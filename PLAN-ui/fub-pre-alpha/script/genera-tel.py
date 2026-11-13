# Genera stati-tel.json: le versioni al telefono (mobile.html, 390×844) delle
# scene del computer. La cornice del telefono è quella di S2 «provvisoria»
# (mods M); gli editor aggiungono la testata del file e la barra del kit.
# Una scena che al telefono non si prepara resta senza cattura sua: il
# simulatore le dà lo stato del telefono più vicino e lo dice.
import json

M = ["testata", "schede", "senzaAvvisi", "modo"]
E = M + ["testataFile", "kitRibbon"]
B = M + ["testataFile", "kitBar"]
out = []


def add(id, scena, mods, **kw):
    out.append({"id": id, "scena": scena, "mods": mods, "telefono": True, **kw})


add("t-menu", "startup", M + ["clicca"], clicca=["#brand-menu"])
add("t-vault", "startup", M + ["clicca"], clicca=["#vault-chip"])
add("t-attivita", "activity", M)
add("t-impostazioni", "settings", M)
add("t-aspetto", "prefs-appearance", M)
add("t-componenti", "settings-components", M)
add("t-imp-vault", "settings-vault", M)
add("t-imp-info", "g2-imp-info", M)
add("t-cestino", "g2-cestino", M, cassetto=True)
add("t-cestino-vuoto", "g2-cestino-vuoto", M, cassetto=True)
add("t-non-salvata", "g2-non-salvata", M)
add("t-salvataggio-fallito", "g2-salvataggio-fallito", M)
add("t-bozza", "g2-bozza", M + ["datiNota"])
add("t-conflitto", "mobile-startup", M + ["datiNota", "conflitto"])
add("t-conferma", "confirm", M)
add("t-conferma-pericolo", "confirm-danger", M)
add("t-ricerca", "search", M, cassetto=True)
add("t-grafo", "graph", M)
add("t-pdf", "g2-pdf-cerca", B + ["pdfBarra"])
add("t-pdf-nessuno", "g2-pdf-nessuno", B + ["pdfBarra"])
add("t-disegno", "draw-open", B, modo="drawing")
add("t-disegno-selezione", "draw-selection", B, modo="drawing")
add("t-lavagna", "proto-lavagna", M)
add("t-foglio-selezione", "grid-selection", E)
add("t-foglio-comandi", "grid-commands", E)
add("t-foglio-risultato", "grid-result-table", E)
add("t-foglio-errore", "grid-result-error", E)
add("t-foto", "photo-xmp", M + ["testataFile"])
add("t-nota-pdf", "nota-pdf", M)
add("t-vuoto", "empty", M)
add("t-nuovo-vault", "new-vault-profile", M)
add("t-toast", "toast", M)
add("t-avvisi", "notices", M)
add("t-nuovo", "g2-nuovo", M)
add("t-rinomina", "g2-rinomina", M)
add("t-comp-spegni", "g2-comp-spegni", M)
add("t-craft", "craft-peso", M + ["testataFile"])
add("t-concentrazione", "concentration", M)
add("t-schede", "tabs", M)
add("t-lettura", "reading", M)
add("t-sorgente", "source", M)
add("t-doc-tab", "document-docx", E, modo="page", clicca=[".pane.focus .kit-ribbon-tabs .kit-tab >> nth=1"])

with open("stati-tel.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(out))
