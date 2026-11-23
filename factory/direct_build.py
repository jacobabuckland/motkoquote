#!/usr/bin/env python3
"""Direct builder: one structured Ollama call that returns whole files.

Used when FACTORY_BUILDER_MODE=direct. Small models are often much better at
"here is the code, return the new file contents" than at driving an agent's
tool calls. Standard library only.
"""
from __future__ import annotations

import argparse
import fnmatch
import glob
import json
import os
import sys
import urllib.request

MAX_FILE_CHARS = 40_000
MAX_TOTAL_CHARS = 90_000

SYSTEM = """You are BUILDER, a precise code generator in an automated software factory.
You receive a ticket and the current contents of relevant files.
Return the COMPLETE new contents of every file you create or change. Only use paths from
"Allowed files". Write complete, working code: no placeholders, no TODOs, no elided sections.
If there is a "Review feedback" section, fix every point in its latest block.
Respond only with JSON matching the schema."""

SCHEMA = {
    "type": "object",
    "properties": {
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["files", "notes"],
}


def section_items(md: str, heading: str) -> list[str]:
    items, on = [], False
    for line in md.splitlines():
        s = line.rstrip()
        if s == f"## {heading}":
            on = True
            continue
        if on and s.startswith("## "):
            break
        if on and s.lstrip().startswith(("- ", "* ")):
            item = s.lstrip()[2:].replace("`", "").strip()
            if item:
                items.append(item)
    return items


def safe_rel(root: str, rel: str) -> str | None:
    if os.path.isabs(rel):
        return None
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(os.path.realpath(root) + os.sep):
        return None
    return full


def expand(root: str, patterns: list[str]) -> tuple[list[str], list[str]]:
    """Returns (concrete paths, glob patterns). Existing matches of globs become concrete."""
    concrete, globs = [], []
    for p in patterns:
        if any(c in p for c in "*?["):
            globs.append(p)
            for m in sorted(glob.glob(os.path.join(root, p), recursive=True)):
                if os.path.isfile(m):
                    concrete.append(os.path.relpath(m, root))
        else:
            concrete.append(p)
    return list(dict.fromkeys(concrete)), globs


def allowed(path: str, concrete: list[str], globs: list[str]) -> bool:
    return path in concrete or any(fnmatch.fnmatch(path, g) for g in globs)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--worktree", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--url", default="http://localhost:11434")
    ap.add_argument("--ctx", type=int, default=40960)
    a = ap.parse_args()

    task_md = open(a.task, encoding="utf-8").read()
    root = a.worktree
    allow_concrete, allow_globs = expand(root, section_items(task_md, "Allowed files"))
    context, _ = expand(root, section_items(task_md, "Context files"))
    if not allow_concrete and not allow_globs:
        print("ERROR: task has no Allowed files", file=sys.stderr)
        return 1

    parts, total = [], 0
    for rel in list(dict.fromkeys(context + allow_concrete)):
        full = safe_rel(root, rel)
        if not full or not os.path.isfile(full):
            continue
        text = open(full, encoding="utf-8", errors="replace").read()[:MAX_FILE_CHARS]
        if total + len(text) > MAX_TOTAL_CHARS:
            parts.append(f"### {rel}\n(omitted: context budget reached)")
            continue
        total += len(text)
        parts.append(f"### {rel}\n```\n{text}\n```")
    new_files = [p for p in allow_concrete if not os.path.exists(os.path.join(root, p))]

    user = (
        f"# Ticket\n{task_md}\n\n# Current files\n" + ("\n\n".join(parts) or "(none)") +
        (f"\n\n# Files that do not exist yet (create if needed)\n" + "\n".join(new_files) if new_files else "")
    )
    payload = {
        "model": a.model,
        "stream": False,
        "think": False,
        "format": SCHEMA,
        "options": {"num_ctx": a.ctx, "temperature": 0.2},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    }
    req = urllib.request.Request(
        a.url.rstrip("/") + "/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    print(f"direct builder: model={a.model} prompt_chars={len(user)}")
    with urllib.request.urlopen(req, timeout=3600) as r:
        resp = json.loads(r.read())
    raw = resp.get("message", {}).get("content", "")
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        print("ERROR: model did not return valid JSON. Raw output:\n" + raw[:4000], file=sys.stderr)
        return 1

    written = 0
    for f in out.get("files", []):
        rel = os.path.normpath(str(f.get("path", "")).strip())
        full = safe_rel(root, rel)
        if not full or not allowed(rel, allow_concrete, allow_globs):
            print(f"REFUSED (not in Allowed files): {rel}")
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(f.get("content", ""))
        written += 1
        print(f"wrote {rel}")
    print(f"notes: {out.get('notes', '')}")
    print(f"files written: {written}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
