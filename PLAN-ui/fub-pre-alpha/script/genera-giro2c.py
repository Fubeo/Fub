# Genera stati-giro2c.json: le catture del secondo giro rifatte dopo i provini
# (i menu si aprono dopo i mods, che li richiuderebbero).
import json

F = ["cornice", "banda", "modo"]
N = ["nota", "modo"]
out = []


def add(id, scena, mods, **kw):
    out.append({"id": id, "scena": scena, "mods": mods, **kw})


MENU = ["#brand-menu", "#app-menu > button >> nth=0"]
add("g2-menu", "startup", F + ["clicca"], clicca=MENU)
add("g2-menu-700", "startup", F + ["clicca"], clicca=MENU, larghezza=700)
add("g2-vault", "startup", F + ["clicca"], clicca=["#vault-chip"])
add("g2-vault-700", "startup", F + ["clicca"], clicca=["#vault-chip"], larghezza=700)
add("g2-menu-riquadro", "g2-menu-riquadro", N + ["clicca"], clicca=[".pane.focus [data-pane-menu]"])
add("g2-cestino-700", "g2-cestino-stretto", F)
add("g2-comp-spegni", "g2-comp-spegni", F + ["via"])
add("g2-comp-orfani", "g2-comp-orfani", F + ["via"])

with open("stati-giro2c.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(out))
