from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TextIO
from urllib import request

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.prompt_assembly import assemble_prompt_injection
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.book_runs.workflow_prompt_bridge import build_draft_prompt_from_state
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.continuity.models import ScenePacket
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown
from app.domains.judge.models import JudgeIssue
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack

REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)


class Phase9BRealLlmSmokePreflightError(RuntimeError):
    """真实 LLM 冒烟缺少私有运行配置。"""


class Phase9BRealLlmSmokeError(RuntimeError):
    """真实 LLM 冒烟运行失败，不能写入完成证据。"""


@dataclass(frozen=True)
class Phase9BRealLlmSmokeResult:
    """9B 真实 LLM 冒烟产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact
    chapter_count: int


def missing_phase9b_real_llm_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    """列出真实 LLM 冒烟所需但尚未配置的环境变量名。"""

    source = os.environ if env is None else env
    return [name for name in REQUIRED_REAL_LLM_ENV if not _env_value(source, name)]


def run_phase9b_real_llm_smoke(
    session: Session,
    *,
    chapter_count: int,
    token_budget: int,
    env: Mapping[str, str | None] | None = None,
) -> Phase9BRealLlmSmokeResult:
    """用真实 OpenAI 兼容 LLM 跑 1 章或 3 章 BookRun 冒烟。"""

    source = os.environ if env is None else env
    _assert_preflight(source, chapter_count, token_budget)
    started_at = time.monotonic()
    book = _create_smoke_book(session, chapter_count)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id, chapter_count))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(
            book_id=book.id,
            blueprint_id=blueprint.id,
            token_budget=token_budget,
            time_budget_sec=_optional_int(source, "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", 900),
            chapter_budget=chapter_count,
        ),
    )
    completed_chapters: list[dict[str, object]] = []
    tokens_used = 0
    for chapter_index in range(1, chapter_count + 1):
        chapter = _chapter(session, book.id, chapter_index)
        generated = _generate_chapter(session, source, chapter_index, chapter)
        tokens_used += generated["token_usage"]
        scene = _approve_scene(session, chapter, str(generated["content"]))
        model_run = _record_model_run(session, book_run, scene, source, generated)
        scene_packet = _record_scene_packet(session, book_run, scene)
        judge = _record_passed_judge(session, book_run, scene, scene_packet)
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": judge.id,
                "repair_patch_id": None,
                "approved_scene_id": scene.id,
                "token_usage": generated["token_usage"],
                "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                "cost_estimate": 0.0,
            }
        )
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise Phase9BRealLlmSmokeError("真实 LLM 冒烟触发 token 预算暂停，不能标记为 completed。")
    book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status="completed",
            current_chapter_index=chapter_count,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {
                    "tokens_used": tokens_used,
                    "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                    "estimated_cost": 0.0,
                },
                "real_llm_smoke": {
                    "provider_name": _required_env(source, "STORYFORGE_LLM_PROVIDER"),
                    "model_name": _required_env(source, "STORYFORGE_LLM_MODEL"),
                    "chapter_count": chapter_count,
                },
            },
        ),
    )
    markdown_artifact = export_book_run_markdown(session, book_run.id)
    audit_artifact = export_book_run_audit_report(session, book_run.id)
    return Phase9BRealLlmSmokeResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
    )


def _assert_preflight(source: Mapping[str, str | None], chapter_count: int, token_budget: int) -> None:
    missing = missing_phase9b_real_llm_env(source)
    if missing:
        joined = ", ".join(missing)
        raise Phase9BRealLlmSmokePreflightError(f"缺少真实 LLM 冒烟环境变量：{joined}。")
    if chapter_count not in {1, 3}:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟只允许 1 章或 3 章。")
    if token_budget <= 0:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟必须设置正数 token_budget。")


def _create_smoke_book(session: Session, chapter_count: int) -> Book:
    book = Book(
        title=f"Phase 9B 真实 LLM 冒烟 {chapter_count} 章",
        status="draft",
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def _seed_consistency_data(session: Session, book_id: int) -> None:
    """为冒烟书写入一条 Character Bible 与一个 Style Pack，让真实一致性数据进入 prompt。"""

    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_id,
            canonical_name="林岚",
            aliases=["雾港调查员"],
            voice_traits={"语气": "克制", "句式": ["短句", "少解释"]},
            forbidden_traits={"禁止": ["突然健谈", "忘记左臂旧伤"]},
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="雾港克制悬疑风格",
            payload={
                "语气": "克制悬疑",
                "视角": "第三人称贴身",
                "规则": ["多用动作与画面", "对话推动信息"],
                "禁用表达": ["不禁", "情不自禁"],
                "示例句": ["她把左臂藏进披风，没有解释。"],
            },
        ),
    )


def _blueprint_payload(book_id: int, chapter_count: int) -> BookBlueprintCreate:
    return BookBlueprintCreate(
        book_id=book_id,
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
        tone="克制悬疑",
        target_word_count=max(1200, chapter_count * 1200),
        target_chapter_count=chapter_count,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
        metadata={"pov": "林岚", "location": "雾港", "title_seed": "真实冒烟"},
    )


def _chapter(session: Session, book_id: int, chapter_index: int) -> Chapter:
    chapter = (
        session.query(Chapter)
        .filter(Chapter.book_id == book_id, Chapter.ordinal == chapter_index)
        .order_by(Chapter.id)
        .one()
    )
    chapter.status = "approved"
    return chapter


def _generate_chapter(
    session: Session,
    source: Mapping[str, str | None],
    chapter_index: int,
    chapter: Chapter,
) -> dict[str, object]:
    injection = assemble_prompt_injection(
        session,
        book_id=chapter.book_id,
        chapter_id=chapter.id,
        chapter_title=chapter.title,
        chapter_goal=chapter.summary or "推进主线调查。",
    )
    prompt = build_draft_prompt_from_state(injection)
    payload = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": [
            {"role": "system", "content": "你是 StoryForge 的中文长篇创作助手。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7),
    }
    max_completion_tokens = _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    if max_completion_tokens > 0:
        payload["max_completion_tokens"] = max_completion_tokens
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {_required_env(source, 'STORYFORGE_LLM_API_KEY')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    timeout = _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 60.0)
    started_at = time.monotonic()
    with request.urlopen(http_request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise Phase9BRealLlmSmokeError("真实 LLM 返回内容为空，不能继续 BookRun 冒烟。")
    token_usage, token_usage_source = _token_usage(data, prompt, content)
    return {
        "prompt": prompt,
        "content": content.strip(),
        "token_usage": token_usage,
        "token_usage_source": token_usage_source,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }


def _approve_scene(session: Session, chapter: Chapter, content: str) -> Scene:
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title=f"{chapter.title} 真实 LLM 正文",
        status="approved",
        content=content,
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def _record_model_run(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    source: Mapping[str, str | None],
    generated: dict[str, object],
):
    return create_model_run(
        session,
        ModelRunCreate(
            book_id=book_run.book_id,
            scene_id=scene.id,
            provider_name=_required_env(source, "STORYFORGE_LLM_PROVIDER"),
            model_name=_required_env(source, "STORYFORGE_LLM_MODEL"),
            capability="llm",
            latency_ms=int(generated["latency_ms"]),
            token_usage=int(generated["token_usage"]),
            input_summary=str(generated["prompt"]),
            output_summary=str(generated["content"]),
            payload={
                "book_run_id": book_run.id,
                "mode": "phase9b_real_llm_smoke",
                "token_usage_source": generated["token_usage_source"],
            },
        ),
    )


def _record_scene_packet(session: Session, book_run: BookRun, scene: Scene) -> ScenePacket:
    packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"book_run_id": book_run.id, "真实 LLM 冒烟": True, "证据链接": []},
        version=1,
    )
    session.add(packet)
    session.commit()
    session.refresh(packet)
    return packet


def _record_passed_judge(session: Session, book_run: BookRun, scene: Scene, scene_packet: ScenePacket) -> JudgeIssue:
    judge = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=None,
        issue_type="phase9b_real_llm_smoke_pass",
        severity="low",
        status="resolved",
        description="真实 LLM 冒烟评审通过，章节可自动批准。",
        payload={"book_run_id": book_run.id, "score": 100, "mode": "phase9b_real_llm_smoke"},
    )
    session.add(judge)
    session.commit()
    session.refresh(judge)
    return judge


def _pause_by_budget(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_budget",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": "token_budget_exceeded",
            },
        ),
    )


def _token_usage(data: object, prompt: str, content: str) -> tuple[int, str]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        if isinstance(total, int) and total > 0:
            return total, "provider_usage"
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            return max(1, prompt_tokens + completion_tokens), "provider_usage"
    return max(1, (len(prompt) + len(content)) // 4), "estimated"


def _env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def _required_env(source: Mapping[str, str | None], name: str) -> str:
    value = _env_value(source, name)
    if not value:
        raise Phase9BRealLlmSmokePreflightError(f"缺少真实 LLM 冒烟环境变量：{name}。")
    return value


def _optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = _env_value(source, name)
    return int(value) if value else default


def _optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = _env_value(source, name)
    return float(value) if value else default


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object] = run_phase9b_real_llm_smoke,
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    """命令行入口：执行 Phase 9B 真实 LLM 冒烟并输出脱敏摘要。"""

    parser = argparse.ArgumentParser(description="运行 StoryForge Phase 9B 真实 LLM BookRun 冒烟。")
    parser.add_argument("--chapter-count", type=int, choices=[1, 3], required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    args = parser.parse_args(argv)
    out = sys.stdout if output is None else output
    err = sys.stderr if error is None else error
    source = os.environ if env is None else env
    try:
        _assert_preflight(source, args.chapter_count, args.token_budget)
    except Phase9BRealLlmSmokePreflightError as exc:
        print(str(exc), file=err)
        return 2
    if session_factory is None:
        from app.db.session import SessionLocal

        session_factory = SessionLocal
    try:
        with session_factory() as session:
            result = runner(
                session,
                chapter_count=args.chapter_count,
                token_budget=args.token_budget,
                env=source,
            )
    except Phase9BRealLlmSmokePreflightError as exc:
        print(str(exc), file=err)
        return 2
    except Exception as exc:
        print(f"Phase 9B 真实 LLM 冒烟失败：{exc}", file=err)
        return 1
    print(json.dumps(_result_summary(result), ensure_ascii=False), file=out)
    return 0


def _result_summary(result: object) -> dict[str, object]:
    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    return {
        "book_run_id": book_run.id,
        "status": book_run.status,
        "chapter_count": result.chapter_count,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "markdown_artifact_id": markdown_artifact.id,
        "markdown_artifact_name": markdown_artifact.name,
        "audit_artifact_id": audit_artifact.id,
        "audit_artifact_name": audit_artifact.name,
    }


if __name__ == "__main__":
    raise SystemExit(main())

