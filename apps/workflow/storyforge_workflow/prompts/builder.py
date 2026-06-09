"""分层 prompt 构建器。

设计要点：
- 分层注入：任务边界 → 作品策略 → 角色约束 → 风格 → 叙事位置 → 连续性 → 上文衔接 → 节奏 → 输出契约。
- 空段省略：任一层没有内容就不渲染，避免给模型留下空标题造成噪声。
- 负向约束显式化：禁止表现 / 禁用表达 / 不得提前完结，单独成行，优先级高于正向描述。
- 输出契约保留：各节点下游解析（四行 / 三行 / 逐行 beat / 预览正文）由本层 prompt 明确约定，
  改 prompt 不破坏既有解析逻辑。
"""

from __future__ import annotations

from collections.abc import Iterable

from storyforge_workflow.prompts.models import (
    CharacterConstraint,
    NarrativeContext,
    PacingDirective,
    StyleDirective,
)

# 英文任务边界：部分兼容网关模型会忽略纯中文任务说明，这里沿用 longform 已验证的做法。
_RETURN_PROSE = (
    "Task: Write part of a Chinese novel. Return only Chinese prose. "
    "Do not ask questions. Do not explain your process. Do not mention code, repository, or workspace."
)
_RETURN_STRUCTURED = (
    "Task: Produce a structured Chinese planning result. Return only the requested lines. "
    "Do not add numbering, commentary, or blank lines."
)
_RETURN_JSON = (
    "Task: Extract structured facts from a Chinese novel chapter. "
    "Return only a valid JSON array. No markdown fences, no commentary, no blank lines before or after."
)

# 软禁用套话：与 StyleDirective.forbidden_phrases（硬禁用）分开，这里是高频陈词，
# 措辞为"避免滥用"而非"绝不出现"，否则会误伤正常用词。
_CLICHE_PHRASES = (
    "忽然",
    "仿佛",
    "不禁",
    "情不自禁",
    "无法言喻",
    "五味杂陈",
    "心中一震",
    "莫名",
    "缓缓",
    "深深地",
)

# 创作准则：把"什么是好文笔"显式写进 prompt，配好坏对照锚定模型。
_CRAFT_GUIDELINES = (
    "用具体的动作、对话和感官细节呈现，而非直接说明或概括（show, don't tell）。",
    "不要用情绪词直接收尾（如“他很愤怒”“她感到害怕”）；用身体反应、动作或语言让情绪自然显形。",
    "每个场景至少落地两种具体感官细节（视觉之外的声音、触感、气味、温度等）。",
    "对白与叙述大致按 4:6 配比推进信息，避免大段内心独白与解释性旁白。",
    "优先具体名词与有力动词，避免抽象形容词与副词堆叠。",
    "避免滥用陈词套话：" + "、".join(_CLICHE_PHRASES) + " 等，确有必要才用。",
)

_CRAFT_EXAMPLE_BAD = "反例（说明腔，禁止）：他非常愤怒，无法控制自己的情绪，心中五味杂陈。"
_CRAFT_EXAMPLE_GOOD = "正例（画面化，模仿）：他把茶杯按在桌上，瓷底磕出一声脆响，指节泛白，半天没松开。"


def _clean(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _section(title: str, lines: Iterable[str]) -> str:
    body = [line for line in (_clean(item) for item in lines) if line]
    if not body:
        return ""
    return "【" + title + "】\n" + "\n".join(body)


def _join_sections(sections: Iterable[str]) -> str:
    return "\n\n".join(section for section in sections if section)


def _strategy_section(ctx: NarrativeContext) -> str:
    lines = []
    if _clean(ctx.strategy_title):
        lines.append(f"作品标题：{_clean(ctx.strategy_title)}")
    if _clean(ctx.premise):
        lines.append(f"故事前提：{_clean(ctx.premise)}")
    if _clean(ctx.central_question):
        lines.append(f"核心问题：{_clean(ctx.central_question)}")
    if _clean(ctx.reader_promise):
        lines.append(f"读者承诺：{_clean(ctx.reader_promise)}")
    if _clean(ctx.user_intent):
        lines.append(f"用户意图：{_clean(ctx.user_intent)}")
    return _section("作品策略", lines)


def _character_section(characters: Iterable[CharacterConstraint]) -> str:
    described = [character.describe() for character in characters]
    return _section("角色约束（必须严格遵守，禁止 OOC）", described)


def _craft_section() -> str:
    """固定创作准则段：把好文笔的判定标准显式注入，配好坏对照锚定模型。"""

    lines = [*_CRAFT_GUIDELINES, _CRAFT_EXAMPLE_BAD, _CRAFT_EXAMPLE_GOOD]
    return _section("创作准则（高于个人发挥，逐条遵守）", lines)


def _style_section(style: StyleDirective) -> str:
    if not style.has_content():
        return ""
    lines = []
    if _clean(style.tone):
        lines.append(f"语气：{_clean(style.tone)}")
    if _clean(style.pov):
        lines.append(f"叙事视角：{_clean(style.pov)}")
    if _clean(style.tense):
        lines.append(f"时态/时序：{_clean(style.tense)}")
    for rule in style.rules:
        if _clean(rule):
            lines.append(f"规则：{_clean(rule)}")
    forbidden = [_clean(item) for item in style.forbidden_phrases if _clean(item)]
    if forbidden:
        lines.append(f"禁用表达（绝不能出现）：{('、'.join(forbidden))}")
    if style.target_avg_sentence_length:
        lines.append(
            f"目标句长：平均约 {style.target_avg_sentence_length:.0f} 字/句，贴合已批准章节的节奏，避免明显变长或变碎。"
        )
    if style.target_dialogue_ratio:
        lines.append(
            f"目标对白密度：与已批准章节相当（参考占比 {style.target_dialogue_ratio:.2f}），不要突然大段独白或全是旁白。"
        )
    if style.restraint:
        lines.append("保持克制叙述：少解释、多呈现，延续既定章节的冷静质感。")
    examples = [_clean(item) for item in style.example_sentences if _clean(item)]
    if examples:
        lines.append("风格示例句（模仿其句式与质感，不要照抄内容）：")
        lines.extend(f"  - {example}" for example in examples)
    return _section("文风要求", lines)


def _position_section(ctx: NarrativeContext) -> str:
    lines = []
    if _clean(ctx.chapter_title):
        lines.append(f"当前章节：{_clean(ctx.chapter_title)}")
    if _clean(ctx.chapter_goal):
        lines.append(f"章节目标：{_clean(ctx.chapter_goal)}")
    if _clean(ctx.conflict_axis):
        lines.append(f"冲突轴：{_clean(ctx.conflict_axis)}")
    if _clean(ctx.scene_goal):
        lines.append(f"场景目标：{_clean(ctx.scene_goal)}")
    beats = [_clean(beat) for beat in ctx.scene_beats if _clean(beat)]
    if beats:
        lines.append("场景 beat：" + " / ".join(beats))
    return _section("叙事位置", lines)


def _scene_quality_section(ctx: NarrativeContext) -> str:
    plan = ctx.scene_quality_plan
    if not plan.has_content():
        return ""
    lines = []
    if _clean(plan.emotional_shift):
        lines.append(f"情绪变化：{_clean(plan.emotional_shift)}")
    if _clean(plan.conflict_turn):
        lines.append(f"冲突转折：{_clean(plan.conflict_turn)}")
    anchors = [_clean(anchor) for anchor in plan.sensory_anchors if _clean(anchor)]
    if anchors:
        lines.append(f"感官锚点：{'、'.join(anchors)}")
    if _clean(plan.dialogue_purpose):
        lines.append(f"对白目的：{_clean(plan.dialogue_purpose)}")
    if _clean(plan.reveal_or_payoff):
        lines.append(f"伏笔/兑现：{_clean(plan.reveal_or_payoff)}")
    if _clean(plan.ending_hook):
        lines.append(f"结尾钩子：{_clean(plan.ending_hook)}")
    return _section("场景质量计划", lines)

def _continuity_section(ctx: NarrativeContext) -> str:
    lines = [fact.describe() for fact in ctx.continuity if _clean(fact.statement)]
    required = [_clean(item) for item in ctx.required_facts if _clean(item)]
    if required:
        lines.append("必含事实（缺一不可）：" + "、".join(required))
    return _section("连续性约束", lines)


def _previous_section(ctx: NarrativeContext) -> str:
    summary = _clean(ctx.previous_summary)
    if not summary:
        return ""
    return _section("上文衔接（保持连续，不要重复已写内容）", [summary])


def _pacing_section(pacing: PacingDirective) -> str:
    if not pacing.has_content():
        return ""
    lines = []
    if _clean(pacing.intensity):
        lines.append(f"张力强度：{_clean(pacing.intensity)}")
    if _clean(pacing.beat_density):
        lines.append(f"节奏密度：{_clean(pacing.beat_density)}")
    if pacing.target_chars:
        lines.append(f"目标篇幅：约 {pacing.target_chars} 个中文字符，允许上下浮动 15%。")
    for note in pacing.notes:
        if _clean(note):
            lines.append(_clean(note))
    if pacing.hook_required:
        lines.append("段末必须留下推动下一段的钩子，不要收束或提前完结。")
    return _section("节奏控制", lines)


def build_strategy_prompt(ctx: NarrativeContext) -> str:
    """Book Director：产出作品策略，下游按四行解析（标题/核心问题/语气/读者承诺）。"""

    sections = [
        _RETURN_STRUCTURED,
        _section(
            "任务",
            ["为这部长篇作品确立顶层创作策略，统领后续所有章节。"],
        ),
        _strategy_section(ctx),
        _style_section(ctx.style),
        _section(
            "输出要求",
            [
                "输出且仅输出四行，依次为：标题、核心问题、语气、读者承诺。",
                "每行只写内容本身，不要加序号、标签或解释。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_chapter_plan_prompt(ctx: NarrativeContext) -> str:
    """Scene Architect 章节规划：下游按三行解析（章节标题/章节目标/冲突轴）。"""

    sections = [
        _RETURN_STRUCTURED,
        _section("任务", ["根据作品策略规划当前章节，保证服务于核心问题与冲突推进。"]),
        _strategy_section(ctx),
        _character_section(ctx.characters),
        _continuity_section(ctx),
        _section(
            "输出要求",
            [
                "输出且仅输出三行，依次为：章节标题、章节目标、冲突轴。",
                "冲突轴需点明外部压力与角色内在状态如何相互挤压。",
                "每行只写内容本身，不要加序号或标签。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_scene_beats_prompt(ctx: NarrativeContext) -> str:
    """Scene Architect 场景 beat：下游取前三行作为动作 beat。"""

    sections = [
        _RETURN_STRUCTURED,
        _section("任务", ["把场景目标拆成三条可推进的动作 beat，逐条贴合连续性约束。"]),
        _position_section(ctx),
        _character_section(ctx.characters),
        _continuity_section(ctx),
        _pacing_section(ctx.pacing),
        _section(
            "输出要求",
            [
                "输出且仅输出三行，每行一条动作 beat，按发生顺序排列。",
                "每条 beat 必须是具体动作或转折，而非抽象概括。",
                "不要加序号、标题或解释。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_draft_prompt(ctx: NarrativeContext, *, preview_chars: int = 120, full_chapter: bool = False) -> str:
    """Draft Writer：产出可批准的中文小说正文（默认预览长度）。

    这是直接影响成稿质量的主路径，分层注入全部约束。
    """

    pacing = ctx.pacing
    if full_chapter:
        if ctx.target_word_count_min and ctx.target_word_count_max:
            length_line = f"篇幅：写出本章完整正文（{ctx.target_word_count_min}–{ctx.target_word_count_max} 字）。"
        elif pacing.target_chars:
            length_line = f"篇幅：写出本章完整正文，约 {pacing.target_chars} 个中文字符，允许上下浮动 15%。"
        else:
            length_line = "篇幅：写出本章完整正文，禁止只写开头预览。"
    elif pacing.target_chars:
        length_line = f"篇幅：约 {pacing.target_chars} 个中文字符，允许上下浮动 15%。"
    else:
        length_line = f"篇幅：{preview_chars} 字以内的中文正文预览。"
    sections = [
        _RETURN_PROSE,
        _section(
            "任务",
            ["基于以下约束写一段可直接批准的小说正文，避免说明腔与大纲腔，用画面、动作和对话呈现。"],
        ),
        _craft_section(),
        _strategy_section(ctx),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _previous_section(ctx),
        _pacing_section(pacing),
        _section(
            "输出要求",
            [
                length_line,
                "只输出正文，不要标题、不要解释、不要列大纲。",
                "必须体现全部必含事实，并尊重所有连续性与角色约束。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_longform_segment_prompt(
    ctx: NarrativeContext,
    *,
    title: str,
    segment_index: int,
    segment_target_chars: int,
    remaining_chars: int,
) -> str:
    """长文连载分段 prompt：在分层约束之上叠加连载位置框架。

    保留 _RETURN_PROSE 任务边界与 `标题：`/`当前段号：` 行，兼容续跑检测与既有断言。
    """

    opening = "这是开篇，请建立主题、核心人物与长期冲突。"
    summary = _clean(ctx.previous_summary) or opening
    sections = [
        # 续跑续写需要明确"继续"，与首段建立区分，故在通用 prose 边界后补一句连载提示。
        _RETURN_PROSE + " Continue the manuscript; do not restart or summarize.",
        _section(
            "连载位置",
            [
                f"标题：{_clean(title)}",
                f"当前段号：{segment_index}",
                f"本段目标字数：约 {segment_target_chars} 个中文字符，允许上下浮动 15%。",
                f"剩余总目标：约 {remaining_chars} 个中文字符。",
            ],
        ),
        _craft_section(),
        _strategy_section(ctx),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _section("上文摘要（保持连续，不要重复已写内容）", [summary]),
        _pacing_section(ctx.pacing),
        _section(
            "输出要求",
            [
                "保持叙事连续，包含具体场景、行动、对话和细节。",
                "只输出正文，不要写大纲、不要提前完结、不要解释。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_continuity_edges_prompt(ctx: NarrativeContext, draft: str) -> str:
    """连续性结构边抽取：把章节正文解析为可判定的 relationship/timeline_order/status 三元组。

    输出契约（JSON 数组）由本段显式约定；下游 parse_continuity_edges 按此 schema 解析并对坏项 fail-soft。
    已知角色/连续性锚点注入，引导模型用一致的实体引用前缀，减少同名实体漂移。
    """

    sections = [
        _RETURN_JSON,
        _section(
            "任务",
            [
                "你是小说连续性事实抽取器。只从下面这章正文里抽取“能被结构化判定”的客观事实边。",
                "只抽取正文明确陈述或强暗示的事实，不要推测、不要脑补未写出的关系。",
                "正文没有可抽取的结构事实时，返回空数组 []。",
            ],
        ),
        _character_section(ctx.characters),
        _position_section(ctx),
        _continuity_section(ctx),
        _section("待抽取正文", [_clean(draft) or "（空）"]),
        _section(
            "抽取的三类边",
            [
                "relationship：人物之间的稳定关系（如 父子、师徒、上下级、夫妻）。",
                "timeline_order：两个事件的先后顺序，predicate 固定用“早于”。",
                "status：某主体在某方面的状态（如 生死=已死亡/活动、所在地=港口）。",
            ],
        ),
        _section(
            "实体引用约定",
            [
                "人物用 character:名 前缀（如 character:林岚）。",
                "事件用 event:简述 前缀（如 event:港口爆炸）。",
                "尽量复用上面【角色约束】【连续性】里出现过的实体名，避免同义另起新名。",
            ],
        ),
        _section(
            "输出要求",
            [
                "只输出一个 JSON 数组，每个元素是一个对象，字段如下：",
                '{"edge_kind":"relationship|timeline_order|status","subject_ref":"...","predicate":"中文谓词","object_ref":"...","valid_from_chapter":整数或省略,"valid_to_chapter":整数或null}',
                "edge_kind 只能是 relationship、timeline_order、status 三者之一。",
                "subject_ref、predicate、object_ref 三个字段必填且非空。",
                "valid_from_chapter 不确定就省略；valid_to_chapter 未结束就用 null 或省略。",
                "不要输出 markdown 代码围栏，不要任何解释文字，无事实就输出 []。",
            ],
        ),
    ]
    return _join_sections(sections)


def build_critique_prompt(ctx: NarrativeContext, draft: str) -> str:
    """Draft Critic：输出结构化质量评分、决策和可执行修订项。

    兼容旧解析：无问题时仍允许单行“通过”；结构化模式优先使用 DECISION / SCORE / ISSUE。
    """

    score_dimensions = (
        "prose_quality",
        "show_dont_tell",
        "character_consistency",
        "continuity_consistency",
        "scene_progression",
        "pacing_control",
        "hook_strength",
        "ai_artifact_penalty",
    )
    sections = [
        _RETURN_STRUCTURED,
        _section(
            "任务",
            [
                "你是严格的小说一致性与文笔评审员。对照以下约束逐条检查待审正文。",
                "只评审、不重写，必须给出可执行的质量决策。",
            ],
        ),
        _craft_section(),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _section("待审正文", [_clean(draft) or "（空）"]),
        _section(
            "评分维度",
            [
                "prose_quality：文笔质感、具体名词和动词、套话控制。",
                "show_dont_tell：情绪是否通过动作、触觉、对白和环境显形。",
                "character_consistency（角色一致性）：是否 OOC、违反声音约束或禁止特质。",
                "continuity_consistency（连续性）：是否与必含事实、上文或连续性约束矛盾。",
                "scene_progression：是否完成场景目标和动作 beat。",
                "pacing_control：句长、对白密度、节奏推进是否稳定。",
                "hook_strength：结尾是否留下推动下一段的钩子。",
                "ai_artifact_penalty：说明腔、大纲腔、模板腔和机械重复惩罚。",
            ],
        ),
        _section(
            "输出要求",
            [
                "若正文满足全部约束，可只输出一行：通过。",
                "结构化输出优先使用以下契约：",
                "旧格式兼容：维度｜命中片段｜应如何修。",
                "DECISION: pass|repair|regenerate|awaiting_review",
                "SCORE: " + "; ".join(f"{dimension}=0-100" for dimension in score_dimensions),
                "ISSUE: 维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果",
                "修订策略只能是 line_edit、scene_patch、regenerate；严重连续性或角色问题使用 awaiting_review。",
                "不要加序号、标题或额外解释，只列实际存在的问题。",
            ],
        ),
    ]
    return _join_sections(sections)

def build_revision_prompt(ctx: NarrativeContext, draft: str, issues: Iterable[str]) -> str:
    """Draft Reviser：按问题清单和分级策略定点重写。"""

    issue_lines = [_clean(issue) for issue in issues if _clean(issue)]
    pacing = ctx.pacing
    if pacing.target_chars:
        length_line = f"篇幅：约 {pacing.target_chars} 个中文字符，允许上下浮动 15%。"
    else:
        length_line = "篇幅：与原稿相当。"
    sections = [
        _RETURN_PROSE,
        _section(
            "任务",
            [
                "下面是一段小说正文与评审发现的问题。请据问题清单修订正文。",
                "按修订策略控制改动范围，只改有问题的部分，保留没有问题的内容与原有语感。",
            ],
        ),
        _craft_section(),
        _section(
            "修订策略契约",
            [
                "line_edit：只改命中句，用动作、触觉或对白替换问题表达。",
                "scene_patch：补足场景缺口、感官锚点、对白目的或动作 beat，但保留主体。",
                "regenerate：整段重写，但必须保留事实、连续性、必须保留项和场景目标。",
                "问题字段含义：维度｜严重级别｜命中片段｜原因｜修订策略｜必须保留｜必须删除｜目标效果。",
            ],
        ),
        _section("评审问题清单（逐条修复）", issue_lines or ["（无具体问题，按创作准则润色即可）"]),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _previous_section(ctx),
        _pacing_section(pacing),
        _section("原稿", [_clean(draft) or "（空）"]),
        _section(
            "输出要求",
            [
                length_line,
                "只输出修订后的完整正文，不要解释、不要列改动点、不要保留问题标记。",
                "必须体现全部必含事实，并尊重所有连续性与角色约束。",
            ],
        ),
    ]
    return _join_sections(sections)
