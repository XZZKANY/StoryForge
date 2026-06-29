from __future__ import annotations

from types import SimpleNamespace

from storyforge_workflow.prompts import (
    build_chapter_plan_prompt,
    build_critique_prompt,
    build_draft_prompt,
    build_longform_segment_prompt,
    build_revision_prompt,
    build_scene_beats_prompt,
    build_strategy_prompt,
)
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.prompts.models import (
    CharacterConstraint,
    ContinuityFact,
    NarrativeContext,
    PacingDirective,
    SceneQualityPlan,
    StyleDirective,
)


def _full_context() -> NarrativeContext:
    return NarrativeContext(
        premise="远航舰队寻找新家园。",
        user_intent="突出角色强撑与谈判压力。",
        strategy_title="灯塔余烬",
        central_question="舰队能否在旧伤中找到新家园？",
        reader_promise="兑现迁徙史诗与个人代价。",
        chapter_title="暗潮",
        chapter_goal="舰队抵达灯塔港并争取维修窗口。",
        conflict_axis="外部任务压力挤压角色隐秘伤势。",
        scene_goal="林岚在港口谈判中争取维修窗口。",
        scene_beats=("压住旧伤入场", "信号逼近窗口", "代表提出代价"),
        previous_summary="上一章舰队刚穿过雷暴，补给见底。",
        characters=(
            CharacterConstraint(
                name="林岚",
                aliases=("舰长",),
                voice_traits=("克制", "用行动代替解释"),
                forbidden_traits=("大段内心独白", "情绪失控嚎哭"),
                role="主角",
            ),
        ),
        style=StyleDirective(
            tone="克制悬疑",
            rules=("多用动作与画面", "对话推动信息"),
            forbidden_phrases=("不禁", "情不自禁"),
            example_sentences=("她把左臂藏进披风，没有解释。",),
            pov="第三人称贴身",
            tense="过去时",
        ),
        pacing=PacingDirective(
            intensity="渐强",
            target_chars=800,
            beat_density="紧凑",
            hook_required=True,
            notes=("谈判后半段加速。",),
        ),
        continuity=(
            ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
            ContinuityFact(statement="灯塔信号每七分钟重复一次", must_appear=True),
        ),
        required_facts=("维修窗口有限", "港口代表索要代价"),
        scene_quality_plan=SceneQualityPlan(
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


def test_draft_prompt_injects_all_layers() -> None:
    prompt = build_draft_prompt(_full_context())
    # 任务边界（兼容网关模型）
    assert "Return only Chinese prose" in prompt
    assert "Do not ask questions" in prompt
    # 作品策略
    assert "灯塔余烬" in prompt
    assert "舰队能否在旧伤中找到新家园？" in prompt
    # 角色正向与负向约束
    assert "林岚" in prompt
    assert "用行动代替解释" in prompt
    assert "禁止表现：大段内心独白、情绪失控嚎哭" in prompt
    # 风格：规则 / 禁用表达 / 示例句
    assert "禁用表达（绝不能出现）：不禁、情不自禁" in prompt
    assert "她把左臂藏进披风，没有解释。" in prompt
    # 连续性必含事实
    assert "林岚左臂受伤未愈（本段必须体现）" in prompt
    assert "维修窗口有限、港口代表索要代价" in prompt
    # 上文衔接
    assert "上一章舰队刚穿过雷暴" in prompt
    # 节奏
    assert "目标篇幅：约 800 个中文字符" in prompt
    assert "段末必须留下推动下一段的钩子" in prompt



def test_draft_prompt_injects_scene_quality_plan() -> None:
    prompt = build_draft_prompt(_full_context())
    assert "【场景质量计划】" in prompt
    assert "情绪变化：林岚从克制到被迫暴露旧伤。" in prompt
    assert "冲突转折：港口代表临时抬高维修代价。" in prompt
    assert "感官锚点：潮湿铁锈味、灯塔电流声" in prompt
    assert "对白目的：让代表用报价逼出林岚的底线。" in prompt
    assert "伏笔/兑现：兑现左臂旧伤伏笔。" in prompt
    assert "结尾钩子：灯塔信号突然中断。" in prompt


def test_draft_prompt_injects_chapter_beat_contract() -> None:
    prompt = build_draft_prompt(_full_context())
    assert "【ChapterBeat 结构门槛】" in prompt
    assert "primary_scene_mode：character_conflict" in prompt
    assert "禁止使用默认调查推进模板" in prompt


def test_longform_prompt_injects_chapter_beat_contract() -> None:
    prompt = build_longform_segment_prompt(
        _full_context(),
        title="灯塔余烬",
        segment_index=2,
        segment_target_chars=900,
        remaining_chars=4500,
    )
    assert "【ChapterBeat 结构门槛】" in prompt
    assert "primary_scene_mode：character_conflict" in prompt
    assert "禁止使用默认调查推进模板" in prompt


def test_context_from_state_maps_scene_quality_plan() -> None:
    ctx = narrative_context_from_state(
        {
            "scene_quality_plan": {
                "emotional_shift": "林岚从克制到被迫暴露旧伤。",
                "conflict_turn": "港口代表临时抬高维修代价。",
                "sensory_anchors": ["潮湿铁锈味", "灯塔电流声"],
                "dialogue_purpose": "让代表用报价逼出林岚的底线。",
                "reveal_or_payoff": "兑现左臂旧伤伏笔。",
                "ending_hook": "灯塔信号突然中断。",
            }
        }
    )
    assert ctx.scene_quality_plan.emotional_shift == "林岚从克制到被迫暴露旧伤。"
    assert ctx.scene_quality_plan.conflict_turn == "港口代表临时抬高维修代价。"
    assert ctx.scene_quality_plan.sensory_anchors == ("潮湿铁锈味", "灯塔电流声")
    assert ctx.scene_quality_plan.dialogue_purpose == "让代表用报价逼出林岚的底线。"
    assert ctx.scene_quality_plan.reveal_or_payoff == "兑现左臂旧伤伏笔。"
    assert ctx.scene_quality_plan.ending_hook == "灯塔信号突然中断。"


def test_context_from_state_ignores_invalid_scene_quality_plan() -> None:
    ctx = narrative_context_from_state({"scene_quality_plan": "坏数据"})
    assert not ctx.scene_quality_plan.has_content()

def test_draft_prompt_omits_empty_sections() -> None:
    prompt = build_draft_prompt(NarrativeContext(premise="孤舟独行。", scene_goal="抵岸。"))
    assert "孤舟独行。" in prompt
    # 没有角色 / 风格 / 节奏数据时，相应分层标题不出现
    assert "【角色约束" not in prompt
    assert "【文风要求】" not in prompt
    assert "【节奏控制】" not in prompt
    assert "【上文衔接" not in prompt
    # 无 target_chars 时回退到预览字数约束
    assert "字以内的中文正文预览" in prompt


def test_strategy_prompt_requests_four_lines() -> None:
    prompt = build_strategy_prompt(_full_context())
    assert "输出且仅输出四行" in prompt
    assert "标题、核心问题、语气、读者承诺" in prompt
    assert "灯塔余烬" in prompt


def test_chapter_plan_prompt_requests_three_lines_with_constraints() -> None:
    prompt = build_chapter_plan_prompt(_full_context())
    assert "输出且仅输出三行" in prompt
    assert "章节标题、章节目标、冲突轴" in prompt
    # 章节规划阶段也应带角色与连续性约束
    assert "林岚" in prompt
    assert "灯塔信号每七分钟重复一次" in prompt


def test_scene_beats_prompt_requests_three_beats_with_pacing() -> None:
    prompt = build_scene_beats_prompt(_full_context())
    assert "输出且仅输出三行" in prompt
    assert "林岚在港口谈判中争取维修窗口。" in prompt
    assert "压住旧伤入场" in prompt
    assert "张力强度：渐强" in prompt


def test_context_from_state_maps_injection_keys() -> None:
    state = {
        "premise": "远航舰队寻找新家园。",
        "scene_goal_ref": "争取维修窗口。",
        "scene_beat_refs": ["入场", "施压"],
        "required_fact_refs": ["左臂受伤"],
        "character_constraints": [
            {
                "name": "林岚",
                "aliases": ["舰长"],
                "voice_traits": ["克制"],
                "forbidden_traits": ["情绪失控"],
                "role": "主角",
            }
        ],
        "style_directive": {"规则": ["多用动作"], "禁用表达": ["不禁"], "示例句": ["她没有解释。"]},
        "pacing_directive": {"intensity": "渐强", "target_chars": 600, "hook_required": True},
        "continuity_facts": [{"statement": "左臂未愈", "must_appear": True}],
        "previous_summary_ref": "刚穿过雷暴。",
    }
    ctx = narrative_context_from_state(state)
    assert ctx.characters[0].name == "林岚"
    assert ctx.characters[0].forbidden_traits == ("情绪失控",)
    assert ctx.style.rules == ("多用动作",)
    assert ctx.style.forbidden_phrases == ("不禁",)
    assert ctx.pacing.target_chars == 600
    assert ctx.pacing.hook_required is True
    assert ctx.continuity[0].must_appear is True
    assert ctx.previous_summary == "刚穿过雷暴。"

    prompt = build_draft_prompt(ctx)
    assert "禁止表现：情绪失控" in prompt
    assert "目标篇幅：约 600 个中文字符" in prompt


def test_context_from_state_falls_back_to_protagonist_ref() -> None:
    state = {"premise": "孤舟。", "protagonist_ref": "陈舟", "scene_goal_ref": "抵岸。"}
    ctx = narrative_context_from_state(state)
    assert ctx.characters[0].name == "陈舟"
    assert ctx.characters[0].role == "主角"


def test_context_from_state_handles_bare_continuity_strings() -> None:
    ctx = narrative_context_from_state({"premise": "x", "continuity_facts": ["事实甲", "  ", "事实乙"]})
    assert [fact.statement for fact in ctx.continuity] == ["事实甲", "事实乙"]
    assert all(fact.must_appear is False for fact in ctx.continuity)


def test_context_from_state_sorts_and_truncates_continuity_facts_by_budget(monkeypatch) -> None:
    """连续性事实应在 prompt 边界按重要性截断，避免长书事实撑爆上下文。"""

    monkeypatch.setenv("STORYFORGE_CONTINUITY_FACT_TOKEN_BUDGET", "12")
    state = {
        "chapter_index": 10,
        "style_directive": {"pov": "林岚"},
        "continuity_facts": [
            {
                "statement": "远章配角事实会被预算截断",
                "source_ref": "chapter:1",
                "character_role": "配角",
            },
            {
                "statement": "林岚近章必须体现",
                "source_ref": "chapter:9",
                "must_appear": True,
                "pov": "林岚",
            },
            {
                "statement": "林岚近章普通事实",
                "source_ref": "chapter:8",
                "pov": "林岚",
            },
            {
                "statement": "反派近章普通事实",
                "source_ref": "chapter:9",
                "character_role": "配角",
            },
        ],
    }

    ctx = narrative_context_from_state(state)

    assert [fact.statement for fact in ctx.continuity] == [
        "林岚近章必须体现",
        "林岚近章普通事实",
    ]
    assert ctx.continuity[0].must_appear is True


def test_draft_prompt_injects_craft_guidelines() -> None:
    prompt = build_draft_prompt(_full_context())
    assert "【创作准则" in prompt
    assert "show, don't tell" in prompt
    # 反套话词表（软禁用）应出现在创作准则里
    assert "忽然" in prompt
    assert "五味杂陈" in prompt
    # 好坏对照锚点
    assert "反例" in prompt
    assert "正例" in prompt


def test_draft_prompt_craft_examples_follow_builder_facade_override(monkeypatch) -> None:
    """诊断脚本可 patch builder._CRAFT_EXAMPLE_* 做好坏锚点 A/B 开关，渲染须随之变化。"""

    from storyforge_workflow.prompts import builder

    monkeypatch.setattr(builder, "_CRAFT_EXAMPLE_BAD", "")
    monkeypatch.setattr(builder, "_CRAFT_EXAMPLE_GOOD", "")
    prompt = build_draft_prompt(_full_context())
    assert "【创作准则" in prompt
    assert "反例" not in prompt
    assert "正例" not in prompt


def test_longform_segment_prompt_injects_craft_guidelines() -> None:
    prompt = build_longform_segment_prompt(
        _full_context(),
        title="灯塔余烬",
        segment_index=2,
        segment_target_chars=900,
        remaining_chars=4500,
    )
    # 连载位置契约行保留
    assert "标题：灯塔余烬" in prompt
    assert "当前段号：2" in prompt
    # 创作准则同样注入
    assert "【创作准则" in prompt
    assert "show, don't tell" in prompt
    assert "忽然" in prompt


def test_critique_prompt_states_pass_and_issue_contract() -> None:
    prompt = build_critique_prompt(_full_context(), "林岚很愤怒地进入谈判。")
    # 待审正文应被嵌入
    assert "林岚很愤怒地进入谈判。" in prompt
    # 通过哨兵契约
    assert "只输出一行：通过" in prompt
    # 问题行格式契约
    assert "维度｜命中片段｜应如何修" in prompt
    # 评审维度
    assert "角色一致性" in prompt
    assert "连续性" in prompt



def test_critique_prompt_requests_structured_quality_scores() -> None:
    prompt = build_critique_prompt(_full_context(), "林岚很愤怒地进入谈判。")
    assert "DECISION: pass|repair|regenerate|awaiting_review" in prompt
    for dimension in (
        "prose_quality",
        "show_dont_tell",
        "character_consistency",
        "continuity_consistency",
        "scene_progression",
        "pacing_control",
        "hook_strength",
        "ai_artifact_penalty",
    ):
        assert dimension in prompt
    assert "ISSUE: 维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果" in prompt
    assert "BEAT_FULFILLMENT: yes|partial|no" in prompt
    assert "NARRATIVE_COLLAPSE: none|warning|soft_fail|hard_fail" in prompt


def test_critique_prompt_score_contract_has_unique_dimensions() -> None:
    prompt = build_critique_prompt(_full_context(), "林岚很愤怒地进入谈判。")
    score_line = next(line for line in prompt.splitlines() if line.startswith("SCORE: "))
    dimensions = [part.split("=", 1)[0].strip() for part in score_line.removeprefix("SCORE: ").split(";")]
    assert len(dimensions) == len(set(dimensions))


def test_critique_prompt_injects_chapter_beat_contract() -> None:
    ctx = NarrativeContext(
        chapter_title="第八章：裂痕",
        scene_goal="林岚在对峙中为误判付出代价。",
        current_chapter_beat=SimpleNamespace(
            primary_scene_mode="character_conflict",
            forbidden_action_pattern="到新地点-问询-取得小物证-收入口袋-转向下一处",
            required_conflict_type="人物冲突",
            required_turning_point="周砚拒绝交出旧记录",
            protagonist_mistake="林岚误信灯塔账本",
            irreversible_consequence="证人保护资格被撤销",
            relationship_shift="林岚与周砚信任破裂",
            clue_usage_mode="reinterpret_existing",
            new_evidence_allowed=False,
        ),
    )

    prompt = build_critique_prompt(ctx, "林岚走进档案室，问完话后把记录收进口袋。")

    assert "【ChapterBeat 结构门槛】" in prompt
    assert "primary_scene_mode：character_conflict" in prompt
    assert "protagonist_mistake：林岚误信灯塔账本" in prompt
    assert "beat_fulfillment" in prompt
    assert "narrative_collapse" in prompt
    assert "BEAT_FULFILLMENT: yes|partial|no" in prompt
    assert "NARRATIVE_COLLAPSE: none|warning|soft_fail|hard_fail" in prompt
    assert "structure_repair" in prompt
    assert "convert_process_to_scene" in prompt
    assert "reinterpret_existing_clue" in prompt


def test_revision_prompt_supports_revision_strategy_contract() -> None:
    prompt = build_revision_prompt(
        _full_context(),
        "她很害怕地靠近门。",
        ["文笔｜中｜她很害怕｜直接说明情绪｜line_edit｜她正在靠近门｜很害怕｜用动作和触觉呈现恐惧"],
    )
    assert "line_edit" in prompt
    assert "scene_patch" in prompt
    assert "regenerate" in prompt
    assert "必须保留" in prompt
    assert "必须删除" in prompt
    assert "目标效果" in prompt
    assert "只输出修订后的完整正文" in prompt

def test_revision_prompt_lists_issues_and_keeps_clean_parts() -> None:
    prompt = build_revision_prompt(
        _full_context(),
        "林岚很愤怒地进入谈判。",
        ["文笔｜他很愤怒｜用动作呈现情绪"],
    )
    assert "林岚很愤怒地进入谈判。" in prompt
    assert "文笔｜他很愤怒｜用动作呈现情绪" in prompt
    assert "只改有问题的部分" in prompt
    assert "只输出修订后的完整正文" in prompt


def test_style_section_renders_fingerprint_targets() -> None:
    style = StyleDirective(
        tone="克制",
        target_avg_sentence_length=22.0,
        target_dialogue_ratio=0.35,
        restraint=True,
    )
    ctx = NarrativeContext(premise="x", scene_goal="y", style=style)
    prompt = build_draft_prompt(ctx)
    assert "目标句长：平均约 22 字/句" in prompt
    assert "参考占比 0.35" in prompt
    assert "保持克制叙述" in prompt


def test_style_from_state_maps_fingerprint_into_targets() -> None:
    ctx = narrative_context_from_state(
        {
            "premise": "x",
            "scene_goal_ref": "y",
            "style_directive": {
                "tone": "克制",
                "fingerprint": {
                    "average_sentence_length": 18.0,
                    "dialogue_ratio": 0.4,
                    "restraint_density": 0.6,
                },
            },
        }
    )
    assert ctx.style.target_avg_sentence_length == 18.0
    assert ctx.style.target_dialogue_ratio == 0.4
    assert ctx.style.restraint is True
