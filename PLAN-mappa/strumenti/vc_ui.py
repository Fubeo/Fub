"""Estrae i comandi dell'interfaccia di VectorCraft (UI_COMMANDS in
crates/ui-egui/src/menus/ui_commands.rs) senza compilarlo.
Uso: python3 -I vc_ui.py <vectorcraft_root> <out.json>"""
import re,sys,json,os
root=sys.argv[1]
src=open(os.path.join(root,"crates/ui-egui/src/menus/ui_commands.rs")).read()
start=src.index("pub const UI_COMMANDS")
body=src[start:]
# find end of the array: line "];" at col 0
end=body.index("\n];")
body=body[:end]
# tokenize tuples
def strlit(s,i):
    # s[i]=='"' ; return (value, newi)
    j=i+1; out=[]
    while s[j]!='"':
        if s[j]=='\\': out.append(s[j:j+2]); j+=2
        else: out.append(s[j]); j+=1
    return "".join(out), j+1
items=[];i=body.index("[",body.index("="))+1
while True:
    k=body.find("(",i)
    if k<0: break
    # parse 4 elements
    j=k+1; vals=[]
    while len(vals)<4:
        while body[j] in " \n\t,": j+=1
        if body[j]=='"':
            v,j=strlit(body,j); vals.append(v)
        else:
            m=re.match(r"[A-Za-z_:][A-Za-z0-9_:]*",body[j:]); vals.append("CONST:"+m.group(0)); j+=m.end()
    j=body.index(")",j)
    items.append(vals); i=j+1
# resolve consts
def resolve(c):
    path=c[6:].split("::")
    if path[0]=="crate": path=path[1:]
    name=path[-1]; mod=path[:-1]
    cands=[os.path.join(root,"crates/ui-egui/src",*mod)+".rs", os.path.join(root,"crates/ui-egui/src",*mod,"mod.rs")]
    for f in cands:
        if os.path.exists(f):
            t=open(f).read()
            m=re.search(r"pub const "+name+r":\s*&str\s*=\s*\"([^\"]+)\"",t)
            if m: return m.group(1)
            m=re.search(r"pub (?:use|const) .*"+name,t)
    # grep fallback
    for dp,dn,fn in sorted(os.walk(os.path.join(root,"crates"))):
        for f in sorted(fn):
            if f.endswith(".rs"):
                t=open(os.path.join(dp,f)).read()
                if "pub const "+name in t:
                    m=re.search(r"pub const "+name+r":\s*&str\s*=\s*\"([^\"]+)\"",t)
                    if m and all(p in dp+"/"+f for p in mod[-1:]): return m.group(1)
    return c
out=[]
for v in items:
    i=v[0] if not v[0].startswith("CONST:") else resolve(v[0])
    out.append({"id":i,"label":v[1],"shortcut":v[2],"params":v[3]})
json.dump(out,open(sys.argv[2],"w"),indent=0,ensure_ascii=False)
print(len(out), sum(1 for o in out if o["id"].startswith("CONST:")))
for o in out:
    if o["id"].startswith("CONST:"): print(o["id"])
