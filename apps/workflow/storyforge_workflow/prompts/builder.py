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
        lines.append(f"\u60c5\u7eea\u53d8\u5316\uff1a{_clean(plan.emotional_shift)}")
    if _clean(plan.conflict_turn):
        lines.append(f"\u51b2\u7a81\u8f6c\u6298\uff1a{_clean(plan.conflict_turn)}")
    anchors = [_clean(item) for item in plan.sensory_anchors if _clean(item)]
    if anchors:
        lines.append("\u611f\u5b98\u951a\u70b9\uff1a" + "\u3001".join(anchors))
    if _clean(plan.dialogue_purpose):
        lines.append(f"\u5bf9\u767d\u76ee\u7684\uff1a{_clean(plan.dialogue_purpose)}")
    if _clean(plan.reveal_or_payoff):
        lines.append(f"\u4f0f\u7b14/\u5151\u73b0\uff1a{_clean(plan.reveal_or_payoff)}")
    if _clean(plan.ending_hook):
        lines.append(f"\u7ed3\u5c3e\u94a9\u5b50\uff1a{_clean(plan.ending_hook)}")
    return _section("\u573a\u666f\u8d28\u91cf\u8ba1\u5212", lines)


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


def build_draft_prompt(ctx: NarrativeContext, *, preview_chars: int = 120) -> str:
    """Draft Writer：产出可批准的中文小说正文（默认预览长度）。

    这是直接影响成稿质量的主路径，分层注入全部约束。
    """

    pacing = ctx.pacing
    if pacing.target_chars:
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


def build_critique_prompt(ctx: NarrativeContext, draft: str) -> str:
    """Draft Critic??????????????????????"""

    sections = [
        _RETURN_STRUCTURED,
        _section(
            "\u4efb\u52a1",
            [
                "\u4f60\u662f\u4e25\u683c\u7684\u5c0f\u8bf4\u4e00\u81f4\u6027\u4e0e\u6587\u7b14\u8bc4\u5ba1\u5458\u3002\u5bf9\u7167\u4ee5\u4e0b\u7ea6\u675f\u9010\u6761\u68c0\u67e5\u5f85\u5ba1\u6b63\u6587\u3002",
                "\u53ea\u8bc4\u5ba1\u3001\u4e0d\u91cd\u5199\uff1b\u6240\u6709\u7ed3\u8bba\u5fc5\u987b\u80fd\u843d\u5230\u8bc4\u5206\u3001\u547d\u4e2d\u7247\u6bb5\u548c\u4fee\u8ba2\u7b56\u7565\u3002",
            ],
        ),
        _craft_section(),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _section("\u5f85\u5ba1\u6b63\u6587", [_clean(draft) or "\uff08\u7a7a\uff09"]),
        _section(
            "\u68c0\u67e5\u7ef4\u5ea6",
            [
                "prose_quality\uff1a\u6587\u7b14\u662f\u5426\u5177\u4f53\u3001\u6709\u753b\u9762\uff0c\u907f\u514d\u7a7a\u6cdb\u5957\u8bdd\u3002",
                "show_dont_tell\uff1a\u662f\u5426\u7528\u52a8\u4f5c\u3001\u5bf9\u767d\u548c\u611f\u5b98\u5448\u73b0\u60c5\u7eea\u3002",
                "character_consistency\uff1a\u662f\u5426 OOC\u3001\u8fdd\u53cd\u58f0\u97f3\u7ea6\u675f\u6216\u7981\u6b62\u7279\u8d28\u3002",
                "continuity_consistency\uff1a\u662f\u5426\u4e0e\u5fc5\u542b\u4e8b\u5b9e\u3001\u4e0a\u6587\u6216\u8fde\u7eed\u6027\u7ea6\u675f\u77db\u76fe\u3002",
                "scene_progression\uff1a\u573a\u666f\u662f\u5426\u6709\u884c\u52a8\u63a8\u8fdb\u3001\u51b2\u7a81\u8f6c\u6298\u548c\u4fe1\u606f\u589e\u91cf\u3002",
                "pacing_control\uff1a\u53e5\u957f\u3001\u5bf9\u767d\u5bc6\u5ea6\u548c\u8282\u594f\u662f\u5426\u8d34\u5408\u573a\u666f\u76ee\u6807\u3002",
                "hook_strength\uff1a\u6bb5\u672b\u662f\u5426\u7559\u4e0b\u63a8\u52a8\u4e0b\u4e00\u6bb5\u7684\u94a9\u5b50\u3002",
                "ai_artifact_penalty\uff1a\u662f\u5426\u5b58\u5728 AI \u8bf4\u660e\u8154\u3001\u603b\u7ed3\u8154\u6216\u6a21\u677f\u5316\u8868\u8fbe\u3002",
            ],
        ),
        _section(
            "\u8f93\u51fa\u8981\u6c42",
            [
                "\u7b2c\u4e00\u884c\u5fc5\u987b\u8f93\u51fa\uff1aDECISION: pass|repair|regenerate|awaiting_review\u3002",
                "\u7b2c\u4e8c\u884c\u5fc5\u987b\u8f93\u51fa\uff1aSCORE: prose_quality=0-100; show_dont_tell=0-100; character_consistency=0-100; continuity_consistency=0-100; scene_progression=0-100; pacing_control=0-100; hook_strength=0-100; ai_artifact_penalty=0-100\u3002",
                "\u5982\u6709\u95ee\u9898\uff0c\u540e\u7eed\u6bcf\u884c\u8f93\u51fa\uff1aISSUE: \u7ef4\u5ea6\uff5c\u4e25\u91cd\u7ea7\u522b\uff5c\u547d\u4e2d\u7247\u6bb5\uff5c\u539f\u56e0\uff5c\u4fee\u8ba2\u7b56\u7565\uff5c\u5fc5\u987b\u4fdd\u7559\uff5c\u5fc5\u987b\u5220\u9664\uff5c\u76ee\u6807\u6548\u679c\u3002",
                "\u4e25\u91cd\u7ea7\u522b\u4f7f\u7528 \u4f4e|\u4e2d|\u9ad8\uff1b\u4fee\u8ba2\u7b56\u7565\u4f7f\u7528 line_edit|scene_patch|regenerate\u3002",
                "\u82e5\u6b63\u6587\u6ee1\u8db3\u5168\u90e8\u7ea6\u675f\uff0cDECISION \u4f7f\u7528 pass\uff0c\u5e76\u53ea\u4fdd\u7559 DECISION \u4e0e SCORE \u4e24\u884c\u3002",
            ],
        ),
    ]
    return _join_sections(sections)


def build_revision_prompt(ctx: NarrativeContext, draft: str, issues: Iterable[str]) -> str:
    """Draft Reviser???????????????????"""

    issue_lines = [_clean(issue) for issue in issues if _clean(issue)]
    pacing = ctx.pacing
    if pacing.target_chars:
        length_line = f"\u7bc7\u5e45\uff1a\u7ea6 {pacing.target_chars} \u4e2a\u4e2d\u6587\u5b57\u7b26\uff0c\u5141\u8bb8\u4e0a\u4e0b\u6d6e\u52a8 15%\u3002"
    else:
        length_line = "\u7bc7\u5e45\uff1a\u4e0e\u539f\u7a3f\u76f8\u5f53\u3002"
    sections = [
        _RETURN_PROSE,
        _section(
            "\u4efb\u52a1",
            [
                "\u4e0b\u9762\u662f\u4e00\u6bb5\u5c0f\u8bf4\u6b63\u6587\u4e0e\u8bc4\u5ba1\u53d1\u73b0\u7684\u95ee\u9898\u3002\u8bf7\u636e\u95ee\u9898\u6e05\u5355\u4fee\u8ba2\u6b63\u6587\u3002",
                "\u6309\u95ee\u9898\u4e2d\u7684\u4fee\u8ba2\u7b56\u7565\u6267\u884c\uff1aline_edit \u53ea\u6539\u547d\u4e2d\u53e5\uff1bscene_patch \u8865\u8db3\u573a\u666f\u7f3a\u53e3\u4f46\u4fdd\u7559\u4e3b\u4f53\uff1bregenerate \u6574\u6bb5\u91cd\u5199\u4f46\u4fdd\u7559\u4e8b\u5b9e\u548c\u8fde\u7eed\u6027\u3002",
                "\u4e25\u683c\u9075\u5b88\u5fc5\u987b\u4fdd\u7559\u3001\u5fc5\u987b\u5220\u9664\u3001\u76ee\u6807\u6548\u679c\uff0c\u4e0d\u8981\u6cdb\u6cdb\u6da6\u8272\u3002",
            ],
        ),
        _craft_section(),
        _section(
            "\u4fee\u8ba2\u7b56\u7565\u5951\u7ea6",
            [
                "line_edit\uff1a\u53ea\u6539\u547d\u4e2d\u53e5\uff0c\u4fdd\u7559\u4e0a\u4e0b\u6587\u8bed\u4e49\u3002",
                "scene_patch\uff1a\u8865\u8db3\u573a\u666f\u7f3a\u53e3\uff0c\u4fdd\u7559\u4e3b\u4f53\u7ed3\u6784\u4e0e\u5173\u952e\u4e8b\u5b9e\u3002",
                "regenerate\uff1a\u6574\u6bb5\u91cd\u5199\uff0c\u5fc5\u987b\u4fdd\u7559\u4e8b\u5b9e\u3001\u8fde\u7eed\u6027\u548c\u89d2\u8272\u7ea6\u675f\u3002",
                "\u95ee\u9898\u5b57\u6bb5\u987a\u5e8f\uff1a\u7ef4\u5ea6\uff5c\u4e25\u91cd\u7ea7\u522b\uff5c\u547d\u4e2d\u7247\u6bb5\uff5c\u539f\u56e0\uff5c\u4fee\u8ba2\u7b56\u7565\uff5c\u5fc5\u987b\u4fdd\u7559\uff5c\u5fc5\u987b\u5220\u9664\uff5c\u76ee\u6807\u6548\u679c\u3002",
            ],
        ),
        _section("\u8bc4\u5ba1\u95ee\u9898\u6e05\u5355\uff08\u9010\u6761\u4fee\u590d\uff09", issue_lines or ["\uff08\u65e0\u5177\u4f53\u95ee\u9898\uff0c\u6309\u521b\u4f5c\u51c6\u5219\u6da6\u8272\u5373\u53ef\uff09"]),
        _character_section(ctx.characters),
        _style_section(ctx.style),
        _position_section(ctx),
        _scene_quality_section(ctx),
        _continuity_section(ctx),
        _previous_section(ctx),
        _pacing_section(pacing),
        _section("\u539f\u7a3f", [_clean(draft) or "\uff08\u7a7a\uff09"]),
        _section(
            "\u8f93\u51fa\u8981\u6c42",
            [
                length_line,
                "\u53ea\u8f93\u51fa\u4fee\u8ba2\u540e\u7684\u5b8c\u6574\u6b63\u6587\uff0c\u4e0d\u8981\u89e3\u91ca\u3001\u4e0d\u8981\u5217\u6539\u52a8\u70b9\u3001\u4e0d\u8981\u4fdd\u7559\u95ee\u9898\u6807\u8bb0\u3002",
                "\u5fc5\u987b\u4f53\u73b0\u5168\u90e8\u5fc5\u542b\u4e8b\u5b9e\uff0c\u5e76\u5c0a\u91cd\u6240\u6709\u8fde\u7eed\u6027\u4e0e\u89d2\u8272\u7ea6\u675f\u3002",
            ],
        ),
    ]
    return _join_sections(sections)
