#!/usr/bin/env bash
# Run from inside the github-site folder:  bash download-images.sh   (needs python3 + curl)
cd "$(dirname "$0")"
python3 - <<'PY'
import json, os, subprocess
items = json.load(open("image-manifest.json", encoding="utf-8"))
ok = 0
for i, it in enumerate(items, 1):
    p = it["path"]; os.makedirs(os.path.dirname(p), exist_ok=True)
    if os.path.exists(p): ok += 1; continue
    r = subprocess.run(["curl", "-fsSL", "-A", "Mozilla/5.0", "-o", p, it["url"]])
    if r.returncode == 0: ok += 1; print(f"[{i}/{len(items)}] OK  {p}")
    else: print(f"[{i}/{len(items)}] FAIL {it['url']}")
print(f"Done: {ok} of {len(items)} images saved.")
PY