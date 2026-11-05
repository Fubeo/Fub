"""Estrae i comandi del motore di VectorCraft (le invocazioni di `cmd!` sotto crates/engine/src)
senza compilarlo. Uso: python3 -I vc_cmds.py <vectorcraft_root> <out.json>"""
import json, os, re, sys
root, out = sys.argv[1], sys.argv[2]
base = os.path.join(root, "crates/engine/src")
STR = r'"((?:[^"\\]|\\.)*)"'
RX = re.compile(r'cmd!\(\s*(query\s+)?' + STR + r'\s*,\s*' + STR + r'\s*,\s*\[([^\]]*)\]\s*,\s*(None|Some\(\s*' + STR + r'\s*\))\s*,\s*' + STR, re.S)
seen, res = set(), []
for d, _, fs in sorted(os.walk(base)):
    for f in sorted(fs):
        if not f.endswith(".rs"): continue
        p = os.path.join(d, f); src = open(p, encoding="utf-8").read()
        if "macro_rules! cmd" in src: src = src.split("pub(crate) use cmd;", 1)[-1]
        for m in RX.finditer(src):
            i = m.group(2)
            if i in seen: continue
            seen.add(i)
            res.append({"id": i, "label": m.group(3), "menu": re.findall(STR, m.group(4)), "shortcut": m.group(6),
                        "params": m.group(7), "query": bool(m.group(1)), "file": os.path.relpath(p, base)})
json.dump(res, open(out, "w"), ensure_ascii=False, indent=0)
print(len(res), "comandi")
