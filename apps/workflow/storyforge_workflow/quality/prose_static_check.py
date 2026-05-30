from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class StaticProseIssue:
    """?????????? NovelLoop ? Judge ?????????"""

    dimension: str
    severity: str
    snippet: str
    message: str
    suggestion: str
    revision_strategy: str = "line_edit"


D_CLICHE = "\u5957\u8bdd"
D_TELLING = "\u8bf4\u660e\u8154"
D_EMOTION = "\u60c5\u7eea\u76f4\u8ff0"
D_DIALOGUE = "\u5bf9\u767d\u5bc6\u5ea6"
D_LENGTH = "\u53e5\u957f"
D_REPEAT = "\u91cd\u590d\u8868\u8fbe"
D_CHARACTER = "\u89d2\u8272\u4e00\u81f4\u6027"
D_CONTINUITY = "\u8fde\u7eed\u6027"
D_PACING = "\u8282\u594f"
LOW = "\u4f4e"
MID = "\u4e2d"
HIGH = "\u9ad8"

_CLICHES = ("\u4e0d\u7981", "\u4e94\u5473\u6742\u9648", "\u5fc3\u4e2d\u4e00\u9707", "\u65e0\u6cd5\u8a00\u55bb", "\u60c5\u4e0d\u81ea\u7981", "\u83ab\u540d", "\u6df1\u6df1\u5730")
_EMOTIONS = ("\u6124\u6012", "\u5bb3\u6015", "\u6050\u60e7", "\u60b2\u4f24", "\u96be\u8fc7", "\u75db\u82e6", "\u7126\u8651", "\u9707\u60ca", "\u7edd\u671b")
_EXPLANATORY = ("\u5979\u4e0d\u77e5\u9053\u8be5\u600e\u4e48\u529e", "\u4ed6\u4e0d\u77e5\u9053\u8be5\u600e\u4e48\u529e", "\u8fd9\u662f\u56e0\u4e3a", "\u610f\u5473\u7740", "\u8bf4\u660e", "\u4e8b\u5b9e\u4e0a")
_ACTION_BEATS = ("\u8d70", "\u63a8", "\u6309", "\u63e1", "\u62ac", "\u653e", "\u8f6c", "\u505c", "\u770b", "\u95ee", "\u7b54", "\u903c", "\u85cf", "\u9012")
_HOOK_WORDS = ("\u7a81\u7136", "\u4e2d\u65ad", "\u54cd\u8d77", "\u95e8\u5916", "\u4e0b\u4e00\u79d2", "\u5374", "\u53ea\u5269", "\u903c\u8fd1")


def check_prose_static_quality(text: str) -> list[StaticProseIssue]:
    """???????????????????"""

    prose = text.strip()
    if not prose:
        return []
    issues: list[StaticProseIssue] = []
    issues.extend(_check_cliches(prose))
    issues.extend(_check_telling(prose))
    issues.extend(_check_dialogue_density(prose))
    issues.extend(_check_sentence_length(prose))
    issues.extend(_check_repetition(prose))
    issues.extend(_check_character_and_continuity_keywords(prose))
    issues.extend(_check_pacing(prose))
    return issues


def _check_cliches(prose: str) -> list[StaticProseIssue]:
    hits = [phrase for phrase in _CLICHES if phrase in prose]
    if not hits:
        return []
    return [StaticProseIssue(D_CLICHE, MID if len(hits) >= 2 else LOW, "\u3001".join(hits), "\u5957\u8bdd\u5bc6\u5ea6\u504f\u9ad8\uff0c\u524a\u5f31\u753b\u9762\u611f\u3002", "\u66ff\u6362\u4e3a\u5177\u4f53\u52a8\u4f5c\u3001\u89e6\u611f\u6216\u5bf9\u767d\u53cd\u5e94\u3002")]


def _check_telling(prose: str) -> list[StaticProseIssue]:
    issues: list[StaticProseIssue] = []
    emotion_hits = [word for word in _EMOTIONS if word in prose]
    if emotion_hits:
        issues.append(StaticProseIssue(D_EMOTION, MID, "\u3001".join(emotion_hits), "\u60c5\u7eea\u88ab\u76f4\u63a5\u8bf4\u660e\uff0c\u7f3a\u5c11\u52a8\u4f5c\u548c\u611f\u5b98\u627f\u8f7d\u3002", "\u7528\u8eab\u4f53\u53cd\u5e94\u3001\u52a8\u4f5c\u505c\u987f\u6216\u5bf9\u767d\u538b\u8feb\u5448\u73b0\u60c5\u7eea\u3002"))
    if any(marker in prose for marker in _EXPLANATORY):
        issues.append(StaticProseIssue(D_TELLING, MID, _first_hit(prose, _EXPLANATORY), "\u89e3\u91ca\u6027\u65c1\u767d\u504f\u91cd\uff0c\u50cf\u603b\u7ed3\u800c\u975e\u573a\u666f\u3002", "\u6539\u6210\u89d2\u8272\u5f53\u4e0b\u53ef\u89c2\u5bdf\u7684\u884c\u52a8\u548c\u51b2\u7a81\u3002", "scene_patch"))
    return issues


def _check_dialogue_density(prose: str) -> list[StaticProseIssue]:
    total = max(len(prose), 1)
    dialogue_chars = sum(len(match.group(0)) for match in re.finditer(r"[\u201c\"].+?[\u201d\"]", prose, re.S))
    ratio = dialogue_chars / total
    if total < 120:
        return []
    if ratio < 0.05:
        return [StaticProseIssue(D_DIALOGUE, LOW, prose[:30], "\u5bf9\u767d\u4e0d\u8db3\uff0c\u4fe1\u606f\u63a8\u8fdb\u53ef\u80fd\u53d8\u6210\u65c1\u767d\u3002", "\u8865\u5165\u6709\u76ee\u7684\u7684\u77ed\u5bf9\u767d\u3002", "scene_patch")]
    if ratio > 0.85:
        return [StaticProseIssue(D_DIALOGUE, LOW, prose[:30], "\u53d9\u8ff0\u4e0d\u8db3\uff0c\u573a\u666f\u7f3a\u5c11\u52a8\u4f5c\u548c\u611f\u5b98\u843d\u70b9\u3002", "\u5728\u5bf9\u767d\u95f4\u8865\u5165\u52a8\u4f5c\u3001\u73af\u5883\u548c\u53cd\u5e94\u3002", "scene_patch")]
    return []


def _check_sentence_length(prose: str) -> list[StaticProseIssue]:
    sentences = [part.strip() for part in re.split(r"[\u3002\uff01\uff1f!?]\s*", prose) if part.strip()]
    if any(len(sentence) > 90 for sentence in sentences):
        return [StaticProseIssue(D_LENGTH, LOW, max(sentences, key=len)[:40], "\u5355\u53e5\u8fc7\u957f\u5f71\u54cd\u9605\u8bfb\u8282\u594f\u3002", "\u62c6\u5206\u957f\u53e5\u5e76\u4fdd\u7559\u52a8\u4f5c\u94fe\u3002")]
    return []


def _check_repetition(prose: str) -> list[StaticProseIssue]:
    words = re.findall(r"[\u4e00-\u9fff]{2,4}", prose)
    repeated = [word for word, count in Counter(words).items() if count >= 4]
    if repeated:
        return [StaticProseIssue(D_REPEAT, LOW, repeated[0], "\u77ed\u7a97\u53e3\u5185\u91cd\u590d\u8868\u8fbe\u504f\u591a\u3002", "\u66ff\u6362\u91cd\u590d\u8bcd\u6216\u6539\u5199\u53e5\u5f0f\u3002")]
    return []


def _check_character_and_continuity_keywords(prose: str) -> list[StaticProseIssue]:
    issues: list[StaticProseIssue] = []
    character_hits = ("\u5f00\u6000\u5927\u7b11", "\u568e\u5555", "\u6492\u5a07", "\u4efb\u6027")
    continuity_hits = ("\u5df2\u7ecf\u75ca\u6108", "\u4ece\u672a\u53d7\u4f24", "\u4fe1\u53f7\u505c\u6b62\u91cd\u590d", "\u7a97\u53e3\u65e0\u9650")
    if any(word in prose for word in character_hits):
        issues.append(StaticProseIssue(D_CHARACTER, HIGH, _first_hit(prose, character_hits), "\u89d2\u8272\u8868\u73b0\u7591\u4f3c\u504f\u79bb\u65e2\u5b9a\u7ea6\u675f\u3002", "\u5bf9\u7167 Character Bible \u6539\u56de\u7a33\u5b9a\u884c\u4e3a\u3002", "regenerate"))
    if any(word in prose for word in continuity_hits):
        issues.append(StaticProseIssue(D_CONTINUITY, HIGH, _first_hit(prose, continuity_hits), "\u6b63\u6587\u7591\u4f3c\u8fdd\u53cd\u5df2\u77e5\u8fde\u7eed\u6027\u4e8b\u5b9e\u3002", "\u56de\u5230\u5fc5\u542b\u4e8b\u5b9e\u4e0e\u65f6\u95f4\u7ebf\u91cd\u5199\u51b2\u7a81\u5904\u3002", "regenerate"))
    return issues


def _check_pacing(prose: str) -> list[StaticProseIssue]:
    if len(prose) < 80:
        return []
    has_action = any(word in prose for word in _ACTION_BEATS)
    has_hook = any(word in prose[-80:] for word in _HOOK_WORDS)
    if not has_action or not has_hook:
        return [StaticProseIssue(D_PACING, MID, prose[-40:], "\u884c\u52a8\u63a8\u8fdb\u6216\u7ed3\u5c3e\u94a9\u5b50\u4e0d\u8db3\u3002", "\u8865\u5165\u660e\u786e\u884c\u52a8 beat \u4e0e\u6bb5\u672b\u60ac\u5ff5\u3002", "scene_patch")]
    return []


def _first_hit(prose: str, candidates: tuple[str, ...]) -> str:
    return next((item for item in candidates if item in prose), prose[:20])
