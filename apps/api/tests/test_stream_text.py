import pytest

from app.common.stream_text import VisibleTextFilter


@pytest.mark.parametrize("source,expected", [
    ("正文<think>private</think>结束", "正文结束"),
    ("<THINK>private</THINK>可见", "可见"),
    ("正文<think>not closed", "正文"),
    ("正文 sk-abcdefghijk 尾", "正文 [REDACTED] 尾"),
    ("正文 api_key=notarealcredential 尾", "正文 api_key=[REDACTED] 尾"),
    ("正文 actual!fixture credential 尾", "正文 [REDACTED] 尾"),
])
def test_every_split_hides_reasoning_and_secrets(source, expected):
    for split in range(len(source) + 1):
        filter_ = VisibleTextFilter(["actual!fixture credential"])
        first = filter_.feed(source[:split])
        second = filter_.feed(source[split:])
        assert first + second + filter_.finish() == expected
        assert "private" not in first + second
        assert "notarealcredential" not in first + second


def test_character_chunks_and_unicode_are_lossless():
    source = "一段 English words, **正文** 😀\n结束。"
    filter_ = VisibleTextFilter()
    assert "".join(filter_.feed(char) for char in source) + filter_.finish() == source


def test_unbounded_reasoning_is_dropped_without_buffering():
    filter_ = VisibleTextFilter()
    assert filter_.feed("<think>" + "秘密" * 10000) == ""
    assert filter_.feed("</think>第一段") == "第一段"
    assert filter_.finish() == ""
