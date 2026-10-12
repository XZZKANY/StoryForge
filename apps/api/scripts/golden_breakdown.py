"""Real book-breakdown oracle: reference-text parsing (TXT / Markdown / JSON / DOCX), chapter
detection, representative selection, scripted model analysis, cancellation and report status."""

from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import zipfile
import zlib
from types import SimpleNamespace

from golden_fs import Project, isolated_fs_oracle

SOURCES = ["app/domains/ide/book_breakdown.py", "app/domains/ide/book_breakdown_control.py"]

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def document(body: str, *, prefix: str = "w", decl: str = DECL, extra: str = "") -> str:
    ns = f' xmlns:{prefix}="{W}"' if prefix else f' xmlns="{W}"'
    tag = (lambda name: f"{prefix}:{name}") if prefix else (lambda name: name)
    return f'{decl}<{tag("document")}{ns}{extra}><{tag("body")}>{body}</{tag("body")}></{tag("document")}>'


def para(*texts: str) -> str:
    return "<w:p>" + "".join(f"<w:r><w:t>{text}</w:t></w:r>" for text in texts) + "</w:p>"


def zip_bytes(entries: list[tuple[str, bytes | str, int, bytes]], *, comment: bytes = b"") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data, method, extra in entries:
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = method
            info.extra = extra
            archive.writestr(info, data)
        archive.comment = comment
    return buffer.getvalue()


def docx(xml: str | bytes, method: int = zipfile.ZIP_DEFLATED) -> bytes:
    return zip_bytes([("[Content_Types].xml", "<Types/>", method, b""), ("word/document.xml", xml, method, b"")])


def patch_central(raw: bytes, name: bytes, offset: int, value: int) -> bytes:
    """Overwrite a 32-bit field of the central-directory record for `name`."""
    start = raw.index(b"PK\x01\x02")
    while True:
        name_length = struct.unpack_from("<H", raw, start + 28)[0]
        if raw[start + 46:start + 46 + name_length] == name:
            return raw[:start + offset] + struct.pack("<L", value) + raw[start + offset + 4:]
        start = raw.index(b"PK\x01\x02", start + 4)


GOOD_BODY = "".join([
    para("第1章 ", "开端"),
    para("正文", "一 &amp; 二"),
    para("   "),
    "<w:p/>",
    '<w:p><w:r><w:t xml:space="preserve"> 前后空格 </w:t></w:r></w:p>',
    "<w:p><w:r><w:t>外</w:t><w:pict><w:txbxContent>" + para("内") + "</w:txbxContent></w:pict></w:r></w:p>",
    "<w:p><w:r><w:t>a<!-- c -->b<![CDATA[<c>]]>&#x4E2D;&#20013;&lt;&gt;&apos;&quot;</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>前<w:x/>后</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>甲</w:t></w:r><w:r><w:tab/><w:t>乙</w:t></w:r></w:p>",
    '<w:p><o:t xmlns:o="urn:other">不算</o:t><w:r><w:t>算</w:t></w:r></w:p>',
    "<?pi data?>",
    para("第二章 发展"),
    para("行一\r\n行二&#13;行三"),
])
GOOD_XML = document(GOOD_BODY)
MALFORMED = {
    "mismatched": document(para("a").replace("</w:p>", "</w:r>", 1)),
    "unclosed": document(para("a"))[:-20],
    "undefined-entity": document(para("&nbsp;")),
    "bare-amp": document(para("a & b")),
    "unbound-prefix": document("<q:p/>" + para("a")),
    "junk-after-root": document(para("a")) + "<w:p/>",
    "two-roots": document(para("a")) + document(para("b"), decl=""),
    "lt-in-attr": document('<w:p a="<"/>' + para("a")),
    "duplicate-attr": document('<w:p a="1" a="2"/>' + para("a")),
    "duplicate-xmlns": document('<w:p xmlns:a="urn:1" xmlns:a="urn:2"/>' + para("a")),
    "duplicate-expanded-attr": document('<w:p xmlns:a="urn:1" xmlns:b="urn:1" a:x="1" b:x="2"/>' + para("a")),
    "cdata-end-in-text": document(para("a]]>b")),
    "bad-char-ref": document(para("&#0;")),
    "comment-dashes": document("<!-- a -- b -->" + para("a")),
    "misplaced-decl": document(para("a"), decl="\n" + DECL),
    "text-before-root": "junk" + document(para("a"), decl=""),
    "empty": "",
}
GOOD_VARIANTS = {
    "bom": b"\xef\xbb\xbf" + GOOD_XML.encode(),
    "lower-encoding": document(para("小写编码"), decl='<?xml version="1.0" encoding="utf-8"?>'),
    "no-decl": document(para("无声明"), decl=""),
    "default-ns": document("<p><r><t>默认命名空间</t></r></p>", prefix=""),
    "custom-prefix": document(para("x").replace("w:", "x:"), prefix="x", extra=' xmlns:w="urn:not-word"'),
    "self-closing-root": f'<w:document xmlns:w="{W}"/>',
}


def docx_files() -> dict[str, bytes]:
    files = {
        "good-deflate": docx(GOOD_XML),
        "good-stored": docx(GOOD_XML, zipfile.ZIP_STORED),
        "not-zip": b"not a zip at all " * 3,
        "missing-document": zip_bytes([("word/other.xml", GOOD_XML, zipfile.ZIP_DEFLATED, b"")]),
        "comment": zip_bytes([("word/document.xml", document(para("带注释的 zip")), zipfile.ZIP_DEFLATED, b"")],
                             comment=b"archive comment"),
        "prepended": b"PREFIX-DATA" + docx(document(para("前置数据"))),
        "duplicate": zip_bytes([("word/document.xml", document(para("旧")), zipfile.ZIP_DEFLATED, b""),
                                ("word/document.xml", document(para("新")), zipfile.ZIP_DEFLATED, b"")]),
        "unicode-path": zip_bytes([("foo.xml", document(para("Unicode 路径")), zipfile.ZIP_DEFLATED,
                                    struct.pack("<HHBL", 0x7075, 5 + 17, 1, zlib.crc32(b"foo.xml")) + b"word/document.xml")]),
    }
    stored = docx(document(para("校验")), zipfile.ZIP_STORED)
    data_start = stored.index(b"word/document.xml") + len("word/document.xml")
    files["crc-mismatch"] = stored[:data_start + 10] + bytes([stored[data_start + 10] ^ 0xFF]) + stored[data_start + 11:]
    local = stored.index(b"word/document.xml")
    files["local-name-mismatch"] = stored[:local] + b"word/documenX.xml" + stored[local + 17:]
    files["backslash-name"] = docx(document(para("反斜杠"))).replace(b"word/document.xml", b"word\\document.xml")
    two = zip_bytes([("word/document.xml", document(para("重叠")), zipfile.ZIP_STORED, b""),
                     ("word/other.xml", "x" * 40, zipfile.ZIP_STORED, b"")])
    size = struct.unpack_from("<L", two, two.index(b"PK\x01\x02") + 20)[0]
    files["overlapped"] = patch_central(two, b"word/document.xml", 20, size + 30)
    for key, xml in {**MALFORMED, **GOOD_VARIANTS}.items():
        files[f"xml-{key}"] = docx(xml)
    return {f"参考/docx/{key}.docx": raw for key, raw in files.items()}


CHAPTER_TEXTS = {
    "headings": "第1章 开端\n正文A\n第二章 发展\n正文B\n第十二回 X\nC\n# 第三节\nD\nChapter 4 Title\nE\nchapter 5\nF\nCHAPTER 6:\nG",
    "no-boundary": "第一章开端\n正文\n第1章_x\n第1章١\nChapter 12a\n第123456章\n内容",
    "boundary-marks": "第1章：开端\n甲\n第2章\u0301\n乙\n\u3000第3章 全角空格\n丙\n第4章\u00a0不换行空格\n丁",
    "empty-bodies": "第1章\n第2章\n内容\n第3章\n   \n",
    "ordinals": "\n".join(f"第{o}章 t\n正文" for o in ["零", "〇", "十", "十五", "三十", "二十三", "一百二十", "两", "百", "千万", "00012", " 十 "]),
    "hashes": "  ## 第3章 标题 ##\n内容\n####### 第4章\n不是标题",
    "bom": "\ufeff第1章 A\n内容\n第2章 B\n内容2",
    "line-endings": "第1章 A\r\n内容\r第2章 B\r\n内容2\r\n",
    "plain": "无标题正文\n第二行",
    "blank": " \n\t ",
}
SOURCE_PATHS = ["参考/书.txt", ".hidden", "a.b.md", "..txt", "noext", "dir.d/name", "file."]
MODEL_RAWS = [
    None, 5, "", "  ", "not json", '{"story_structure": "a  b\\nc"}', '```json\n{"conflict_and_rhythm": "围栏"}\n```',
    '模型说明：{"craft_methods": {"summary": "对象", "evidence_refs": ["x", 1, "y"]}} 结尾', "[1, 2]", '{"a": 1} 多余 }',
    json.dumps({
        "story_structure": {"summary": "", "analysis": "备用"}, "characters_and_relations": {"summary": [], "内容": "内容键"},
        "conflict_and_rhythm": {"summary": 0.0, "analysis": "零值"}, "setting_and_world": "  ", "craft_methods": 7,
        "transferable_insights": {"summary": "长" * 1700, "evidence_refs": [f"r{i}" for i in range(25)]},
    }, ensure_ascii=False),
    json.dumps({"story_structure": {"summary": "s", "evidence_refs": "not-list"}}, ensure_ascii=False),
]


class CountingEvent:
    """Stands in for threading.Event: reports set from the n-th check onwards."""

    def __init__(self, set_from: int):
        self.checks = 0
        self.set_from = set_from

    def is_set(self) -> bool:
        self.checks += 1
        return self.checks >= self.set_from


def p1_breakdown_snapshot() -> dict:
    with isolated_fs_oracle("breakdown-oracle-") as (api, run):
        from app.domains.agent_runs.fs_tools import FsToolError
        from app.domains.ide import book_breakdown as bb
        from app.domains.ide import book_breakdown_control as control

        pure = []

        def record(fn, args, run_fn, errors=(bb.BookBreakdownError,)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        for key, text in CHAPTER_TEXTS.items():
            record("parse_chapters", {"case": key, "text": text, "source": "参考/书.txt"},
                   lambda text=text: bb.parse_chapters(text, "参考/书.txt"))
        for source in SOURCE_PATHS:
            record("parse_chapters", {"case": "stem", "text": CHAPTER_TEXTS["plain"], "source": source},
                   lambda source=source: bb.parse_chapters(CHAPTER_TEXTS["plain"], source))
        for count in [0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 15, 20]:
            chapters = [{"chapter_id": f"c:{i + 1}", "global_index": i + 1, "title": f"第{i + 1}章", "source_path": "c"}
                        for i in range(count)]
            for target in (1, 3, 5, 8, 12, 20):
                record("select", {"count": count, "target": target},
                       lambda chapters=chapters, target=target: bb.select_representative_chapters(chapters, target_count=target))
        selected = [{"chapter_id": "a:1"}, {"chapter_id": "a:2"}]
        for raw in MODEL_RAWS:
            record("parse_model", {"raw": raw, "selected": selected},
                   lambda raw=raw: bb._parse_model_analysis(raw, selected), errors=(bb.BookBreakdownError, ValueError))
        for steps in (["prepare:x", "request:x", "request:y", "release:x", "request:x"], ["request:z"]):
            def registry(steps=steps):
                out = []
                for step in steps:
                    action, analysis_id = step.split(":")
                    if action == "prepare":
                        event = control.prepare_breakdown_cancellation(analysis_id)
                        out.append(event.is_set())
                    elif action == "request":
                        out.append(control.request_breakdown_cancel(analysis_id))
                    else:
                        control.release_breakdown_cancellation(analysis_id)
                        out.append(None)
                return out
            record("registry", {"steps": steps}, registry)

        long_book = "\n".join(f"第{i}章 第{i}章标题\n" + f"第{i}章的正文内容。" * 3 for i in range(1, 11))
        files: dict[str, bytes | str] = {
            "参考/长篇.txt": long_book,
            "参考/短篇.md": "# 第一章 起\n内容一\n## 第二章 承\n内容二",
            "参考/notes.markdown": "没有任何章节标题的笔记。\n第二行。",
            "参考/data.json": json.dumps([{"title": "x", "content": "第1章 甲\n内容"}, {"text": "正文2"}, {"正文": ["a", "b"]}],
                                       ensure_ascii=False),
            "参考/meta.json": json.dumps({"name": "书", "count": 3, "ratio": 1.5, "big": 1e16, "neg": -0.0, "flag": True,
                                       "none": None, "list": [1, "a"], "nested": {"k": "v"}}, ensure_ascii=False),
            "参考/bad.json": "{bad",
            "参考/bom.json": "\ufeff{}",
            "参考/binary.txt": b"abc\x00def",
            "参考/invalid-utf8.txt": b"\xff\xfe\xe7\xac\xac1\xe7\xab\xa0 X\n\xe4\xbd\xe5\x86\x85\xe5\xae\xb9\xed\xa0\x80\xf0\x80\x80end",
            "参考/crlf.txt": "第1章 一\r\n甲\r第2章 二\r\n乙\r\n",
            "参考/empty.md": "",
            "参考/image.png": b"\x89PNG",
            "参考/UPPER.TXT": "第1章 大写后缀\n内容",
            ".storyforge/agent-instructions.md": "第1章 不该是正文\n作者指令也会被当作参考文本扫描",
            ".git/x.txt": "第1章 隐藏\n内容",
            **docx_files(),
        }
        p = Project(run, "book", files)
        for path in sorted(files):
            if path.startswith("参考/docx/") or path in ("参考/meta.json", "参考/data.json", "参考/invalid-utf8.txt",
                                                       "参考/bad.json", "参考/bom.json", "参考/binary.txt"):
                p.call("read_source", {"path": path}, lambda path=path: bb._read_source(p.root / path),
                       errors=(bb.BookBreakdownError,))

        source = {"STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "fake-model"}

        def run_with(project, replies=None, **kwargs):
            calls = []

            def fake(src, *, system_prompt, user_prompt):
                calls.append({"system": system_prompt, "user": user_prompt})
                reply = replies[len(calls) - 1]
                if isinstance(reply, Exception):
                    raise reply
                return reply

            bb._call_llm = fake

            def execute():
                output = bb.run_book_breakdown(str(project.root), **kwargs)
                return {"output": output, "calls": calls}
            return execute

        def encode(reply):
            return {"raise": type(reply).__name__} if isinstance(reply, Exception) else reply

        good = {"content": json.dumps({key: f"{key} 的分析" for key in bb._ANALYSIS_KEYS}, ensure_ascii=False)}
        runs = [
            ({"analysis_id": "a1"}, None),
            ({"analysis_id": "a2", "target_count": 3}, None),
            ({"analysis_id": "a3", "target_count": 12, "model_source": source}, [RuntimeError("x"), {"content": "```\n" + good["content"] + "\n```"}]),
            ({"analysis_id": "a4", "model_source": source}, [RuntimeError("x"), {"content": "仍然不是 JSON"}]),
            ({"analysis_id": "a5", "model_source": source}, [{"content": '{"story_structure": "只有一个字段"}'}]),
            ({"analysis_id": "a6", "cancel_event": 1}, None),
            ({"analysis_id": "a7", "cancel_event": 3}, None),
            ({"analysis_id": "a8", "cancel_event": 4, "model_source": source}, [good]),
            ({"analysis_id": "a9", "cancel_event": 2}, None),
            ({"analysis_id": ""}, None),
        ]
        bb.uuid = SimpleNamespace(uuid4=lambda: SimpleNamespace(hex="feedfacefeedfacefeedfacefeedface"))
        for kwargs, replies in runs:
            shown = {**kwargs, "model_source": "configured" if "model_source" in kwargs else None,
                     "replies": [encode(reply) for reply in replies or []]}
            if "cancel_event" in kwargs:
                kwargs = {**kwargs, "cancel_event": CountingEvent(kwargs["cancel_event"])}
            p.call("run", shown, run_with(p, replies, **kwargs), errors=(bb.BookBreakdownError, FsToolError))
            if kwargs.get("analysis_id") == "a2":
                p.call("status", {}, lambda: bb.read_book_breakdown_status(str(p.root)), errors=(bb.BookBreakdownError,))
                for max_chars in (60, 200):
                    report = {"selected_chapters": [
                        {"chapter_id": "参考/长篇.txt:1", "source_path": "参考/长篇.txt", "title": "一", "reason": "r"},
                        {"chapter_id": "参考/长篇.txt:2", "source_path": "参考/长篇.txt"},
                        "skip", {"chapter_id": "参考/长篇.txt:99", "source_path": "参考/长篇.txt"}]}
                    p.call("selected_context", {"report": report, "max_chars": max_chars},
                           lambda report=report, max_chars=max_chars: bb.selected_context(str(p.root), report, max_chars=max_chars))
                p.mutate("参考/短篇.md", "# 第一章 起\n改过的内容".encode())
                p.call("status", {}, lambda: bb.read_book_breakdown_status(str(p.root)), errors=(bb.BookBreakdownError,))

        empty = Project(run, "empty", {"图片.png": b"\x89PNG", "空.txt": "  \n"})
        empty.call("status", {}, lambda: bb.read_book_breakdown_status(str(empty.root)), errors=(bb.BookBreakdownError,))
        empty.call("run", {"analysis_id": "e1", "model_source": None, "replies": []},
                   run_with(empty, None, analysis_id="e1"), errors=(bb.BookBreakdownError, FsToolError))

        broken = Project(run, "broken", {"正文.txt": "第1章 a\n内容", ".storyforge/analysis/book-breakdown.json": "{bad"})
        broken.call("status", {}, lambda: bb.read_book_breakdown_status(str(broken.root)), errors=(bb.BookBreakdownError,))
        broken.mutate(".storyforge/analysis/book-breakdown.json", b"[1]")
        broken.call("status", {}, lambda: bb.read_book_breakdown_status(str(broken.root)), errors=(bb.BookBreakdownError,))
        broken.mutate(".storyforge/analysis/book-breakdown.json",
                      json.dumps({"status": "", "input_sha256": None}).encode())
        broken.call("status", {}, lambda: bb.read_book_breakdown_status(str(broken.root)), errors=(bb.BookBreakdownError,))
        current = bb._sources_hash(bb.load_project_chapters(str(broken.root))[1])
        broken.mutate(".storyforge/analysis/book-breakdown.json",
                      json.dumps({"status": "", "input_sha256": current, "analysis_id": "b1"}).encode())
        broken.call("status", {}, lambda: bb.read_book_breakdown_status(str(broken.root)), errors=(bb.BookBreakdownError,))

        small = Project(run, "small", {"一章.txt": "只有一章的正文。"})
        small.call("run", {"analysis_id": "s1", "model_source": None, "replies": []},
                   run_with(small, None, analysis_id="s1"), errors=(bb.BookBreakdownError, FsToolError))
        small.call("status", {}, lambda: bb.read_book_breakdown_status(str(small.root)), errors=(bb.BookBreakdownError,))

        return {
            "format_version": 1,
            "suite": "p1-breakdown",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book" if os.name == "nt" else "/tmp/synthetic-book",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [p.record("book"), empty.record("empty"), broken.record("broken"), small.record("small")],
            "pure": pure,
        }
