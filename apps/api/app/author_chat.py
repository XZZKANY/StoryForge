"""storyforge chat — Claude-Code-for-fiction 对话式作者 CLI (MVP)。

在一个稿件文件夹上用自然语言改稿:审稿 / 定点改 → 内联 diff → 确认写回 → git 版本。
零按钮,跑在终端。复用与 book_generation 同一个 STORYFORGE_LLM_* LLM 客户端,
直接调 live agent 后端 run_agent_user_message(file.review / file.revise)。

用法:
    uv run python -m app.author_chat <稿件文件夹> [--model deepseek-v4-pro]

会话内命令:
    ls                          列出稿件文件
    open <序号|第N章|文件名>     选定当前文件
    <自然语言>                   审稿 / 定点改稿(自动路由 review/revise)
    y / n                       接受 / 丢弃上一处待确认修订(接受=写回+git commit)
    diff                        重看上一处待确认 diff
    quit                        退出
"""
from __future__ import annotations

import argparse
import difflib
import os
import re
import subprocess
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (注册所有表)
from app.db.base import Base
from app.domains.agent_runs.service import run_agent_user_message
from app.domains.book_runs.book_generation_preflight import missing_book_generation_env

DOC_EXT = (".md", ".txt")
SKIP_DIRS = {".storyforge", ".git", "node_modules", ".codex"}


def list_docs(root: Path) -> list[Path]:
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() in DOC_EXT and not (SKIP_DIRS & set(p.parts)):
            out.append(p)
    return out


def resolve_doc(root: Path, docs: list[Path], token: str) -> Path | None:
    token = token.strip()
    if not token:
        return None
    if token.isdigit():
        i = int(token) - 1
        if 0 <= i < len(docs):
            return docs[i]
    for p in docs:  # filename / relative-path substring
        if token in p.name or token in str(p.relative_to(root)):
            return p
    m = re.search(r"(\d+)", token)  # 第N章 → 文件名含数字 N
    if m:
        n = m.group(1)
        for p in docs:
            if re.search(rf"(?<!\d){n}(?!\d)", p.stem):
                return p
    return None


def render_diff(before: str, after: str, *, max_lines: int = 40) -> None:
    diff = difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm="", n=2)
    shown = 0
    for ln in diff:
        if ln[:3] in ("---", "+++"):
            continue
        if ln.startswith("@@"):
            print(f"    {ln}")
        elif ln[:1] == "+":
            print(f"    ＋ {ln[1:][:170]}")
            shown += 1
        elif ln[:1] == "-":
            print(f"    － {ln[1:][:170]}")
            shown += 1
        else:
            print(f"      {ln[:170]}")
        if shown >= max_lines:
            print("    …(diff 截断)")
            break


def git_commit(root: Path, file_path: Path, message: str) -> str:
    def run(*a):
        return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)

    if run("rev-parse", "--is-inside-work-tree").returncode != 0:
        return "非 git 仓库,跳过提交(文件已写回)"
    if run("add", str(file_path)).returncode != 0:
        return "git add 失败"
    res = run("commit", "-m", message)
    return "已提交" if res.returncode == 0 else f"git commit 失败: {(res.stderr or res.stdout).strip()[:80]}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="storyforge chat — 对话式作者 CLI")
    parser.add_argument("manuscript", help="稿件文件夹")
    parser.add_argument("--model", default=None, help="覆盖 STORYFORGE_LLM_MODEL,如 deepseek-v4-pro")
    args = parser.parse_args(argv)
    if args.model:
        os.environ["STORYFORGE_LLM_MODEL"] = args.model

    missing = missing_book_generation_env()
    if missing:
        print("缺少真实 LLM 环境变量: " + ", ".join(missing))
        print("请先设置 STORYFORGE_LLM_API_KEY / _BASE_URL / _MODEL / _PROVIDER(本机私有 env,勿入库)。")
        return 2

    root = Path(args.manuscript).resolve()
    if not root.is_dir():
        print(f"不是文件夹: {root}")
        return 2
    docs = list_docs(root)
    if not docs:
        print(f"{root} 下没有 .md/.txt 稿件文件。")
        return 2

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    print(f"📚 storyforge chat · {root.name} · {len(docs)} 篇 · 模型 {os.environ.get('STORYFORGE_LLM_MODEL')}")
    print("   命令: ls | open <序号/第N章/文件名> | <自然语言审稿/改稿> | y 接受 | n 丢弃 | diff | quit")
    for i, p in enumerate(docs, 1):
        print(f"   {i}. {p.relative_to(root)}")

    cur: Path | None = docs[0] if len(docs) == 1 else None
    last_report = None
    pending: tuple[Path, str, str, str] | None = None  # (file, before, after, instruction)
    sid = "author-chat-1"

    with SessionLocal() as sess:
        while True:
            try:
                line = input(f"\n[{cur.name if cur else '—'}] 🧑 ").strip()
            except EOFError:
                break
            if not line:
                continue
            low = line.lower()
            if low in ("quit", "exit", ":q"):
                break
            if low == "ls":
                for i, p in enumerate(docs, 1):
                    print(f"   {i}. {p.relative_to(root)}")
                continue
            if low.startswith("open"):
                f = resolve_doc(root, docs, line[4:])
                if f:
                    cur = f
                    print(f"   → 当前: {cur.relative_to(root)} ({len(cur.read_text(encoding='utf-8'))} 字)")
                else:
                    print("   没找到该文件(试 'ls' 看序号)")
                continue
            if low == "diff":
                if pending:
                    render_diff(pending[1], pending[2])
                else:
                    print("   无待确认修订")
                continue
            if low in ("y", "yes", "accept", "接受"):
                if not pending:
                    print("   没有待确认的修订")
                    continue
                f, _before, after, instr = pending
                f.write_text(after, encoding="utf-8")
                status = git_commit(root, f, f"author-chat: {instr[:60]}")
                print(f"   ✅ 已写回 {f.relative_to(root)} ({len(after)} 字) · {status}")
                pending = None
                continue
            if low in ("n", "no", "reject", "丢弃"):
                pending = None
                print("   已丢弃")
                continue

            # ---- 自然语言 → live agent ----
            if cur is None:
                print("   先 open 一个文件,如 'open 1'")
                continue
            content = cur.read_text(encoding="utf-8")
            msg_args = {"file_path": str(cur.relative_to(root)), "content": content, "instruction": line}
            if last_report:
                msg_args["review_report"] = last_report
            ids = re.findall(r"\b([a-z]+-\d+)\b", line)
            if ids:
                msg_args["selected_issue_ids"] = ids
            try:
                res = run_agent_user_message(
                    sess,
                    agent_session_id=sid,
                    message={"type": "user_message", "user_message": line, "args": msg_args},
                )
            except Exception as exc:  # noqa: BLE001
                print(f"   ⚠ agent 出错: {exc}")
                continue
            r = getattr(res, "result", None) or {}
            intent = r.get("intent")
            ar = r.get("agent_result") if isinstance(r.get("agent_result"), dict) else {}
            report = ar.get("review_report") if isinstance(ar, dict) else None
            patch = r.get("proposed_patch") or (ar.get("proposed_patch") if isinstance(ar, dict) else None)

            if isinstance(patch, dict) and (patch.get("after") or patch.get("before")):
                if isinstance(report, dict) and report.get("kind") == "review_report":
                    last_report = report  # 保留随修订附带的审稿,供后续定向引用
                before = patch.get("before") or content
                after = patch.get("after") or ""
                summ = ar.get("summary") if isinstance(ar, dict) else None
                if summ:
                    print(f"   🤖 [{intent}] {summ}")
                print(f"   定点修订 (id={patch.get('id')}, 需确认):")
                render_diff(before, after)
                print(f"   (before {len(before)} 字 → after {len(after)} 字)   输 y 写回 / n 丢弃")
                pending = (cur, before, after, line)
            elif isinstance(report, dict) and report.get("kind") == "review_report":
                last_report = report
                issues = report.get("issues") or []
                print(f"   🤖 [{intent} · {report.get('mode')}] {ar.get('summary')}")
                for it in issues[:12]:
                    print(f"      • [{it.get('id')}·{it.get('severity')}] {it.get('category')}: {it.get('message')}")
                    sa = it.get("suggested_action") or it.get("suggestion")
                    if sa:
                        print(f"          建议: {str(sa)[:120]}")
            else:
                print(f"   🤖 [{intent}] {ar.get('summary') if isinstance(ar, dict) else r.get('summary') or '(无结构化结果)'}")

    print("bye.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
