"""创作准则单一事实源：什么是好文笔，只在这里写一份。

放 `app/common` 而不是留在 `book_runs/prompts` 的原因是触达边界：四条产字路径
（chat 循环 / file.revise / file.create / prose.continue）分属 agent_runs、assistant
与 book_runs 三个域，而 `agent_runs/loop/*.py` 被源码标准硬门禁禁止 import
`domains.book_runs`（见 tests/test_source_code_standards.py）。共享常量下沉到 common
是既有先例（llm_env 为破环下沉）。本模块必须保持无依赖叶子：不 import 任何 domains。
"""

from __future__ import annotations

# 软禁用套话：与 StyleDirective.forbidden_phrases（硬禁用）分开，这里是高频陈词，
# 措辞为"避免滥用"而非"绝不出现"，否则会误伤正常用词。
CLICHE_PHRASES = (
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
CRAFT_GUIDELINES = (
    "用具体的动作、对话和感官细节呈现，而非直接说明或概括（show, don't tell）。",
    "不要用情绪词直接收尾（如“他很愤怒”“她感到害怕”）；用身体反应、动作或语言让情绪自然显形。",
    "每个场景至少落地两种具体感官细节（视觉之外的声音、触感、气味、温度等）。",
    "对白与叙述大致按 4:6 配比推进信息，避免大段内心独白与解释性旁白。",
    "优先具体名词与有力动词，避免抽象形容词与副词堆叠。",
    "避免滥用陈词套话：" + "、".join(CLICHE_PHRASES) + " 等，确有必要才用。",
)

# 好坏对照锚点：正例画面化、可直接模仿；反例只描述"说明腔"反模式，
# 不复述任何被禁词条（避免在 prompt 里既禁止又示范同一串，给模型混淆信号）。
#
# 生产零调用方（2026-08-01）：prompt_lab 三波实验裁定删锚点（no-examples → adopt，
# 六次重复零必含事实丢失、篇幅更贴目标、比喻密度更高），批量路径已删同形态锚点，
# file.create 随本刀对齐。常量刻意保留而非删除——prompt_lab 的变体纪律是"从生产常量
# 做同源增删、不手抄文案"，留着才能在 live 链上重跑 with/without 对比；
# 生产不许再挂回来，由 test_craft_guidelines_reach 的锚点缺席断言钉死。
CRAFT_EXAMPLE_BAD = "反例（说明腔，禁止）：直接用情绪形容词概括人物状态、堆叠抽象副词、用旁白解释心理，而不落到动作与感官。"
CRAFT_EXAMPLE_GOOD = "正例（画面化，模仿）：他把茶杯按在桌上，瓷底磕出一声脆响，指节泛白，半天没松开。"


def craft_prompt_clause(*, with_examples: bool = False) -> str:
    """把创作准则压成一句可直接拼进 system prompt 的中文子句。

    整书管线用的是带标题的多行 section（见 book_runs.prompts），而三条对话侧路径的
    system prompt 是单段长句，故这里出扁平子句形态，两种形态共用同一份准则文本。
    """

    clause = "创作准则（高于个人发挥，逐条遵守）：" + "；".join(
        guideline.rstrip("。") for guideline in CRAFT_GUIDELINES
    ) + "。"
    if with_examples:
        clause += CRAFT_EXAMPLE_BAD + CRAFT_EXAMPLE_GOOD
    return clause


# 场景纪律：与 CRAFT_GUIDELINES 分开，因为作用域不同——准则约束句子好不好，本清单约束
# 一场戏立不立得住。诊断（2026-07-28）：产字路径此前只有句子层守则，模型每次都是无计划
# 直出，于是最常见的坏产出不是句子难看而是「这一场删掉也不影响主线」。
#
# 打捞自退役批量管线的 `book_runs/prompts/_sections.py`「生成前先在内部确认……」——该文件
# 的 7 个构建器至今零生产调用方，桌面永远走不到，故这里是重写而非 import。
#
# 名与释分开存：改写 / 压缩路径只报得出名字（见 scene_discipline_guard_clause），
# 两处措辞不同但必须同源，否则两条路径会各按各的尺子说话。
SCENE_DISCIPLINE_ITEMS = (
    ("视角", "这一段用谁的眼睛看；中途不换视点人物，不滑进全知旁白。"),
    ("目标与阻力", "这一场谁想要什么，什么在挡他；只有推进没有阻力的文字是过场。"),
    (
        "代价与不可逆",
        "收场时有什么被永久改动了：受伤、失信、暴露、耗尽、越界，"
        "或者得到某样再也退不回去的东西。",
    ),
    (
        "落差",
        "收场时的处境相比开场必须变了（变好变坏都算），"
        "且变化由场上发生的事造成，不是叙述者宣布的。",
    ),
)

# 承重判据，独立成句是为了让两种措辞共用同一条判决标准。
SCENE_COLLAPSE_TEST = "第 3 项一样都拿不出来时，这一场删掉也不影响主线。"


def scene_discipline_clause() -> str:
    """写新正文前的内部确认清单（`file.create` / `prose.continue`）。

    措辞刻意说「在心里定死、不要写出来」：目标是给生成加一层内部规划，不是让模型多输出
    一段大纲——补丁面板里出现清单就是污染作者正文。
    """

    items = "；".join(
        f"{index}）{name}——{detail.rstrip('。')}"
        for index, (name, detail) in enumerate(SCENE_DISCIPLINE_ITEMS, 1)
    )
    return (
        "场景纪律（这四项在心里定死、全部成立再动笔，一章含多场就逐场过一遍；"
        "上文若已在一场戏中间，就从上文读出前两项，不要另起一场）：" + items + "。"
        + SCENE_COLLAPSE_TEST
        + "换个写法再动笔。这四项是你的内部检查，不要写进正文，也不要输出清单、小标题或任何说明；"
        "只写其中一段时，这一段也必须朝第 3、4 项推进一格，不许原地兜圈或只做气氛铺陈。"
    )


def scene_discipline_guard_clause() -> str:
    """改写与压缩时的承重保护（`file.revise`，`project.trim_prose` 复用同一条路径）。

    这里绝不能用 compose 版措辞：`trim_prose` 是按百分比压缩，命令它「先定死四项再动笔」
    会诱导它为凑齐结构反向加字，与压缩指令直接打架。故改写侧只要求**不抽掉**承重，
    并明说宁可多留几个字——与 `_REVISE_SYSTEM_PROMPT` 的最小改动纪律同向。
    """

    names = "、".join(name for name, _ in SCENE_DISCIPLINE_ITEMS)
    return (
        f"场景纪律（这份稿件已经存在，以下四项是它的承重结构：{names}）："
        "删字、并句、砍副词都可以，但改完后这一场若删掉也不影响主线，说明你抽掉了承重——"
        "宁可多留几个字。"
    )


# 审稿判据：与产字侧同源，打捞自退役批量管线 `book_runs/prompts/builder.py` 的 10 维评分表。
#
# 诊断（2026-07-28）：三个 LLM 审稿子代理此前拿到的全部判断标准，就是 ReviewSkill.focus
# 那一句（三条合计 36 字），既没说什么算好也没说什么算坏，只能凭通用语感回「感觉平淡」。
# 判据本身与场景纪律埋在同一座坟里，桌面永远走不到。
#
# 判据放这里而不是 `domains/ide/review_skills.py`，是为了让写与审物理同源：plot 组的
# 承重条直接由 SCENE_DISCIPLINE_ITEMS 派生、末条就是 SCENE_COLLAPSE_TEST，写侧被要求满足的
# 那把尺子，审侧必须用同一把去验。
#
# 两处刻意偏离原 10 维：
#   - continuity_consistency 不在此处——连续性视角是纯启发式关键词扫描，不走 LLM。
#   - narrative_collapse 原文含「到新地点/问询/取得物证」的推理小说模板，属类型专有，
#     已改写成不认题材的判据（同 SCENE_DISCIPLINE_ITEMS 的方向中立取舍）。
REVIEW_RUBRICS: dict[str, tuple[str, ...]] = {
    "plot": (
        "场景推进：这一场的目标有没有被推进或被挫败；只有位移与交代、没有阻力的段落是过场。",
        "承重结构：" + "、".join(name for name, _ in SCENE_DISCIPLINE_ITEMS) + "，缺哪一项就点名哪一项。",
        "钩子强度：收场处有没有留下推动读者往下看的压力（新阻碍、新代价、新问题）；"
        "但正文明显停在一场戏中间时，缺钩子不算问题。",
        SCENE_COLLAPSE_TEST,
    ),
    "character": (
        "动机可见：角色的选择有没有落到动作或对白上；只由旁白宣布的动机不算。",
        "一致性：称谓、说话方式、能力边界、关系亲疏有没有与已知设定或上文冲突。",
        "代价归属：这一场的损失或改变有没有真落在某个角色身上，而不是悬空发生。",
    ),
    "prose": (
        "呈现而非说明：情绪与判断有没有通过动作、感官、对白显形，还是被形容词直接说出。",
        "语言质感：具体名词与有力动词优先，抽象形容词与副词堆叠算问题；"
        "陈词套话（" + "、".join(CLICHE_PHRASES) + " 等）命中即点名。",
        "节奏：句长与对白密度有没有失控；大段内心独白或纯旁白解释要指出来。",
        "AI 腔：说明腔、大纲腔、模板腔、同义反复、机械排比，命中即报。",
    ),
}


def review_rubric_clause(key: str) -> str:
    """某个审稿视角的判断标准，拼进该子代理的 system prompt。

    未知视角直接让 KeyError 抛出而不回落空串：审稿子代理少了判据照样会返回 issue，
    静默降级会让「模型凭语感乱报」看起来像正常工作。
    """

    items = REVIEW_RUBRICS[key]
    return (
        "判断标准（逐条对照，只报真命中的；判据之外的个人口味不要报）："
        + "；".join(item.rstrip("。") for item in items)
        + "。"
    )
