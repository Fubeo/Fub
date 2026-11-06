# Genera piani-giro2.json: gli stati delle pagine di piano approvate che il
# simulatore compone nella cornice S2 (D4 = A).
import json

out = []


def tema(attr):
    return {"light": [{"clic": f'[{attr}="light"]'}], "dark": [{"clic": f'[{attr}="dark"]'}]}


LAV = tema("data-proto-theme")
DIS = tema("data-light")
RIC = {"light": [{"clic": '[data-group="theme"][data-value="light"]'}],
       "dark": [{"clic": '[data-group="theme"][data-value="dark"]'}]}
CEL = {"light": [{"scegli": ["#proto-luce", "chiara"]}], "dark": [{"scegli": ["#proto-luce", "scura"]}]}


def add(id, pagina, palco, passi, luci, misura, **kw):
    out.append({"id": id, "pagina": pagina, "palco": palco, "passi": passi, "luci": luci, "misura": misura, **kw})


# N6 T25, la lavagna con le schede (approvata il 2026-11-04).
VL = [912, 640]
for scena, modo in [("schede", "snapshot"), ("schede", "live"), ("schede", "selected"), ("schede", "active")]:
    add(f"p-lav-schede-{modo}", "lavagna-schede.html", "#proto-screen",
        [{"clic": f'[data-proto-scene="{scena}"]'}, {"clic": f'[data-proto-mode="{modo}"]'}], LAV, VL)
for scena in ["testate", "inchiostro", "maniglie", "mancante", "rilascio3", "rilascio47", "colori", "notifiche",
              "lontano", "lontanissimo"]:
    add(f"p-lav-{scena}", "lavagna-schede.html", "#proto-screen", [{"clic": f'[data-proto-scene="{scena}"]'}], LAV, VL)
add("p-lav-cinquecento", "lavagna-schede.html", "#proto-screen",
    [{"clic": '[data-proto-scene="cinquecento"]'}, {"clic": '[data-proto-zoom="0.1"]', "dopo": 1500}], LAV, VL, attesa=1500)
add("p-lav-impostazioni", "lavagna-schede.html", "#proto-settings",
    [{"clic": '[data-proto-scene="impostazioni"]'}], LAV, [760, 640])

# N4 T20, le penne della lavagna (approvata il 2026-11-02).
for stato in ["closed", "pen", "highlighter", "eraser", "custom", "mouse", "readonly"]:
    add(f"p-penne-{stato}", "lavagna-penne.html", "#proto-board", [{"clic": f'[data-proto-state="{stato}"]'}], LAV, VL,
        nascondi=[".canvas-toolbar"])
add("p-penne-settings", "lavagna-penne.html", "#proto-settings", [{"clic": '[data-proto-state="settings"]'}], LAV, [760, 640])

# Le celle dei fogli (griglia T1–T9).
for stato in ["riposo", "intervallo", "oltre", "editor", "misura", "riempimento", "copiata", "tagliata"]:
    add(f"p-celle-{stato}", "celle-griglia.html", ".grid-surface", [{"scegli": ["#proto-stato", stato]}], CEL, [960, 600],
        nascondi=[".proto-sheets"])

# K5 T25, il disegno sul motore (approvata il 2026-11-05).
VD = [968, 760]
for st in ["1", "2a", "2b", "3", "4", "5", "6a", "6b", "7a", "7b"]:
    add(f"p-dis-{st}", "disegno-motore.html", '.proto-frame[data-view="draw"]', [{"clic": f'[data-state="{st}"]', "dopo": 600}], DIS, VD)
for tool in ["hand", "pen", "eraser", "rect"]:
    add(f"p-dis-strumento-{tool}", "disegno-motore.html", '.proto-frame[data-view="draw"]',
        [{"clic": '[data-state="1"]'}, {"clic": f'.proto-frame[data-view="draw"] [data-slot="{tool}"]', "dopo": 600}], DIS, VD)
for st in ["8a", "8b", "8c"]:
    add(f"p-dis-{st}", "disegno-motore.html", '.proto-frame[data-view="settings"]', [{"clic": f'[data-state="{st}"]', "dopo": 600}], DIS, [1000, 700])

# A1 T12, le ricette (approvata il 2026-11-03).
SEZ = ["piena", "vuota", "problemi", "carica", "errore", "cinquecento"]
for s in SEZ:
    add(f"p-ricette-{s}", "ricette.html", ".proto-settings",
        [{"clic": '[data-group="toast"][data-value="no"]'}, {"clic": f'[data-group="section"][data-value="{s}"]'}], RIC, [760, 640],
        nascondi=[f'[data-proto-section]:not([data-proto-section="{s}"])'])
for d in ["aperta", "prova", "prova-errore", "nessuna-nota", "venti", "cambiata"]:
    add(f"p-ricette-dialogo-{d}", "ricette.html", "#stage",
        [{"clic": '[data-group="toast"][data-value="no"]'}, {"clic": f'[data-group="dialog"][data-value="{d}"]', "dopo": 500}], RIC, [1280, 800],
        mostra=["#scrim"], trasparente=True)
add("p-ricette-avviso", "ricette.html", "#stage", [{"clic": '[data-group="toast"][data-value="si"]'}], RIC, [1280, 800],
    mostra=["#toasts"], trasparente=True)

with open("piani-giro2.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(out))
