"""Genera PLAN-mappa/mappa.tsv: ogni funzione di VectorCraft (rev cfb30d81) con famiglia,
fase, task di PLAN.md, posto in Fub, unità pigra e nota. Ingressi: i JSON estratti dal sorgente
(vc-cmds.json, vc-ui.json, vc-effects.json) e il catalogo degli strumenti.
Uso: python3 -I mappa.py <vectorcraft_root> <dir_json> <out.tsv>"""
import json, os, re, sys, collections
root, dj, out = sys.argv[1], sys.argv[2], sys.argv[3]
cmds = json.load(open(os.path.join(dj, "vc-cmds.json")))
ui = json.load(open(os.path.join(dj, "vc-ui.json")))
fx = json.load(open(os.path.join(dj, "vc-effects.json")))

# famiglia -> (fase, scheda dell'ispettore o posto di ripiego). «ispettore/design/documento»
# è la sezione Documento di Design, che si vede quando non è scelto niente.
FAM = {
 "nucleo": ("F1", "tavolozza"), "tracciati": ("F1", "ispettore/design"), "forme": ("F1", "ispettore/design"),
 "trasforma": ("F1", "ispettore/design"), "colore": ("F1", "ispettore/design"), "aspetto": ("F1", "ispettore/design"),
 "livelli": ("F1", "ispettore/livelli"), "vista": ("F1", "menu/visualizza"),
 "testo": ("F2", "ispettore/design"), "pennelli": ("F2", "ispettore/risorse"), "dinamici": ("F2", "menu/oggetto"),
 "effetti": ("F2", "menu/effetto"), "tavole": ("F2", "ispettore/design/documento"), "pulizia": ("F2", "menu/oggetto"),
 "trame": ("F2", "ispettore/design"),
 "raster": ("F3", "menu/effetto"), "tre-d": ("F3", "menu/effetto"), "immagini": ("F3", "ispettore/design"),
 "simboli": ("F3", "ispettore/risorse"), "web": ("F3", "ispettore/design/documento"), "formati": ("F3", "menu/file"),
 "prospettiva": ("F4", "colonna"), "grafici": ("F4", "colonna"), "stampa": ("F4", "menu/file"),
 "dati": ("F4", "ispettore/design/documento"), "automazione": ("F4", "menu/file"),
 "fub": ("—", "fub"), "escluso": ("—", "escluso"),
}
NS = {  # primo segmento dell'id -> famiglia
 "path": "tracciati", "shape": "forme", "shaper": "forme", "shapeBuilder": "forme",
 "paint": "colore", "swatch": "colore", "color": "colore", "colorTheme": "colore", "recolor": "colore", "eyedropper": "colore",
 "appearance": "aspetto", "graphicStyle": "aspetto", "transparency": "aspetto", "stroke": "aspetto", "gradient": "aspetto",
 "layer": "livelli", "select": "livelli", "magicWand": "livelli", "node": "livelli",
 "view": "vista", "text": "testo", "type": "testo", "brush": "pennelli", "effect": "effetti",
 "artboard": "tavole", "guide": "tavole", "dimension": "tavole", "pattern": "trame", "livePaint": "trame",
 "imageTrace": "immagini", "image": "immagini", "links": "immagini", "symbol": "simboli", "library": "simboli",
 "svgInteractivity": "web", "css": "web", "webExport": "web", "slice": "web", "assets": "web",
 "file": "formati", "pdf": "formati", "importMatches": "formati", "perspective": "prospettiva", "graph": "grafici",
 "print": "stampa", "flattener": "stampa", "variable": "dati", "dataset": "dati", "attributes": "dati", "docInfo": "dati",
 "plugin": "automazione", "script": "automazione", "action": "automazione", "command": "automazione",
 "clipboard": "nucleo", "edit": "nucleo", "prefs": "fub", "shortcutSet": "fub", "shortcuts": "fub", "help": "escluso",
 "align": "trasforma", "pathfinder": "forme", "tool": "nucleo", "toolbar": "fub", "app": "fub",
}
OBJ = [  # object.<x> -> famiglia
 (r"object\.(align|distribute|move|nudge|rotate|reflect|scale|shear|transform|setBounds|resetBoundingBox|puppetWarp|distort|makePixelPerfect)", "trasforma"),
 (r"object\.(arrange|group|ungroup|lock|hide|showAll|unlockAll|isolate|exitIsolation|setProps)", "nucleo"),
 (r"object\.(blend|envelope|repeat|intertwine|objectsOnPath)", "dinamici"),
 (r"object\.(clippingMask|compoundPath|path|expand\b|expand$|outline)", "tracciati"),
 (r"object\.(compoundShape|pathfinder|shape|setLiveShape|expandShape)", "forme"),
 (r"object\.(convertDocumentColorMode|setOverprint|flattenTransparency|createTrimMarks)", "stampa"),
 (r"object\.(createObjectMosaic|cropImage|maskImage|rasterize|vectorHalftone)", "immagini"),
 (r"object\.(expandBrush|liquify)", "pennelli"), (r"object\.(mesh|pattern)", "trame"),
 (r"object\.slice", "web"), (r"object\.textWrap", "testo"),
]
ADDON = {"arrange": "trasforma", "cleanup": "pulizia", "color": "colore", "document": "pulizia", "pathtools": "tracciati", "pen": "tracciati", "path": "effetti"}
DOC = [
 (r"document\.(setup|setUnits|switchUnits|rulerOrigin|setRulerOrigin|resetRulerOrigin)$", "tavole"),
 (r"document\.(info)$", "dati"), (r"document\.activate$", "fub"), (r"document\.rasterEffectsSettings", "raster"),
 (r"document\.exportForWeb|document\.exportForScreens|document\.exportSettings|document\.exportPresets", "web"),
 (r"document\.(inspect|node|find|json)$", "nucleo"),
]
EDIT = [(r"edit\.colors", "colore"), (r"edit\.(colorSettings|assignProfile)", "stampa"), (r"edit\.(findReplace|findNext)", "testo"),
        (r"edit\.(preferences|keyboardShortcuts)", "fub")]
# formati pesanti: sotto-componente
FORMATI = re.compile(r"(pdf|eps|dxf|Dxf|Eps|Pdf|Emf|emf|affinity|cad|metafile|ForOffice)", re.I)
FUB = {  # equivalenti di Fub (nessun codice di VectorCraft servito)
 "file.new": "nuovo disegno di Fub (menu File, «Nuovo disegno…»)", "file.newFromTemplate": "modelli di Fub (`editors/spatial/templates`)",
 "file.close": "chiudere la scheda di Fub", "file.closeAll": "chiudere le schede di Fub", "file.revert": "Fub: torna alla versione salvata (versioni del kernel)",
 "document.open": "aprire dal vault (il motore non legge il disco)", "document.save": "il salvataggio di Fub (DocumentSession): il motore non scrive il disco",
 "file.saveAs": "Fub: Salva con nome del file del vault", "file.saveCopy": "Fub: Salva una copia nel vault", "file.recovery": "bozze e versioni del kernel",
 "file.list": "le schede aperte di Fub", "file.open": "aprire dal vault", "file.save": "il salvataggio di Fub (DocumentSession)",
 "file.reveal": "Mostra nella cartella di Fub", "file.recentFiles": "recenti di Fub", "file.clearRecent": "recenti di Fub",
 "file.newDialog": "nuovo disegno di Fub", "file.newWithoutDialog": "nuovo disegno di Fub", "file.info": "proprietà della nota di Fub",
 "window.brightness": "la luce di Fub (giorno/notte)", "window.nextDocument": "Vai › Scheda successiva", "window.previousDocument": "Vai › Scheda precedente",
 "window.newWindow": "Fub: nuova finestra della shell", "window.dock": "mostra o nascondi l'ispettore e il cassetto", "window.panels": "mostra o nascondi l'ispettore",
 "window.collapseDock": "l'ispettore di Fub", "window.control": "la testata del disegno", "window.toolbar": "la colonna del disegno",
 "window.toolbarColumns": "la colonna di Fub è una sola: il resto nel cassetto «Tutti gli strumenti»", "window.toolbarAdvanced": "lo spazio di lavoro Semplice/Completo",
 "window.floatTools": "niente gruppi fluttuanti: il cassetto «Tutti gli strumenti»", "window.editToolbar": "«Modifica la colonna» nel cassetto degli strumenti",
 "window.taskBar": "la barra contestuale diventa la fila delle opzioni della testata", "window.workspace": "gli spazi di lavoro del disegno (Semplice, Completo, per famiglia) e i workspace salvati di Fub",
 "window.panel": "le schede dell'ispettore di Fub", "app.language": "la lingua di Fub", "app.home": "il Benvenuto di Fub", "app.quit": "chiudere Fub",
 "edit.preferences": "Impostazioni › Disegno", "edit.keyboardShortcuts": "Impostazioni › Scorciatoie", "help.commandPalette": "la tavolozza dei comandi di Fub",
 "help.about": "Informazioni su Fub e THIRD_PARTY_NOTICES", "help.checkForUpdates": "gli aggiornamenti di Fub: il motore viaggia dentro Fub", "document.activate": "le schede di Fub", "toolbar": "la colonna del disegno, configurata dallo spazio di lavoro",
 "shortcuts": "Impostazioni › Scorciatoie (comandi del disegno inclusi)", "shortcutSet": "Impostazioni › Scorciatoie: importa un insieme (domanda D7)",
 "prefs": "Impostazioni › Disegno (le preferenze del motore come impostazioni di Fub)", "ui.menuDialog": "la tavolozza e il menu del disegno",
 "ui.dialogReset": "le finestre di Fub non ricordano posizioni", "ui.shortcutImportDialog": "Impostazioni › Scorciatoie",
}
ESCLUSO = {"help.discord": "link della comunità ArtCraft: Fub ha il suo Aiuto (D6)", "help.website": "link ad ArtCraft (D6)", "help.appPage": "link a getartcraft.com (D6)",
           "help.github": "link al GitHub di VectorCraft: il credito sta in Informazioni e THIRD_PARTY_NOTICES (D6)", "help.links": "elenco dei link sopra (D6)",
                      "window.panel.layout": "aggancio libero dei pannelli: Fub ha l'ispettore a schede (D6)", "window.panel.move": "aggancio libero (D6)",
           "window.panel.float": "pannelli fluttuanti (D6)", "window.panel.dock": "aggancio libero (D6)", "window.panel.collapse": "aggancio libero (D6)",
           "window.taskBar.pin": "la barra contestuale non si sposta: è la fila delle opzioni (D6)", "window.taskBar.reset": "come sopra (D6)"}
PANEL_TAB = {
 "Layers": "livelli", "Variables": "design/documento", "Pathfinder": "design", "Swatches": "risorse", "Transparency": "design", "Graphic Styles": "risorse",
 "Appearance": "design", "Artboards": "design/documento", "Swatch Libraries": "risorse", "Color Themes": "risorse", "Align": "design",
 "Graphic Style Libraries": "risorse", "Tabs": "fub", "Brush Libraries": "risorse", "Symbol Libraries": "risorse", "Gradient": "design",
 "Pattern Options": "design", "Magic Wand": "design", "Stroke": "design", "Brushes": "risorse", "Document Info": "design/documento", "Symbols": "risorse",
}
def famiglia(i, menu=None):
    p = i.split(".")
    if i in FUB or p[0] in ("toolbar", "shortcuts", "shortcutSet", "prefs", "app"): return "fub"
    if re.match(r"file\.(openRecent\d+$|recovery\.)", i): return "fub"
    if i in ESCLUSO or p[0] == "help": return "escluso" if i not in FUB else "fub"
    if p[0] == "object":
        for rx, f in OBJ:
            if re.match(rx, i): return f
        return "nucleo"
    if p[0] == "addon": return ADDON.get(p[1], "tracciati")
    if p[0] == "document":
        for rx, f in DOC:
            if re.match(rx, i): return f
        return "formati"
    if p[0] == "edit":
        for rx, f in EDIT:
            if re.match(rx, i): return f
        return "nucleo"
    if p[0] == "select" and len(p) > 1 and p[1] in ("all", "none", "inverse", "add", "toggle", "set", "reselect", "nextAbove", "nextBelow"): return "nucleo"
    if p[0] == "view":
        if p[1:2] and p[1] in ("guides",): return "tavole"
        if p[1:2] and p[1] in ("slices",): return "web"
        if p[1:2] and p[1] in ("overprintPreview", "separationsPreview", "proofColors", "proofSetup", "printTiling", "trimView", "videoRulers"): return "stampa"
        if p[1:2] and (p[1].startswith("goto") or p[1] in ("artboards", "goToArtboard", "fitArtboard")): return "tavole"
        if p[1:2] and p[1] in ("livePaintGaps",): return "trame"
        if p[1:2] and p[1] in ("textThreads", "snapToGlyph"): return "testo"
        if p[1:2] and p[1] in ("gradientAnnotator",): return "aspetto"
        return "vista"
    if p[0] == "window":
        n = p[1] if len(p) > 1 else ""
        if re.match(r"(user)?[bB]rushLibrary", n): return "pennelli"
        if re.match(r"(user)?[sS]watchLibrary", n): return "colore"
        if re.match(r"(user)?[sS]ymbolLibrary", n): return "simboli"
        if re.match(r"(user)?[gG]raphicStyleLibrary", n): return "aspetto"
        return "fub"
    if p[0] == "ui":
        n = p[1].lower()
        for k, f in [("perspective", "prospettiva"), ("brush", "pennelli"), ("Brush", "pennelli"), ("symbol", "simboli"), ("Symbol", "simboli"),
                     ("swatch", "colore"), ("Swatch", "colore"), ("color", "colore"), ("Color", "colore"), ("recolor", "colore"), ("spotColors", "colore"),
                     ("saturate", "colore"), ("graphicStyle", "aspetto"), ("GraphicStyle", "aspetto"), ("imageTrace", "immagini"), ("cropImage", "immagini"),
                     ("placement", "immagini"), ("findLinks", "immagini"), ("layer", "livelli"), ("Layer", "livelli"), ("Artboard", "tavole"),
                     ("charStyle", "testo"), ("CharStyle", "testo"), ("ParaStyle", "testo"), ("hyphenation", "testo"), ("justification", "testo"),
                     ("Fonts", "testo"), ("blend", "dinamici"), ("expand", "tracciati"), ("simplify", "tracciati"), ("smooth", "tracciati"),
                     ("corners", "forme"), ("widthPoint", "pennelli"), ("livePaint", "trame"), ("tileEdge", "trame"), ("flatten", "stampa"),
                     ("print", "stampa"), ("Print", "stampa"), ("rasterEffects", "raster"), ("effectGallery", "raster"), ("pdf", "formati"),
                     ("Pdf", "formati"), ("eps", "formati"), ("dxf", "formati"), ("package", "formati"), ("fileInfo", "dati"),
                     ("installPlugin", "automazione"), ("javascript", "automazione"), ("checkScript", "automazione"), ("actionSet", "automazione"),
                     ("batch", "automazione"), ("library", "simboli"), ("Library", "simboli"), ("paramDialog", "nucleo"), ("menuDialog", "fub"),
                     ("dialogReset", "fub"), ("shortcutImport", "fub"), ("sampleScreen", "colore")]:
            if k.lower() in n: return f
        return "nucleo"
    return NS.get(p[0], "nucleo")

def pigro(fam, i):
    if fam in ("fub", "escluso"): return "—"
    if fam == "automazione" and re.match(r"(plugin|ui\.installPlugin)", i): return "sotto:disegno-plugin"
    if fam == "automazione" and re.match(r"(script|ui\.checkScript|ui\.javascript)", i): return "sotto:disegno-script"
    if re.match(r"(document\.(export(Pdf|Eps|Dxf|ForOffice)|pdfInfo|dxfInfo|pdfSettings)|pdf\.|clipboard\.(import(Pdf|Eps|Emf)|exportPdf)|ui\.(eps|dxf|pdf|savePdf))", i):
        return "sotto:disegno-formati"
    # La stampa del motore passa dal crate del PDF (print.rs, printtiling.rs, printpresets.rs
    # chiamano vectorcraft_pdf), che la patch 0002 di K5 spegne: serve la stessa feature.
    if re.match(r"(file\.print$|file\.export\.pdf$|print\.(setup|preview|presets\.|tiling)|view\.printTiling$|printTiling$|ui\.printPreset)", i):
        return "sotto:disegno-formati"
    return "nucleo" if fam == "nucleo" else "famiglia"

TOP = {"Edit": "menu/modifica", "Object": "menu/oggetto", "Type": "menu/testo", "Select": "menu/selezione", "Effect": "menu/effetto",
       "View": "menu/visualizza", "File": "menu/file"}
def posto(fam, i, menu, query, label=""):
    if fam == "fub": return "fub"
    if fam == "escluso": return "escluso"
    if menu:
        if menu[0] == "Window":
            t = PANEL_TAB.get(menu[1] if len(menu) > 1 else "", None)
            return "ispettore/" + t if t and t != "fub" else FAM[fam][1]
        if menu[0] in TOP: return TOP[menu[0]]
    if query: return "interno"
    return FAM[fam][1]

rows = []
def add(fonte, i, label, menu, fam, pst, pg, nota=""):
    rows.append([fonte, i, label, " › ".join(menu or []), fam, FAM[fam][0], pst, pg, nota])

for c in cmds:
    fam = famiglia(c["id"], c["menu"])
    pst = posto(fam, c["id"], c["menu"], c["query"])
    nota = FUB.get(c["id"]) or FUB.get(".".join(c["id"].split(".")[:2])) or FUB.get(c["id"].split(".")[0]) or ESCLUSO.get(c["id"], "")
    if re.match(r"(select\.(set|add|toggle)|edit\.(undoGroup\.\w+|dropSelection)|object\.setProps)$", c["id"]):
        pst, nota = "interno", "lo usano la colonna, i gesti e l'ispettore: non è una voce"
    if re.match(r"object\.(isolate|exitIsolation)$", c["id"]): pst = "tasto-destro"
    if re.match(r"perspective\.grid\.", c["id"]) and not c["menu"]: pst = "menu/visualizza"
    elif re.match(r"perspective\.(attach|release)$", c["id"]) and not c["menu"]: pst = "menu/oggetto"
    elif c["id"].startswith("perspective.") and not c["menu"]: pst, nota = "interno", "lo usano gli strumenti della prospettiva: non è una voce"
    if c["id"].startswith("action."): pst = "ispettore/cronologia"
    if pst == "interno": nota = "lettura del motore: la usano l'ispettore, le finestre e i test, non è una voce"
    if label_ell := (c["label"] or "").endswith(("…", "...")): nota = (nota + "; " if nota else "") + "finestra"
    add("motore", c["id"], c["label"], c["menu"], fam, pst, pigro(fam, c["id"]), nota)
for c in ui:
    fam = famiglia(c["id"])
    i = c["id"]
    if i.startswith("ui."): pst = "finestra" if fam not in ("fub", "escluso") else ("fub" if fam == "fub" else "escluso")
    elif i.startswith("tool."): pst = "colonna"
    elif i.startswith(("view.goto", "view.setZoom", "view.zoom", "view.actualSize", "view.fit")): pst = "banda"
    elif i.startswith("view."): pst = "menu/visualizza"
    elif i.startswith("type."): pst = "menu/testo"
    elif i.startswith("select."): pst = "menu/selezione"
    elif i.startswith("align."): pst = "ispettore/design"
    elif i.startswith(("effect.", "pathfinder.")): pst = "menu/effetto" if i.startswith("effect.") else "ispettore/design"
    else: pst = posto(fam, i, None, False)
    m = re.match(r"(file\.openRecent|view\.goto|window\.user\w+Library|ui\.perspectiveUserPreset)(\d+)", i)
    nota = FUB.get(i) or FUB.get(".".join(i.split(".")[:2])) or FUB.get(i.split(".")[0]) or ESCLUSO.get(i, "")
    if i.startswith("file.openRecent"): nota = "recenti di Fub"
    if m: nota = (nota + "; " if nota else "") + "voce numerata: una sola voce che elenca, non " + m.group(1) + "N"
    if i.startswith("window.workspace"): fam, pst, nota = "fub", "fub", FUB["window.workspace"]
    if i.startswith("window.panel") and i not in ESCLUSO: fam, pst, nota = "fub", "fub", FUB["window.panel"]
    if i in ESCLUSO: fam, pst, nota = "escluso", "escluso", ESCLUSO[i]
    if i.startswith("window.taskBar") and i not in ESCLUSO: fam, pst, nota = "fub", "fub", FUB["window.taskBar"]
    add("interfaccia", i, c["label"], [], fam, pst, pigro(fam, i), nota)

tools = []
cat = open(os.path.join(root, "crates/tools/src/catalog.rs")).read().split("pub const TOOL_GROUPS")[1].split("= &[",1)[1].split("\n];")[0]
for gi, grp in enumerate(cat.split("&[")[1:]):
    for tid, lab in re.findall(r't\("([A-Za-z]+)", "([^"]+)"', grp):
        tools.append((tid, lab, gi))
addons = open(os.path.join(root, "crates/tools/src/addons.rs")).read()
ids = dict((m.group(1), m.group(2)) for m in re.finditer(r'pub const ID: &str = "(\w+)"', "".join(
    open(os.path.join(root, "crates/tools/src/addons", f)).read() for f in os.listdir(os.path.join(root, "crates/tools/src/addons")) if f.endswith(".rs"))) if False)
for lab in re.findall(r'ToolInfo \{ id: (\w+)::ID, label: "([^"]+)"', addons):
    tools.append((lab[0], lab[1], 99))
TF = [  # strumento -> famiglia
 ("selection|directSelection|groupSelection|lasso|hand|zoom|rotateView", "nucleo"), ("magicWand", "livelli"),
 ("pen|addAnchor|deleteAnchor|anchorPoint|curvature|pencil|smooth|pathEraser|join|scissors|knife|mirrorCut|lineCut|rectCut|eraser|anchor_eraser|extend_path|slide_anchor|smart_pen|shared_edge|corner_tool", "tracciati"),
 ("type|areaType|typeOnPath|verticalType|verticalAreaType|verticalTypeOnPath|touchType", "testo"),
 ("lineSegment|arc|spiral|rectangularGrid|polarGrid|rectangle|roundedRectangle|ellipse|polygon|star|flare|shaper|shapeBuilder|parametric_shape", "forme"),
 ("paintbrush|blobBrush|width|warp|twirl|pucker|bloat|scallop|crystallize|wrinkle", "pennelli"),
 ("rotate|reflect|scale|shear|reshape|freeTransform|puppetWarp", "trasforma"), ("livePaintBucket|livePaintSelection|mesh", "trame"),
 ("perspectiveGrid|perspectiveSelection", "prospettiva"), ("gradient|eyedropper", "colore"), ("measure|dimension|artboard|measure_inspect", "tavole"),
 ("blend|objectsOnPath", "dinamici"), ("symbol\\w+", "simboli"), ("\\w+Graph", "grafici"), ("slice|sliceSelection", "web"), ("printTiling", "stampa"),
]
RAIL = {"nucleo": "scegli", "livelli": "scegli", "tracciati": "disegna", "pennelli": "disegna", "forme": "forme", "testo": "testo",
        "trasforma": "trasforma", "colore": "colore", "trame": "colore", "tavole": "misura", "dinamici": "oggetti", "simboli": "oggetti",
        "grafici": "oggetti", "prospettiva": "prospettiva", "web": "misura", "stampa": "misura"}
primo = {}
for tid, lab, gi in tools: primo.setdefault(gi, tid)
for tid, lab, gi in tools:
    fam = next((f for rx, f in TF if re.fullmatch(rx, tid)), "nucleo")
    if tid in ("hand", "zoom", "rotateView"): rail = "vista"
    else: rail = RAIL[fam]
    slot = primo[gi] if gi != 99 else tid
    add("strumento", tid, lab, [], fam, "colonna/" + rail, pigro(fam, tid),
        "riquadro «" + slot + "»" + (" (aggiunta di VectorCraft)" if gi == 99 else ""))
for e in fx:
    m1 = e["menu"][1] if len(e["menu"]) > 1 else ""
    fam = "tre-d" if m1 == "3D and Materials" else "raster" if e["raster"] or e["id"] == "rasterize" else "stampa" if "crop" in e["id"].lower() and "Marks" in e["label"] else "effetti"
    add("effetto", e["id"], e["label"], e["menu"], fam, "menu/effetto", "famiglia", "anche in Design › Aspetto › «Aggiungi effetto»")
PANELS = {
 "actions": ("automazione", "ispettore/cronologia"), "align": ("trasforma", "ispettore/design"), "appearance": ("aspetto", "ispettore/design"),
 "artboards": ("tavole", "ispettore/design/documento"), "asset_export": ("web", "ispettore/design/documento"), "attributes": ("dati", "ispettore/design"),
 "blend": ("dinamici", "finestra"), "brushes": ("pennelli", "ispettore/risorse"), "character": ("testo", "ispettore/design"),
 "color": ("colore", "ispettore/design"), "color_guide": ("colore", "ispettore/design"), "color_themes": ("colore", "ispettore/risorse"),
 "css_properties": ("web", "ispettore/design/documento"), "doc_info": ("dati", "ispettore/design/documento"), "flattener_preview": ("stampa", "ispettore/design/documento"),
 "glyphs": ("testo", "ispettore/risorse"), "gradient": ("aspetto", "ispettore/design"), "graphic_styles": ("aspetto", "ispettore/risorse"),
 "history": ("nucleo", "ispettore/cronologia"), "image_trace": ("immagini", "ispettore/design"), "info": ("vista", "banda"),
 "layers": ("livelli", "ispettore/livelli"), "libraries": ("simboli", "ispettore/risorse"), "library_panel": ("simboli", "ispettore/risorse"),
 "links": ("immagini", "ispettore/risorse"), "magic_wand": ("livelli", "testata"), "memo": ("dati", "ispettore/design/documento"),
 "navigator": ("vista", "banda"), "opentype": ("testo", "ispettore/design"), "paragraph": ("testo", "ispettore/design"),
 "pathfinder": ("forme", "ispettore/design"), "pattern_options": ("trame", "ispettore/design"), "properties": ("nucleo", "ispettore/design"),
 "separations": ("stampa", "ispettore/design/documento"), "stroke": ("aspetto", "ispettore/design"), "svg_interactivity": ("web", "ispettore/design/documento"),
 "swatches": ("colore", "ispettore/risorse"), "symbols": ("simboli", "ispettore/risorse"), "tabs": ("fub", "fub"),
 "text_styles": ("testo", "ispettore/risorse"), "transform": ("trasforma", "ispettore/design"), "transparency": ("aspetto", "ispettore/design"),
 "variables": ("dati", "ispettore/design/documento"),
}
pdir = os.path.join(root, "crates/ui-egui/src/panels")
found = sorted(f[:-3] for f in os.listdir(pdir) if f.endswith(".rs") and f[:-3] in PANELS) if os.path.isdir(pdir) else sorted(PANELS)
for p in sorted(PANELS):
    fam, pst = PANELS[p]
    add("pannello", p, p.replace("_", " ").title(), ["Window"], fam, pst, "—" if fam == "fub" else ("nucleo" if fam == "nucleo" else "famiglia"),
        "le schede del documento sono le schede di Fub" if fam == "fub" else "")
# famiglia -> il task di PLAN.md che la porta (le ondate sono in PLAN.md).
TASK = {
 "nucleo": "T11", "vista": "T11", "tracciati": "T12", "forme": "T13", "trasforma": "T13", "colore": "T14",
 "aspetto": "T15", "livelli": "T15", "testo": "T16", "pennelli": "T17", "pulizia": "T17", "effetti": "T18",
 "tavole": "T19", "immagini": "T20", "trame": "T21", "dinamici": "T21", "web": "T22", "simboli": "T22",
 "formati": "T23", "raster": "T24", "tre-d": "T24", "stampa": "T25", "prospettiva": "T25", "grafici": "T25",
 "dati": "T26", "automazione": "T26", "escluso": "T2",
}
# Le righe «fub» vanno al task che tocca la parte di Fub che le fa già; le altre le verifica T2.
FUB = [(r"window\.workspace", "T7"), (r"(window\.(toolbar|editToolbar|floatTools|control)|toolbar\.)", "T8"),
       (r"(window\.(panel|panels|dock|collapseDock|taskBar)$|window\.panel\.)", "T10"),
       (r"(shortcuts\.|shortcutSet\.|ui\.shortcutImportDialog|edit\.keyboardShortcuts|help\.commandPalette)", "T9"),
       (r"(prefs\.|edit\.preferences$)", "T11")]


def task_di(r):
    if r[4] != "fub":
        return TASK[r[4]]
    return next((t for rx, t in FUB if re.match(rx, r[1])), "T2")


with open(out, "w", encoding="utf-8") as f:
    f.write("# Mappa di VectorCraft cfb30d8139161cf1722dfabf3046741a0b21b3da in Fub (generata da PLAN-mappa/strumenti/mappa.py, K6)\n")
    f.write("fonte\tid\tetichetta\tmenu\tfamiglia\tfase\ttask\tposto\tpigro\tnota\n")
    for r in rows:
        r = list(r[:6]) + [task_di(r)] + list(r[6:])
        f.write("\t".join(str(x).replace("\t", " ").replace("\n", " ") for x in r) + "\n")
C = collections.Counter
print("righe", len(rows), C(r[0] for r in rows))
print("famiglie", sorted(C(r[4] for r in rows).items(), key=lambda x: -x[1]))
print("fasi", C(r[5] for r in rows)); print("task", sorted(C(task_di(r) for r in rows).items(), key=lambda x: int(x[0][1:]))); print("posti", C(r[6].split("/")[0] for r in rows)); print("pigro", C(r[7] for r in rows))
