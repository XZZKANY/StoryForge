"""prompt 对比实验台的固定输入集。

参照 tests/test_prompt_assembly.py 的「雾港装配」种子手写（林岚/雾港/灯塔信号失真/
克制悬疑/左臂受伤），全部不依赖 DB——NarrativeContext 是冻结 dataclass，直接构造。
三份输入覆盖产字两条分支（预览 / 完整正文）、评稿、修订与 agent 组装链单轮回话。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domains.book_runs.prompts.models import (
    CharacterConstraint,
    ContinuityFact,
    NarrativeContext,
    PacingDirective,
    SceneQualityPlan,
    StyleDirective,
)

# 供评稿 / 修订共用的手工正文：故意埋说明腔（情绪形容词收尾）、陈词（不禁 / 无法言喻）、一处节奏断裂。
MANUAL_DRAFT = (
    "林岚走进修船坞，闻到了机油和潮水的味道。"
    "她不禁想起昨夜灯塔的异响，心中五味杂陈。"
    "船坞老板老陈正在清点缆绳，看到她进来，放下了手里的活。"
    "“又是你。”老陈说。"
    "林岚出示了旧港的通行证，问他最近有没有人修过信号灯。"
    "老陈摇摇头，说修船坞三个月没人动过灯塔的零件。"
    "林岚望着他，觉得他一定在隐瞒什么，心中一震。"
    "她把通行证收进口袋，转身离开，走得很慢，心情无法言喻。"
)

OPENING_CTX = NarrativeContext(
    premise="林岚在雾港追查失真的灯塔信号。",
    user_intent="写第一章的开篇段落，建立氛围与人物。",
    strategy_title="灯塔余烬",
    central_question="失真的灯塔信号究竟在向谁传递什么？",
    reader_promise="克制悬疑：信息一点一点漏，读者跟着林岚一起猜。",
    chapter_title="第一章 雾港",
    chapter_goal="建立调查线索，让读者知道灯塔信号是锚点。",
    conflict_axis="林岚的调查欲望 vs 守塔人隐瞒的信号真相",
    scene_goal="林岚夜巡灯塔，首次核对信号节拍。",
    scene_beats=("林岚核对信号节拍", "发现异常间隔", "锁定守塔人"),
    previous_summary="",
    characters=(
        CharacterConstraint(
            name="林岚",
            aliases=("雾港调查员",),
            voice_traits=("克制", "短句", "少解释"),
            forbidden_traits=("突然健谈",),
            role="灯塔信号调查员",
        ),
    ),
    style=StyleDirective(
        tone="克制悬疑",
        pov="第三人称贴身",
        rules=("多用动作与画面",),
        forbidden_phrases=("不禁", "情不自禁"),
        example_sentences=("她把左臂藏进披风，没有解释。",),
        restraint=True,
        target_avg_sentence_length=12.0,
        target_dialogue_ratio=0.4,
    ),
    pacing=PacingDirective(
        intensity="中高",
        target_chars=400,
        beat_density="紧凑",
        hook_required=True,
        notes=("开篇不要交代世界观，直接进动作。",),
    ),
    continuity=(
        ContinuityFact(statement="灯塔信号在无雾之夜也会失真", must_appear=True),
        ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
    ),
    required_facts=("林岚持有旧港灯塔密钥",),
    scene_quality_plan=SceneQualityPlan(
        emotional_shift="从例行巡检滑向警觉",
        conflict_turn="信号节拍错了一拍，林岚意识到这不是故障",
        sensory_anchors=("机油味", "石阶上的水痕", "信号灯的电流声"),
        dialogue_purpose="守塔人用一句例行公事的话挡开追问",
        reveal_or_payoff="林岚发现记录本上被撕掉的一页",
        ending_hook="信号灯在无雾的夜里又亮起一次",
    ),
    current_chapter_beat={
        "primary_scene_mode": "suspicion_probe",
        "protagonist_mistake": "过早亮出调查员身份",
        "irreversible_consequence": "守塔人销毁证据后失踪",
    },
)

TRANSITION_CTX = NarrativeContext(
    premise="林岚在雾港追查失真的灯塔信号。",
    user_intent="继续写过渡章节。",
    strategy_title="灯塔余烬",
    central_question="失真的灯塔信号究竟在向谁传递什么？",
    reader_promise="克制悬疑：信息一点一点漏，读者跟着林岚一起猜。",
    chapter_title="第五章 修船坞",
    chapter_goal="把线索从旧港推进到修船坞。",
    conflict_axis="林岚的调查欲望 vs 船坞老板老陈的沉默",
    scene_goal="林岚在老陈的修船坞里找到信号灯的维修记录。",
    scene_beats=("进入修船坞", "与老陈周旋", "发现维修记录里的伪造日期"),
    previous_summary="上一章林岚在旧港发现灯塔密钥，守塔人随后失踪。",
    characters=(
        CharacterConstraint(
            name="林岚",
            aliases=("雾港调查员",),
            voice_traits=("克制", "短句", "少解释"),
            forbidden_traits=("突然健谈",),
            role="灯塔信号调查员",
        ),
        CharacterConstraint(
            name="老陈",
            voice_traits=("寡言", "只回答问到的"),
            forbidden_traits=("主动吐露信号灯信息",),
            role="修船坞老板",
        ),
    ),
    style=StyleDirective(
        tone="克制悬疑",
        pov="第三人称贴身",
        rules=("多用动作与画面",),
        forbidden_phrases=("不禁", "情不自禁"),
        example_sentences=("她把左臂藏进披风，没有解释。",),
        restraint=True,
        target_avg_sentence_length=13.0,
        target_dialogue_ratio=0.45,
    ),
    pacing=PacingDirective(
        intensity="中",
        target_chars=1000,
        beat_density="舒缓",
        hook_required=True,
        notes=("过渡章推进一处线索即可，不要开新支线。",),
    ),
    continuity=(
        ContinuityFact(statement="灯塔信号在无雾之夜也会失真", must_appear=True),
        ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
        ContinuityFact(statement="守塔人已于昨夜失踪", must_appear=False),
    ),
    required_facts=("林岚持有旧港灯塔密钥",),
    scene_quality_plan=SceneQualityPlan(
        emotional_shift="从被敷衍的压抑转向线索到手的窄快感",
        conflict_turn="老陈的维修记录日期对不上",
        sensory_anchors=("机油味", "缆绳的沙沙声", "柜台上的账本"),
        dialogue_purpose="老陈用一句例行公事的话挡开追问",
        reveal_or_payoff="维修记录最后一页的日期是伪造的",
        ending_hook="老陈在林岚走后拨通了一个电话",
    ),
    current_chapter_beat={
        "primary_scene_mode": "suspicion_probe",
        "protagonist_mistake": "把通行证留在柜台上",
        "irreversible_consequence": "老陈报信，林岚暴露了行踪",
    },
    target_word_count_min=600,
    target_word_count_max=1600,
)


@dataclass(frozen=True)
class Task:
    """一条实验任务：固定输入 + 任务类型 + 渲染参数。kind 决定用哪张变体注册表。"""

    id: str
    kind: str
    description: str
    ctx: NarrativeContext | None = None
    full_chapter: bool = False
    preview_chars: int = 120
    draft: str = ""
    issues: tuple[str, ...] = ()
    user_prompt: str = ""


TASKS: dict[str, Task] = {
    "opening-preview": Task(
        id="opening-preview",
        kind="draft",
        description="雾港开场，林岚夜巡灯塔核对信号节拍（120 字预览）",
        ctx=OPENING_CTX,
        preview_chars=120,
    ),
    "transition-full": Task(
        id="transition-full",
        kind="draft",
        description="过渡章完整正文：林岚在老陈的修船坞找维修记录（600–1600 字）",
        ctx=TRANSITION_CTX,
        full_chapter=True,
    ),
    "critique-draft": Task(
        id="critique-draft",
        kind="critique",
        description="对埋雷正文评稿（说明腔 / 陈词 / 节奏断裂）",
        ctx=TRANSITION_CTX,
        draft=MANUAL_DRAFT,
    ),
    "revise-draft": Task(
        id="revise-draft",
        kind="revision",
        description="按 ISSUE 契约修订埋雷正文",
        ctx=TRANSITION_CTX,
        draft=MANUAL_DRAFT,
        issues=(
            "prose_quality｜medium｜她不禁想起昨夜灯塔的异响｜情绪直述 + 陈词｜scene_patch｜保留事实｜删除“不禁、心中五味杂陈”｜用身体反应显形情绪",
            "narrative_collapse｜hard_fail｜她把通行证收进口袋，转身离开｜默认调查模板收尾，无不可逆后果｜convert_process_to_scene｜保留老陈沉默事实｜删除“走得很慢”的收束腔｜让离开这一动作产生后果",
        ),
    ),
    "agent-chat": Task(
        id="agent-chat",
        kind="agent",
        description="agent 组装链单轮回话：继续写这一章",
        user_prompt="继续写这一章，保持林岚的克制语气。约 120 字。",
    ),
}
