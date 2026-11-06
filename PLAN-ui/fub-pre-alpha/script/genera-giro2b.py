# Genera stati-giro2b.json: la seconda infornata del secondo giro (PDF,
# risultati del foglio, lanciatore vuoto, componenti, due riquadri rifatti).
import json

F = ["cornice", "banda", "modo"]
FV = F + ["via"]
G = ["cornice", "testataFile", "kitRibbon", "modo", "via"]
P = ["cornice", "testataFile", "pdfBarra", "kitBar", "modo", "via"]
out = []


def add(id, scena, mods, stretta=False, **kw):
    e = {"id": id, "scena": scena, "mods": mods, **kw}
    out.append(e)
    if stretta:
        d = dict(e)
        d["id"] = id + "-700"
        d["dopo"] = 700
        d["modsDopo"] = [m for m in ["kitRibbon", "kitBar"] if m in mods] + ["modo"]
        out.append(d)


add("g2-due-riquadri", "g2-due-riquadri", ["nota", "pdfBarra", "kitBar", "modo"], True)
for s in ["cerca", "nessuno", "miniature", "due", "scuro"]:
    add(f"g2-pdf-{s}", f"g2-pdf-{s}", P, s == "cerca")
add("g2-foglio-risultato-carica", "grid-result-loading", G)
add("g2-foglio-risultato-errore", "grid-result-error", G)
add("g2-foglio-risultato-molti", "grid-result-many", G)
add("g2-foglio-scrive", "grid-editing", G)
add("g2-lanciatore-vuoto", "launcher-empty", F)
add("g2-lanciatore-comandi", "launcher-commands", F)
add("g2-conferma-pericolo", "confirm-danger", F)
add("g2-filo-titoli", "heading-thread", ["nota", "modo"])
for s in ["spegni", "orfani", "cerca"]:
    add(f"g2-comp-{s}", f"g2-comp-{s}", FV)
add("g2-nuovo", "g2-nuovo", F)
add("g2-rinomina", "g2-rinomina", F)

with open("stati-giro2b.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(out))
