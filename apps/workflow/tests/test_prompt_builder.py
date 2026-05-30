from __future__ import annotations

from storyforge_workflow.prompts import (
    CharacterConstraint,
    ContinuityFact,
    NarrativeContext,
    PacingDirective,
    SceneQualityPlan,
    StyleDirective,
    build_chapter_plan_prompt,
    build_critique_prompt,
    build_draft_prompt,
    build_longform_segment_prompt,
    build_revision_prompt,
    build_scene_beats_prompt,
    build_strategy_prompt,
)
from storyforge_workflow.prompts.context import narrative_context_from_state


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
        scene_quality_plan=SceneQualityPlan(
            emotional_shift="\u6797\u5c9a\u4ece\u514b\u5236\u5230\u88ab\u8feb\u66b4\u9732\u65e7\u4f24\u3002",
            conflict_turn="\u6e2f\u53e3\u4ee3\u8868\u4e34\u65f6\u62ac\u9ad8\u7ef4\u4fee\u4ee3\u4ef7\u3002",
            sensory_anchors=("\u6f6e\u6e7f\u94c1\u9508\u5473", "\u706f\u5854\u7535\u6d41\u58f0"),
            dialogue_purpose="\u8ba9\u4ee3\u8868\u7528\u62a5\u4ef7\u903c\u51fa\u6797\u5c9a\u7684\u5e95\u7ebf\u3002",
            reveal_or_payoff="\u5151\u73b0\u5de6\u81c2\u65e7\u4f24\u4f0f\u7b14\u3002",
            ending_hook="\u706f\u5854\u4fe1\u53f7\u7a81\u7136\u4e2d\u65ad\u3002",
        ),
        continuity=(
            ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
            ContinuityFact(statement="灯塔信号每七分钟重复一次", must_appear=True),
        ),
        required_facts=("维修窗口有限", "港口代表索要代价"),
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
    assert "\u3010\u573a\u666f\u8d28\u91cf\u8ba1\u5212\u3011" in prompt
    assert "\u60c5\u7eea\u53d8\u5316\uff1a\u6797\u5c9a\u4ece\u514b\u5236\u5230\u88ab\u8feb\u66b4\u9732\u65e7\u4f24\u3002" in prompt
    assert "\u51b2\u7a81\u8f6c\u6298\uff1a\u6e2f\u53e3\u4ee3\u8868\u4e34\u65f6\u62ac\u9ad8\u7ef4\u4fee\u4ee3\u4ef7\u3002" in prompt
    assert "\u611f\u5b98\u951a\u70b9\uff1a\u6f6e\u6e7f\u94c1\u9508\u5473\u3001\u706f\u5854\u7535\u6d41\u58f0" in prompt
    assert "\u5bf9\u767d\u76ee\u7684\uff1a\u8ba9\u4ee3\u8868\u7528\u62a5\u4ef7\u903c\u51fa\u6797\u5c9a\u7684\u5e95\u7ebf\u3002" in prompt
    assert "\u4f0f\u7b14/\u5151\u73b0\uff1a\u5151\u73b0\u5de6\u81c2\u65e7\u4f24\u4f0f\u7b14\u3002" in prompt
    assert "\u7ed3\u5c3e\u94a9\u5b50\uff1a\u706f\u5854\u4fe1\u53f7\u7a81\u7136\u4e2d\u65ad\u3002" in prompt


def test_context_from_state_maps_scene_quality_plan() -> None:
    ctx = narrative_context_from_state(
        {
            "scene_quality_plan": {
                "emotional_shift": "\u6797\u5c9a\u4ece\u514b\u5236\u5230\u88ab\u8feb\u66b4\u9732\u65e7\u4f24\u3002",
                "conflict_turn": "\u6e2f\u53e3\u4ee3\u8868\u4e34\u65f6\u62ac\u9ad8\u7ef4\u4fee\u4ee3\u4ef7\u3002",
                "sensory_anchors": ["\u6f6e\u6e7f\u94c1\u9508\u5473", "\u706f\u5854\u7535\u6d41\u58f0"],
                "dialogue_purpose": "\u8ba9\u4ee3\u8868\u7528\u62a5\u4ef7\u903c\u51fa\u6797\u5c9a\u7684\u5e95\u7ebf\u3002",
                "reveal_or_payoff": "\u5151\u73b0\u5de6\u81c2\u65e7\u4f24\u4f0f\u7b14\u3002",
                "ending_hook": "\u706f\u5854\u4fe1\u53f7\u7a81\u7136\u4e2d\u65ad\u3002",
            }
        }
    )
    assert ctx.scene_quality_plan.emotional_shift == "\u6797\u5c9a\u4ece\u514b\u5236\u5230\u88ab\u8feb\u66b4\u9732\u65e7\u4f24\u3002"
    assert ctx.scene_quality_plan.conflict_turn == "\u6e2f\u53e3\u4ee3\u8868\u4e34\u65f6\u62ac\u9ad8\u7ef4\u4fee\u4ee3\u4ef7\u3002"
    assert ctx.scene_quality_plan.sensory_anchors == ("\u6f6e\u6e7f\u94c1\u9508\u5473", "\u706f\u5854\u7535\u6d41\u58f0")
    assert ctx.scene_quality_plan.dialogue_purpose == "\u8ba9\u4ee3\u8868\u7528\u62a5\u4ef7\u903c\u51fa\u6797\u5c9a\u7684\u5e95\u7ebf\u3002"
    assert ctx.scene_quality_plan.reveal_or_payoff == "\u5151\u73b0\u5de6\u81c2\u65e7\u4f24\u4f0f\u7b14\u3002"
    assert ctx.scene_quality_plan.ending_hook == "\u706f\u5854\u4fe1\u53f7\u7a81\u7136\u4e2d\u65ad\u3002"


def test_critique_prompt_requests_structured_quality_scores() -> None:
    prompt = build_critique_prompt(_full_context(), "\u6797\u5c9a\u628a\u5de6\u81c2\u85cf\u5728\u62ab\u98ce\u4e0b\u3002")
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
    assert "DECISION: pass|repair|regenerate|awaiting_review" in prompt
    assert "SCORE:" in prompt
    assert "ISSUE: \u7ef4\u5ea6\uff5c\u4e25\u91cd\u7ea7\u522b\uff5c\u547d\u4e2d\u7247\u6bb5\uff5c\u539f\u56e0\uff5c\u4fee\u8ba2\u7b56\u7565\uff5c\u5fc5\u987b\u4fdd\u7559\uff5c\u5fc5\u987b\u5220\u9664\uff5c\u76ee\u6807\u6548\u679c" in prompt


def test_revision_prompt_supports_revision_strategy_contract() -> None:
    prompt = build_revision_prompt(
        _full_context(),
        "\u5979\u5f88\u5bb3\u6015\uff0c\u6b63\u5728\u9760\u8fd1\u95e8\u3002",
        ["\u6587\u7b14\uff5c\u4e2d\uff5c\u5979\u5f88\u5bb3\u6015\uff5c\u76f4\u63a5\u8bf4\u660e\u60c5\u7eea\uff5cline_edit\uff5c\u5979\u6b63\u5728\u9760\u8fd1\u95e8\uff5c\u5f88\u5bb3\u6015\uff5c\u7528\u52a8\u4f5c\u548c\u89e6\u89c9\u5448\u73b0\u6050\u60e7"],
    )
    assert "line_edit" in prompt
    assert "scene_patch" in prompt
    assert "regenerate" in prompt
    assert "\u5fc5\u987b\u4fdd\u7559" in prompt
    assert "\u5fc5\u987b\u5220\u9664" in prompt
    assert "\u76ee\u6807\u6548\u679c" in prompt


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
    prompt = build_critique_prompt(_full_context(), "???????????")
    # ????????
    assert "???????????" in prompt
    # ?????????????
    assert "DECISION: pass|repair|regenerate|awaiting_review" in prompt
    assert "SCORE:" in prompt
    assert "ISSUE: \u7ef4\u5ea6\uff5c\u4e25\u91cd\u7ea7\u522b\uff5c\u547d\u4e2d\u7247\u6bb5\uff5c\u539f\u56e0\uff5c\u4fee\u8ba2\u7b56\u7565\uff5c\u5fc5\u987b\u4fdd\u7559\uff5c\u5fc5\u987b\u5220\u9664\uff5c\u76ee\u6807\u6548\u679c" in prompt
    # ????
    assert "character_consistency" in prompt
    assert "continuity_consistency" in prompt


def test_revision_prompt_lists_issues_and_keeps_clean_parts() -> None:
    prompt = build_revision_prompt(
        _full_context(),
        "林岚很愤怒地进入谈判。",
        ["文笔｜他很愤怒｜用动作呈现情绪"],
    )
    assert "林岚很愤怒地进入谈判。" in prompt
    assert "文笔｜他很愤怒｜用动作呈现情绪" in prompt
    assert "严格遵守必须保留" in prompt
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
