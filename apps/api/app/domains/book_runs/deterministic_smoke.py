from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.artifacts.models import Artifact
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown
from app.domains.judge.models import JudgeIssue
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run


@dataclass(frozen=True)
class Phase9ADeterministicSmokeResult:
    """9A deterministic 冒烟产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact


def run_phase9a_deterministic_smoke(session: Session) -> Phase9ADeterministicSmokeResult:
    """跑通三章 deterministic BookRun，并导出 Markdown 与审计报告。"""

    book = Book(title="雾港航线", status="draft", premise="林岚在雾港追查失真的灯塔信号。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(session, BookRunCreate(book_id=book.id, blueprint_id=blueprint.id))
    completed_chapters = []
    for chapter_index in range(1, 4):
        chapter = _chapter(session, book.id, chapter_index)
        scene = _approve_deterministic_scene(session, book_run, chapter)
        model_run = _record_deterministic_model_run(session, book_run, scene)
        scene_packet = _record_scene_packet(session, book_run, scene)
        judge = _record_passed_judge(session, book_run, scene, scene_packet)
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": judge.id,
                "repair_patch_id": None,
                "approved_scene_id": scene.id,
            }
        )
    book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status="completed",
            current_chapter_index=3,
            progress={"completed_chapters": completed_chapters},
        ),
    )
    markdown_artifact = export_book_run_markdown(session, book_run.id)
    audit_artifact = export_book_run_audit_report(session, book_run.id)
    return Phase9ADeterministicSmokeResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
    )


def count_markdown_body_words(markdown: str) -> int:
    """统计 Markdown 正文词数，忽略 frontmatter 和标题行。"""

    in_frontmatter = False
    total = 0
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped == "---":
            in_frontmatter = not in_frontmatter
            continue
        if in_frontmatter or not stripped or stripped.startswith("#"):
            continue
        total += len(stripped.split())
    return total


def _blueprint_payload(book_id: int) -> BookBlueprintCreate:
    return BookBlueprintCreate(
        book_id=book_id,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=4500,
        target_chapter_count=3,
        chapter_word_count_min=1000,
        chapter_word_count_max=1800,
        metadata={"pov": "林岚", "location": "雾港"},
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


def _approve_deterministic_scene(session: Session, book_run: BookRun, chapter: Chapter) -> Scene:
    content = _chapter_content(chapter.ordinal)
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title=f"{chapter.title} 正文",
        status="approved",
        content=content,
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def _record_deterministic_model_run(session: Session, book_run: BookRun, scene: Scene):
    return create_model_run(
        session,
        ModelRunCreate(
            book_id=book_run.book_id,
            scene_id=scene.id,
            provider_name="deterministic-smoke",
            model_name="phase9a-mock-writer",
            capability="llm",
            latency_ms=1,
            token_usage=420,
            input_summary=f"生成第 {scene.ordinal} 个场景。",
            output_summary="deterministic 正文已生成。",
            payload={"book_run_id": book_run.id, "mode": "phase9a_deterministic_smoke"},
        ),
    )


def _record_scene_packet(session: Session, book_run: BookRun, scene: Scene) -> ScenePacket:
    packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"book_run_id": book_run.id, "章节目标": scene.title, "证据链接": []},
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
        issue_type="phase9a_smoke_pass",
        severity="low",
        status="resolved",
        description="deterministic 冒烟评审通过。",
        payload={"book_run_id": book_run.id, "score": 100},
    )
    session.add(judge)
    session.commit()
    session.refresh(judge)
    return judge


def _chapter_content(chapter_index: int) -> str:
    sentence = (
        f"第 {chapter_index} 章里 林岚 沿着 雾港 灯塔 的 潮湿 石阶 前进 她 核对 信号 节拍 记录 船队 损伤 "
        "并 在 克制 的 对话 中 推进 调查 每一次 选择 都 留下 可审计 的 行动 证据 "
    )
    return " ".join(sentence.strip() for _ in range(34))
