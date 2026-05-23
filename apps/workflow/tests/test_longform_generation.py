from __future__ import annotations

from pathlib import Path

import pytest

from storyforge_workflow.longform import LongformGenerationPlan, count_article_chars, generate_longform_article


def test_generate_longform_article_writes_segments_until_target(tmp_path: Path) -> None:
    """长文生成器应按真实 provider 边界分段调用，并把正文增量落盘。"""

    prompts: list[str] = []

    def provider(prompt: str) -> str:
        prompts.append(prompt)
        return "晨雾里，林岚把航海日志摊开，逐项核对灯塔留下的异常信号。" * 12

    output = tmp_path / "article.md"
    result = generate_longform_article(
        LongformGenerationPlan(title="灯塔余烬", target_chars=520, segment_chars=260, max_segments=4, retry_sleep_seconds=0),
        output,
        premise="失真的灯塔信号迫使远航舰队重新选择航线。",
        provider=provider,
    )

    content = output.read_text(encoding="utf-8")
    assert result["actual_chars"] >= 520
    assert result["segments"] == 2
    assert len(prompts) == 2
    assert "## 第 001 段" in content
    assert "## 第 002 段" in content
    assert count_article_chars(content) >= 520


def test_generate_longform_article_resumes_existing_file(tmp_path: Path) -> None:
    """重新执行时应从既有分段后继续，避免覆盖已生成正文。"""

    output = tmp_path / "article.md"
    output.write_text("# 灯塔余烬\n\n## 第 001 段\n\n旧段落正文。\n", encoding="utf-8")

    def provider(prompt: str) -> str:
        assert "当前段号：2" in prompt
        return "新段落继续推进冲突，补足人物选择与环境压力。" * 15

    result = generate_longform_article(
        LongformGenerationPlan(title="灯塔余烬", target_chars=260, segment_chars=240, max_segments=3, retry_sleep_seconds=0),
        output,
        premise="失真的灯塔信号迫使远航舰队重新选择航线。",
        provider=provider,
    )

    assert result["segments"] == 2
    content = output.read_text(encoding="utf-8")
    assert "旧段落正文" in content
    assert "## 第 002 段" in content


def test_generate_longform_article_fails_when_max_segments_exhausted(tmp_path: Path) -> None:
    """达到最大分段仍不足目标字数时必须显式失败，不能假装完成。"""

    with pytest.raises(RuntimeError, match="最大分段数"):
        generate_longform_article(
            LongformGenerationPlan(title="灯塔余烬", target_chars=1000, segment_chars=300, max_segments=1, retry_sleep_seconds=0),
            tmp_path / "article.md",
            premise="失真的灯塔信号迫使远航舰队重新选择航线。",
            provider=lambda prompt: "短段落正文。" * 40,
        )


def test_longform_cli_generates_article_through_module_entry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """命令行入口应能通过 workflow 模块生成文章。"""

    from storyforge_workflow import longform

    def provider(prompt: str) -> str:
        assert "标题：雾城回声" in prompt
        return "雨夜里，侦探沿着旧剧院的安全通道前进，录音笔忽然播放失踪者的耳语。" * 12

    output = tmp_path / "mystery.md"
    monkeypatch.setattr(longform, "generate_text", provider)

    exit_code = longform.main(
        [
            "--title",
            "雾城回声",
            "--premise",
            "刑警追查旧剧院录音引发的连环失踪案。",
            "--output",
            str(output),
            "--target-chars",
            "520",
            "--segment-chars",
            "260",
            "--max-segments",
            "4",
            "--retry-sleep-seconds",
            "0",
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "actual_chars" in captured.out
    assert output.exists()
    assert count_article_chars(output.read_text(encoding="utf-8")) >= 520


def test_generate_longform_article_retries_transient_provider_errors_with_backoff(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """provider 出现临时错误时应按指数退避重试，并在成功后继续落盘。"""

    from urllib.error import HTTPError

    from storyforge_workflow import longform

    attempts = 0
    sleeps: list[float] = []

    def provider(prompt: str) -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise HTTPError(url="https://example.test", code=503, msg="Service Unavailable", hdrs=None, fp=None)
        return "雨夜里，侦探沿着旧剧院的安全通道前进，录音笔忽然播放失踪者的耳语。" * 12

    monkeypatch.setattr(longform, "sleep", sleeps.append)
    output = tmp_path / "article.md"

    result = generate_longform_article(
        LongformGenerationPlan(
            title="雾城回声",
            target_chars=260,
            segment_chars=240,
            max_segments=2,
            retry_count=3,
            retry_sleep_seconds=1,
            retry_backoff_multiplier=2,
            max_retry_sleep_seconds=5,
        ),
        output,
        premise="刑警追查旧剧院录音引发的连环失踪案。",
        provider=provider,
    )

    assert attempts == 3
    assert sleeps == [1, 2]
    assert result["actual_chars"] >= 260
    assert "## 第 001 段" in output.read_text(encoding="utf-8")


def test_generate_longform_article_reports_persisted_counting_contract_for_multiline_segments(tmp_path: Path) -> None:
    """返回的实际字数必须等于落盘文件的正文计数，不能把换行符算成正文。"""

    def provider(prompt: str) -> str:
        return "\n".join(["雨夜剧院里，侦探听见暗门后传来录音笔的低语。"] * 20)

    output = tmp_path / "article.md"
    result = generate_longform_article(
        LongformGenerationPlan(title="雾城回声", target_chars=700, segment_chars=300, max_segments=4, retry_sleep_seconds=0),
        output,
        premise="刑警追查旧剧院录音引发的连环失踪案。",
        provider=provider,
    )

    persisted_chars = count_article_chars(output.read_text(encoding="utf-8"))
    assert result["actual_chars"] == persisted_chars
    assert persisted_chars >= 700
