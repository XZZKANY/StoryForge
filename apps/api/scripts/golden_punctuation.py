"""Pure punctuation oracle using normal domain imports, with all domain IO denied."""
from __future__ import annotations

import hashlib
import random
import sys
from pathlib import Path

from golden_pure import pure_kernel_oracle


def p1_punctuation_snapshot() -> dict:
    with pure_kernel_oracle() as (api, state):
        import difflib

        from app.common.author_edit_policy import AuthorEditPolicy
        from app.common.punctuation import DIALOGUE_PATTERN, canonical_punctuation, restore_incidental_punctuation

        sources = {name: hashlib.sha256((api / name).read_bytes()).hexdigest() for name in
                   ["app/common/punctuation.py", "app/common/author_edit_policy.py"]}
        sources["stdlib/difflib.py"] = hashlib.sha256(Path(difflib.__file__).read_bytes()).hexdigest()
        state["executing"] = True
        folds = '“”「」『』„‟‘’‚‛‐‑‒–—―…\u00a0\u3000\u2007\u202f'
        texts = ["", "林岚𠀀😀", "你好，世界。", "你好, 世界.", "...---   .- ", "\t\r\n\u0085\ufeff",
                 "……...——--\u3000 \u00a0", "!!??！？", "‘甲’和’乙‘", "__proto__"]
        texts.extend("甲" + char * 3 + "乙" for char in folds)
        canonical = [{"id": f"canonical-{i}", "input": text, "output": canonical_punctuation(text)}
                     for i, text in enumerate(texts)]
        dialogue_texts = ["", '“甲”「乙」『丙』"丁"', '“跨\n行”「跨\r\n行」『\n』"不跨\n行"',
                          '"跨\r行" "跨\u2028行"', '“”「」『』""', '“外“内”尾” 「外「内」尾」',
                          '“混「引号」合”', '“未闭合', '😀"𠀀😀"尾', r'"反斜\"杠"', '‘单引号不匹配’',
                          '”逆向“ 「不配』', '"a""b"\n“c”']
        dialogue = [{"id": f"dialogue-{i}", "input": text,
                     "matches": [{"text": m.group(), "start": m.start(), "end": m.end()} for m in DIALOGUE_PATTERN.finditer(text)],
                     "stripped": DIALOGUE_PATTERN.sub("", text)} for i, text in enumerate(dialogue_texts)]
        original = '　　林岚推开舱门，海风灌进来。\n\n“你确定是这里？”她问。\n\n老陈没有回答——很久很久……\n\n　　十二台发射器同时亮起。'
        drift = '  林岚推开舱门，海风灌进来。\n\n"你确定是这里？"她问。\n\n老陈没有回答—很久很久...\n\n  十二台发射器同时亮起。'
        pairs = [("identical", original, original), ("punctuation-only", original, drift),
                 ("real-edit", original, drift.replace("她问。", "她压低声音问。")),
                 ("insert", original, drift + '\n\n“走吧。”'),
                 ("delete", original, '\n'.join(x for x in drift.split('\n') if "十二台" not in x)),
                 ("empty", "", ""), ("empty-before", "", "\n“新增”"), ("empty-after", "“删除”\n", ""),
                 ("line-endings", '“甲”\r\n……\r\n旧', '"甲"\r\n...\r\n新'),
                 ("mixed-units", '　“等等……”\n门很冷。', ' "等等..."\n地板很凉。'),
                 ("cjk-real-change", "你好，世界。\n“你好”", '你好, 世界.\n"你好"'),
                 ("quote-and-real-edit", '“旧”\n‘未改’', '"新"\n\'未改\''),
                 ("tie-order", '“甲”\n「甲」\n旧', '"甲"\n新'),
                 ("moved-line", '“甲”\n“乙”\n“丙”', '"丙"\n"甲"\n"乙"'),
                 ("blank-heavy", '第一段。\n\n\n第二段——收尾。\n\n', '第一段。\n\n\n第二段--改写后的收尾。\n\n'),
                 ("popular-lines", '旧首\n' + '“重复”\n\n' * 120 + '尾', '新首\n' + '"重复"\n\n' * 120 + '尾'),
                 ("supplementary", '😀　“𠀀……”\n旧', '😀 "𠀀..."\n新'),
                 ("unicode-line-separators", '“甲”\u2028旧\n“乙”', '"甲"\u2028新\n"乙"')]
        rng = random.Random(20261012)
        variants = [('', ''), ('“甲”', '"甲"'), ('「甲」', '"甲"'), ('——', '--'), ('　', ' '),
                    ('…', '...'), ('𠀀😀', '𠀀😀'), ('“乙”', '"乙"'), ('__proto__', '__proto__')]
        for i in range(256):
            before = [rng.choice(variants)[0] for _ in range(rng.randrange(1, 10))]
            after = [canonical_punctuation(x) for x in before]
            for _ in range(rng.randrange(1, 5)):
                action = rng.randrange(3)
                if action == 0 or not after:
                    after.insert(rng.randrange(len(after) + 1), rng.choice(variants)[1])
                elif action == 1:
                    del after[rng.randrange(len(after))]
                else:
                    after[rng.randrange(len(after))] = rng.choice(variants)[1] + '新'
            pairs.append((f"seeded-{i}", '\n'.join(before), '\n'.join(after)))
        restoration = []
        for name, before, after in pairs:
            for forms in [None, [], ["quotes"], ["unknown"]]:
                policy = None if forms is None else AuthorEditPolicy(source_sha256=hashlib.sha256(before.encode()).hexdigest(), allowed_punctuation_forms=frozenset(forms))
                restoration.append({"id": f"{name}/{forms}", "before": before, "after": after,
                                    "allowed_punctuation_forms": forms,
                                    "output": restore_incidental_punctuation(before, after, edit_policy=policy)})
        assert "app.common.config" not in sys.modules
        return {"format_version": 1, "suite": "p1-punctuation", "python": sys.version.split()[0], "sources": sources,
                "isolation": {"normal_domain_imports": True, "domain_io": "audit-denied", "network": "audit-denied",
                              "settings_imported": False, "audit_self_tests": ["author-read", "network", "write"]},
                "canonical": canonical, "dialogue": dialogue, "restoration": restoration}
