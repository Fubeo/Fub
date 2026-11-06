# Genera stati-giro2.json: le catture del secondo giro del simulatore.
import json

F = ["cornice", "banda", "modo"]
FV = F + ["via"]
N = ["nota", "modo"]
G = ["cornice", "testataFile", "kitRibbon", "modo", "via"]
D = ["cornice", "banda", "testataFile", "kitRibbon", "modo", "clicca", "via"]
W = ["cornice", "banda", "testataFile", "kitBar", "modo", "clicca", "via"]
M = ["testata", "schede", "senzaAvvisi", "modo"]
C = ["cornice", "testataFile", "modo", "via"]
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


add("g2-menu", "menu", F, True)
add("g2-vault", "vault-chip", F, True)
add("g2-attivita", "activity", FV, True)
for n in range(4):
    add(f"g2-ispettore-{n}", f"g2-ispettore-{n}", N)
add("g2-ispettore-chiuso", "g2-ispettore-chiuso", N)
for s in ["editor", "vault", "diagnostica", "profili", "tasti"]:
    add(f"g2-imp-{s}", f"g2-imp-{s}", FV)
add("g2-imp-info", "g2-imp-info", FV, True)
add("g2-menu-riquadro", "g2-menu-riquadro", N)
add("g2-due-riquadri", "g2-due-riquadri", N, True)
add("g2-live-lettura", "g2-live-lettura", N)
add("g2-trascina", "g2-trascina", N)
add("g2-nuovo", "g2-nuovo", F)
add("g2-rinomina", "g2-rinomina", F)
add("g2-cestino", "g2-cestino", FV, True)
add("g2-cestino-vuoto", "g2-cestino-vuoto", FV)
add("g2-non-salvata", "g2-non-salvata", N, True)
add("g2-salvataggio-fallito", "g2-salvataggio-fallito", N, True)
B = ["corniceConAvvisi", "banda", "datiNota", "modo", "via"]
add("g2-bozza", "g2-bozza", B, True)
add("g2-bozza-divergente", "g2-bozza-divergente", B)
add("g2-conflitto-lettura", "proto-nota", ["notaIn", "modo", "conflitto"], True, modoNota="reading")
add("g2-compatta", "compact", FV)
add("g2-stretta", "narrow", FV)
add("g2-stretta-cassetto", "narrow-drawer", F)
add("g2-tema", "prefs-theme-settings", FV)
add("g2-app-esterne", "settings-external-apps", FV)
add("g2-titolo-rinomina", "title-rename", F)
add("g2-conferma", "confirm", F)
add("g2-lanciatore-anteprima", "launcher-preview", F)
add("g2-lanciatore-cerca", "launcher-search", F)
for sc in [
    "grid-selection", "grid-formula", "grid-resize", "grid-command-form", "grid-ribbon-table",
    "grid-ribbon-keytips", "grid-ribbon-open", "grid-ribbon-palette", "grid-ribbon-collapsed",
    "grid-ribbon-readonly", "grid-commands-context-off", "grid-commands-table", "grid-commands-readonly",
    "grid-result-table", "grid-result-empty",
]:
    add("g2-" + sc.replace("grid-", "foglio-"), sc, G)
for k, nome in enumerate(["inserisci", "layout", "formule", "dati", "revisione", "visualizza"], 1):
    add(f"g2-foglio-tab-{nome}", "proto-foglio", G[:-1] + ["clicca", "via"],
        clicca=[f".pane.focus .kit-ribbon-tabs .kit-tab >> nth={k}"])
add("g2-foglio-secondo", "proto-foglio", G[:-1] + ["clicca", "via"],
    clicca=['.pane.focus .kit-tabs[aria-label="Fogli"] .kit-tab >> nth=1'])
for k, nome in enumerate(["inserisci", "disegna", "layout", "revisione", "visualizza"], 1):
    add(f"g2-doc-tab-{nome}", "document-docx", D, modo="page",
        clicca=[f".pane.focus .kit-ribbon-tabs .kit-tab >> nth={k}"])
add("g2-doc-prestato", "docx-due-righe", ["cornice", "banda", "testataFile", "modo", "via"])
for t in ["Penna", "Gomma", "Rettangolo", "Mano"]:
    add(f"g2-disegno-{t.lower()}", "draw-open", W, modo="drawing",
        clicca=[f'.pane.focus .kit-rail .draw-tool[aria-label="{t}"]'])
add("g2-foto-senza", "photo-senza-xmp", C)
add("g2-raw-girato", "raw-girato", C)
add("g2-raw-senza", "raw-senza", C)
add("g2-nota-pdf-senza", "nota-pdf-senza", FV)
add("g2-craft-peso", "craft-peso", C)
add("g2-craft-fallita", "craft-fallita", C)
add("g2-tel-doc-pannello", "mobile-document-panel", M + ["testataFile", "kitRibbon"])
add("g2-tel-foglio-aperto", "mobile-grid-ribbon-open", M + ["testataFile", "kitRibbon"])
add("g2-tel-sdraiato", "mobile-landscape", M)

with open("stati-giro2.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(out))
