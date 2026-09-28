"""Bundle a header tree into {"<relative path>": "<contents>"} JSON."""
import json, os, sys

root, out = sys.argv[1], sys.argv[2]
files = {}
for d, _, names in os.walk(root):
    for n in sorted(names):
        p = os.path.join(d, n)
        with open(p, encoding="utf-8", errors="replace") as f:
            files[os.path.relpath(p, root)] = f.read()
with open(out, "w") as f:
    json.dump(files, f, separators=(",", ":"), sort_keys=True)
print(f"{len(files)} headers -> {out}")
