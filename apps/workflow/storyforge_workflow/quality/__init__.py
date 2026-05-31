"""小说质量检查公共入口。"""

from __future__ import annotations

from storyforge_workflow.quality.prose_static_check import StaticProseIssue, check_prose_static_quality

__all__ = ["StaticProseIssue", "check_prose_static_quality"]
