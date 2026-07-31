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


CLIMAX_CTX = NarrativeContext(
    premise="林岚在雾港追查失真的灯塔信号。",
    user_intent="写本章的高潮对峙段落。",
    strategy_title="灯塔余烬",
    central_question="失真的灯塔信号究竟在向谁传递什么？",
    reader_promise="克制悬疑：信息一点一点漏，读者跟着林岚一起猜。",
    chapter_title="第九章 灯塔顶端",
    chapter_goal="林岚与守塔人在灯塔顶端对峙，真相揭开一半。",
    conflict_axis="林岚的追查 vs 守塔人的最后隐瞒",
    scene_goal="林岚手持旧港灯塔密钥登上塔顶，与守塔人摊牌。",
    scene_beats=("登上塔顶", "对峙摊牌", "守塔人松口一半真相"),
    previous_summary="林岚查到守塔人在无雾之夜伪造信号记录，灯塔密钥证实旧港失窃案与他有关。",
    characters=(
        CharacterConstraint(
            name="林岚",
            aliases=("雾港调查员",),
            voice_traits=("克制", "短句", "少解释"),
            forbidden_traits=("突然健谈", "歇斯底里"),
            role="灯塔信号调查员",
        ),
        CharacterConstraint(
            name="守塔人",
            aliases=("老周",),
            voice_traits=("寡言", "只回答问到的", "隐忍"),
            forbidden_traits=("主动吐露全部真相",),
            role="灯塔守塔人",
        ),
    ),
    style=StyleDirective(
        tone="克制悬疑，张力拉满但字面冷静",
        pov="第三人称贴身",
        rules=("多用动作与画面", "对白短促"),
        forbidden_phrases=("不禁", "情不自禁", "忽然"),
        example_sentences=("她把手按在栏杆上，指节发白。",),
        restraint=True,
        target_avg_sentence_length=10.0,
        target_dialogue_ratio=0.55,
    ),
    pacing=PacingDirective(
        intensity="高",
        target_chars=900,
        beat_density="密集",
        hook_required=True,
        notes=("高潮场景，对白交锋为主，动作间隔点缀。",),
    ),
    continuity=(
        ContinuityFact(statement="灯塔信号在无雾之夜也会失真", must_appear=True),
        ContinuityFact(statement="林岚左臂受伤未愈", must_appear=True),
        ContinuityFact(statement="旧港灯塔密钥是林岚从失窃案现场找回的", must_appear=True),
        ContinuityFact(statement="守塔人老周在伪造信号记录", must_appear=True),
    ),
    required_facts=("守塔人没有直接认罪，只吐露一半真相",),
    scene_quality_plan=SceneQualityPlan(
        emotional_shift="从压抑质问到半真半假的坦白",
        conflict_turn="守塔人承认伪造记录，但否认与失窃案有关",
        sensory_anchors=("塔顶的风", "黄铜钥匙的凉意", "远处海面的闪光"),
        dialogue_purpose="守塔人用半句真话试探林岚知道多少",
        reveal_or_payoff="信号灯背后的电闸上有一截不属于雾港的电缆",
        ending_hook="守塔人问林岚：你确定你查的是对的灯吗？",
    ),
    current_chapter_beat={
        "primary_scene_mode": "confrontation",
        "protagonist_mistake": "在塔顶背对楼梯，被守塔人挡住退路",
        "irreversible_consequence": "林岚摔碎了旧港灯塔密钥，线索断一半",
    },
    target_word_count_min=800,
    target_word_count_max=1200,
)

# --- live 链（桌面 file.create）输入 ---
#
# user 消息一律经生产的 `_build_draft_prompt` 渲染，不手写：变体只改 system prompt，
# 输入侧必须与作者在桌面按「新建文件起草」时收到的逐字一致，否则量的不是同一条链。
# 必含事实照抄 book_runs 侧 fixtures 的 ContinuityFact（密钥 / 左臂 / 无雾失真 / 守塔人），
# 使 wave1-3 的评审口径可直接套用到本组。
_LIVE_FACTS = (
    "必须体现的既有设定：①林岚持有旧港灯塔密钥；②林岚左臂受伤未愈；"
    "③灯塔信号在无雾之夜也会失真；④守塔人老周知情但只说一半。"
)


def _live_user_prompt(*, file_path: str, instruction: str, previous: tuple[str, str] | None) -> str:
    from app.domains.assistant.schemas import AssistantDraftRequest
    from app.domains.assistant.service import _build_draft_prompt

    payload = AssistantDraftRequest(
        file_path=file_path,
        instruction=instruction,
        project_name="雾港",
    )
    return _build_draft_prompt(payload, None, previous)


_LIVE_PREV = (
    "第002章 修船坞",
    "老陈把缆绳放回架上，没有回头。“三个月没人动过灯塔的零件。”"
    "林岚看着他后颈渗出的汗，把通行证收进口袋。塔顶的灯又闪了一次，比昨夜早了两秒。",
)

TASKS: dict[str, Task] = {
    "opening-preview": Task(
        id="opening-preview",
        kind="draft",
        description="雾港开场，林岚夜巡灯塔核对信号节拍（约 400 字预览）",
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
    "climax-full": Task(
        id="climax-full",
        kind="draft",
        description="高潮对峙：林岚登塔顶与守塔人摊牌（800–1200 字）",
        ctx=CLIMAX_CTX,
        full_chapter=True,
    ),
    "agent-chat": Task(
        id="agent-chat",
        kind="agent",
        description="agent 组装链单轮回话：继续写这一章",
        user_prompt="继续写这一章，保持林岚的克制语气。约 120 字。",
    ),
    "live-opening": Task(
        id="live-opening",
        kind="live-draft",
        description="live file.create 起草开篇（约 400 字，无上一章）",
        user_prompt=_live_user_prompt(
            file_path="正文/第001章 雾港.md",
            instruction=(
                "写第一章开篇：林岚夜巡灯塔，首次核对信号节拍并发现异常间隔，锁定守塔人。"
                "克制悬疑，第三人称贴身，短句，对白短促。约 400 字。" + _LIVE_FACTS
            ),
            previous=None,
        ),
    ),
    "live-transition": Task(
        id="live-transition",
        kind="live-draft",
        description="live file.create 起草过渡章完整正文（600–1600 字，带上一章尾）",
        user_prompt=_live_user_prompt(
            file_path="正文/第003章 值班记录.md",
            instruction=(
                "写本章完整正文：林岚回灯塔找值班记录，发现缺页，守塔人老周在场但只说一半。"
                "克制悬疑，第三人称贴身。600–1600 字。" + _LIVE_FACTS
            ),
            previous=_LIVE_PREV,
        ),
    ),
    "live-climax": Task(
        id="live-climax",
        kind="live-draft",
        description="live file.create 起草高潮对峙（800–1200 字，带上一章尾）",
        user_prompt=_live_user_prompt(
            file_path="正文/第004章 塔顶.md",
            instruction=(
                "写本章完整正文：林岚登塔顶与守塔人摊牌，对白交锋为主。"
                "守塔人承认伪造记录但否认与失窃案有关，收场时林岚摔碎密钥、线索断一半。"
                "克制悬疑，第三人称贴身，张力拉满但字面冷静。800–1200 字。" + _LIVE_FACTS
            ),
            previous=_LIVE_PREV,
        ),
    ),
}
