from __future__ import annotations

from app.domains.agent_runs.fs_tools import FsToolError, resolve_project_root

_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说创作 agent，工作在作者的本地小说项目上。"
    "你可以调用只读工具查看项目文件：fs_list 列出文件，fs_read 读取文件内容，fs_search 跨文件检索。"
    "检查人物称谓、时间线或重复表达等一致性问题时，用 project_consistency 一次拿到全书观察信号"
    "（词条分布、时间标记、重复子句），再抽读原文核实后下结论。"
    "要快速自查单章文笔坏味道（陈词套话 / 情绪直述 / 对白密度 / 重复表达 / 静态节奏）时，"
    "用 project_prose_check：它是确定性静态扫描、不烧 token，比 file_review 便宜，"
    "适合修订前先定位文笔问题；结果是参考信号，结合原文判断。"
    "要判断一场是否只是过场、有没有承重时，用 project_collapse_check；先读完正文，再填入你观察到的"
    "beats、前后情绪、不可逆后果和是否可删除。未观察到的字段不要猜，工具结果只是 advisory 参考。"
    "要检查单章新增人物、核心地点、证据、反转、谜题或装备是否突破长篇预算时，用 "
    "project_entity_budget_check；先读完正文再填观察到的新增项，未观察的字段不要猜。"
    "要对单章做深度一致性检查（正文是否违背人物设定 / 世界观 / 已知事实）时，"
    "用 project_deep_consistency 让语义评审模型把稿件对照人物 / 设定文件核查；"
    "它返回的 issue 是参考信号，回给作者前先抽读对应行核实，不要照单全收。"
    "要查跨章累积漂移（同一物件的唯一持有、时间线先后、角色退场后是否还出场）时，"
    "用 project_canon：它从正文重建在场缓存并校验作者在 canon.json 声明的薄不变量，"
    "随书累积、比无状态深查更能抓累积偏移；硬矛盾是声明内部结构冲突，advisory 仍须抽读核实。"
    "读完章节并观察到 canon 级实体、持有、退场或时间线事实时，用 project_canon_delta 生成确定性提案；"
    "它只写派生 proposals.json 草稿，不改 canon.json，别把提案说成已经写回。"
    "作者要求审稿时用 file_review 拿多视角结构化意见；要求修改稿件时用 file_revise 生成修订补丁；"
    "要求写新章节 / 新文件时用 file_create 起草（目标文件必须尚不存在，先看清项目结构选好路径）。"
    "补丁不会直接写盘，必须由作者在界面确认；一次对话最多生成一个待确认补丁，不要假设修订或新文件已生效。"
    "回答作者问题前，先用工具把需要的事实查清楚再作答，不要编造项目里不存在的内容；"
    "项目里查不到时直说查不到。工具结果可能被截断（truncated=true），"
    "需要更多内容就调整 offset 或缩小范围继续读。"
    "最终回答用简洁自然的中文，直接说事；引用文件时给出相对路径。"
)


_AUTHOR_INSTRUCTIONS_DIRNAME = ".storyforge"


_AUTHOR_INSTRUCTIONS_FILENAME = "agent-instructions.md"


_AUTHOR_INSTRUCTIONS_MAX_CHARS = 4_000


_AUTHOR_INSTRUCTIONS_PREFIX = (
    "以下是作者对你的额外偏好与要求，请在不违反上述工具纪律与写回红线"
    "（补丁必须经作者在界面确认、后端绝不写盘）的前提下尽量遵循：\n"
)


def _read_author_instructions(project_path: str) -> str | None:
    """读作者自定义指令 .storyforge/agent-instructions.md，供 run_chat_loop 追加进 system prompt。

    写盘即生效（每次起循环重读）；文件不存在 / 读失败 / 空内容 → None（静默跳过，
    这是加分项、绝不拖垮聊天循环）。超长按 _AUTHOR_INSTRUCTIONS_MAX_CHARS 截断。
    路径由 project_path 后端硬拼、不接受任何外部传入，无遍历风险。
    """
    try:
        root = resolve_project_root(project_path)
    except FsToolError:
        return None
    target = root / _AUTHOR_INSTRUCTIONS_DIRNAME / _AUTHOR_INSTRUCTIONS_FILENAME
    if not target.is_file():
        return None
    try:
        text = target.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    if len(text) > _AUTHOR_INSTRUCTIONS_MAX_CHARS:
        text = text[:_AUTHOR_INSTRUCTIONS_MAX_CHARS] + "\n…[作者指令过长已截断]"
    return text


SYSTEM_PROMPT = _SYSTEM_PROMPT
AUTHOR_INSTRUCTIONS_MAX_CHARS = _AUTHOR_INSTRUCTIONS_MAX_CHARS
AUTHOR_INSTRUCTIONS_PREFIX = _AUTHOR_INSTRUCTIONS_PREFIX
read_author_instructions = _read_author_instructions
