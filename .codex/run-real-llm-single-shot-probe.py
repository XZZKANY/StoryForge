"""单发探针：用真实创作 prompt 直接打 _call_llm，区分 mimo HTTP 500 / 超时 / 空返回。

为什么需要它：
  既有 connectivity-probe 只发 "OK"，永远复现不了「完整创作准则 + 长程上下文」下的失败。
  本探针复用 P0-A 给 _call_llm 加的可观测性（stderr 上的 HTTPError/超时/空返回分支），
  用与 _generate_chapter 同款的 full-chapter draft prompt 打一发，把失败模式钉死。

用法（在 apps/api 下，已设置 STORYFORGE_LLM_* 环境变量）：
  cd apps/api
  uv run python ../../.codex/run-real-llm-single-shot-probe.py

可调开关（环境变量，用于 A/B 验证根因与改法）：
  PROBE_INCLUDE_CRAFT_EXAMPLES = 1|0   是否保留好坏对照锚点（默认 1；置 0 验证"示例是否触发 500"）
  STORYFORGE_LLM_REASONING_EFFORT      透传给 payload；置 "minimal"/"low" 验证超长推理假设
  STORYFORGE_LLM_TIMEOUT_SECONDS       透传给 _call_llm；放大可区分"真超时" vs "服务端 500"
  STORYFORGE_LLM_MAX_COMPLETION_TOKENS 控制生成上限

输出：probe_verdict 行明确分类 ok / http_error / timeout_or_conn / empty_return / other。
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

# 让脚本自给自足：无论从哪个 cwd 启动，都能 import app.*（apps/api 不是 site-packages 包）。
_API_DIR = Path(__file__).resolve().parents[1] / "apps" / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))


def _load_prompt_layer() -> tuple[ModuleType, ModuleType]:
    """仿 workflow_prompt_bridge：按文件路径加载 builder/models/context，绕开 langgraph 顶层依赖。"""

    prompts_dir = Path(__file__).resolve().parents[1] / "apps" / "workflow" / "storyforge_workflow" / "prompts"
    if "storyforge_workflow" not in sys.modules:
        pkg = ModuleType("storyforge_workflow")
        pkg.__path__ = [str(prompts_dir.parent)]
        sys.modules["storyforge_workflow"] = pkg
    if "storyforge_workflow.prompts" not in sys.modules:
        prompts_pkg = ModuleType("storyforge_workflow.prompts")
        prompts_pkg.__path__ = [str(prompts_dir)]
        sys.modules["storyforge_workflow.prompts"] = prompts_pkg

    def _load(name: str, path: Path) -> ModuleType:
        spec = importlib.util.spec_from_file_location(name, path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    models = _load("storyforge_workflow.prompts.models", prompts_dir / "models.py")
    _load("storyforge_workflow.prompts.context", prompts_dir / "context.py")
    builder = _load("storyforge_workflow.prompts.builder", prompts_dir / "builder.py")
    return builder, models


def _build_realistic_prompt(builder: ModuleType, models: ModuleType) -> str:
    """构造与 _generate_chapter 同量级的 full-chapter draft prompt（含创作准则锚点）。"""

    ctx = models.NarrativeContext(
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
        user_intent="突出角色强撑与谈判压力。",
        strategy_title="灯塔余烬",
        central_question="信号为何失真，谁在篡改灯塔？",
        reader_promise="兑现悬疑追查与个人代价。",
        chapter_title="暗潮",
        chapter_goal="林岚在港口谈判中争取维修窗口并锁定第一条篡改证据。",
        conflict_axis="外部任务压力挤压角色隐秘伤势。",
        scene_goal="林岚在港口谈判中争取维修窗口。",
        scene_beats=("压住旧伤入场", "信号逼近窗口", "代表提出代价"),
        previous_summary="上一章舰队刚穿过雷暴，补给见底。",
        characters=(
            models.CharacterConstraint(
                name="林岚",
                aliases=("舰长",),
                voice_traits=("克制", "用行动代替解释"),
                forbidden_traits=("大段内心独白", "情绪失控嚎哭"),
                role="主角",
            ),
        ),
        style=models.StyleDirective(
            tone="克制悬疑",
            rules=("多用动作与画面", "对话推动信息"),
            forbidden_phrases=("不禁", "情不自禁"),
            example_sentences=("她把左臂藏进披风，没有解释。",),
            pov="第三人称贴身",
            tense="过去时",
        ),
        pacing=models.PacingDirective(
            intensity="渐强",
            target_chars=900,
            beat_density="紧凑",
            hook_required=True,
            notes=("谈判后半段加速。",),
        ),
        continuity=(
            models.ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
            models.ContinuityFact(statement="灯塔信号每七分钟重复一次", must_appear=True),
        ),
        required_facts=("维修窗口有限", "港口代表索要代价"),
        scene_quality_plan=models.SceneQualityPlan(
            emotional_shift="林岚从克制到被迫暴露旧伤。",
            conflict_turn="港口代表临时抬高维修代价。",
            sensory_anchors=("潮湿铁锈味", "灯塔电流声"),
            dialogue_purpose="让代表用报价逼出林岚的底线。",
            reveal_or_payoff="兑现左臂旧伤伏笔。",
            ending_hook="灯塔信号突然中断。",
        ),
        current_chapter_beat=SimpleNamespace(
            primary_scene_mode="character_conflict",
            forbidden_action_pattern="到新地点-问询-取得小物证-收入口袋-转向下一处",
            required_conflict_type="人物冲突",
            required_turning_point="港口代表拒绝默认维修协议",
            protagonist_mistake="林岚误判港口代表会遵守旧盟约",
            irreversible_consequence="备用维修窗口被取消",
            relationship_shift="林岚与港口代表公开决裂",
            clue_usage_mode="reinterpret_existing",
            new_evidence_allowed=False,
        ),
    )
    return builder.build_draft_prompt(ctx, full_chapter=True)


def main() -> int:
    builder, models = _load_prompt_layer()

    # A/B 开关：置 0 时清空好坏对照锚点，验证"示例是否是 mimo 500 的触发因子"。
    if os.environ.get("PROBE_INCLUDE_CRAFT_EXAMPLES", "1") == "0":
        builder._CRAFT_EXAMPLE_BAD = ""
        builder._CRAFT_EXAMPLE_GOOD = ""
        print("[probe] craft examples DISABLED for this run", file=sys.stderr, flush=True)

    prompt = _build_realistic_prompt(builder, models)
    print(f"[probe] prompt_chars={len(prompt)}", file=sys.stderr, flush=True)

    # 复用 P0-A 给 _call_llm 加的可观测性：HTTPError / 超时 / 空返回各有独立 stderr 分支。
    from app.domains.book_runs.phase9b_real_llm_smoke import (
        Phase9BRealLlmSmokeError,
        _call_llm,
    )

    source = dict(os.environ)
    try:
        result = _call_llm(
            source,
            system_prompt="你是 StoryForge 的中文长篇创作助手。",
            user_prompt=prompt,
        )
    except Phase9BRealLlmSmokeError as exc:
        message = str(exc)
        if "HTTP" in message:
            verdict = "http_error"
        elif "超时" in message or "连接失败" in message:
            verdict = "timeout_or_conn"
        elif "为空" in message:
            verdict = "empty_return"
        else:
            verdict = "other"
        print(f"probe_verdict: {verdict}", flush=True)
        print(f"probe_detail: {message[:500]}", flush=True)
        return 0

    print("probe_verdict: ok", flush=True)
    print(
        f"probe_detail: content_chars={len(result['content'])} "
        f"completion_tokens={result.get('completion_tokens')} latency_ms={result.get('latency_ms')}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
