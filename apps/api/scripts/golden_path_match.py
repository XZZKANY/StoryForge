"""Freeze actual pathlib.PurePath.match, not fnmatch or filesystem glob traversal."""
from __future__ import annotations

import hashlib
import inspect
import random
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

from golden_pure import pure_kernel_oracle


def p1_path_match_snapshot() -> dict:
    with pure_kernel_oracle() as (_, state):
        import fnmatch
        import glob
        import ntpath
        import posixpath
        import re._casefix

        sources = {}
        for name, module in [("fnmatch", fnmatch), ("glob", glob), ("ntpath", ntpath), ("posixpath", posixpath),
                             ("re/_casefix", re._casefix)]:
            sources[f"stdlib/{name}.py"] = hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
        path_source = Path(inspect.getsourcefile(PurePosixPath.match))
        sources["stdlib/pathlib/match-owner.py"] = hashlib.sha256(path_source.read_bytes()).hexdigest()
        state["executing"] = True
        cases = []

        def add(name, path, pattern):
            for platform, cls in [("windows", PureWindowsPath), ("posix", PurePosixPath)]:
                row = {"id": name + "/" + platform, "path": path, "pattern": pattern, "platform": platform}
                try:
                    row["output"] = cls(path).match(pattern)
                except ValueError as error:
                    row["error"] = {"type": type(error).__name__, "message": str(error)}
                cases.append(row)

        paths = ["", ".", "..", "/", "//", "///", "C:", "C:/", "C:a.md", "C:/a.md", "a.md", "A.MD",
                 "正文/a.md", "正文/卷一/a.md", "../a.md", "./a.md", " 正文/a.md ", "x\\a.md",
                 "//server/share", "//server/share/a.md", "//?/UNC/server/share/a.md", "//?/C:/a.md", "//./pipe/name",
                 "//server", "//server/", "///server/share/a.md", "a/b/../c.md", "a//b/./c.md", "a\nb.md",
                 "😀/𠀀.md", "\x00.md", "[a].md", "*", "İ.MD", "ı.md", "ſ.md", "K.md", "1:/a.md", "😀:/a.md"]
        patterns = ["", ".", "./", "*", "**", "*.md", "*.MD", "?*.md", "*/a.md", "**/a.md", "**/**/*.md",
                    "正文/*.md", "正文/卷一/*.md", "a.md", "./a.md", "/a.md", "C:*.md", "C:/*.md", "c:/*.md",
                    "//server/share/*.md", "//?/UNC/server/share/*.md", "//?/C:/*.md", "[a-z].md", "[!a-z].md", "[!z-a]",
                    "..", "*/*", " /a.md ", "x\\a.md", "i.md", "k.md", "s.md", "[[]a].md"]
        for i, path in enumerate(paths):
            for j, pattern in enumerate(patterns):
                add(f"shape-{i}-{j}", path, pattern)
        for pattern in ["[]", "[!]", "[!]]", "[]]", "[[]", "[^]", "[a-c]", "[c-a]", "[!c-a]", "[a--b]", "[--a]", "[a-b-c]",
                        "[a-c-e-g]", "[z-a-d]", "[!z-a-d]", "[a&&b]", "[a~~b]", "[a||b]", "[\\]", "[!a]", "[!-a]", "[-!]", "[a-]", "[!a-]", "[a-zA-Z]", "[À-Ö]", "[𐐀-𐐧]", "[😀-𠀀]"]:
            for char in ["a", "b", "c", "-", "!", "]", "[", "^", "\\", "/", "&", "~", "|", "A", "ſ", "İ", "ı", "K", "à", "𐐨", "😀", "𠀀", "\n"]:
                add(f"class-{ascii(pattern)}-{ord(char)}", char, pattern)
        for a, b in [("İ", "i"), ("ı", "I"), ("ſ", "S"), ("K", "k"), ("µ", "μ"), ("ß", "ss"), ("ẞ", "ß"),
                     ("σ", "ς"), ("ﬅ", "ﬆ"), ("𐐀", "𐐨"), ("\u1c89", "\u1c8a")]:
            add(f"case-{ord(a)}-{ascii(b)}", a, b)
            add(f"case-class-{ord(a)}-{ascii(b)}", a, f"[{b}]")
        rng = random.Random(20261014)
        alphabet = ["a", "b", "c", "-", "!", "[", "]", "^", "&", "*", "?", "A", "İ", "ſ", "😀"]
        for i in range(600):
            pattern = ''.join(rng.choice(alphabet) for _ in range(rng.randrange(1, 12)))
            path = ''.join(rng.choice(alphabet[:10]) for _ in range(rng.randrange(1, 9)))
            add(f"seeded-{i}", path, pattern)
        for i in range(120):
            body = ''.join(rng.choice(alphabet[:9]) for _ in range(rng.randrange(1, 10)))
            pattern = '[' + body + ']'
            for char in ['a', '-', '!', ']', '[']:
                add(f"seeded-class-{i}-{ord(char)}", char, pattern)
        add("supplementary-question", "😀", "?")
        add("supplementary-class", "😀", "[😀-𠀀]")
        add("supplementary-pseudo-drive", "😀:/a.md", "*/a.md")
        roots = ["/", "//", "///", "////", "C:", "C:/", "C://", "C:a", "é:/", "😀:/", "//s", "//s/", "//s/sh", "//s/sh/",
                 "//?/UNC/s/sh", "//?/unc/s/sh/", "//?/C:", "//?/C:/", "//./pipe", "//./pipe/", "//?", "//."]
        for i, path in enumerate(roots):
            for j, pattern in enumerate(["*", "**", "?", "[!a]", *roots]):
                add(f"anchor-{i}-{j}", path, pattern)
        for size in [8, 12]:
            add(f"star-adversarial-false-{size}", 'a' * size, '*a' * size + 'b')
            add(f"star-adversarial-true-{size}", 'a' * size, '*a' * size)
        assert "app.common.config" not in sys.modules
        return {"format_version": 1, "suite": "p1-path-match", "python": sys.version.split()[0], "runtime_platform": sys.platform,
                "windows_splitroot_native": inspect.isbuiltin(ntpath.splitroot), "sources": sources,
                "isolation": {"normal_stdlib_imports": True, "domain_io": "audit-denied", "network": "audit-denied",
                              "settings_imported": False, "audit_self_tests": ["author-read", "network", "write"]}, "cases": cases}
