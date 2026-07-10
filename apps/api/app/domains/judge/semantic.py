"""Judge 域 Semantic LLM 评审。

调用 OpenAI 兼容模型执行语义一致性评审，解析响应并规整为 DetectedIssue 列表。
"""
from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence

from prometheus_client import Counter

from app.common import llm_client
from app.common.llm_env import resolved_llm_env
from app.common.llm_http import env_value
from app.common.logging_config import get_logger
from app.domains.judge.schemas import JudgeIssueCreate, SemanticJudgeInput
from app.domains.judge.types import DetectedIssue, JudgeProvider, SemanticJudgeOutcome

_JUDGE_SYSTEM_PROMPT = """\
你是 StoryForge 的结构化一致性评审员。仅返回 JSON 数组，不要解释。

## 检测类别与严重性

| category | 触发条件 | severity |
|---|---|---|
| setting_conflict | 正文与必含事实直接矛盾（地点、物品、伤情等） | high |
| timeline_conflict | 已死亡角色出场，或同一时刻角色出现在两处 | high |
| relationship_conflict | 角色关系与已知事实矛盾（敌友、亲属、从属） | medium |
| style_drift | 出现解释性旁白、作者直接说明，破坏叙事克制感 | medium |
| character_voice_violation | 角色对白/行为违反其声音约束（语气、句式、禁忌词） | medium |
| cross_chapter_state_conflict | 正文与跨章 story_state / memory 事实矛盾（持有人、位置、伤情、规则、状态） | high |
| foreshadow_payoff_gap | 正文声称回收、解决或遗忘伏笔，但与已埋伏笔状态不匹配 | high |
| arc_continuity_drift | 本章推进偏离已知主线弧线、倒计时或承诺，且没有合理过渡 | medium |
| repetition_echo | 本章明显复用前章开头、段落或系统化句式，形成模板化回声 | medium |

severity 只能是 low / medium / high。

## 输出格式（JSON 数组，每项必须包含以下字段）

```json
[
  {
    "category": "setting_conflict",
    "severity": "high",
    "span_start": 12,
    "span_end": 18,
    "matched_text": "左臂完好无损",
    "expected_text": "左臂受伤",
    "replacement_text": "左臂仍然受伤",
    "summary": "正文与必含事实"左臂受伤"矛盾。"
  }
]
```

span_start / span_end 是正文中的字符偏移量（0-based）。无问题时返回空数组 []。\
"""

_JUDGE_FEW_SHOT = """\
## 示例

### 示例 1 — setting_conflict
正文：「她举起右臂，剑光一闪。」
必含事实：["右臂受伤"]
输出：[{"category":"setting_conflict","severity":"high","span_start":3,"span_end":5,"matched_text":"右臂","expected_text":"右臂受伤","replacement_text":"左臂","summary":"正文与必含事实"右臂受伤"矛盾，角色不应能举起右臂。"}]

### 示例 2 — character_voice_violation
正文：「林寒长篇大论地解释了自己的动机，语气热切。」
角色声音约束：[{"name": "林寒", "voice_traits": {"语气": "克制", "句式": "短促"}}, {"name": "沈曜", "notes": "一生不撒谎；说话从不超过三句。"}]
（约束条目的字段形状不固定：可能是结构化 voice_traits / forbidden_traits，也可能是 notes 原文摘录，按字段语义理解。）
输出：[{"category":"character_voice_violation","severity":"medium","span_start":2,"span_end":18,"matched_text":"长篇大论地解释了自己的动机，语气热切","expected_text":"克制、短促的表达","replacement_text":"林寒只说了一个字。","summary":"林寒的对白违反声音约束：应克制、短促，不应长篇解释动机。"}]

### 示例 3 — 无问题
正文：「她沉默地走过长廊。」
必含事实：[]
输出：[]\
"""

_judge_llm_errors_total = Counter(
    "judge_llm_errors_total",
    "Total semantic judge LLM errors (network, timeout, malformed response)",
)


def semantic_judge(
    payload: JudgeIssueCreate | SemanticJudgeInput,
    *,
    provider: JudgeProvider | None = None,
    character_voice_constraints: list[dict] | None = None,
    llm_env: Mapping[str, str | None] | None = None,
) -> list[DetectedIssue]:
    """调用 OpenAI 兼容模型执行语义一致性评审，仅返回问题列表。

    保留历史签名供既有调用方使用；需要区分"无问题"与"调用失败"时改用
    semantic_judge_with_status。
    """

    return semantic_judge_with_status(
        payload,
        provider=provider,
        character_voice_constraints=character_voice_constraints,
        llm_env=llm_env,
    ).issues


def semantic_judge_with_status(
    payload: JudgeIssueCreate | SemanticJudgeInput,
    *,
    provider: JudgeProvider | None = None,
    character_voice_constraints: list[dict] | None = None,
    llm_env: Mapping[str, str | None] | None = None,
) -> SemanticJudgeOutcome:
    """执行语义评审并返回结果与失败标记。

    failed=True 仅代表远程调用出错（网络/超时/响应不可解析）。
    未配置 API Key 属于"未启用"而非失败，failed 保持 False。

    STORYFORGE_LLM_* 走 resolved_llm_env 覆盖链（env → .env settings → llm-provider.json），
    STORYFORGE_JUDGE_LLM_* 仍为进程 env 独占的最高优先级覆盖。
    """

    if provider is not None:
        return SemanticJudgeOutcome(issues=_issues_from_provider_items(provider(payload), payload.content), failed=False)

    source = resolved_llm_env(llm_env)
    api_key = os.getenv("STORYFORGE_JUDGE_LLM_API_KEY") or env_value(source, "STORYFORGE_LLM_API_KEY")
    if not api_key:
        return SemanticJudgeOutcome(issues=[], failed=False, configured=False)
    base_url = os.getenv("STORYFORGE_JUDGE_LLM_BASE_URL") or env_value(source, "STORYFORGE_LLM_BASE_URL") or "https://api.openai.com/v1"
    model = os.getenv("STORYFORGE_JUDGE_LLM_MODEL") or env_value(source, "STORYFORGE_LLM_MODEL") or "gpt-4o-mini"

    # json.dumps 而非 f-string repr：模型看到的必须是与 few-shot 同形状的合法 JSON（双引号、无 Python 字面量）。
    voice_section = (
        f"\n角色声音约束：{json.dumps(character_voice_constraints, ensure_ascii=False, default=str)}"
        if character_voice_constraints
        else ""
    )
    user_prompt = (
        f"{_JUDGE_FEW_SHOT}\n\n"
        f"## 待评审正文\n{payload.content}\n"
        f"必含事实：{payload.required_facts}\n"
        f"风格规则：{payload.style_rules}\n"
        f"证据链接：{payload.evidence_links}"
        f"{voice_section}"
    )
    request_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
    }
    reasoning_effort = os.getenv("STORYFORGE_JUDGE_LLM_REASONING_EFFORT") or env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        request_payload["reasoning_effort"] = reasoning_effort
    log = get_logger(__name__)
    timeout_seconds = os.getenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS") or env_value(source, "STORYFORGE_LLM_TIMEOUT_SECONDS") or "300"
    request_source = dict(source)
    request_source.update(
        {
            "STORYFORGE_LLM_API_KEY": api_key,
            "STORYFORGE_LLM_BASE_URL": base_url.strip().rstrip("/"),
            "STORYFORGE_LLM_AUTH_HEADER": "bearer",
        }
    )
    try:
        data, _started_at = llm_client._request_chat_completions(
            request_source,
            request_payload,
            timeout_seconds=float(timeout_seconds),
            max_attempts=1,
        )
        raw_content = data["choices"][0]["message"]["content"]
        decoded = _decode_semantic_judge_content(str(raw_content))
    except Exception as exc:
        log.warning("semantic_judge_failed", error=llm_client.redact_secrets(str(exc), [api_key]), model=model)
        _judge_llm_errors_total.inc()
        return SemanticJudgeOutcome(issues=[], failed=True)
    if not isinstance(decoded, list):
        log.warning("semantic_judge_invalid_response", raw=str(raw_content)[:200])
        return SemanticJudgeOutcome(issues=[], failed=True)
    valid_items = [item for item in decoded if isinstance(item, dict) and "category" in item]
    if len(valid_items) < len(decoded):
        log.warning("semantic_judge_filtered_items", dropped=len(decoded) - len(valid_items))
    return SemanticJudgeOutcome(issues=_issues_from_provider_items(valid_items, payload.content), failed=False)


def _decode_semantic_judge_content(raw_content: str) -> object:
    """从模型响应中提取 JSON，兼容纯 JSON、代码块和前后说明文本。"""

    stripped = raw_content.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    fenced = _strip_json_markdown_fence(stripped)
    if fenced != stripped:
        try:
            return json.loads(fenced)
        except json.JSONDecodeError:
            pass
    array_fragment = _first_json_array_fragment(stripped)
    if array_fragment is not None:
        return json.loads(array_fragment)
    return json.loads(stripped)


def _strip_json_markdown_fence(content: str) -> str:
    """去掉模型常见的 ```json 包裹，保留内部 JSON 文本。"""

    lines = content.splitlines()
    if len(lines) >= 2 and lines[0].strip().lower() in {"```json", "```"} and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return content


def _first_json_array_fragment(content: str) -> str | None:
    """提取文本中的第一个 JSON 数组片段，支持字符串内括号转义。"""

    start = content.find("[")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(content)):
        char = content[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return content[start : index + 1]
    return None


def _issues_from_provider_items(items: Sequence[dict[str, object] | DetectedIssue], content: str) -> list[DetectedIssue]:
    """规整 provider 返回值，让远程模型和本地测试替身走同一条解析路径。"""

    issues: list[DetectedIssue] = []
    for item in items:
        if isinstance(item, DetectedIssue):
            issues.append(item)
        elif isinstance(item, dict):
            issues.append(_issue_from_llm_item(item, content))
    return issues


def _locate_matched_span(content: str, matched_text: str, hint_start: int) -> tuple[int, int] | None:
    """以 matched_text 反查正文真实偏移；多处命中取距模型自报位置最近的一处。

    模型对中文正文自报的字符偏移不可靠，matched_text 才是它真正"看到"的原文，
    能反查到就以反查结果为准；找不到（模型转述而非摘抄）返回 None，由调用方回退自报 span。
    """

    needle = matched_text.strip()
    if not needle:
        return None
    best: tuple[int, int] | None = None
    index = content.find(needle)
    while index >= 0:
        if best is None or abs(index - hint_start) < abs(best[0] - hint_start):
            best = (index, index + len(needle))
        index = content.find(needle, index + 1)
    return best


def _issue_from_llm_item(item: dict, content: str) -> DetectedIssue:
    """把模型 JSON 条目规整为内部问题对象，防止越界位置污染响应。"""

    span_start = max(0, min(int(item.get("span_start", 0)), len(content)))
    span_end = max(span_start, min(int(item.get("span_end", span_start)), len(content)))
    raw_matched = str(item.get("matched_text") or "")
    located = _locate_matched_span(content, raw_matched, span_start)
    if located is not None:
        span_start, span_end = located
    category = str(item.get("category", "setting_conflict"))
    severity = str(item.get("severity", "medium"))
    matched_text = raw_matched or content[span_start:span_end]
    expected_text = str(item.get("expected_text", ""))
    return DetectedIssue(
        category=category,
        severity=severity if severity in {"low", "medium", "high"} else "medium",
        span_start=span_start,
        span_end=span_end,
        summary=str(item.get("summary") or f"模型发现 {category}。"),
        recommended_repair_mode="replace_span",
        expected_text=expected_text,
        replacement_text=str(item.get("replacement_text") or expected_text),
        matched_text=matched_text,
    )
