"""Read the existing receipt-keyed author-loop audit, never trust a client ACK."""
from __future__ import annotations

import json
import os
import re
import stat

from app.domains.agent_runs.fs.native_receipts import NativeWritebackBinding, raw_sha256
from app.domains.agent_runs.fs_safety import FsToolError, is_directory_link, scoped_target

HEADER = "<!-- storyforge-writeback-audit-v1 "
COMPLETE = "\n<!-- storyforge-writeback-audit-complete -->\n"
MAX_AUDIT_BYTES = 65536


def inspect_delivery_audit(binding: NativeWritebackBinding) -> bool:
    """Envelope/body integrity + exact receipt identity; not a new audit ledger.

    payloadHash is checked structurally, not reconstructed from UI summary/note.
    The Native receipt independently binds the actual before/after bytes. This
    proves the existing audit's durable presence, not literary review quality.
    """
    root = binding.canonical_root
    path = root / ".storyforge" / "author-loop" / f"{binding.identity.operation_id}.md"
    try:
        if binding.project_path.resolve(strict=True) != root:
            return False
        for candidate in (path.parent.parent, path.parent, path):
            scoped_target(root, candidate)
            if is_directory_link(candidate):
                return False
        if not stat.S_ISREG(path.stat().st_mode):
            return False
        with path.open("rb", buffering=0) as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                return False
            raw = stream.read(MAX_AUDIT_BYTES + 1)
        if len(raw) > MAX_AUDIT_BYTES:
            return False
        content = raw.decode("utf-8", errors="strict")
        first, separator, rest = content.partition("\n")
        if not separator or not first.startswith(HEADER) or not first.endswith(" -->") or not rest.endswith(COMPLETE):
            return False
        pairs = json.loads(first[len(HEADER):-4], object_pairs_hook=list)
        if not isinstance(pairs, list) or len(pairs) != 3:
            return False
        fields = dict(pairs)
        if set(fields) != {"operationId", "payloadHash", "bodyHash"}:
            return False
        body = rest[:-len(COMPLETE)]
        return (fields["operationId"] == binding.identity.operation_id
                and isinstance(fields["payloadHash"], str)
                and re.fullmatch(r"[0-9a-f]{64}", fields["payloadHash"]) is not None
                and fields["bodyHash"] == raw_sha256(body.encode("utf-8")))
    except (OSError, FsToolError, UnicodeError, ValueError, TypeError, RecursionError):
        return False
