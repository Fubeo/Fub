// node --test tools/disegno-mappa/estrai.test.mjs
//
// L'estrazione della mappa del disegno: sulla copia di VectorCraft e su un
// motore finto, scritto in una cartella temporanea, con i casi limite.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  COLONNE,
  MAPPA,
  estrai,
  leggiMappa,
  revisione,
  rigenera,
  scriviMappa,
  senzaTest,
  stringaRust,
  traduzioni,
} from "./estrai.mjs";

const conta = (righe, colonna) => {
  const out = {};
  for (const r of righe) out[r[colonna]] = (out[r[colonna]] ?? 0) + 1;
  return out;
};

test("sulla copia di cfb30d81 l'estrazione dà le 1551 righe, con i conti per fonte", () => {
  assert.equal(revisione(), "cfb30d8139161cf1722dfabf3046741a0b21b3da");
  const righe = estrai();
  assert.equal(righe.length, 1551);
  assert.deepEqual(conta(righe, "fonte"), { motore: 881, interfaccia: 397, strumento: 100, effetto: 130, pannello: 43 });
  // Gli strumenti aggiunti hanno il loro ID, non il nome del modulo.
  assert.ok(righe.some((r) => r.fonte === "strumento" && r.id === "cornerTool"));
  assert.ok(!righe.some((r) => r.id === "corner_tool"));
  // Le costanti di UI_COMMANDS si leggono dal loro modulo.
  assert.ok(righe.some((r) => r.fonte === "interfaccia" && r.id === "addon.pathtools.cornerTool"));
  // `file.place` è del motore e dell'interfaccia: due righe.
  assert.deepEqual(righe.filter((r) => r.id === "file.place").map((r) => r.fonte).sort(), ["interfaccia", "motore"]);
});

test("la mappa del repository ha le righe dell'estrazione e la loro revisione", () => {
  const mappa = leggiMappa(fs.readFileSync(MAPPA, "utf8"));
  assert.deepEqual(mappa.errori, []);
  assert.equal(mappa.rev, revisione());
  assert.equal(mappa.righe.length, 1551);
  // Le sette righe `window.workspace*` sono di Fub (T7), e T10 chiude le sette
  // righe `window.*` del menu Finestra: da «da fare» a «fub». T8 chiude le dieci
  // righe della colonna e del cassetto, e passano a «fub» allo stesso modo; T9c
  // le dieci di Impostazioni › Scorciatoie (i tasti, i conflitti, gli insiemi).
  // T11 giro A porta a «fatto» le venti del nucleo (select, object), il giro B
  // a «fub» le cinque delle preferenze del motore (Impostazioni › Disegni), il
  // giro C a «fatto» le dodici degli appunti e della cronologia, il giro D le sei
  // della banda (il menu dello zoom e le misure), il giro F le sedici di Modifica
  // (le incolle nelle varianti, pulisci, duplica) e le letture interne.
  // Il giro E di T11 porta a «fatto» le sei di ≡ › Visualizza e del navigatore.
  // T12 giro 1 porta a «fatto» i ventuno strumenti di «disegnare» e i quattro
  // comandi sui punti che la fila dei punti chiama. Il giro «oggetti» di T11
  // le sette di Raggruppa, Blocca e Nascondi (la selezione, il resto, tutto).
  // T13 giro 1 porta a «fatto» le otto forme del Completo, le otto finestre
  // delle misure dei comandi `shape.*` (senza le griglie), le tre voci di
  // Allinea del motore, le quindici `align.*` e il pannello `align`:
  // trentaquattro righe. Le griglie e il riflesso aspettano T27.
  // T12 giro 2 le quattordici di Oggetto › Tracciato senza finestra; T12
  // giro 3 le cinque finestre dei tracciati. T13 giro 3 le nove di Trasforma.
  // T13 giro 5 i quattro strumenti di «modificare» (Ruota, Rifletti, Scala, Inclina).
  // T15 giro 1 le dodici del menu Selezione. T14 giro 1 le ventuno del
  // colore: i nove `paint.*` del colore attivo, le dieci di Modifica › Modifica
  // colori e le due finestre `ui.*` del client. T15 giro 2 `transparency.set`;
  // T15 giro 3 `layer.delete`, `layer.new` e `layer.setProps` (nome, occhio, lucchetto).
  // T16 giro 1 le cinque del testo di punto: lo strumento Testo, i pannelli
  // Carattere e Paragrafo e i loro due comandi (`text.setRangeStyle`, `text.setStyle`).
  // T12 giro 5 le dieci operazioni di Elaborazione tracciati e il pannello `pathfinder`.
  // T15 giro 5 `stroke.set` (la sezione Contorno) e le quattro della sfumatura
  // (`paint.editGradient`, `paint.setGradientGeom`, `gradient.selectStop`, `paint.lastGradient`).
  // T13 le quattro `object.compoundShape.*`, `object.expandShape` e `pathfinder.repeat`.
  // T12 giro 6 le tre maschere di ritaglio (`object.clippingMask.make`, `.release`, `.editContents`),
  // `select.object.clippingMasks`, e le due finestre di Media (`path.average`, `path.averageJoin`).
  // T15 giro 6 le quattro `gradient.presets.*`, il pannello `gradient` e lo strumento Sfumatura.
  // T14 contagocce (giro 6): `eyedropper` (strumento), `paint.sampleColor` e
  // `eyedropper.setOptions` sono «fatto»; `appearance.copyFrom` resta «da fare» (T15).
  // T15 giro 6 porta a «fatto» otto righe di ≡ › Selezione: il testo uguale (sei) e Punti isolati e
  // Tracciati aperti. Il testo di punto e quello in area restano da fare: il motore vede il testo con
  // fub:wrap come testo di punto, quindi il confronto per specie non è giusto.
  // T11 giro H (interruttori della vista) porta a «fatto» tre righe di ≡ › Visualizza:
  // la griglia di trasparenza (fonte motore, ma la fa il client), i bordi e il riquadro
  // di delimitazione. Guide intelligenti, aggancio ai punti e widget d'angolo restano
  // «da fare»: il gesto non porta i flag di vista, e il widget arriva con T12.
  // T12 punti le dieci sui punti di un tracciato: `path.moveAnchor`, `.moveAnchors`, `.setHandle`,
  // `.insertAnchor`, `.removeAnchor`, `.convertAnchor`, `.deleteAnchors`, `.close`, `.appendAnchor`, `.split`.
  // T14 campioni porta a «fatto» quattro righe dei campioni (duplica, unisci, ordina per nome, sposta).
  // Restano «da fare», con il perché: i tre comandi dei gruppi e i predefiniti non ci sono nel formato,
  // e ordina per specie non cambia niente su campioni che sono tutti colori.
  // T13 disponi porta a «fatto» le sette voci di ≡ › Oggetto › Disponi (`addon.arrange.*`), con i
  // loro casi in trasforma.json; Sposta leggermente (`object.nudge`) e Trasforma singolarmente
  // (`object.transformEach`) restano «da fare».
  // T12 mano libera (giro 9) porta a «fatto» i cinque comandi a mano libera: `path.freehand`,
  // `.eraseRegion`, `.eraseSegments`, `.knife`, `.smoothRegion` (gli strumenti erano già fatti).
  // T15 Seleziona giro 2: Riseleziona (`select.reselect`) è «fatto», con il ricordo del banco.
  // Le selezioni salvate, Oggetto › Testo di punto e in area, la bacchetta restano «da fare».
  // T15 livelli giro 2 porta a «fatto» tre righe di livelli: `layer.selectAll`, `layer.merge` e
  // `layer.reverse`. Duplica, raccogli in un livello nuovo, il livello corrente e le righe di
  // Oggetto che lavorano sul livello (sopra e altri livelli, il livello corrente) restano «da fare»,
  // con la causa nella nota.
  // T13 generatore (giro 7): Oggetto › Trasforma › Trasforma singolarmente
  // (`object.transformEach`) è «fatto», con la sua finestra con l'anteprima; le due
  // griglie (`shape.rectangularGrid`, `shape.polarGrid`) e i loro strumenti (`rectangularGrid`,
  // `polarGrid`) sono «fatto», senza più «aspetta T27»: quattro in più.
  // T13 generatore (giro 7): il Generatore forme (`shapeBuilder.merge`, la lettura
  // `shapeBuilder.regions` e lo strumento `shapeBuilder`) è «fatto»: tre in più.
  // T12 curvatura porta a «fatto» undici righe: `path.curvature`, `.curvatureEdit`, `.reshape`,
  // `.reshapeSegment`, `.setAnchors` e le sei `addon.pen.*` (append, close, segment, removePoint,
  // togglePoint, reshape), come comandi su un punto con `element` (la Curvatura crea o sostituisce).
  // T15 pannello contorno: il pannello `stroke` è «fatto» con i campi che il formato scrive;
  // i campi che il formato non scrive restano spenti col perché, i profili di spessore in T27.
  // T14 sfumatura libera: le letture `paint.recent` e `paint.proxies` diventano «fatto»; le sette
  // righe della sfumatura libera (`paint.freeform.*`) restano «da fare», perché il formato della
  // scena non ha punti né linee per una sfumatura (la causa è nella nota della mappa).
  // T14 librerie porta a «fatto» le due letture delle librerie di base, `swatch.library.list` e
  // `swatch.library.get` (con casi in `tests/famiglie/colore.json`). Aggiungere campioni da una
  // libreria (`swatch.library.add`) e le finestre restano «da fare», con la causa nella nota.
  // T15 maschere: Crea maschera di opacità e le due letture della Trasparenza («fatto»); le altre
  // maschere, il pannello e l'isolamento della pagina restano «da fare» con la causa nella nota.
  // T16 testo base le sette del testo: `type.changeCase`, `type.createOutlines`,
  // `type.convertToAreaType`, `type.convertToPointType`, `edit.findReplace`, `edit.findNext`
  // e `text.editRange`.
  // T14 librerie 2 porta a «fatto» `swatch.library.add`: copia una libreria di base nel disegno, con i
  // campioni globali e senza gruppo (casi in `tests/famiglie/colore.json`). Restano «da fare» le finestre
  // delle librerie e le librerie dell'utente (la cartella del desktop non c'è nel Completo).
  // T14 pannello colore: il pannello `color` diventa «fatto» (la sezione Colore del Design, con la sua
  // prova in colore.json); `ui.colorPicker` e `ui.colorPanel` restano «da fare», con la causa nella nota.
  // T15 aspetto: Riduci ad aspetto di base («fatto», con la riapertura dei due riempimenti); Svuota
  // resta «da fare», perché il file riaperto perde l'oggetto (la causa è nella nota).
  // T14 colori aggiunti (giro 9, punto 1): Seleziona per tipo di colore (con la sua finestra),
  // Trova e Applica il campione più vicino: tre in più. Le letture del colore e le tinte piatte
  // restano «da fare» in questo giro; stampa e filtro restano «da fare» con la causa.
  // T14 librerie finestra porta a «fatto» `window.swatchLibrary`: la finestra elenca le librerie, mostra
  // i campioni e aggiunge (prova: `librerie-finestra.test.ts`). Resta «da fare» Altra libreria… (un file).
  // T14 ricolora: cinque righe fatte in più (tre letture, Ricolora grafica e la sua finestra).
  // T14 letture colore: `color.harmony`, `color.convert` e `color.gamutCheck` sono «fatto»
  // (letture senza finestra, casi in colore.json): tre in più.
  // T15 aggiungi aspetto: Aggiungi riempimento e Aggiungi contorno («fatto», con le riaperture nei test);
  // il pannello Aspetto e il resto dell'aspetto restano «da fare».
  // T15 livelli altri: `layer.showAll` e `layer.unlockAll` diventano «fatto» (la visita dell'albero, con
  // i loro casi in livelli.json); `layer.hideOthers` e `layer.lockOthers` restano «da fare», con la causa.
  assert.deepEqual(conta(mappa.righe, "stato"), { "da fare": 1085, fub: 114, escluso: 12, fatto: 340 });
});

// --- un motore finto ---------------------------------------------------------------

const cartelle = [];
after(() => {
  for (const d of cartelle) fs.rmSync(d, { recursive: true, force: true });
});

function motoreFinto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fub-disegno-mappa-"));
  cartelle.push(dir);
  for (const [rel, testo] of Object.entries(file)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), testo);
  }
  return dir;
}

const BASE = {
  "upstream.lock": `rev = "${"c".repeat(40)}"\n`,
  "crates/engine/src/cmd.rs": [
    "macro_rules! cmd {",
    '    ($id:literal, $label:literal) => { "cmd!(\\"finto\\", \\"Finto\\", [], None, \\"{}\\"" };',
    "}",
    "pub(crate) use cmd;",
    "pub fn specs() -> Vec<CommandSpec> {",
    '    vec![cmd!("path.join", "Join", ["Object", "Path"], Some("Cmd+J"), "{}", has_doc, run),',
    '         cmd!(query "doc.read", "Read\\tAll", [], None, "{}", has_doc, run),',
    '         cmd!("file.place", "Place…", ["File"], None, "{}", has_doc, run)]',
    "}",
    "#[cfg(test)]",
    "#[allow(dead_code)]",
    "mod prove {",
    "    // una graffa in un commento: }",
    '    const S: &str = "}";',
    '    const R: &str = r#"} "cmd!"#;',
    "    fn f<'a>(c: char) -> bool { c == '}' }",
    '    fn g() { let _ = cmd!("prova.inLinea", "Test", [], None, "{}", has_doc, run); }',
    "}",
    "#[cfg(test)]",
    "mod tests;",
    "#[cfg(all(test, feature = \"x\"))]",
    'fn h() { cmd!("prova.funzione", "Test", [], None, "{}", has_doc, run); }',
    'pub fn dopo() -> CommandSpec { cmd!("path.split", "Split", ["Object", "Path"], None, "{}", has_doc, run) }',
    "",
  ].join("\n"),
  "crates/engine/src/cmd/tests.rs": 'fn t() { cmd!("prova.file", "Test", [], None, "{}", has_doc, run); }\n',
  "crates/engine/src/cmd/tests/altro.rs": 'fn t() { cmd!("prova.sotto", "Test", [], None, "{}", has_doc, run); }\n',
  "crates/ui-egui/src/menus/ui_commands.rs": [
    "pub const UI_COMMANDS: &[(&str, &str, &str, &str)] = &[",
    "    // un commento con (parentesi",
    '    (crate::addons::arrange::ZOOM, "Zoom to Selection", "", "{}"),',
    '    ("file.place", "Place…", "", "{path?} (con una parentesi)"),',
    '    ("help.discord", "Discord", "", "{}"),',
    "];",
    "",
  ].join("\n"),
  "crates/ui-egui/src/addons/arrange.rs": 'pub const ZOOM: &str = "addon.arrange.zoomSelection";\n',
  "crates/ui-egui/src/i18n/it.tsv": [
    "# commento",
    "",
    "\tJoin\tUnisci",
    "\tZoom to Selection\t",
    "@msg\tPlace…\tnon è un'etichetta",
    "\tPlace…\tInserisci…",
    "",
  ].join("\r\n"),
  "crates/tools/src/catalog.rs": [
    "pub const TOOL_GROUPS: &[&[ToolInfo]] = &[",
    '    &[t("selection", "Selection Tool", Some("V"), "tool-selection")],',
    '    &[t("pen", "Pen Tool", Some("P"), "tool-pen"), t("addAnchor", "Add Anchor Point Tool", None, "x")],',
    "];",
    "",
  ].join("\n"),
  "crates/tools/src/addons.rs": 'pub const GROUPS: &[ToolInfo] = &[ToolInfo { id: corner_tool::ID, label: "Corner Tool", shortcut: None, icon: "x" }];\n',
  "crates/tools/src/addons/corner_tool.rs": 'pub const ID: &str = "cornerTool";\n',
  "crates/effects/src/catalog.rs": [
    'const MENU_BLUR: &[&str] = &["Effect", "Blur"];',
    'pub const GAUSS: &str = "blur.gaussian";',
    "fn all() {",
    "    let g = |id, label, menu, params, defaults| EffectInfo { id, label, menu };",
    '    g(GAUSS, "Gaussian Blur…", MENU_BLUR, &[], &[]);',
    '    r("raster.glow", "Glow…", &["Effect", "Stylize"], &[], &[]);',
    "}",
    'pub const WARP_STYLES: [(&str, &str); 1] = [("arc", "Arc…")];',
    "",
  ].join("\n"),
  "crates/effects/src/group.rs": '    ("pathfinder.add", "Add", PathfinderOp::Unite),\n',
  "crates/ui-egui/src/panels.rs": [
    "pub mod layers;",
    "pub(crate) mod memo;",
    "mod aiuto;",
    "#[cfg(test)]",
    "mod tests_layers;",
    "#[cfg(test)]",
    "mod tests {",
    "    pub mod finto;",
    "}",
    "",
  ].join("\n"),
  "crates/ui-egui/src/panels/layers/mod.rs": "",
  "crates/ui-egui/src/panels/memo.rs": "",
  "crates/ui-egui/src/panels/aiuto.rs": "",
  "crates/ui-egui/src/panels/tests_layers.rs": "",
  "crates/ui-egui/src/panels/finto.rs": "",
};

test("un cmd! nei test non conta: in linea, in un file di test e sotto di lui", () => {
  const righe = estrai(motoreFinto(BASE)).filter((r) => r.fonte === "motore");
  assert.deepEqual(
    righe.map((r) => r.id),
    ["path.join", "doc.read", "file.place", "path.split"],
  );
  assert.deepEqual(righe[0], { fonte: "motore", id: "path.join", etichetta: "Join", menu: "Object › Path", etichetta_it: "Unisci" });
});

test("senzaTest toglie l'elemento intero, anche con graffe in stringhe, caratteri e commenti", () => {
  const { sorgente, moduli } = senzaTest(BASE["crates/engine/src/cmd.rs"]);
  assert.ok(!sorgente.includes("prova."));
  assert.ok(sorgente.includes('"path.split"'));
  assert.deepEqual(moduli, [{ nome: "tests", percorso: undefined }]);
});

test("le altre fonti: interfaccia, strumenti, effetti e pannelli", () => {
  const righe = estrai(motoreFinto(BASE));
  const di = (fonte) => righe.filter((r) => r.fonte === fonte).map((r) => r.id);
  assert.deepEqual(di("interfaccia"), ["addon.arrange.zoomSelection", "file.place", "help.discord"]);
  assert.deepEqual(di("strumento"), ["selection", "pen", "addAnchor", "cornerTool"]);
  assert.deepEqual(di("effetto"), ["blur.gaussian", "raster.glow", "warp.arc", "pathfinder.add"]);
  // `aiuto` non è pub, `tests_layers` e `finto` sono dei test.
  assert.deepEqual(di("pannello"), ["layers", "memo"]);
  const effetto = righe.find((r) => r.id === "blur.gaussian");
  assert.equal(effetto.menu, "Effect › Blur");
});

test("un id con la stessa scritta in due fonti fa due righe", () => {
  const righe = estrai(motoreFinto(BASE)).filter((r) => r.id === "file.place");
  assert.deepEqual(righe.map((r) => r.fonte), ["motore", "interfaccia"]);
});

test("it.tsv con righe vuote, CRLF e traduzioni che mancano: l'etichetta inglese", () => {
  const it = traduzioni(BASE["crates/ui-egui/src/i18n/it.tsv"]);
  assert.equal(it.get("Join"), "Unisci");
  assert.equal(it.get("Place…"), "Inserisci…");
  assert.equal(it.has("Zoom to Selection"), false);
  const righe = estrai(motoreFinto(BASE));
  assert.equal(righe.find((r) => r.id === "addon.arrange.zoomSelection").etichetta_it, "Zoom to Selection");
  assert.equal(righe.find((r) => r.id === "help.discord").etichetta_it, "Discord");
});

test("un'etichetta con un tab si legge giusta e non sposta le colonne", () => {
  assert.equal(stringaRust("Read\\tAll \\u{2026} \\\"x\\\""), 'Read\tAll … "x"');
  const righe = estrai(motoreFinto(BASE));
  const r = righe.find((x) => x.id === "doc.read");
  assert.equal(r.etichetta, "Read\tAll");
  const { righe: mappa } = rigenera([], righe);
  const letta = leggiMappa(scriviMappa("c".repeat(40), mappa));
  assert.deepEqual(letta.errori, []);
  const riletta = letta.righe.find((x) => x.id === "doc.read");
  assert.equal(riletta.etichetta, "Read All");
  assert.equal(riletta.stato, "da fare");
  assert.equal(Object.keys(riletta).length, COLONNE.length + 1);
});

test("rigenerando, le righe che c'erano tengono le colonne scritte a mano", () => {
  const righe = estrai(motoreFinto(BASE));
  const vecchie = [
    { fonte: "motore", id: "path.join", etichetta: "Vecchia", menu: "", famiglia: "tracciati", fase: "F1", task: "T12", stato: "fatto", posto: "menu/oggetto", pigro: "famiglia", nota: "a mano", etichetta_it: "" },
    { fonte: "motore", id: "path.rinominato", etichetta: "X", menu: "", famiglia: "tracciati", fase: "F1", task: "T12", stato: "da fare", posto: "menu/oggetto", pigro: "famiglia", nota: "", etichetta_it: "" },
  ];
  const { righe: nuove, nuove: aggiunte, sparite } = rigenera(vecchie, righe);
  const join = nuove.find((r) => r.id === "path.join");
  assert.equal(join.famiglia, "tracciati");
  assert.equal(join.stato, "fatto");
  assert.equal(join.nota, "a mano");
  assert.equal(join.etichetta, "Join");
  const split = nuove.find((r) => r.id === "path.split");
  assert.equal(split.famiglia, "");
  assert.equal(split.stato, "da fare");
  assert.deepEqual(sparite, ["motore\tpath.rinominato"]);
  assert.ok(aggiunte.includes("motore\tpath.split"));
});

test("una costante di UI_COMMANDS che non si trova ferma l'estrazione", () => {
  const file = { ...BASE };
  delete file["crates/ui-egui/src/addons/arrange.rs"];
  assert.throws(() => estrai(motoreFinto(file)), /crate::addons::arrange::ZOOM/);
});

test("la mappa con una riga dal numero di campi sbagliato non si legge", () => {
  const testo = scriviMappa("c".repeat(40), rigenera([], estrai(motoreFinto(BASE))).righe);
  const rotta = testo.replace("path.join\t", "path.join\textra\t");
  assert.match(leggiMappa(rotta).errori.join("\n"), /campi invece di 12/);
});
