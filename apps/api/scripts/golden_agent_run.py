"""Agent run oracle (P3-5b2b): the real `run_agent_user_message` with the model scripted at the HTTP layer.

Every scenario starts a fresh in-memory sqlite database and synthetic project, then drives one author message
through run creation, the chat loop (real configured + observed provider, real tool handlers), the single-turn
fallback, hidden system jobs and execution settlement. Control writes flip the run row at a named interruption
boundary or while a request is in flight, and a virtual clock stands in for time. Recorded: frames, text frames,
the result or error, every row the run wrote (runs / events / artifacts / assistant sessions / messages / tool
calls), the HTTP requests and the interruption boundaries asked about. Long strings are kept as digests.
"""

from __future__ import annotations

import datetime as real_datetime
import email.message
import hashlib
import io
import json
import os
import shutil
from types import SimpleNamespace
from urllib import error
from uuid import UUID

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle, stable
from golden_llm_harness import FakeBody, sse

SECRET = "sk-oracle-secret-123456"
STEP = 0.25
SOURCES = [
    "app/domains/agent_runs/runtime.py",
    "app/domains/agent_runs/loop/conversation_runtime.py",
    "app/domains/agent_runs/tools/execution_runtime.py",
    "app/domains/agent_runs/runtime_delivery.py",
    "app/domains/agent_runs/service.py",
    "app/domains/agent_runs/events/review_sources.py",
]
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "openai",
    "STORYFORGE_LLM_MODEL": "m-1",
    "STORYFORGE_LLM_API_KEY": SECRET,
    "STORYFORGE_LLM_BASE_URL": "https://llm.example/v1",
    "STORYFORGE_LLM_TIMEOUT_SECONDS": "60",
    "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1",
    # Non-integral rates: TS numbers drop Python's 2.0 / 2 split, and these values end up inside evidence digests.
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2.5",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8.5",
}
FILES = {
    "正文/第001章.md": "第一章 风起\n\n林舟推开门。\n",
    "正文/第002章.md": "第二章 夜行\n\n沈禾问路。\n",
    "人物/主角.md": "# 林舟\n\n左臂有旧伤。\n",
}
PROPOSAL = {"target_path": "设定/规则.md", "operation": "create", "title": "铁城宵禁", "claim": "铁城入夜宵禁",
            "kind": "world_rule", "confidence": "inferred", "sources": [{"type": "project_file", "path": "正文/第001章.md"}],
            "reason": "第一章提到"}
FIXED_NOW = (2026, 10, 12, 8, 30, 0)
HISTORY = [["user" if i % 2 == 0 else "assistant", f"第{i}条消息" + "。" * 20] for i in range(14)]


def completion(content="", calls=(), finish="stop", usage=(12, 5), **effects):
    message = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = [{"id": i, "type": "function", "function": {"name": n, "arguments": a}}
                                 for i, n, a in calls]
    body = {"id": "resp-1", "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1], "total_tokens": usage[0] + usage[1]}}
    return {"status": 200, "body": json.dumps(body, ensure_ascii=False), **effects}


def streamed(chunks=(), calls=(), finish="stop", usage=(12, 5), **effects):
    events = [{"choices": [{"index": 0, "delta": {"content": chunk}}]} for chunk in chunks]
    for index, (call_id, name, args) in enumerate(calls):
        events.append({"choices": [{"index": 0, "delta": {"tool_calls": [
            {"index": index, "id": call_id, "type": "function", "function": {"name": name, "arguments": args}}]}}]})
    events.append({"choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
    events.append({"choices": [], "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1],
                                            "total_tokens": usage[0] + usage[1]}})
    return {"status": 200, "body": sse(*events), **effects}


def message(text, run_id="run-1", project=True, file=True, **extra):
    args = {"project_path": "$ROOT"} if project else {}
    if file:
        args["file_path"] = "$ROOT/正文/第001章.md"
    args.update(extra.pop("args", {}))
    return {"type": "user_message", "user_message": text, "run_id": run_id, "args": args, **extra}


def scenario(name, msg, replies=(), **options):
    return {"id": name, "message": msg, "replies": list(replies), "env": options.pop("env", {}),
            "triggers": options.pop("triggers", []), "stream": options.pop("stream", False),
            "history": options.pop("history", None), "sessions": options.pop("sessions", []), **options}


def scenarios():
    s = []
    s.append(scenario("answer", message("第一章怎么样"), [completion("第一章节奏紧。")]))
    s.append(scenario("read-then-answer", message("读一下第一章再说", permission_profile="read"), [
        completion("", [("c1", "fs_read", '{"path":"正文/第001章.md"}'), ("c2", "fs_list", "{}")]),
        completion("读完了，开头很紧。")]))
    s.append(scenario("tools-in-two-rounds", message("先列再读"), [
        completion("", [("c1", "fs_list", "{}")]), completion("", [("c2", "fs_read", '{"path":"人物/主角.md"}')]),
        completion("都看过了。")]))
    s.append(scenario("stop-after-compaction", message("继续聊", assistant_session_id=1), [
        completion("好的。"), {"compaction_quote": True}], history=HISTORY,
        sessions=[{"title": "新的创作会话", "project_path": "$ROOT"}],
        triggers=[{"boundary": "before_publish:system_job:title", "nth": 1, "status": "stopped",
                   "current_step": "stopped"}]))
    s.append(scenario("stop-before-finalize", message("收尾前停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_finalize:assistant.chat_loop", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("streaming", message("流式回答"), [
        streamed(["我先", "看看"], [("c1", "fs_list", "{}")]), streamed(["看完", f"了 {SECRET}"])], stream=True))
    s.append(scenario("long-history-compaction", message("继续聊", assistant_session_id=1), [
        completion("好的。"), {"compaction_quote": True}], history=HISTORY,
        sessions=[{"title": "新的创作会话", "project_path": "$ROOT"}]))
    s.append(scenario("pause-after-tool", message("先列目录"), [completion("", [("c1", "fs_list", "{}")])],
                      triggers=[{"boundary": "after_tool", "nth": 1, "status": "paused", "current_step": "paused"}]))
    s.append(scenario("stop-during-request", message("停"), [completion("答到一半", set_status=["stopped", "stopped"])]))
    s.append(scenario("fallback-not-configured", message("没配模型"), env={"STORYFORGE_LLM_API_KEY": None}))
    s.append(scenario("fallback-no-project", message("随便聊聊", project=False, file=False,
                                                     args={"selection_text": "选中的一句"}),
                      [completion("单轮回答。")]))
    s.append(scenario("fallback-llm-error", message("随便聊聊", project=False, file=False),
                      [{"status": 500, "body": '{"error":{"message":"upstream down"}}'}]))
    s.append(scenario("loop-provider-error", message("出错"), [
        completion("", [("c1", "fs_list", "{}")]), {"status": 500, "body": '{"error":{"message":"boom"}}'}]))
    s.append(scenario("session-project-mismatch", message("归属不对", assistant_session_id=1),
                      sessions=[{"title": "别处", "project_path": "D:/elsewhere"}]))
    s.append(scenario("session-id-conflict", message("两个会话", assistant_session_id=1,
                                                    args={"assistant_session_id": 2})))
    s.append(scenario("session-missing", message("不存在的会话", assistant_session_id=9)))
    s.append(scenario("file-intent-downgrade", message("审稿", file=False, intent="file.review"),
                      [completion("没有打开文件，按对话处理。")]))
    s.append(scenario("stop-before-title-job", message("收尾时停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_publish:system_job:title", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("deadline", message("超时"), [completion("", [("c1", "fs_list", "{}")], advance=901)]))
    s.append(scenario("offered-review-not-latest", message(
        "按审稿意见改第一章", args={"review_report": {"report_id": "rr-1", "content_sha256": "x" * 64}})))
    s.append(scenario("stop-before-fallback", message("单轮前停", project=False, file=False),
                      triggers=[{"boundary": "before_fallback", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("knowledge-proposal", message("记一条设定"), [
        completion("", [("c1", "knowledge_propose", json.dumps({"proposals": [PROPOSAL]}, ensure_ascii=False))]),
        completion("提议已记下。")]))
    review = {"report_id": "rr-1", "file_path": "正文/第001章.md", "issues": []}
    s.append(scenario("required-review-unbound", message("按审稿意见改第一章", assistant_session_id=1,
                                                        args={"review_report": {"report_id": "rr-1"}}),
                      sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=review))
    s.append(scenario("offered-review-current", message(
        "按审稿意见改第一章", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": "c" * 64}}), [completion("先看看。")],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}],
        seed_review={**review, "content_sha256": "c" * 64}))
    s.append(scenario("title-kept", message("老会话", assistant_session_id=1), [completion("好。")],
                      sessions=[{"title": "我自己起的名字", "project_path": "$ROOT"}]))
    return s


CONTROL_SOURCES = [
    "app/domains/agent_runs/service_control.py",
    "app/domains/agent_runs/service_execution.py",
    "app/domains/agent_runs/loop/recovery.py",
    "app/domains/agent_runs/loop/checkpoint_store.py",
    "app/domains/agent_runs/loop/recovery_sources.py",
]
PATCH = {"id": "patch-1", "kind": "file_revision", "file_path": "正文/第001章.md", "before": "旧", "after": "新",
         "requires_confirmation": True, "created_by_tool": "file.revise"}


def waiting(outcome=None):
    agent_result = {"summary": "补丁待确认", "requires_user_confirmation": True}
    if outcome:
        agent_result["execution_outcome"] = outcome
    return {"type": "agent_result", "session_id": "sess-1", "assistant_session_id": None, "intent": "file.revise",
            "user_message": "改第一章", "agent_result": agent_result, "tool_trace": [], "proposed_patch": PATCH,
            "plan": [{"step": "file.revise", "detail": "修订", "status": "completed"},
                     {"step": "permission.confirm", "detail": "等作者确认", "status": "needs_approval"}]}


def control_scenarios():
    pause, stop = {"type": "pause_run"}, {"type": "stop_run"}
    resume = {"op": "control", "type": "resume_run"}
    s = []
    s.append(scenario("pause-then-resume", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]), completion("看完了。")], ops=[resume]))
    s.append(scenario("pause-edit-then-resume", message("先读再答"), [
        completion("", [("c1", "fs_read", '{"path":"正文/第002章.md"}')], controls=[pause])],
        ops=[{"op": "edit", "path": "正文/第001章.md", "content": "第一章 改过"}, resume]))
    after_tool = [{"boundary": "after_tool", "nth": 1, "status": "paused", "current_step": "paused"}]
    # Paused after the first of two reads (the second, a directory, is still pending); the resumed run finishes
    # it, runs one more round and answers, numbering traces after the ones already recorded.
    s.append(scenario("pause-after-tool-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}'), ("c2", "fs_read", '{"path":"正文"}')]),
        completion("", [("c3", "fs_list", "{}")]), completion("看过了。")], triggers=after_tool, ops=[resume]))
    s.append(scenario("pause-after-tool-unknown-tool-pending-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}'), ("c2", "no_such_tool", "{}")]),
        completion("好。")], triggers=after_tool, ops=[resume]))
    s.append(scenario("pause-before-read-tool-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')]), completion("看过了。")],
        triggers=[{"boundary": "before_tool:fs.read", "nth": 1, "status": "paused", "current_step": "paused"}],
        ops=[resume]))
    s.append(scenario("pause-after-tool-create-instructions-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')])], triggers=after_tool,
        ops=[{"op": "edit", "path": ".storyforge/agent-instructions.md", "content": "只写短句"}, resume]))
    s.append(scenario("edit-read-file-mid-turn-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')]),
        completion("", [("c2", "fs_list", "{}")], edits={"人物/主角.md": "# 林舟 中途改过"}, controls=[pause])],
        ops=[resume]))
    s.append(scenario("pause-context-file-edit-then-resume", message("对照人物答", args={"context_bundle": {
        "files": [{"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。"}]}}), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause])],
        ops=[{"op": "edit", "path": "人物/主角.md", "content": "# 林舟 改过"}, resume]))
    s.append(scenario("pause-before-finalize-then-resume", message("收尾前停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_finalize:assistant.chat_loop", "nth": 1, "status": "paused",
                                 "current_step": "paused"}], ops=[resume]))
    s.append(scenario("pause-and-resume-in-flight", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause, {"type": "resume_run"}]),
        completion("看完了。")], ops=[resume]))
    s.append(scenario("pause-after-tool-edit-read-file-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')])], triggers=after_tool,
        ops=[{"op": "edit", "path": "人物/主角.md", "content": "# 林舟 改过"}, resume]))
    s.append(scenario("pause-resume-then-resume-again", message("再恢复一次"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]), completion("好。")], ops=[resume, resume]))
    s.append(scenario("stop-in-flight-then-resume", message("停"), [
        completion("答到一半", controls=[stop, stop])], ops=[resume]))
    s.append(scenario("controls-on-completed-run", message("答完"), [completion("好。")],
                      ops=[{"op": "control", "type": "pause_run"}, {"op": "control", "type": "stop_run"}, resume]))
    s.append(scenario("resume-without-checkpoint", message("单轮", project=False, file=False),
                      triggers=[{"boundary": "before_fallback", "nth": 1, "status": "paused",
                                 "current_step": "paused"}], ops=[resume]))
    s.append(scenario("resume-model-outcome-unknown", message("流式"), [streamed(["半句"], controls=[pause])],
                      stream=True, ops=[resume]))
    s.append(scenario("resume-tool-outcome-unknown", message("记设定"), [
        completion("", [("c1", "knowledge_propose", json.dumps({"proposals": [PROPOSAL]}, ensure_ascii=False))])],
        triggers=[{"boundary": "before_tool:knowledge.propose", "nth": 1, "status": "paused",
                   "current_step": "paused"}], ops=[resume]))
    s.append(scenario("resume-while-running", message("恢复正在跑的"), [
        completion("好。", controls=[{"type": "resume_run"}])], ops=[]))
    s.append(scenario("approve-plain", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "approve_permission"}]))
    s.append(scenario("approve-with-outcome", None, setup="permission_wait",
                      wait_result=waiting({"status": "partial", "code": "provider_error", "message": "部分完成"}),
                      ops=[{"op": "control", "type": "approve_permission"},
                           {"op": "control", "type": "approve_permission"}]))
    s.append(scenario("deny", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "deny_permission"}]))
    s.append(scenario("pause-run-not-yet-executing", None, setup="started_only",
                      ops=[{"op": "control", "type": "pause_run"}, resume]))
    s.append(scenario("resume-permission-wait", None, setup="permission_wait", wait_result=waiting(), ops=[resume]))
    s.append(scenario("pause-permission-wait-then-resume", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "pause_run"}, resume]))
    s.append(scenario("forged-control-payload", message("答完"), [completion("好。")], ops=[
        {"op": "control", "type": "pause_run",
         "payload": {"control_effect": "applied", "runtime_recovery": {"resume_diagnostic": {"can_resume": True}},
                     "note": "作者附言"}}]))
    s.append(scenario("resume-again-while-resumed-run-in-flight", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]),
        completion("看完了。", controls=[{"type": "resume_run"}])], ops=[resume]))
    s.append(scenario("foreign-session-control", message("别人的 run"), [completion("好。")],
                      ops=[{"op": "control", "type": "pause_run", "session": "sess-other"}]))
    return s


PATCH_SOURCES = [
    "app/domains/agent_runs/patches/runtime_tools.py",
    "app/domains/agent_runs/patches/writing_context.py",
    "app/domains/agent_runs/patches/revise_input.py",
    "app/domains/agent_runs/tools/prose_continue_runtime.py",
    "app/domains/agent_runs/tools/project_canon_runtime.py",
    "app/domains/agent_runs/review_report.py",
    "app/domains/ide/review_reasoning.py",
    "app/domains/assistant/service.py",
]
CHAPTER_ONE = FILES["正文/第001章.md"]
REVIEW_ISSUES = json.dumps([{"severity": "high", "code": "plot.hook_missing", "message": "章尾缺少钩子",
                             "evidence": "林舟推开门。"}], ensure_ascii=False)


def review_replies(*contents):
    return [completion(content) for content in contents or (REVIEW_ISSUES, "[]", "[]")]


def tool_args(**arguments):
    return json.dumps(arguments, ensure_ascii=False)


# Rendered by knowledge_entries.render_knowledge_entry (a structured world rule the retriever can auto-select).
KNOWLEDGE_ENTRY = "<!-- storyforge-knowledge:v1\n{\"claim_fingerprint\":\"sha256:49eab88fac81fdfa3ac2a365325f2041bd9d9391e853995b80b3f37a8b3940ab\",\"created_at\":\"2026-10-01T00:00:00Z\",\"evidence_state\":\"current\",\"id\":\"pk_22222222-2222-4222-8222-222222222222\",\"kind\":\"world_rule\",\"sources\":[{\"agent_event_id\":\"ake_1\",\"type\":\"author_statement\"}],\"status\":\"active\",\"updated_at\":\"2026-10-02T00:00:00Z\"}\n-->\n## 铁城宵禁\n\n铁城入夜宵禁，城门落锁。\n<!-- /storyforge-knowledge -->\n"


def patch_scenarios():
    s = []
    path = "正文/第001章.md"
    revise = ("c1", "file_revise", tool_args(path=path, instruction="把开门写得更有力"))
    revised = streamed(["第一章 风起\n\n林舟一脚踹开了门。\n"])
    s.append(scenario("revise-ask", message("改一下第一章开门那句"), [
        completion("", [revise]), revised, completion("改好了，等你确认。")]))
    s.append(scenario("revise-auto", message("改一下第一章开门那句", permission_profile="auto"), [
        completion("", [revise]), revised, completion("改好了。")]))
    s.append(scenario("revise-read-only-profile", message("改一下第一章", permission_profile="read"), [
        completion("", [revise]), completion("只读档改不了。")]))
    s.append(scenario("read-then-revise", message("对照人物改第一章"), [
        completion("", [("c1", "fs_read", tool_args(path="人物/主角.md"))]), completion("", [revise]), revised,
        completion("改好了。")]))
    s.append(scenario("revise-with-context-bundle", message("对照人物改第一章", args={"context_bundle": {
        "files": [{"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。", "kind": "character"}]}}), [
        completion("", [revise]), revised, completion("改好了。")]))
    s.append(scenario("review-then-answer", message("审一下第一章"), [
        completion("", [("c1", "file_review", tool_args(path=path))]), *review_replies(), completion("审完了。")]))
    s.append(scenario("review-llm-degraded", message("审一下第一章"), [
        completion("", [("c1", "file_review", tool_args(path=path))]),
        {"status": 500, "body": '{"error":{"message":"down"}}'}, completion('{"issues": []}'), completion("[]"),
        completion("审完了。")]))
    s.append(scenario("review-then-revise-by-ordinal", message("先审稿，再按审稿意见改第1条"), [
        completion("", [("c1", "file_review", tool_args(path=path))]), *review_replies(),
        completion("", [("c2", "file_revise", tool_args(path=path, instruction="按第1条改"))]), revised,
        completion("按第1条改好了。")]))
    seeded = {"report_id": "rr-1", "file_path": path, "content_sha256": hashlib.sha256(CHAPTER_ONE.encode()).hexdigest(),
              "issues": [{"id": "plot-1", "category": "plot", "severity": "high", "code": "plot.hook_missing",
                          "message": "章尾缺少钩子", "evidence": "林舟推开门。"}]}
    s.append(scenario("revise-offered-review", message(
        "按审稿意见修改第1条", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": seeded["content_sha256"]}}),
        [completion("", [revise]), revised, completion("改好了。")],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=seeded))
    s.append(scenario("revise-stale-offered-review", message(
        "按审稿意见修改第1条", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": seeded["content_sha256"]}}),
        [completion("", [revise]), completion("审稿过期了。")],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=seeded,
        extra_files={path: "第一章 风起\n\n林舟推开门，又关上。\n"}))
    s.append(scenario("revise-llm-error", message("改第一章"), [
        completion("", [revise]), {"status": 500, "body": '{"error":{"message":"upstream down"}}'},
        completion("没改成。")]))
    s.append(scenario("revise-hidden-path", message("改指令文件"), [
        completion("", [("c1", "file_revise", tool_args(path=".storyforge/agent-instructions.md", instruction="改"))]),
        completion("改不了。")]))
    s.append(scenario("revise-missing-file", message("改第九章"), [
        completion("", [("c1", "file_revise", tool_args(path="正文/第009章.md", instruction="改"))]),
        completion("没有这章。")]))
    s.append(scenario("revise-crlf-bom-file", message("改第五章"), [
        completion("", [("c1", "file_revise", tool_args(path="正文/第005章.md", instruction="改"))]),
        streamed(["第五章\n\n改过了。\n"]), completion("改好了。")],
        extra_files={"正文/第005章.md": "﻿第五章\r\n\r\n原文。\r\n"}))
    s.append(scenario("revise-nul-file", message("改坏文件"), [
        completion("", [("c1", "file_revise", tool_args(path="正文/坏.md", instruction="改"))]),
        completion("文件坏了。")], extra_files={"正文/坏.md": "第一行\u0000第二行"}))
    s.append(scenario("stop-during-revise-request", message("改第一章"), [
        completion("", [revise]), streamed(["第一章"], set_status=["stopped", "stopped"])]))
    s.append(scenario("pause-during-review", message("审一下第一章"), [
        completion("", [("c1", "file_review", tool_args(path=path))]), completion(REVIEW_ISSUES),
        completion("[]", controls=[{"type": "pause_run"}])], ops=[]))
    s.append(scenario("two-patch-tools-one-round", message("改第一章再起草第三章"), [
        completion("", [revise, ("c2", "file_create", tool_args(path="正文/第003章.md", instruction="写第三章"))]),
        revised, completion("先改了第一章。")]))
    s.append(scenario("create-new", message("起草第三章"), [
        completion("", [("c1", "file_create", tool_args(path="正文/第003章.md", instruction="写第三章：沈禾入城"))]),
        streamed(["第三章 入城\n\n沈禾入城。\n"]), completion("起草好了。")]))
    s.append(scenario("create-empty-placeholder", message("写第三章"), [
        completion("", [("c1", "file_create", tool_args(path="正文/第003章.md", instruction="写第三章"))]),
        streamed(["第三章\n\n正文。\n"]), completion("写好了。")], extra_files={"正文/第003章.md": "  \n"}))
    s.append(scenario("create-existing", message("起草第一章"), [
        completion("", [("c1", "file_create", tool_args(path=path, instruction="写第一章"))]),
        completion("第一章已经有了。")]))
    s.append(scenario("create-outside", message("起草外面的文件"), [
        completion("", [("c1", "file_create", tool_args(path="../外面.md", instruction="写"))]),
        completion("不能写到外面。")]))
    view = {"author_view": {"file_path": path, "cursor_line": 1}}
    s.append(scenario("continue-at-cursor", message("接着写", args=view), [
        completion("", [("c1", "prose_continue", tool_args(path=path))]),
        streamed(["林舟踏进门槛，屋里一股霉味。"]), completion("续上了。")]))
    s.append(scenario("continue-explicit-anchor", message("在第三行后接着写"), [
        completion("", [("c1", "prose_continue", tool_args(path=path, anchor_line=3, target_chars=120,
                                                    instruction="写得短一点"))]),
        streamed(["门外的风停了。"]), completion("续上了。")]))
    s.append(scenario("continue-other-file-cursor", message("接着写第二章", args=view), [
        completion("", [("c1", "prose_continue", tool_args(path="正文/第002章.md"))]),
        streamed(["沈禾指了指北边。"]), completion("续上了。")]))
    s.append(scenario("continue-repeat-only", message("接着写"), [
        completion("", [("c1", "prose_continue", tool_args(path=path))]),
        streamed(["风起\n\n林舟推开门。"]), completion("没写出新内容。")]))
    s.append(scenario("continue-bad-target", message("接着写"), [
        completion("", [("c1", "prose_continue", tool_args(path=path, target_chars=10))]),
        completion("字数不对。")]))
    s.append(scenario("continue-crlf-file", message("接着写第五章"), [
        completion("", [("c1", "prose_continue", tool_args(path="正文/第005章.md"))]),
        streamed(["新的一段。"]), completion("续上了。")],
        extra_files={"正文/第005章.md": "第五章\r\n\r\n原文。\r\n"}))
    s.append(scenario("trim-default", message("压缩第一章"), [
        completion("", [("c1", "project_trim_prose", tool_args(path=path))]),
        streamed(["第一章 风起\n\n林舟推门。\n"]), completion("压缩好了。")]))
    s.append(scenario("trim-target", message("压缩第一章两成", permission_profile="full"), [
        completion("", [("c1", "project_trim_prose", tool_args(path=path, target_percent=20))]),
        streamed(["第一章\n\n林舟推门。\n"]), completion("压缩好了。")]))
    s.append(scenario("trim-bad-percent", message("压缩第一章八成"), [
        completion("", [("c1", "project_trim_prose", tool_args(path=path, target_percent=80))]),
        completion("压缩比例不对。")]))
    s.append(scenario("review-continuity-signal", message("审一下第六章"), [
        completion("", [("c1", "file_review", tool_args(path="正文/第006章.md"))]), *review_replies(),
        completion("审完了。")], extra_files={"正文/第006章.md": "第六章\n\n他昨天才第一次见她，前后矛盾。\n"}))
    s.append(scenario("review-pinned-context-and-roles-then-revise", message("审稿后按意见改第一章", args={
        "context_bundle": {"files": [{"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。", "kind": "character"}]},
        "agent_role_hints": ["plot_reviewer"]}), [
        completion("", [("c1", "file_review", tool_args(path=path))]), *review_replies(),
        completion("", [("c2", "file_revise", tool_args(path=path, instruction="补上章尾钩子"))]), revised,
        completion("改好了。")]))
    s.append(scenario("revise-directed-without-review", message("按审稿意见改第一章"), [
        completion("", [revise]), completion("还没有审稿。")]))
    s.append(scenario("revise-unknown-ordinal", message("先审稿，再按审稿意见改第9条"), [
        completion("", [("c1", "file_review", tool_args(path=path))]), *review_replies(),
        completion("", [("c2", "file_revise", tool_args(path=path, instruction="按第9条改"))]),
        completion("没有第9条。")]))
    # The message is longer than the snapshot's review text limit: the writer must get the report itself.
    legacy = {"issues": [{"id": "plot-1", "category": "plot", "severity": "high", "message": "章尾缺少钩子，" * 100,
                          "evidence": "林舟推开门。"}]}
    s.append(scenario("revise-legacy-offered-review", message("改第一章", args={"review_report": legacy}), [
        completion("", [("c1", "file_revise", tool_args(path=path, instruction="按第1条和第9条改"))]), revised,
        completion("改好了。")]))
    s.append(scenario("revise-with-auto-retrieved-knowledge", message("按铁城宵禁的设定改第一章"), [
        completion("", [revise]), revised, completion("改好了。")],
        extra_files={"设定/世界观.md": KNOWLEDGE_ENTRY}))
    s.append(scenario("create-long-instruction", message("起草第三章"), [
        completion("", [("c1", "file_create", tool_args(path="正文/第003章.md", instruction="写第三章：" + "沈禾入城。" * 60))]),
        streamed(["第三章\n\n沈禾入城。\n"]), completion("起草好了。")]))
    s.append(scenario("continue-auto", message("接着写", permission_profile="auto"), [
        completion("", [("c1", "prose_continue", tool_args(path=path))]),
        streamed(["林舟踏进门槛。"]), completion("续上了。")]))
    s.append(scenario("trim-integral-percent", message("压缩第一章"), [
        completion("", [("c1", "project_trim_prose", tool_args(path=path))]),
        streamed(["第一章\n\n林舟推开了门。\n"]), completion("压缩好了。")]))
    s.append(scenario("revise-blank-path", message("改第一章"), [
        completion("", [("c1", "file_revise", tool_args(path="  ", instruction="改"))]), completion("缺路径。")]))
    s.append(scenario("review-crlf-file", message("审一下第五章"), [
        completion("", [("c1", "file_review", tool_args(path="正文/第005章.md"))]), *review_replies(),
        completion("审完了。")], extra_files={"正文/第005章.md": "第五章\r\n\r\n原文。\r\n"}))
    s.append(scenario("revise-unnormalized-path", message("改第一章"), [
        completion("", [("c1", "file_revise", tool_args(path="./正文//第001章.md", instruction="改"))]), revised,
        completion("改好了。")]))
    s.append(scenario("continue-unnormalized-path", message("接着写"), [
        completion("", [("c1", "prose_continue", tool_args(path="./正文//第001章.md"))]),
        streamed(["林舟踏进门槛。"]), completion("续上了。")]))
    s.append(scenario("continue-over-read-limit", message("接着写长章"), [
        completion("", [("c1", "prose_continue", tool_args(path="正文/长.md"))]), completion("太长了。")],
        big_files={"正文/长.md": ["雨夜里他推开门。", 25001]}))
    s.append(scenario("stop-during-review-request", message("审一下第一章"), [
        completion("", [("c1", "file_review", tool_args(path=path))]),
        completion(REVIEW_ISSUES, set_status=["stopped", "stopped"])]))
    s.append(scenario("trim-empty-file", message("压缩空文件"), [
        completion("", [("c1", "project_trim_prose", tool_args(path="正文/空.md"))]),
        completion("文件是空的。")], extra_files={"正文/空.md": ""}))
    return s


POLISH_SOURCES = [
    "app/domains/agent_runs/patches/runtime_tools.py",
    "app/domains/agent_runs/patches/polishing_service.py",
    "app/domains/agent_runs/patches/polish_context.py",
    "app/domains/agent_runs/patches/polishing.py",
    "app/domains/agent_runs/patches/polish_fact_guards.py",
    "app/domains/agent_runs/patches/writing_context.py",
    "app/common/llm_env.py",
]
POLISH_SECRET = "sk-polish-secret-654321"
POLISH_ENV = {
    "STORYFORGE_POLISH_LLM_PROVIDER": "openai",
    "STORYFORGE_POLISH_LLM_BASE_URL": "https://polish.example/v1",
    "STORYFORGE_POLISH_LLM_MODEL": "p-1",
    "STORYFORGE_POLISH_LLM_API_KEY": POLISH_SECRET,
}
NO_POLISH = {key: None for key in POLISH_ENV}
ROUGH = "# 第四章 雨夜\n\n林舟推开门，，屋里很暗。。\n他不禁五味杂陈...\n沈禾说：“走吧！！”\n"
CLEAN = "# 第五章\n\n林舟推开门，屋里很暗。\n沈禾说：“走吧。”\n"
SMOOTH = [["，，", "，"], ["。。", "。"], ["他不禁五味杂陈...", "他心里乱成一团……"]]


def polished(*replace, drop_last=False, finish="stop"):
    """The polish model echoes the request's segments with these replacements (both sides build it the same way)."""
    return {"polish": {"replace": [list(pair) for pair in replace], "drop_last": drop_last, "finish": finish}}


def polish_scenarios():
    s = []
    path = "正文/第004章.md"
    rough = {path: ROUGH}
    call = ("c1", "chapter_polish", tool_args(path=path))
    done = completion("润色好了。")
    s.append(scenario("polish-online-accepted", message("润色第四章"), [
        completion("", [call]), polished(*SMOOTH), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-online-accepted-auto", message("润色第四章", permission_profile="auto"), [
        completion("", [call]), polished(*SMOOTH), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-not-configured", message("润色第四章"), [completion("", [call]), done],
                      extra_files=rough, env=NO_POLISH))
    s.append(scenario("polish-partial-slot", message("润色第四章"), [completion("", [call]), done],
                      extra_files=rough, env={**POLISH_ENV, "STORYFORGE_POLISH_LLM_MODEL": None}))
    s.append(scenario("polish-invalid-json", message("润色第四章"), [
        completion("", [call]), completion("这不是 JSON"), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-fenced-json", message("润色第四章"), [
        completion("", [call]), completion('```json\n{"segments":[{"index":0,"text":"林舟推门。\\n"}]}\n```'), done],
        extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-segment-count-changed", message("润色第四章"), [
        completion("", [call]), polished(*SMOOTH, drop_last=True), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-provider-error", message("润色第四章"), [
        # The dedicated slot carries only its identity keys, so the client's default three attempts apply.
        completion("", [call]), *[{"status": 500, "body": '{"error":{"message":"polish down"}}'}] * 3, done],
        extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-truncated", message("润色第四章"), [
        completion("", [call]), polished(*SMOOTH, finish="length"), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-noop", message("润色第五章"), [
        completion("", [("c1", "chapter_polish", tool_args(path="正文/第005章.md"))]), polished(), done],
        extra_files={"正文/第005章.md": CLEAN}, env=POLISH_ENV))
    # Pinned files are re-read from disk, so every pinned path exists; memory and chapter values feed required facts.
    trusted = {"context_bundle": {
        "files": [{"relative_path": "人物/主角.md", "excerpt": "林舟，左臂有旧伤。", "kind": "character", "title": "林舟"},
                  {"relative_path": "设定/规则.md", "excerpt": "铁城入夜宵禁。", "kind": "setting"},
                  {"relative_path": "大纲/时间线.md", "excerpt": "第四章在雨夜。", "kind": "timeline"}],
        "story_memory": {"items": [{"entity": "沈禾", "kind": "character", "text": "沈禾是城里的向导。"}]},
        "chapter_context": {"goal": "林舟与沈禾出城", "beats": ["推门", "出城"]}}}
    trusted_files = {**rough, "设定/规则.md": "铁城入夜宵禁。\n", "大纲/时间线.md": "第四章在雨夜。\n"}
    s.append(scenario("polish-entity-renamed", message("润色第四章", args=trusted), [
        completion("", [call]), polished(*SMOOTH, ["林舟", "林洲"]), done], extra_files=trusted_files, env=POLISH_ENV))
    s.append(scenario("polish-trusted-constraints", message("润色第四章", args=trusted), [
        completion("", [call]), polished(*SMOOTH), done], extra_files=trusted_files, env=POLISH_ENV))
    s.append(scenario("polish-degraded-auto", message("润色第四章", permission_profile="auto"), [
        completion("", [call]), done], extra_files=rough, env=NO_POLISH))
    s.append(scenario("polish-segments-missing", message("润色第四章"), [
        completion("", [call]), completion('{"items": []}'), done], extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-index-changed", message("润色第四章"), [
        completion("", [call]), completion('{"segments": [{"index": 1, "text": "林舟推门。"}]}'), done],
        extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-forbidden-dir", message("润色证据稿"), [
        completion("", [("c1", "chapter_polish", tool_args(path="Evidence/章.md"))]), done],
        extra_files={"Evidence/章.md": ROUGH}, env=POLISH_ENV))
    s.append(scenario("polish-style-instruction", message("润色第四章"), [
        completion("", [("c1", "chapter_polish", tool_args(path=path, style_instruction="冷峻一些"))]),
        polished(*SMOOTH), done], extra_files=rough, env={**POLISH_ENV, "STORYFORGE_POLISH_LLM_PROVIDER": "OpenAI"}))
    s.append(scenario("polish-author-instructions", message("润色第四章"), [
        completion("", [call]), polished(*SMOOTH), done],
        extra_files={**rough, ".storyforge/agent-instructions.md": "保留感叹号的叠用。"}, env=POLISH_ENV))
    s.append(scenario("polish-structured-file", message("润色数据表"), [
        completion("", [("c1", "chapter_polish", tool_args(path="数据/表.json"))]), done],
        extra_files={"数据/表.json": "{}"}, env=POLISH_ENV))
    s.append(scenario("polish-empty-file", message("润色空章"), [
        completion("", [("c1", "chapter_polish", tool_args(path="正文/空.md"))]), done],
        extra_files={"正文/空.md": "  \n"}, env=POLISH_ENV))
    s.append(scenario("polish-stop-during-request", message("润色第四章"), [
        completion("", [call]), {**polished(*SMOOTH), "set_status": ["stopped", "stopped"]}],
        extra_files=rough, env=POLISH_ENV))
    s.append(scenario("polish-read-only-profile", message("润色第四章", permission_profile="read"), [
        completion("", [call]), done], extra_files=rough, env=POLISH_ENV))
    return s


DEEP_SOURCES = [
    "app/domains/agent_runs/deep_consistency.py",
    "app/domains/agent_runs/tools/project_checks_runtime.py",
    "app/domains/judge/semantic.py",
    "app/domains/judge/schemas.py",
]
ISSUE = {"category": "setting_conflict", "severity": "high", "span_start": 0, "span_end": 2, "matched_text": "推开门",
         "expected_text": "左臂受伤", "replacement_text": "用右手推开门", "summary": "左臂有旧伤，不该推门。"}


def judged(*items):
    return completion(json.dumps(list(items), ensure_ascii=False))


def deep_scenarios():
    s = []
    path = "正文/第001章.md"
    call = ("c1", "project_deep_consistency", tool_args(path=path))
    done = completion("看完了。")
    rules = {"设定/规则.md": "铁城入夜宵禁。\n"}
    s.append(scenario("deep-default", message("深查第一章"), [completion("", [call]), judged(ISSUE), done],
                      extra_files=rules))
    s.append(scenario("deep-no-issues", message("深查第一章"), [completion("", [call]), judged(), done]))
    s.append(scenario("deep-fenced", message("深查第一章"), [
        completion("", [call]), completion("```json\n" + json.dumps([ISSUE], ensure_ascii=False) + "\n```"), done]))
    s.append(scenario("deep-array-in-prose", message("深查第一章"), [
        completion("", [call]), completion("结果如下：" + json.dumps([ISSUE], ensure_ascii=False) + " 以上。"), done]))
    s.append(scenario("deep-invalid", message("深查第一章"), [completion("", [call]), completion("不是 JSON"), done]))
    s.append(scenario("deep-not-list", message("深查第一章"), [completion("", [call]), completion('{"a": 1}'), done]))
    s.append(scenario("deep-provider-error", message("深查第一章"), [
        completion("", [call]), {"status": 500, "body": '{"error":{"message":"judge down"}}'}, done]))
    s.append(scenario("deep-explicit-bible-and-facts", message("深查第一章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(
            path=path, bible_paths=["人物/主角.md", " ", "设定/规则.md"], facts=["林舟左臂有伤", "林舟左臂有伤", "  "]))]),
        judged(), done], extra_files=rules))
    s.append(scenario("deep-bible-missing", message("深查第一章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path=path, bible_paths=["人物/不存在.md"]))]),
        done]))
    s.append(scenario("deep-empty-target", message("深查空章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path="正文/空.md"))]), done],
        extra_files={"正文/空.md": " \n"}))
    s.append(scenario("deep-target-directory", message("深查正文目录"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path="正文"))]), done]))
    s.append(scenario("deep-judge-overrides", message("深查第一章"), [completion("", [call]), judged(ISSUE), done],
                      env={"STORYFORGE_JUDGE_LLM_MODEL": "judge-1", "STORYFORGE_JUDGE_LLM_BASE_URL": "https://judge.example/v1/",
                           "STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS": "45"}))
    s.append(scenario("deep-item-normalization", message("深查第一章"), [completion("", [call]), judged(
        {"category": "timeline_conflict", "severity": "critical", "span_start": "3", "span_end": 99},
        {"category": "style_drift", "matched_text": "  林舟  ", "expected_text": None, "summary": "", "span_start": True},
        {"severity": "low"}, "不是对象",
        {"category": "relationship_conflict", "span_start": 2.9, "span_end": -4, "expected_text": "敌人",
         "matched_text": ["列表"]},
        {"category": "style_drift", "span_start": True, "span_end": 3},
        {"category": "style_drift", "matched_text": True},
        {"category": "arc_continuity_drift", "span_start": " +1_0 "},
        {"category": "repetition_echo", "span_start": 999}), done]))
    s.append(scenario("deep-bad-span", message("深查第一章"), [
        completion("", [call]), judged({"category": "setting_conflict", "span_start": "abc"}), done]))
    s.append(scenario("deep-null-span", message("深查第一章"), [
        completion("", [call]), judged({"category": "setting_conflict", "span_start": None}), done]))
    s.append(scenario("deep-nearest-match", message("深查第六章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path="正文/第006章.md"))]),
        judged({**ISSUE, "matched_text": "门", "span_start": 9, "span_end": 10}), done],
        extra_files={"正文/第006章.md": "门外有门，\n门里还有门。\n"}))
    s.append(scenario("deep-many-bible-files", message("深查第一章"), [completion("", [call]), judged(), done],
                      extra_files={f"设定/条目{i:02d}.md": f"条目{i}：" + "设定内容。" * 300 for i in range(13)}))
    s.append(scenario("deep-long-content", message("深查长章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path="正文/长.md"))]), judged(), done],
        big_files={"正文/长.md": ["雨夜里他推开门。\n", 3001]}))
    s.append(scenario("deep-stop-during-request", message("深查第一章"), [
        completion("", [call]), {**judged(ISSUE), "set_status": ["stopped", "stopped"]}]))
    s.append(scenario("deep-hidden-target", message("深查作者指令"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path=".storyforge/agent-instructions.md"))]),
        judged(), done], extra_files={".storyforge/agent-instructions.md": "少用套话。"}))
    s.append(scenario("deep-json-string-reply", message("深查第一章"), [
        completion("", [call]), completion(json.dumps("[]")), done]))
    s.append(scenario("deep-fenced-object", message("深查第一章"), [
        completion("", [call]), completion("```JSON\n" + json.dumps({"issues": [ISSUE]}, ensure_ascii=False) + "\n```"),
        done]))
    s.append(scenario("deep-fragment-bracket-in-string", message("深查第一章"), [
        completion("", [call]), completion("说明：" + json.dumps(
            [{"category": "style_drift", "summary": '含]括号"]', "matched_text": "林舟"}], ensure_ascii=False) + " 尾"),
        done]))
    s.append(scenario("deep-stop-on-provider-error", message("深查第一章"), [
        completion("", [call]),
        {"status": 500, "body": '{"error":{"message":"judge down"}}', "set_status": ["stopped", "stopped"]}]))
    s.append(scenario("deep-many-facts", message("深查第一章"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path=path, facts=[f"事实{i}" for i in range(41)]))]),
        judged(), done]))
    s.append(scenario("deep-target-in-bible-dir", message("深查主角设定"), [
        completion("", [("c1", "project_deep_consistency", tool_args(path="人物/主角.md"))]), judged(), done],
        extra_files=rules))
    s.append(scenario("deep-main-max-tokens", message("深查第一章"), [completion("", [call]), judged(), done],
                      env={"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "512"}))
    s.append(scenario("deep-uppercase-markdown", message("深查第一章"), [completion("", [call]), judged(), done],
                      extra_files={"设定/大写.MD": "大写后缀的设定。", "人物/配角.txt": "不是 Markdown。"}))
    return s


FIXED_SOURCES = [
    "app/domains/agent_runs/adapters/intent_fixed_pipeline_adapter.py",
    "app/domains/agent_runs/adapters/file_review_pipeline.py",
    "app/domains/agent_runs/adapters/chapter_generation_pipeline.py",
    "app/domains/agent_runs/adapters/chapter_polishing_pipeline.py",
    "app/domains/agent_runs/patches/runtime_tools.py",
    "app/domains/agent_runs/runtime_recovery.py",
    "app/domains/agent_runs/events/runtime_support.py",
    "app/domains/agent_runs/fs/runtime_tools.py",
]


def fixed(text, intent, content=None, **extra):
    args = {"content": CHAPTER_ONE if content is None else content, **extra.pop("args", {})}
    return message(text, intent=intent, args=args, **extra)


def fixed_scenarios():
    s = []
    resume = {"op": "control", "type": "resume_run"}
    paused_at = lambda boundary: [{"boundary": boundary, "nth": 1, "status": "paused", "current_step": "paused"}]  # noqa: E731
    stopped_at = lambda boundary: [{"boundary": boundary, "nth": 1, "status": "stopped", "current_step": "stopped"}]  # noqa: E731
    s.append(scenario("review-fixed", fixed("审一下这章", "file.review"), review_replies()))
    s.append(scenario("review-fixed-heuristic", fixed("审一下这章", "file.review"), [],
                      env={"STORYFORGE_LLM_API_KEY": None}))
    s.append(scenario("review-fixed-roles-and-context", fixed("审一下这章", "file.review", args={
        "agent_role_hints": ["plot_reviewer"], "context_bundle": {"files": [
            {"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。", "kind": "character"}]}}), review_replies()))
    s.append(scenario("review-fixed-pause-after-plan", fixed("审一下这章", "file.review"), [],
                      triggers=paused_at("after_plan"), ops=[resume]))
    s.append(scenario("review-fixed-pause-after-context", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=paused_at("after_tool:context.load"), ops=[resume]))
    s.append(scenario("review-fixed-stop-after-context", fixed("审一下这章", "file.review"), [],
                      triggers=stopped_at("after_tool:context.load"), ops=[resume]))
    s.append(scenario("review-fixed-pause-during-delivery", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=paused_at("after_tool:subagent.character_reviewer"), ops=[resume]))
    s.append(scenario("review-fixed-stop-during-delivery", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=stopped_at("after_tool:subagent.plot_reviewer")))
    s.append(scenario("review-fixed-pause-before-deliver", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=paused_at("before_deliver:file.review"), ops=[resume, resume]))
    s.append(scenario("review-fixed-pause-before-finalize", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=paused_at("before_finalize:agent_runtime"), ops=[resume]))
    # The resumed run pauses again during delivery: the second pending call (with the review output) wins.
    s.append(scenario("review-fixed-pause-twice", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=[*paused_at("after_tool:context.load"),
                                *paused_at("after_tool:subagent.prose_reviewer")], ops=[resume, resume]))
    # Settlement records the resolution before the hidden jobs; a later pause has no pending call left.
    s.append(scenario("review-fixed-pause-after-resolution", fixed("审一下这章", "file.review"), review_replies(),
                      triggers=[*paused_at("after_tool:context.load"),
                                *paused_at("before_publish:system_job:title")], ops=[resume, resume]))
    in_flight = review_replies()
    in_flight[0] = {**in_flight[0], "controls": [{"type": "resume_run"}]}
    s.append(scenario("review-fixed-resume-while-resumed", fixed("审一下这章", "file.review"), in_flight,
                      triggers=paused_at("after_tool:context.load"), ops=[resume]))
    s.append(scenario("review-fixed-deadline", fixed("审一下这章", "file.review"), [
        completion(REVIEW_ISSUES, advance=901), completion("[]"), completion("[]")]))
    revised = streamed(["第一章 风起\n\n林舟一脚踹开了门。\n"])
    s.append(scenario("revise-fixed", fixed("把开门写得更有力", "file.revise"), [*review_replies(), revised]))
    s.append(scenario("revise-fixed-auto", fixed("把开门写得更有力", "file.revise", permission_profile="auto"),
                      [*review_replies(), revised]))
    s.append(scenario("revise-fixed-judge-marker", fixed("把开门写得更有力", "file.revise"), [
        *review_replies(), streamed(["第一章 风起\n\n其实林舟一脚踹开了门。\n"])]))
    seeded = {"report_id": "rr-1", "file_path": "正文/第001章.md",
              "content_sha256": hashlib.sha256(CHAPTER_ONE.encode()).hexdigest(),
              "issues": [{"id": "plot-1", "category": "plot", "severity": "high", "code": "plot.hook_missing",
                          "message": "章尾缺少钩子", "evidence": "林舟推开门。"}]}
    s.append(scenario("revise-fixed-offered-review", fixed(
        "按审稿意见修改第1条", "file.revise", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": seeded["content_sha256"]}}), [revised],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=seeded))
    s.append(scenario("revise-fixed-scope-warning", fixed(
        "按审稿意见修改第1条", "file.revise", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": seeded["content_sha256"]}}),
        [streamed(["第一章 别的名字\n\n全部重写了一遍。\n另起一段。\n再起一段。\n"])],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=seeded))
    s.append(scenario("revise-fixed-directed-without-review", fixed("按审稿意见改第1条", "file.revise"), []))
    s.append(scenario("revise-fixed-llm-error", fixed("把开门写得更有力", "file.revise"), [
        *review_replies(), {"status": 500, "body": '{"error":{"message":"upstream down"}}'}]))
    s.append(scenario("revise-fixed-pause-after-revise", fixed("把开门写得更有力", "file.revise"),
                      [*review_replies(), revised], triggers=paused_at("after_tool:file.revise"), ops=[resume]))
    s.append(scenario("polish-fixed-main-model", fixed("润色这章", "chapter.polish", content=ROUGH, args={
        "file_path": "$ROOT/正文/第004章.md", "style_instruction": "冷峻一些", "use_main_model": True}),
        [polished(*SMOOTH)], extra_files={"正文/第004章.md": ROUGH}))
    s.append(scenario("polish-fixed-auto-accepted", fixed("润色这章", "chapter.polish", content=ROUGH,
                                                       permission_profile="auto", args={
                                                           "file_path": "$ROOT/正文/第004章.md", "use_main_model": True}),
                      [polished(*SMOOTH)], extra_files={"正文/第004章.md": ROUGH}))
    s.append(scenario("polish-fixed-offline", fixed("润色这章", "chapter.polish", content=ROUGH, args={
        "file_path": "$ROOT/正文/第004章.md", "online_enabled": False}), [], extra_files={"正文/第004章.md": ROUGH}))
    s.append(scenario("polish-fixed-dedicated-noop", fixed("润色这章", "chapter.polish", content=CLEAN, args={
        "file_path": "$ROOT/正文/第005章.md"}), [polished()], extra_files={"正文/第005章.md": CLEAN}, env=POLISH_ENV))
    s.append(scenario("polish-fixed-auto-degraded", fixed("润色这章", "chapter.polish", content=ROUGH,
                                                       permission_profile="auto",
                                                       args={"file_path": "$ROOT/正文/第004章.md"}),
                      [], extra_files={"正文/第004章.md": ROUGH}, env=NO_POLISH))
    s.append(scenario("polish-fixed-outside-path", fixed("润色这章", "chapter.polish", content=ROUGH, args={
        "file_path": "D:/elsewhere/第004章.md"}), []))
    s.append(scenario("polish-fixed-relative-path", fixed("润色这章", "chapter.polish", content=ROUGH, args={
        "file_path": "正文/第004章.md"}), [], extra_files={"正文/第004章.md": ROUGH}, env=NO_POLISH))
    return s


CHAPTER_SOURCES = [
    "app/domains/agent_runs/adapters/chapter_writing_pipeline.py",
    "app/domains/agent_runs/adapters/chapter_writing_contracts.py",
    "app/domains/agent_runs/adapters/chapter_writing_tools.py",
    "app/domains/agent_runs/adapters/chapter_check_protocol.py",
    "app/domains/agent_runs/adapters/chapter_source_guard.py",
    "app/domains/agent_runs/loop/generation_recovery.py",
    "app/domains/agent_runs/loop/knowledge_recovery.py",
    "app/domains/agent_runs/loop/ordinary_recovery.py",
    "app/domains/agent_runs/service_control.py",
]
BRIEF_ID = "chapter-brief-" + f"{1:032x}"
DRAFT = "第三章 入城\n\n沈禾带林舟穿过城门。\n守卫看了他们一眼。\n"
BEAT = {"rule": "missing_required_beat", "severity": "hard", "message": "缺少夜宿情节", "line": 3,
        "evidence": "沈禾带林舟穿过城门。"}


def brief_reply(**fields):
    body = {"target_path": "正文/第003章.md", "chapter_ordinal": None, "chapter_title": "入城", "goal": "沈禾带林舟入城",
            "pov": "林舟", "setting": "城门", "required_beats": ["入城", "夜宿"], "forbidden_items": ["回忆"],
            "continuity_constraints": ["林舟左臂有旧伤"], "target_chars_min": 10, "target_chars_max": 400, **fields}
    return completion(json.dumps(body, ensure_ascii=False))


def checked(*findings, corrupt=False):
    """The checker echoes the check source from its own prompt (both sides build it the same way)."""
    return {"chapter_check": {"findings": list(findings), "corrupt": corrupt}}


def confirmed_brief(**fields):
    return {"brief_id": BRIEF_ID, "revision": 1, "chapter_title": "入城", "goal": "沈禾带林舟入城，夜宿客栈",
            "pov": "林舟", "setting": "城门", "required_beats": ["入城", "夜宿"], "forbidden_items": ["回忆"],
            "continuity_constraints": ["林舟左臂有旧伤"], "target_chars_min": 10, "target_chars_max": 400, **fields}


def chapter_scenarios():
    s = []
    target = "$ROOT/正文/第003章.md"

    def write(text="写第三章：沈禾带林舟入城", **extra):
        args = {"file_path": target, **extra.pop("args", {})}
        return message(text, intent="chapter.write", args=args, **extra)

    def confirm(**fields):
        return {"op": "control", "type": "resume_run", "payload": {"chapter_brief": confirmed_brief(**fields)}}

    s.append(scenario("write-brief", write(), [brief_reply()]))
    s.append(scenario("write-brief-then-pass", write(), [brief_reply(), streamed([DRAFT]), checked()],
                      ops=[confirm()]))
    s.append(scenario("write-auto-profile", write(permission_profile="auto"),
                      [brief_reply(), streamed([DRAFT]), checked()], ops=[confirm()]))
    s.append(scenario("write-repair-then-pass", write(), [
        brief_reply(), streamed([DRAFT]), checked(BEAT),
        streamed(["第三章 入城\n\n沈禾带林舟穿过城门，夜宿客栈。\n守卫看了他们一眼。\n"]), checked()], ops=[confirm()]))
    s.append(scenario("write-repair-still-failing", write(), [
        brief_reply(), streamed([DRAFT]), checked(BEAT), streamed([DRAFT]), checked(BEAT)], ops=[confirm()]))
    s.append(scenario("write-check-advisory-only", write(), [
        brief_reply(), streamed([DRAFT]),
        checked({"rule": "advisory", "severity": "hard", "message": "可以更紧凑", "line": None, "evidence": None},
                {"rule": "pov_violation", "severity": "advisory", "message": "视角略有游移", "line": 4,
                 "evidence": "守卫看了他们一眼。"})], ops=[confirm()]))
    s.append(scenario("write-check-invalid", write(), [brief_reply(), streamed([DRAFT]), completion("不是 JSON")],
                      ops=[confirm()]))
    s.append(scenario("write-check-source-mismatch", write(), [brief_reply(), streamed([DRAFT]), checked(corrupt=True)],
                      ops=[confirm()]))
    s.append(scenario("write-check-bad-evidence", write(), [brief_reply(), streamed([DRAFT]), checked(
        {**BEAT, "line": 4})], ops=[confirm()]))
    s.append(scenario("write-check-too-many", write(), [brief_reply(), streamed([DRAFT]), checked(
        *[{"rule": "advisory", "severity": "advisory", "message": f"建议{i}", "line": None, "evidence": None}
          for i in range(101)])], ops=[confirm()]))
    s.append(scenario("write-check-provider-error", write(), [
        brief_reply(), streamed([DRAFT]), {"status": 500, "body": '{"error":{"message":"check down"}}'}],
        ops=[confirm()]))
    s.append(scenario("write-word-count-repair", write(), [
        brief_reply(), streamed(["第三章\n\n短。\n"]), checked(),
        streamed([DRAFT]), checked()], ops=[confirm(target_chars_min=40, target_chars_max=400)]))
    s.append(scenario("write-stale-brief", write(), [brief_reply()], ops=[confirm(brief_id="chapter-brief-stale")]))
    s.append(scenario("write-bad-word-range", write(), [brief_reply()],
                      ops=[confirm(target_chars_min=500, target_chars_max=100)]))
    s.append(scenario("write-missing-brief-on-resume", write(), [brief_reply()],
                      ops=[{"op": "control", "type": "resume_run"}]))
    s.append(scenario("write-source-drift", write(), [brief_reply()],
                      ops=[{"op": "edit", "path": ".storyforge/agent-instructions.md", "content": "只写短句"}, confirm()]))
    s.append(scenario("write-previous-chapter-drift", write(), [brief_reply()],
                      ops=[{"op": "edit", "path": "正文/第002章.md", "content": "第二章 改过\n\n沈禾问路。\n"}, confirm()]))
    s.append(scenario("write-no-project", write(project=False), []))
    s.append(scenario("write-existing-target", write(args={"file_path": "$ROOT/正文/第001章.md"}), []))
    s.append(scenario("write-outside-target", write(args={"file_path": "D:/elsewhere/第003章.md"}), []))
    plan = {"premise": "末世", "chapter_word_count_min": 300, "chapter_word_count_max": 600, "chapters": [
        {"ordinal": 1, "status": "done", "path": "正文/第001章.md"},
        {"ordinal": 2, "status": "done", "path": "正文/第002章.md"},
        {"ordinal": 3, "title": "入城", "goal": "沈禾带林舟入城", "status": "pending"}]}
    plan_file = {".storyforge/serial-plan.json": json.dumps(plan, ensure_ascii=False)}
    s.append(scenario("write-planned-next", write(args={"file_path": None}), [brief_reply(chapter_title=None)],
                      extra_files=plan_file))
    s.append(scenario("write-explicit-target-not-planned", write(args={"file_path": "$ROOT/正文/第009章.md"}),
                      [brief_reply(target_path="正文/第009章.md")], extra_files=plan_file))
    s.append(scenario("write-brief-not-json", write(), [completion("好的，我来写。")]))
    s.append(scenario("write-brief-fenced-and-swapped", write(), [completion(
        "```json\n" + json.dumps({"goal": "  ", "target_chars_min": 900, "target_chars_max": 300,
                                   "required_beats": ["a", "a", " ", 3] + [f"b{i}" for i in range(20)]},
                                  ensure_ascii=False) + "\n```")]))
    s.append(scenario("write-pause-before-brief-finalize", write(), [brief_reply()],
                      triggers=[{"boundary": "before_finalize:chapter.brief", "nth": 1, "status": "paused",
                                 "current_step": "paused"}]))
    s.append(scenario("write-brief-with-pinned-context", write(args={"context_bundle": {"files": [
        {"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。", "kind": "character"}]}}),
        [brief_reply(), streamed([DRAFT]), checked()], ops=[confirm()]))
    s.append(scenario("write-pinned-source-drift", write(args={"context_bundle": {"files": [
        {"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。", "kind": "character"}]}}),
        [brief_reply()], ops=[{"op": "edit", "path": "人物/主角.md", "content": "# 林舟\n\n右臂有旧伤。\n"}, confirm()]))
    declared = {**plan, "chapters": [*plan["chapters"][:2],
                                     {"ordinal": 3, "title": "入城", "goal": "沈禾带林舟入城", "status": "pending",
                                      "path": "正文/第三章-入城.md"}]}
    s.append(scenario("write-explicit-target-vs-declared", write(), [brief_reply()],
                      extra_files={".storyforge/serial-plan.json": json.dumps(declared, ensure_ascii=False)}))
    s.append(scenario("write-stale-revision", write(), [brief_reply()], ops=[confirm(revision=2)]))
    s.append(scenario("write-knowledge-added-drift", write("写第三章：铁城宵禁那夜"), [brief_reply()],
                      ops=[{"op": "edit", "path": "设定/世界观.md", "content": KNOWLEDGE_ENTRY}, confirm()]))
    s.append(scenario("write-drift-during-brief", write(), [
        {**brief_reply(), "edits": {".storyforge/agent-instructions.md": "只写短句"}}]))
    s.append(scenario("write-project-name", write(args={"project_name": "末世吞噬"}),
                      [brief_reply(), streamed([DRAFT]), checked()], ops=[confirm()]))
    s.append(scenario("write-secret-in-brief", write(), [brief_reply(), streamed([DRAFT]), checked()],
                      ops=[confirm(goal=f"入城，口令是 {SECRET}")]))
    s.append(scenario("write-empty-placeholder-target", write(), [brief_reply(), streamed([DRAFT]), checked()],
                      extra_files={"正文/第003章.md": " \n"}, ops=[confirm()]))
    return s


def write_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content.encode("utf-8"))


def renumber_artifacts(record):
    """Checkpoints stay in engine memory in TS (§2.6), so they are dropped here and the remaining artifacts are
    numbered by rank; every `artifact_id` that pointed at one of them is rewritten the same way."""
    kept = [row for row in record["artifacts"] if row["kind"] != "runtime_checkpoint"]
    mapping = {row["id"]: rank for rank, row in enumerate(kept, start=1)}

    def remap(value):
        if isinstance(value, dict):
            return {key: mapping.get(item, item) if key == "artifact_id" and isinstance(item, int) else remap(item)
                    for key, item in value.items()}
        if isinstance(value, list):
            return [remap(item) for item in value]
        return value

    record["artifacts"] = [{**row, "id": mapping[row["id"]]} for row in kept]
    for key in ("events", "frames", "result"):
        if key in record:
            record[key] = remap(record[key])
    return record


def tool_digest(tools):
    encoded = json.dumps(tools, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {"names": [tool["function"]["name"] for tool in tools], "sha256": hashlib.sha256(encoded.encode()).hexdigest()}


def compact(value):
    """Long strings become digests on both sides; tool schema lists become names plus a digest."""
    if isinstance(value, dict) and isinstance(value.get("tools"), list) and value["tools"] and all(
            isinstance(tool, dict) and "function" in tool for tool in value["tools"]):
        return {key: tool_digest(item) if key == "tools" else compact(item) for key, item in value.items()}
    if isinstance(value, str) and len(value) > 400:
        return {"sha256": hashlib.sha256(value.encode()).hexdigest(), "length": len(value)}
    if isinstance(value, dict):
        return {key: compact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [compact(item) for item in value]
    return value


def p3_agent_run_snapshot() -> dict:
    return _snapshot("p3-agent-run", scenarios(), SOURCES)


def p3_agent_control_snapshot() -> dict:
    return _snapshot("p3-agent-control", control_scenarios(), SOURCES + CONTROL_SOURCES)


def p3_patch_tools_snapshot() -> dict:
    return _snapshot("p3-patch-tools", patch_scenarios(), SOURCES + PATCH_SOURCES)


def pending_call_records() -> dict:
    """Pure pending-call helpers on hand-made payloads (branches the end-to-end scenarios cannot reach)."""
    from app.domains.agent_runs.runtime_recovery import (
        build_runtime_pending_call_resolution_payload,
        build_runtime_pending_call_resume_diagnostic,
    )

    message = {"type": "user_message", "user_message": "x"}
    payloads = {
        "not-pending": {"status": "resolved", "intent": "file.review"},
        "unsupported": {"status": "pending", "intent": "chat.explain", "resume_message": message},
        "review-ready": {"status": "pending", "intent": "file.review", "boundary": "after_tool:context.load",
                         "resume_strategy": "continue_after_context_load", "resume_message": message},
        "review-postprocess": {"status": "pending", "intent": "file.review", "boundary": "before_deliver:file.review",
                               "next_trace_index": 3, "resume_message": message},
        "review-no-message": {"status": "pending", "intent": "file.review"},
        "chapter-review-no-judge": {"status": "pending", "intent": "chapter.review", "resume_message": message},
        "chapter-review-ready": {"status": "pending", "intent": "chapter.review", "resume_message": message,
                                 "judge_output": {}, "judge_trace": {}},
        "chapter-write-no-brief": {"status": "pending", "intent": "chapter.write", "resume_message": message},
        "chapter-write-ready": {"status": "pending", "intent": "chapter.write", "resume_message": message,
                                "chapter_brief": {"goal": "g"}},
        "not-a-dict": "pending",
    }
    diagnostics = []
    for name, payload in payloads.items():
        for status, step in (("running", "resumed"), ("running", "agent.loop"), ("paused", "paused"), (None, None)):
            diagnostics.append({"name": name, "run_status": status, "current_step": step, "payload": payload,
                                "result": build_runtime_pending_call_resume_diagnostic(
                                    run_status=status, current_step=step, payload=payload, artifact_id=7)})
    resolutions = [{"name": name, "payload": payload,
                    "result": build_runtime_pending_call_resolution_payload(payload, artifact_id=7)}
                   for name, payload in payloads.items()]
    return {"pending_call_diagnostics": diagnostics, "pending_call_resolutions": resolutions}


def chapter_check_records() -> dict:
    """The check protocol on hand-made checker replies (validation branches the scenarios cannot reach)."""
    from app.domains.agent_runs.adapters.chapter_check_protocol import build_check, check_prompt, check_source

    brief = {"brief_id": "b-1", "revision": 2, "goal": "入城", "pov": "林舟", "setting": None, "required_beats": ["入城"],
             "forbidden_items": [], "continuity_constraints": [], "target_chars_min": 10, "target_chars_max": 400}
    content = "第三章\r\n\r\n沈禾带林舟穿过城门。\n守卫看了\n他们一眼。\n"
    source = check_source(content, brief)

    def reply(findings, **extra):
        return json.dumps({**source, "findings": findings, **extra}, ensure_ascii=False)

    hard = {"rule": "missing_required_beat", "severity": "hard", "message": "缺夜宿", "line": 3,
            "evidence": "沈禾带林舟穿过城门。"}
    raws = {
        "pass": reply([]),
        "fenced": "```JSON\n" + reply([]) + "\n```",
        "hard": reply([hard]),
        "multiline-evidence": reply([{**hard, "line": 4, "evidence": "守卫看了\n他们一眼。"}]),
        "advisory-claims-hard": reply([{**hard, "rule": "advisory"}]),
        "advisory-null-quote": reply([{"rule": "pov_violation", "severity": "advisory", "message": "略", "line": None,
                                       "evidence": None}]),
        "advisory-bad-quote": reply([{**hard, "severity": "advisory", "evidence": "不存在的句子"}]),
        "hard-without-evidence": reply([{**hard, "evidence": None, "line": None}]),
        "line-without-evidence": reply([{**hard, "severity": "advisory", "evidence": None}]),
        "line-beyond": reply([{**hard, "line": 99}]),
        "evidence-other-line": reply([{**hard, "line": 1}]),
        "line-zero": reply([{**hard, "line": 0}]),
        "line-bool": reply([{**hard, "line": True}]),
        "line-float": reply([{**hard, "line": 3.0}]),
        "unknown-rule": reply([{**hard, "rule": "made_up"}]),
        "bad-severity": reply([{**hard, "severity": "critical"}]),
        "empty-message": reply([{**hard, "message": "  "}]),
        "long-message": reply([{**hard, "message": "长" * 2001}]),
        "blank-evidence": reply([{**hard, "evidence": " "}]),
        "missing-key": reply([{k: v for k, v in hard.items() if k != "line"}]),
        "not-object-finding": reply(["hard"]),
        "findings-missing": json.dumps(source),
        "findings-not-list": reply({}),
        "too-many": reply([{"rule": "advisory", "severity": "advisory", "message": "x", "line": None,
                            "evidence": None}] * 101),
        "version-float": json.dumps({**source, "protocol_version": 2.0, "findings": []}),
        "version-bool": json.dumps({**source, "protocol_version": True, "findings": []}),
        "wrong-brief-sha": json.dumps({**source, "brief_sha256": "0" * 64, "findings": []}),
        "duplicate-key": '{"findings": [], "findings": []}',
        "not-object": "[]",
        "not-json": "检查完毕，没有问题。",
        "oversized": " " * 256_001,
    }
    records = [{"name": name, "raw": raw, "content": content, "result": build_check(content, brief, raw)}
               for name, raw in raws.items()]
    for record in records:
        if record["name"] == "oversized":  # Rebuilt on the TS side instead of storing 256 KB of spaces.
            record["raw"], record["raw_repeat"] = None, [" ", 256_001]
    extremes = [
        {"name": "empty-draft", "content": " \n", "raw": None, "provider_failed": True},
        {"name": "too-short", "content": "短", "raw": None, "provider_failed": True},
        {"name": "too-long", "content": "长" * 600, "raw": None, "provider_failed": True},
    ]
    for item in extremes:
        records.append({**item, "result": build_check(item["content"], brief, item["raw"], provider_failed=True)})
    return {"check_brief": brief, "check_records": records, "check_prompt": check_prompt(brief, content)}


def p3_chapter_writing_snapshot() -> dict:
    return _snapshot("p3-chapter-writing", chapter_scenarios(), SOURCES + CONTROL_SOURCES + CHAPTER_SOURCES,
                     after=chapter_check_records)


def p3_fixed_pipelines_snapshot() -> dict:
    return _snapshot("p3-fixed-pipelines", fixed_scenarios(), SOURCES + CONTROL_SOURCES + FIXED_SOURCES,
                     extra={"polish_secret": POLISH_SECRET}, after=pending_call_records)


def p3_deep_consistency_snapshot() -> dict:
    return _snapshot("p3-deep-consistency", deep_scenarios(), SOURCES + DEEP_SOURCES)


def p3_polish_snapshot() -> dict:
    return _snapshot("p3-polish", polish_scenarios(), SOURCES + POLISH_SOURCES, extra={"polish_secret": POLISH_SECRET})


def drop_checkpoint_artifact_ids(value):
    """TS keeps checkpoints in engine memory (no artifact row), so its resume diagnostics carry no artifact_id."""
    if isinstance(value, dict):
        return {key: drop_checkpoint_artifact_ids(item) for key, item in value.items()
                if not (key == "artifact_id" and value.get("kind") == "runtime_checkpoint_resume")}
    if isinstance(value, list):
        return [drop_checkpoint_artifact_ids(item) for item in value]
    return value


def _snapshot(suite: str, specs: list, sources: list, extra: dict | None = None, after=None) -> dict:
    with isolated_fs_oracle("storyforge-golden-agent-run-", fixed=True) as (api, run_dir):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common import llm_client as lc
        from app.common import llm_control
        from app.common.version import APP_VERSION
        from app.db.base import Base
        from app.domains.agent_runs import (
            event_sink,
            llm_context,
            request_evidence,
            review_report,
            service,
            service_execution,
            text_stream,
        )
        from app.domains.agent_runs.adapters import chapter_writing_contracts, chapter_writing_pipeline
        from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.loop import conversation_runtime, run_control
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
        from app.domains.agent_runs.patches import runtime_tools as patch_runtime_tools
        from app.domains.agent_runs.patches import writing_context as patch_writing_context
        from app.domains.agent_runs.service_types import AgentRuntimeUserMessageError
        from app.domains.agent_runs.tools import project_canon_runtime, prose_continue_runtime
        from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
        from app.platform.ai_sdk.providers import openai_compatible

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        proposals_module.datetime = FixedDatetime
        clock = {"now": 100.0}
        # Sleeping advances the virtual clock: retry waits poll it until the backoff has elapsed.
        virtual = SimpleNamespace(monotonic=lambda: clock["now"], time=lambda: clock["now"],
                                  sleep=lambda seconds: clock.__setitem__("now", clock["now"] + seconds))
        lc.random = lambda: 0.375
        for module in (lc, openai_compatible, run_control, llm_control):
            module.time = virtual
        real_check = event_sink.AgentRunEventSink.runtime_interruption
        state: dict = {}

        def runtime_interruption(self, run, *, boundary):
            state["checks"].append(boundary)
            for index, trigger in enumerate(state["triggers"]):
                if trigger["boundary"] == boundary:
                    state["trigger_counts"][index] += 1
                    if state["trigger_counts"][index] == trigger["nth"]:
                        set_status(trigger["status"], trigger["current_step"])
            return real_check(self, run, boundary=boundary)

        event_sink.AgentRunEventSink.runtime_interruption = runtime_interruption

        def set_status(status, step):
            db = state["db"]
            row = db.query(AgentRun).filter(AgentRun.public_id == "run-1").one()
            # Another session (the control channel) may have moved the row since: refresh, or an unchanged
            # cached value would make this assignment a no-op that never reaches the database.
            db.refresh(row)
            row.status, row.current_step = status, step
            db.add(row)
            db.commit()

        def fake_urlopen(req, timeout=None):
            clock["now"] += STEP
            body = json.loads(req.data.decode("utf-8")) if req.data is not None else None
            state["requests"].append({"url": req.full_url, "method": req.get_method(), "timeout": timeout,
                                      "body": body})
            reply = state["replies"].pop(0)
            if reply.get("set_status"):
                set_status(*reply["set_status"])
            for path, content in reply.get("edits", {}).items():
                write_file(state["project"].root / path, content)
            for control in reply.get("controls", []):
                state["controls"].append(run_control(control))
            clock["now"] += reply.get("advance", 0)
            if reply.get("polish") is not None:
                rule = reply["polish"]
                segments = json.loads(body["messages"][1]["content"])["segments"]
                for segment in segments:
                    for old, new in rule["replace"]:
                        segment["text"] = segment["text"].replace(old, new)
                if rule["drop_last"]:
                    segments = segments[:-1]
                reply = completion(json.dumps({"segments": segments}, ensure_ascii=False), finish=rule["finish"])
            if reply.get("chapter_check") is not None:
                rule = reply["chapter_check"]
                prompt = body["messages"][-1]["content"]
                start = prompt.index("检查源：") + len("检查源：")
                source = json.loads(prompt[start:prompt.index("\n", start)])
                if rule["corrupt"]:
                    source["content_sha256"] = "0" * 64
                reply = completion(json.dumps({**source, "findings": rule["findings"]}, ensure_ascii=False))
            if reply.get("compaction_quote"):
                model_input = json.loads(body["messages"][1]["content"])
                entries = [{"category": "decision", "text": f"摘要 {source['key']}", "source_id": source["key"],
                            "quote": source["content"][:10]} for source in model_input["new_sources"]]
                reply = completion(json.dumps({"entries": entries}, ensure_ascii=False))
            raw = reply.get("body", "").encode()
            if reply["status"] >= 400:
                headers = email.message.Message()
                raise error.HTTPError(req.full_url, reply["status"], "error", headers, io.BytesIO(raw))
            return FakeBody(raw, None, None, None)

        def run_control(control):
            # The control channel is another connection in production: a separate session on the same database.
            try:
                result = service.handle_agent_control_message(
                    state["control_db"], public_id="run-1", session_id=control.get("session", "sess-1"),
                    control_type=control["type"],
                    payload=control.get("payload"))
            except Exception as exc:  # noqa: BLE001 - the oracle records every failure shape
                return {"error": {"type": type(exc).__name__, "message": str(exc)}}
            return {"event": {"event_type": result.event.event_type, "sequence": result.event.sequence,
                              "payload": result.event.payload},
                    "resumed_result": result.resumed_result, "resume_diagnostic": result.resume_diagnostic}

        lc.request.urlopen = fake_urlopen
        real_snapshot = llm_context.build_llm_context_snapshot

        def snapshot_without_checkpoints(*, artifacts=None, **kwargs):
            # TS keeps checkpoints in engine memory (§2.6): they never reach the artifact list a snapshot counts.
            kept = None if artifacts is None else [a for a in artifacts if getattr(a, "kind", None) != "runtime_checkpoint"]
            return real_snapshot(artifacts=kept, **kwargs)

        for module in (conversation_runtime, patch_writing_context):
            module.build_llm_context_snapshot = snapshot_without_checkpoints
        records = []
        for spec in specs:
            if (run_dir / "book").exists():
                shutil.rmtree(run_dir / "book")
            project = Project(run_dir, "book", FILES)
            for path, content in spec.get("extra_files", {}).items():
                write_file(project.root / path, content)
            for path, (unit, count) in spec.get("big_files", {}).items():
                write_file(project.root / path, unit * count)
            root = str(project.root)
            for key in list(os.environ):
                if key.startswith(("STORYFORGE_LLM_", "STORYFORGE_POLISH_LLM_", "STORYFORGE_JUDGE_LLM_")):
                    del os.environ[key]
            os.environ.update({k: v for k, v in {**SOURCE, **spec["env"]}.items() if v is not None})
            engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
            Base.metadata.create_all(engine)
            db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
            for session_spec in spec["sessions"]:
                db.add(AssistantSession(title=session_spec["title"], task_type="ide_agent_orchestration",
                                        project_path=session_spec["project_path"].replace("$ROOT", root)))
            db.commit()
            for role, content in spec["history"] or []:
                db.add(AssistantMessage(session_id=1, role=role, content=content))
            if spec.get("seed_review"):
                earlier = AgentRun(public_id="run-0", session_id="sess-0", assistant_session_id=1, goal="审稿",
                                   scope={}, permission_profile="ask", budget={}, status="completed", root_plan=[],
                                   current_step="completed")
                db.add(earlier)
                db.commit()
                db.add(AgentArtifact(run_id=earlier.id, kind="review_report", payload=spec["seed_review"],
                                     requires_confirmation=False))
            db.commit()
            clock["now"] = 100.0
            attempts, streams = iter(range(1, 100)), iter(range(1, 100))
            request_evidence.uuid4 = lambda attempts=attempts: f"attempt-{next(attempts)}"
            proposal_ids = iter(range(1, 100))
            proposals_module.uuid4 = lambda proposal_ids=proposal_ids: UUID(f"00000000-0000-4000-8000-{next(proposal_ids):012x}")
            text_stream.uuid4 = lambda streams=streams: f"stream-{next(streams)}"
            # Patch and review ids share one counter (uuid4().hex shape), in call order across the four modules.
            hex_ids = iter(range(1, 100))
            fake_uuid = SimpleNamespace(uuid4=lambda hex_ids=hex_ids: SimpleNamespace(hex=f"{next(hex_ids):032x}"))
            for module in (patch_runtime_tools, project_canon_runtime, prose_continue_runtime, review_report,
                           chapter_writing_contracts, chapter_writing_pipeline):
                module.uuid = fake_uuid
            control_db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
            state.update(db=db, control_db=control_db, project=project, checks=[], requests=[], controls=[],
                         replies=json.loads(json.dumps(spec["replies"])),
                         triggers=spec["triggers"], trigger_counts=[0] * len(spec["triggers"]))
            frames, text_frames = [], []

            def on_event(event, frames=frames):
                frames.extend(websocket_stream_events_from_agent_event(event))

            record = {"id": spec["id"], "spec_json": json.dumps(spec, ensure_ascii=False)}
            if spec.get("setup"):
                # Built through the real lifecycle and sink: a run just created (no execution yet), or one
                # settled at permission.confirm.
                start = service.start_agent_user_message_run(
                    db, agent_session_id="sess-1", message={"user_message": "改第一章", "run_id": "run-1"})
                on_event(start.started_event)
                record["result"] = None
            if spec.get("setup") == "permission_wait":
                started = service_execution.start_agent_execution(db, start.run)
                sink = event_sink.AgentRunEventSink(db, on_event=on_event)
                sink.bind_execution(started)
                wait = json.loads(json.dumps(spec["wait_result"]))
                sink.record_permission_required(start.run, wait, reason="requires_user_confirmation")
                out_result, settled = service_execution.finish_agent_execution(db, start.run, started, wait)
                on_event(settled)
                record["result"] = out_result
            elif not spec.get("setup"):
                msg = json.loads(json.dumps(spec["message"]).replace("$ROOT", root.replace("\\", "\\\\")))
                if msg["args"].get("file_path") == root + "/正文/第001章.md":
                    msg["args"]["file_path"] = str(project.root / "正文" / "第001章.md")
                try:
                    out = service.run_agent_user_message(
                        db, agent_session_id="sess-1", message=msg, on_event=on_event,
                        on_text=(lambda frame, text_frames=text_frames: text_frames.append(frame.model_dump()))
                        if spec["stream"] else None)
                    record["result"] = out.result
                except AgentRuntimeUserMessageError as exc:
                    record["error"] = {"type": type(exc).__name__, "message": str(exc)}
            for op in spec.get("ops", []):
                if op["op"] == "edit":
                    write_file(project.root / op["path"], op["content"])
                else:
                    state["controls"].append(run_control(op))
            if "ops" in spec:
                record["controls"] = state["controls"]
            control_db.close()
            db.expire_all()
            record.update(
                frames=frames, text_frames=text_frames, checks=state["checks"], requests=state["requests"],
                unused_replies=len(state["replies"]),
                runs=[{c: getattr(r, c) for c in ("id", "public_id", "session_id", "assistant_session_id", "goal",
                                                  "scope", "permission_profile", "budget", "status", "root_plan",
                                                  "current_step")} for r in db.query(AgentRun).order_by(AgentRun.id)],
                events=[{c: getattr(e, c) for c in ("id", "run_id", "event_type", "actor", "message", "payload",
                                                    "sequence")}
                        for e in db.query(AgentRunEvent).order_by(AgentRunEvent.id)],
                artifacts=[{c: getattr(a, c) for c in ("id", "run_id", "kind", "payload", "requires_confirmation")}
                           for a in db.query(AgentArtifact).order_by(AgentArtifact.id)],
                subagents=[{c: getattr(r, c) for c in ("id", "run_id", "role", "input", "output", "status")}
                           for r in db.query(SubagentRun).order_by(SubagentRun.id)],
                sessions=[{c: getattr(r, c) for c in ("id", "title", "task_type", "project_path")}
                          for r in db.query(AssistantSession).order_by(AssistantSession.id)],
                messages=[{c: getattr(r, c) for c in ("id", "session_id", "role", "content")}
                          for r in db.query(AssistantMessage).order_by(AssistantMessage.id)],
                tool_calls=[{c: getattr(r, c) for c in ("id", "session_id", "tool_name", "status", "input_summary",
                                                        "output_summary", "error_message")}
                            for r in db.query(AssistantToolCall).order_by(AssistantToolCall.id)],
            )
            plain = json.loads(json.dumps(record, ensure_ascii=False, default=str))
            normalized = compact(renumber_artifacts(drop_checkpoint_artifact_ids(stable(plain, project.root))))
            records.append({**normalized, "spec_json": record["spec_json"]})
            db.close()
        event_sink.AgentRunEventSink.runtime_interruption = real_check
        return {
            "format_version": 1,
            "suite": suite,
            "secret": SECRET,
            "source": SOURCE,
            "files": FILES,
            "history": HISTORY,
            "app_version": APP_VERSION,
            "step_seconds": STEP,
            "fixed_now": "2026-10-12T08:30:00Z",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in sources},
            "platform": "windows" if os.name == "nt" else "posix",
            "project_root": str(run_dir / "book"),
            "scenarios": records,
            **(extra or {}),
            **(after() if after is not None else {}),
        }

