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
