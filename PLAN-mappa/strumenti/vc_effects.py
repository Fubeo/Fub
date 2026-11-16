"""Estrae il catalogo degli effetti di VectorCraft dal sorgente (senza compilarlo).
Uso: python3 -I vc_effects.py <vectorcraft_root> <out.json>"""
import json, os, re, sys
root, out = sys.argv[1], sys.argv[2]
src = os.path.join(root, "crates/effects/src")
texts = {}
for d, _, fs in sorted(os.walk(src)):
    for f in sorted(fs):
        if f.endswith(".rs"):
            p = os.path.join(d, f)
            texts[p] = open(p, encoding="utf-8").read()
allsrc = "\n".join(texts.values())
strc = dict(re.findall(r'(?:pub(?:\([a-z]+\))? )?const ([A-Z0-9_]+): &str = "([^"]*)"', allsrc))
menuc = {}
for name, body in re.findall(r'const ([A-Z0-9_]+): &\[&str\] = &\[([^\]]*)\]', allsrc):
    menuc.setdefault(name, re.findall(r'"([^"]*)"', body))
def rid(tok):
    tok = tok.strip()
    if tok.startswith('"'):
        return tok.strip('"')
    return strc.get(tok.split("::")[-1], tok)
def rmenu(tok, local):
    tok = tok.strip()
    if tok.startswith("&["):
        return re.findall(r'"([^"]*)"', tok)
    return local.get(tok, menuc.get(tok, [tok]))
res = []
call = re.compile(r'\b([gre]|entry)\(\s*([A-Za-z0-9_:]+|"[^"]*"),\s*"((?:[^"\\]|\\.)*)",\s*(&\[[^\]]*\]|[A-Z][A-Z0-9_]*)?')
for p, t in texts.items():
    local = {n: re.findall(r'"([^"]*)"', b) for n, b in re.findall(r'const ([A-Z0-9_]+): &\[&str\] = &\[([^\]]*)\]', t)}
    for m in call.finditer(t):
        kind, idt, label, menu = m.groups()
        if idt in ("id",):
            continue
        if kind in ("e", "entry"):
            menu_l = local.get("MENU", ["?"])
        else:
            menu_l = rmenu(menu, local) if menu else ["?"]
        res.append({"id": rid(idt), "label": label, "menu": menu_l, "raster": kind == "r", "file": os.path.relpath(p, root)})
for p2, t2 in texts.items():
    for idt, label, menu in re.findall(r'EffectInfo \{\s*id: ([A-Za-z0-9_:]+|"[^"]*"),\s*label: "([^"]*)",\s*menu: (&\[[^\]]*\])', t2):
        res.append({"id": rid(idt), "label": label, "menu": re.findall(r'"([^"]*)"', menu), "raster": False, "file": os.path.relpath(p2, root)})
for s, label in re.findall(r'\("([a-zA-Z]+)", "([^"]+…)"\)', texts[os.path.join(src, "catalog.rs")].split("WARP_STYLES")[1].split("];")[0]):
    res.append({"id": "warp." + s, "label": label, "menu": ["Effect", "Warp"], "raster": False, "file": "crates/effects/src/catalog.rs"})
for i, label in re.findall(r'\("(pathfinder\.[a-zA-Z]+)", "([^"]+)", PathfinderOp', allsrc):
    res.append({"id": i, "label": label, "menu": ["Effect", "Pathfinder"], "raster": False, "file": "crates/effects/src/group.rs"})
seen, uniq = set(), []
for r in res:
    if r["id"] in seen or not re.match(r'^[a-zA-Z][\w.]*$', r["id"]):
        continue
    seen.add(r["id"]); uniq.append(r)
json.dump(uniq, open(out, "w"), ensure_ascii=False, indent=0)
import collections
print(len(uniq), collections.Counter(" › ".join(r["menu"][1:2]) for r in uniq).most_common())
