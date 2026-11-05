// Costruisce PLAN-ui/scrittoio-2.html dalle catture (cattura2/) e dai blocchi
// di CSS nuovo (blocchi/). Usa e getta: vive in tmp, non nel worktree.
// node script/costruisci.mjs <uscita.html>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const [out] = process.argv.slice(2);
const cat = join(root, "cattura2");
const fontsDir = join(root, "anteprima-copia/apps/client/public/fonts");

// ── Gli stati del prototipo ─────────────────────────────────────────────────
// fuoco: il controllo principale dello stato (il bottone «Fuoco» lo mette lì).
const STATI = [
  { g: "Editor", id: "nota", nome: "Nota in Live, menu delle modalità aperto", w700: "nota-700", fuoco: '[role="menuitemradio"][aria-checked="true"]',
    dice: "La pagina Benvenuto del mockup. La testata ha solo il percorso, «Salvato» e «…»; la modalità si sceglie dalla banda (il menu è aperto); «Si scrive» è una voce della banda; sotto il titolo la riga dei dati; nell'ispettore la struttura e «In entrata».",
    task: ["T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T11", "T12", "T13"] },
  { g: "Editor", id: "barra", nome: "Nota con la barra di formato", w700: "barra-700", fuoco: ".kit-bar-button",
    dice: "La barra di formato delle note prende la fila di serie: il vassoio stondato un tono sotto la carta, i gruppi come foglietti, gli stessi pulsanti della barra dei fogli. A 700 px ciò che non ci sta va in «…».",
    task: ["T16", "T17"] },
  { g: "Editor", id: "documento", nome: "Documento .docx", w700: "documento-700", fuoco: '.kit-ribbon-tabs [role="tab"][aria-selected="true"]',
    dice: "La barra a schede del documento è la barra di serie dei fogli, con le classi del kit; i pezzi propri del documento (la galleria degli stili) restano suoi. Il gruppo raccolto si apre sul posto (domanda 8).",
    task: ["T5", "T20", "T21"] },
  { g: "Editor", id: "foglio", nome: "Foglio di calcolo", w700: "foglio-700", fuoco: '.kit-ribbon-tabs [role="tab"][aria-selected="true"]',
    dice: "La barra dei fogli è l'origine dello standard: si vede uguale a oggi, ma la sua forma passa al kit (`kit-ribbon-*`). Ai fogli restano tavolozza, galleria, campioni, «Comandi», formula e schede.",
    task: ["T20"] },
  { g: "Editor", id: "disegno", nome: "Disegno SVG", w700: "disegno-700", fuoco: ".draw-header .kit-bar-button",
    dice: "La testa del disegno nella fila di serie; la colonna degli strumenti prende la pelle di `kit-rail`. È la proposta per K5 T25.",
    task: ["T16", "T22"] },
  { g: "Editor", id: "craft", nome: "File Craft senza anteprima", w700: "craft-700", fuoco: ".craft-ask-answer",
    dice: "Senza anteprima la scheda è un foglietto sollevato, non un riquadro tratteggiato; le risposte sono pulsanti del kit. Arriva dopo che N7 è in main.",
    task: ["T19"] },
  { g: "Editor", id: "pdf", nome: "PDF", w700: "pdf-700", fuoco: ".media-pdf-toolbar .kit-bar-button",
    dice: "La barra del PDF nella fila di serie, coi gruppi e la lente; «Pagina N di M» va nella banda; «Apri con un'altra app» e «Copia il link alla pagina» vanno in «…».",
    task: ["T18"] },
  { g: "Cornice", id: "impostazioni", nome: "Impostazioni", w700: "impostazioni-700", fuoco: '.settings-tab[aria-selected="true"]',
    dice: "Le impostazioni nella lingua dello Scrittoio: etichette in tondo, la scelta a segmenti come la barra di serie.",
    task: ["T10"] },
  { g: "Cornice", id: "componenti", nome: "Componenti", fuoco: '.settings-tab[aria-selected="true"]',
    dice: "La pagina «Componenti» prende la stessa pelle delle impostazioni.", task: ["T10"] },
  { g: "Cornice", id: "ricerca", nome: "Ricerca nel vault", fuoco: "#search-input",
    dice: "Il cassetto della ricerca: il pozzetto pieno con la lente, le etichette in tondo.", task: ["T8"] },
  { g: "Cornice", id: "grafo", nome: "Grafo", fuoco: ".graph-list-summary", dice: "Il grafo resta; cambiano le etichette in tondo.", task: ["T10"] },
  { g: "Cornice", id: "icone", nome: "Icona di una cartella: le figure", fuoco: '[data-icon^="fub:"]',
    dice: "Il selettore dell'icona offre le figure monocrome (`fub:<nome>`) accanto alle emoji. Il vault del banco usa le figure.",
    task: ["T14", "T15"] },
  { g: "Cornice", id: "icone-emoji", nome: "Icona di una cartella: le emoji", fuoco: '[data-icon^="fub:"]',
    dice: "Le emoji restano una scelta piena: il vault del banco con `?icone=emoji`.", task: ["T14", "T15"] },
  { g: "Casi", id: "vuoto", nome: "Nessun vault aperto", fuoco: "#pill", dice: "La pillola diventa il campo dei comandi, anche a vuoto.", task: ["T7"] },
  { g: "Casi", id: "zero", nome: "Avvio rapido, zero risultati", fuoco: ".launcher-input", dice: "Zero voci: il messaggio resta, le etichette in tondo.", task: ["T10"] },
  { g: "Casi", id: "caricamento", nome: "Foglio, un risultato in caricamento", fuoco: '.kit-button[data-kind="primary"]', dice: "«Statistiche della selezione» mentre legge: il dialogo del kit resta com'è, dietro c'è la barra di serie del foglio.", task: ["T20"] },
  { g: "Casi", id: "errore", nome: "Foglio, un risultato in errore", fuoco: '.kit-button[data-kind="primary"]', dice: "Lo stesso dialogo quando il motore non risponde: il messaggio e «Riprova» restano, dietro c'è la barra di serie del foglio.", task: ["T20"] },
  { g: "Casi", id: "molti", nome: "Foglio a 700 px, 500 errori", fuoco: '.kit-button[data-kind="primary"]', dice: "«Controllo errori» con cinquecento celle nella finestra stretta: la tabella scorre dentro il dialogo, dietro la barra di serie si raccoglie.", task: ["T20"] },
  { g: "Casi", id: "sola-lettura", nome: "Documento in sola lettura", fuoco: "#status-mode",
    dice: "Uno stato diverso da «Si scrive» resta nella testata, dove si vede; «Si scrive» va nella banda.", task: ["T4", "T5"] },
  { g: "Telefono", id: "tel-nota", nome: "Telefono: nota, si scrive", fuoco: ".pane > .pane-mode-current",
    dice: "In piedi il foglio va da un bordo all'altro, e in alto il marchio non c'è: la pillola parte da dove stava lui, e le voci del menu dell'applicazione si trovano nel lanciatore. La testata tiene il nome, lo stato in figura (la spunta di «Salvato») e «…»; «Si scrive» sta in «…». Mentre si scrive il bottone della modalità chiude la fila della barra di formato, in basso a destra, accanto ad Annulla e Ripeti: la sola icona, il nome nell'etichetta e nel suggerimento.",
    task: ["T2", "T3", "T4", "T5", "T7", "T11", "T12"] },
  { g: "Telefono", id: "tel-ferma", nome: "Telefono: nota, a riposo", fuoco: ".pane > .pane-mode-current",
    dice: "Senza il fuoco nel testo la barra di formato non c'è: il bottone della modalità resta in basso a destra, un tondo alto un dito sopra la carta.",
    task: ["T2", "T3", "T5", "T7"] },
  { g: "Telefono", id: "tel-sdraiato", nome: "Telefono sdraiato", fuoco: ".pane > .pane-mode-current",
    dice: "Sdraiato la barra del titolo è quella stretta del computer: il marchio resta, con il suo menu. La banda si ritira perché manca l'altezza, quindi la modalità la dice il tondo in basso a destra, come in piedi. Il foglio tiene i margini della scrivania.",
    task: ["T3", "T7"] },
  { g: "Telefono", id: "tel-tastiera", nome: "Telefono: nota, tastiera aperta", fuoco: ".pane > .pane-mode-current",
    dice: "Con la tastiera aperta la barra inferiore cede il posto e la fila della barra di formato sta sopra i tasti, col bottone della modalità in fondo. Aprire il suo menu chiude la tastiera, come «Titolo 1».",
    task: ["T3", "T7", "T17"] },
  { g: "Telefono", id: "tel-doc", nome: "Telefono: documento", fuoco: ".pane > .pane-mode-current",
    dice: "Il documento al telefono con la barra di serie raccolta. Il documento non ha la barra di formato: il bottone della modalità è il tondo in basso a destra, e il pulsante dei commenti gli sta a sinistra, sulla stessa riga.",
    task: ["T3", "T5", "T7", "T21"] },
  { g: "Telefono", id: "tel-foglio", nome: "Telefono: foglio", fuoco: "[data-pane-menu]", dice: "Il foglio al telefono, da un bordo all'altro. Ha una modalità sola: niente bottone della modalità.", task: ["T5", "T7", "T20"] },
];

// ── I blocchi di CSS, una destinazione ciascuno ─────────────────────────────
const VAR = /\/\*\s*variante ([\w-]+)\s*\*\/([\s\S]*?)\/\*\s*fine variante \1\s*\*\//g;
const blocchi = {};
for (const f of (await readdir(join(root, "blocchi"))).filter((f) => f.endsWith(".css")).sort()) {
  blocchi[f.replace(/\.css$/, "")] = await readFile(join(root, "blocchi", f), "utf8");
}
const corpo = (text) => text.replace(/^\/\* → [^*\n]*\*\/\n/, ""); // via la riga della destinazione, se è una riga sola
const varianti = {};
const senzaVarianti = (text) =>
  text.replace(VAR, (_m, name, css) => {
    varianti[name] = css.trim() + "\n";
    return "";
  });
// L'ordine vero: structure.css prima della pelle; la pelle nell'ordine di
// skin/order.ts; mobile.css per ultimo.
const DEST = [
  ["theme/scrittoio/structure.css", "struttura", ["00-structure", "70-kit-struttura", "70f-kit-fila-struttura"]],
  ["theme/scrittoio/skin/kit.css", "pelle", ["71-kit", "72-kit-vassoio", "71f-kit-fila"]],
  ["theme/scrittoio/skin/frame.css", "pelle", ["10-frame"]],
  ["theme/scrittoio/skin/drawers.css", "pelle", ["20-drawers", "21-icone"]],
  ["theme/scrittoio/skin/tree.css", "pelle", ["30-tree"]],
  ["theme/scrittoio/skin/sheets.css", "pelle", ["40-sheets"]],
  ["theme/scrittoio/skin/document.css", "pelle", ["50-document"]],
  ["theme/scrittoio/skin/media.css", "pelle", ["85-media", "86-craft"]],
  ["theme/scrittoio/skin/nodes.css", "pelle", ["60-nodes", "61-nodes"]],
  ["theme/scrittoio/skin/graph.css", "pelle", ["81-graph"]],
  ["theme/scrittoio/skin/menus.css", "pelle", ["65-menus"]],
  ["theme/scrittoio/skin/launcher.css", "pelle", ["82-launcher"]],
  ["theme/scrittoio/skin/centres.css", "pelle", ["45-centres"]],
  ["theme/scrittoio/skin/settings.css", "pelle", ["80-settings"]],
  ["theme/scrittoio/skin/welcome.css", "pelle", ["83-welcome"]],
  ["shells/scrittoio/mobile/mobile.css", "telefono", ["90-mobile"]],
  ["theme/scrittoio/series.ts", "serie", ["01-series"]],
  ["theme/scrittoio/recipe.ts", "serie", ["02-ruoli"]],
];
const usati = new Set(DEST.flatMap((d) => d[2]));
for (const k of Object.keys(blocchi)) if (!usati.has(k)) throw new Error(`blocco senza destinazione: ${k}`);
const destinazioni = DEST.map(([dest, posto, files]) => ({
  dest,
  posto,
  css: (blocchi[files[0]].startsWith(`/* → ${dest}:`) ? "" : `/* → ${dest} */\n`) + files.map((f) => corpo(senzaVarianti(blocchi[f])).trim()).join("\n\n") + "\n",
}));
// «Com'era»: le regole di oggi, rimesse sopra tutto per il confronto. Non
// vanno nel codice: dicono soltanto da dove si parte.
const VARIANTI = [
  { nome: "prima-ombra", file: "prima-ombra", dove: "prima" },
  { nome: "prima-vassoio", file: "prima-vassoio", dove: "prima" },
  { nome: "prima-sezioni", file: "prima-sezioni", dove: "prima" },
];
for (const v of VARIANTI) {
  if (!varianti[v.file]) throw new Error(`variante mancante: ${v.file}`);
  v.css = `/* com'era (${v.nome}): non va nel codice */\n` + varianti[v.file];
}

// ── Le icone nuove (fuori dal CSS) ──────────────────────────────────────────
const iconsTs = await readFile(join(root, "anteprima-copia/apps/client/src/ui/icons.ts"), "utf8");
const iconeNuove = iconsTs.slice(iconsTs.indexOf("  // --- Scrittoio 2: le modalità della banda"), iconsTs.indexOf("music:"));
const iconeBlocco = iconeNuove + iconsTs.slice(iconsTs.indexOf("music:")).split("\n")[0] + "\n";

// ── Le catture, compresse ───────────────────────────────────────────────────
const FONTS = [
  "hanken-grotesk-latin-wght-normal", "hanken-grotesk-latin-wght-italic",
  "newsreader-latin-opsz-normal", "newsreader-latin-opsz-italic",
  "ibm-plex-mono-latin-400-normal", "ibm-plex-mono-latin-400-italic",
  "ibm-plex-mono-latin-500-normal", "ibm-plex-mono-latin-600-normal",
  "inter-latin-wght-normal",
];
const fonts = [];
for (const f of FONTS) fonts.push([f, (await readFile(join(fontsDir, `${f}.woff2`))).toString("base64")]);
const tienFont = new Set(FONTS);
const pulisciCss = (css) =>
  css.replace(/@font-face\s*{[^}]*}/g, (rule) => {
    const m = /\/fonts\/([\w-]+)\.woff2/.exec(rule);
    return m && !tienFont.has(m[1]) ? "" : rule;
  });
const pulisciBody = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, (m) => (m.includes("\n") ? "><" : m));

function diff(a, b) {
  const ops = [];
  const rec = (a0, a1, b0, b1) => {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) (a0 += 1), (b0 += 1);
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) (a1 -= 1), (b1 -= 1);
    if (a0 === a1 && b0 === b1) return;
    if (a0 === a1 || b0 === b1) return void ops.push([a0, a1 - a0, b0, b1 - b0]);
    const ca = new Map();
    const cb = new Map();
    for (let i = a0; i < a1; i += 1) ca.set(a[i], ca.has(a[i]) ? -1 : i);
    for (let i = b0; i < b1; i += 1) cb.set(b[i], cb.has(b[i]) ? -1 : i);
    const pairs = [];
    for (const [t, i] of ca) {
      const j = cb.get(t);
      if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
    }
    if (!pairs.length) return void ops.push([a0, a1 - a0, b0, b1 - b0]);
    pairs.sort((x, y) => x[0] - y[0]);
    const tails = [];
    const prev = new Array(pairs.length);
    for (let k = 0; k < pairs.length; k += 1) {
      const j = pairs[k][1];
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (pairs[tails[m]][1] < j) lo = m + 1;
        else hi = m;
      }
      prev[k] = lo > 0 ? tails[lo - 1] : -1;
      tails[lo] = k;
    }
    const chain = [];
    for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) chain.push(pairs[k]);
    chain.reverse();
    let pa = a0;
    let pb = b0;
    for (const [i, j] of chain) {
      rec(pa, i, pb, j);
      pa = i + 1;
      pb = j + 1;
    }
    rec(pa, a1, pb, b1);
  };
  rec(0, a.length, 0, b.length);
  return ops;
}
const tok = (s, kind) => s.split(kind === "h" ? /(?<=>)/ : /(?<=})/);
const applica = (base, kind, patch) => {
  const a = tok(base, kind);
  let outS = "";
  let pos = 0;
  for (const [s, n, ins] of patch) {
    outS += a.slice(pos, s).join("") + ins;
    pos = s + n;
  }
  return outS + a.slice(pos).join("");
};

const texts = [];
const byHash = new Map();
const pieni = []; // indici dei testi pieni, per tipo e etichetta
function metti(text, kind, label) {
  const h = createHash("sha1").update(text).digest("hex");
  if (byHash.has(h)) return byHash.get(h);
  let best = null;
  for (const p of pieni) {
    if (p.kind !== kind || p.label !== label) continue;
    const a = tok(p.text, kind);
    const b = tok(text, kind);
    const ops = diff(a, b);
    const patch = ops.map(([s, n, bs, bn]) => [s, n, b.slice(bs, bs + bn).join("")]);
    const size = JSON.stringify(patch).length;
    if (size < text.length * 0.4 && (!best || size < best.size)) best = { base: p.idx, patch, size };
  }
  const idx = texts.length;
  if (best) {
    if (applica(texts[best.base], kind, best.patch) !== text) throw new Error("toppa sbagliata");
    texts.push({ b: best.base, k: kind, p: best.patch });
  } else {
    texts.push(text);
    pieni.push({ idx, kind, label, text });
  }
  byHash.set(h, idx);
  return idx;
}
// per le toppe serve il testo pieno della base
const testoDi = (i) => (typeof texts[i] === "string" ? texts[i] : applica(testoDi(texts[i].b), texts[i].k, texts[i].p));
const caps = {};
const ids = new Set(STATI.flatMap((s) => [s.id, s.w700].filter(Boolean)));
for (const id of ids) {
  for (const light of ["light", "dark"]) {
    const j = JSON.parse(await readFile(join(cat, `${id}-${light}.json`), "utf8"));
    caps[`${id}-${light}`] = {
      a: j.attrs,
      ba: j.bodyAttrs,
      b: metti(pulisciBody(j.body), "h", "body"),
      c: j.css.filter((s) => s.text.trim()).map((s) => [s.label, s.media, metti(pulisciCss(s.text), "c", s.label)]),
      v: j.viewport,
      t: j.title,
    };
  }
}
// i testi toppa si riferiscono a testi pieni: controlla
for (let i = 0; i < texts.length; i += 1) testoDi(i);
const dati = { fonts, texts, caps };
const blob = gzipSync(Buffer.from(JSON.stringify(dati)), { level: 9 }).toString("base64");

// ── La pagina ────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noScriptEnd = (s) => s.replace(/<\/(script|style)/gi, "<\\/$1");
const gruppi = [...new Set(STATI.map((s) => s.g))];
const opzioni = gruppi
  .map((g) => `      <optgroup label="${g}">\n${STATI.filter((s) => s.g === g).map((s) => `        <option value="${s.id}">${esc(s.nome)}</option>`).join("\n")}\n      </optgroup>`)
  .join("\n");
const statiJs = JSON.stringify(STATI.map(({ id, nome, w700, fuoco, dice, task }) => ({ id, nome, w700, fuoco, dice, task })));
const destCss = destinazioni.map((d) => `<style media="not all" data-destinazione="${d.dest}" data-posto="${d.posto}">\n${noScriptEnd(d.css)}</style>`).join("\n");
const varCss = VARIANTI.map((v) => `<style media="not all" data-variante="${v.nome}" data-posto="${v.dove}">\n${noScriptEnd(v.css)}</style>`).join("\n");
const tolte = [
  ["skin/sheets.css", "`.format-bar`, `.format-bar-group`, `.format-bar-group:last-of-type`, `.format-bar-button`, `.format-bar-menu` (la barra di formato agganciata; la bolla della selezione tiene le sue)", "T17"],
  ["skin/media.css", "`.media-pdf-toolbar` e `.media-pdf-toolbar > button|input|select` (righe 384–456 di main)", "T18"],
  ["skin/draw.css", "`.draw-header`; `.draw-button` e `.draw-group` valgono solo fuori dalla fila (`:not(.kit-bar-button)`, `:not(.kit-bar-group)`)", "T22"],
  ["structure.css, skin/editors.css", "le regole generiche `.grid-ribbon-*` e `.rich-ribbon-*` che diventano `.kit-ribbon-*` (restano «Comandi», tavolozza, galleria, campioni)", "T20, T21"],
  ["ui/node.ts", "gli stili in linea di `list_item` (passano in `structure.css`)", "T9"],
  ["panels/document.ts", "`.pane-format` (il gettone del formato) e la vista di `.segmented` nella testata; `.pane-mode-current` esce dalla testata e diventa figlio del foglio, dopo la barra di formato", "T3, T5"],
  ["structure.css", "`.pane-toolbar > .pane-mode-current` e la regola dell'ordine dei segmenti: il bottone non è più nella testata", "T3"],
  ["skin/sheets.css", "`.pane-toolbar > .pane-mode-current`, la freccia `::after` compresa (l'anello del fuoco resta, su `.pane > .pane-mode-current`), e la parte dei segmenti nella regola di contenitore `sheet-head`: resta «…» a 24 px", "T17"],
];
const tolteHtml = tolte.map(([f, cosa, t]) => `          <li><b>${esc(f)}</b>: ${esc(cosa).replace(/`([^`]+)`/g, "<code>$1</code>")} <span class="proto-task">${t}</span></li>`).join("\n");
const destList = destinazioni.map((d) => `          <li><code>${esc(d.dest)}</code></li>`).join("\n");

const html = `<!doctype html>
<html lang="it" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scrittoio 2</title>
<!--
  Il prototipo di Scrittoio 2 (piano/scrittoio-2). Lo schermo è il client vero
  del banco (anteprima/tutto del 2026-11-04, IPC finta) fotografato stato per
  stato: DOM e CSS copiati, compressi qui sotto e rimontati in un iframe senza
  script. Sopra il CSS copiato si monta il CSS nuovo, un <style> per file di
  destinazione (in ordine: structure.css, la pelle secondo skin/order.ts,
  mobile.css). Il DOM nuovo (la banda, la testata, la riga dei dati…) è già
  nella cattura: è quello che i task costruiscono. Il computer è approvato
  (2026-11-04); il telefono è approvato per ora (2026-11-04), e un piano
  successivo lo rifà. «Com'era» rimette sopra tutto le regole di oggi
  dell'ombra del foglio, del vassoio e delle sezioni, per il confronto. La
  lavagna segue il piano N6 (lavagna-schede.html): qui non ha stati suoi.
-->
<style>
/* La pagina del prototipo, fuori dallo schermo. */
:root {
  /* da foundation.css */
  --bg: #e8edf5;
  --sheet: #fcfdff;
  --sheet-2: #f3f6f9;
  --bg-elev: #ffffff;
  --text: #1a1f29;
  --muted: #5a5f6a;
  --border: #d3d8e0;
  --accent: #2b56cc;
  --accent-wash: #d8e5ff;
  --focus-ring: #2b56cc;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-7: 20px;
  --space-8: 24px;
  --radius-chip: 6px;
  --radius-control: 8px;
  --radius-sheet: 12px;
  --font-ui: "Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* da foundation.css */
    --bg: #0a0e16;
    --sheet: #151a21;
    --sheet-2: #1d222a;
    --bg-elev: #212730;
    --text: #e5e8ed;
    --muted: #a0a5ae;
    --border: #2c323c;
    --accent: #82a8fd;
    --accent-wash: #213156;
    --focus-ring: #82a8fd;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  /* da foundation.css */
  --bg: #0a0e16;
  --sheet: #151a21;
  --sheet-2: #1d222a;
  --bg-elev: #212730;
  --text: #e5e8ed;
  --muted: #a0a5ae;
  --border: #2c323c;
  --accent: #82a8fd;
  --accent-wash: #213156;
  --focus-ring: #82a8fd;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 var(--font-ui);
  overflow-x: hidden;
}
.proto-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4) var(--space-6);
  padding: var(--space-4) var(--space-6);
  background: var(--sheet-2);
  border-bottom: 1px solid var(--border);
}
.proto-bar h1 { margin: 0 var(--space-4) 0 0; font-size: 15px; font-weight: 600; }
.proto-field { display: inline-flex; align-items: center; gap: var(--space-3); }
.proto-bar select, .proto-bar button {
  min-height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg-elev);
  color: var(--text);
  font: inherit;
  padding: 0 var(--space-5);
}
.proto-bar select { max-width: min(100%, 22rem); }
.proto-seg {
  display: inline-flex;
  margin: 0;
  padding: 2px;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--bg-elev);
  box-shadow: 0 0 0 1px var(--border);
}
.proto-seg legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.proto-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.proto-seg label {
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-chip);
  color: var(--muted);
  cursor: pointer;
}
.proto-seg input:checked + label { background: var(--accent-wash); color: var(--accent); }
.proto-seg input:disabled + label { opacity: 0.45; cursor: default; }
.proto-seg input:focus-visible + label, .proto-bar select:focus-visible, .proto-bar button:focus-visible, .proto-decidere input:focus-visible + label {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.proto-bar button[aria-pressed="true"] { background: var(--accent-wash); color: var(--accent); border-color: transparent; }
main { padding: var(--space-6); max-width: 1340px; margin: 0 auto; }
.proto-decidere {
  margin: 0 0 var(--space-6);
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-sheet);
  background: var(--sheet);
  box-shadow: 0 0 0 1px var(--border);
}
.proto-decidere h2 { margin: 0 0 var(--space-4); font-size: 15px; }
.proto-decidere p { margin: 0 0 var(--space-4); color: var(--muted); }
.proto-scelte { display: flex; flex-wrap: wrap; gap: var(--space-5) var(--space-8); }
.proto-scelte fieldset { margin: 0; padding: 0; border: 0; }
.proto-scelte legend { padding: 0; margin-bottom: var(--space-3); font-weight: 600; }
.proto-scelte .proto-seg { margin-top: 0; }
.proto-schermo-box {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-sheet);
  box-shadow: 0 0 0 1px var(--border), 0 8px 24px rgb(0 0 0 / 0.12);
  background: var(--sheet);
  margin: 0 auto;
}
.proto-schermo-box iframe { display: block; border: 0; transform-origin: 0 0; background: var(--bg); }
.proto-didascalia { margin: var(--space-6) 0 var(--space-4); }
.proto-didascalia h2 { margin: 0 0 var(--space-3); font-size: 16px; }
.proto-didascalia p { margin: 0 0 var(--space-3); max-width: 70ch; }
.proto-task {
  display: inline-block;
  padding: 0 var(--space-3);
  border-radius: var(--radius-chip);
  background: var(--accent-wash);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
details { margin: var(--space-4) 0; padding: var(--space-4) var(--space-6); border-radius: var(--radius-control); background: var(--sheet-2); }
summary { cursor: pointer; font-weight: 600; }
details li { margin: var(--space-2) 0; }
code { font-size: 12.5px; }
@media (max-width: 600px) {
  .proto-bar { padding: var(--space-4); }
  main { padding: var(--space-6) var(--space-6); }
}
</style>
<!-- Il CSS nuovo, un blocco per file di destinazione: spento qui (media="not all"), lo monta lo schermo. -->
${destCss}
<!-- Le varianti delle scelte da decidere guardando: si montano dopo il CSS nuovo. -->
${varCss}
<!-- → ui/icons.ts: le figure nuove (testo, non eseguito). -->
<script type="text/plain" data-destinazione="ui/icons.ts">
${noScriptEnd(iconeBlocco)}</script>
<style id="proto-scala"></style>
<script type="application/json" id="proto-dati">"${blob}"</script>
</head>
<body>
<header class="proto-bar" aria-label="Comandi del prototipo">
  <h1>Scrittoio 2</h1>
  <span class="proto-field">
    <label for="proto-stato">Stato</label>
    <select id="proto-stato">
${opzioni}
    </select>
  </span>
  <fieldset class="proto-seg" id="proto-luce">
    <legend>Luce</legend>
    <input type="radio" name="luce" id="luce-giorno" value="light" checked><label for="luce-giorno">Giorno</label>
    <input type="radio" name="luce" id="luce-notte" value="dark"><label for="luce-notte">Notte</label>
  </fieldset>
  <fieldset class="proto-seg" id="proto-larghezza">
    <legend>Larghezza</legend>
    <input type="radio" name="larghezza" id="larghezza-piena" value="piena" checked><label for="larghezza-piena">Piena</label>
    <input type="radio" name="larghezza" id="larghezza-700" value="700"><label for="larghezza-700">700 px</label>
  </fieldset>
  <button type="button" id="proto-fuoco" aria-pressed="false">Fuoco sul controllo principale</button>
</header>
<main>
  <section class="proto-decidere" aria-labelledby="decidere-titolo">
    <h2 id="decidere-titolo">Com'era</h2>
    <p>Il computer è approvato (2026-11-04: il menu col segno a destra e le scorciatoie in tasti, il titolo a 600). Il telefono è approvato per ora (2026-11-04), col tondo in basso a destra: un piano successivo lo rifà da capo. Le ultime tre correzioni si confrontano con com'erano: accese, lo schermo torna alle regole di oggi.</p>
    <div class="proto-scelte">
      <fieldset class="proto-scelta">
        <legend>Rimetti com'era</legend>
        <span class="proto-seg">
          <input type="checkbox" name="prima" id="prima-ombra" value="ombra"><label for="prima-ombra">L'ombra del foglio (T27)</label>
          <input type="checkbox" name="prima" id="prima-vassoio" value="vassoio"><label for="prima-vassoio">Il vassoio delle barre (T16, T20)</label>
          <input type="checkbox" name="prima" id="prima-sezioni" value="sezioni"><label for="prima-sezioni">Le sezioni della barra (T20)</label>
        </span>
      </fieldset>
    </div>
  </section>
  <div class="proto-schermo-box" id="proto-box">
    <iframe id="proto-schermo" title="Lo schermo di Fub nello stato scelto" sandbox="allow-same-origin"></iframe>
  </div>
  <section class="proto-didascalia" aria-live="polite">
    <h2 id="proto-nome"></h2>
    <p id="proto-dice"></p>
    <p>Task: <span id="proto-task"></span></p>
  </section>
  <details>
    <summary>L'ordine del Tab</summary>
    <ul>
      <li>Dalla banda: le voci della superficie (per esempio «38 parole»), «Si scrive», la modalità, poi gli altri bottoni della banda; si ricomincia dal salto all'editor, la barra del titolo, il binario, la striscia degli spazi, l'albero.</li>
      <li>La modalità è un <code>button</code> con <code>aria-haspopup="menu"</code>: Invio, Spazio e Freccia su aprono il menu col fuoco sulla voce scelta; Esc lo chiude e rende il fuoco al bottone.</li>
      <li>La testata non ha più fermate per la modalità: i segmenti non si vedono e non sono nell'ordine del Tab. Il bottone della modalità è un figlio del foglio, dopo la barra di formato: sul computer non si vede e non è una fermata; al telefono in piedi è la fermata che segue la barra di formato (o la testata, quando la barra non c'è), prima del testo.</li>
      <li>Le barre nella fila di serie tengono l'ordine di oggi; «…» è l'ultima fermata della fila.</li>
    </ul>
  </details>
  <details>
    <summary>Le regole che si tolgono</summary>
    <ul>
${tolteHtml}
    </ul>
  </details>
  <details>
    <summary>I file di destinazione del CSS nuovo</summary>
    <ul>
${destList}
    </ul>
  </details>
</main>
<script>
(() => {
  "use strict";
  const STATI = ${statiJs};
  const $ = (id) => document.getElementById(id);
  const frame = $("proto-schermo");
  const box = $("proto-box");
  let dati = null;
  const testi = [];
  const fontUrl = new Map();
  const scelto = { stato: "nota", luce: "light", larghezza: "piena", fuoco: false, prima: new Set() };

  const tok = (s, kind) => s.split(kind === "h" ? /(?<=>)/ : /(?<=})/);
  function testo(i) {
    if (testi[i] !== undefined) return testi[i];
    const t = dati.texts[i];
    if (typeof t === "string") return (testi[i] = t);
    const a = tok(testo(t.b), t.k);
    let out = "";
    let pos = 0;
    for (const [s, n, ins] of t.p) {
      out += a.slice(pos, s).join("") + ins;
      pos = s + n;
    }
    return (testi[i] = out + a.slice(pos).join(""));
  }
  const bytes = (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
  };
  async function carica() {
    const b64 = JSON.parse($("proto-dati").textContent);
    const stream = new Blob([bytes(b64)]).stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let json = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      json += dec.decode(value, { stream: true });
    }
    json += dec.decode();
    dati = JSON.parse(json);
    for (const [name, b] of dati.fonts) {
      const u = bytes(b);
      fontUrl.set(name, URL.createObjectURL(new Blob([u], { type: "font/woff2" })));
      if (name.startsWith("hanken")) {
        const face = new FontFace("Hanken Grotesk Variable", u.buffer, { weight: "100 900", style: name.endsWith("italic") ? "italic" : "normal" });
        document.fonts.add(face);
        face.load().catch(() => {});
      }
    }
  }
  const conFont = (css) => css.replace(/\\/fonts\\/([\\w-]+)\\.woff2/g, (m, n) => fontUrl.get(n) ?? m);
  const attr = (pairs) => pairs.map(([k, v]) => \` \${k}="\${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"\`).join("");
  const stile = (css, label) => \`<style data-proto="\${label}">\${css.replace(/<\\/style/gi, "<\\\\/style")}</style>\`;
  const blocco = (sel) => [...document.querySelectorAll(sel)].map((s) => s.textContent).join("\\n");

  function capId() {
    const s = STATI.find((x) => x.id === scelto.stato);
    const id = scelto.larghezza === "700" && s.w700 ? s.w700 : s.id;
    return \`\${id}-\${scelto.luce}\`;
  }
  function documento(cap) {
    // Il CSS nuovo va dove andrà nel codice: structure.css subito dopo il suo
    // foglio, la pelle (e i valori di serie) dopo la pelle, mobile.css dopo il suo.
    const nuovo = { struttura: blocco('style[data-posto="struttura"]'), pelle: blocco('style[data-posto="pelle"]:not([data-variante])'), telefono: blocco('style[data-posto="telefono"]:not([data-variante])'), serie: blocco('style[data-posto="serie"]') };
    const prima = [...scelto.prima].map((v) => blocco(\`style[data-variante="prima-\${v}"]\`)).join("\\n");
    let head = '<meta charset="utf-8">';
    let messi = { struttura: false, pelle: false, telefono: false };
    for (const [label, media, i] of cap.c) {
      head += stile(conFont(testo(i)), label).replace("<style", media ? \`<style media="\${media}"\` : "<style");
      if (label === "src/theme/scrittoio/structure.css") (head += stile(nuovo.struttura, "nuovo:struttura")), (messi.struttura = true);
      if (label === "fub:pelle") (head += stile(nuovo.pelle, "nuovo:pelle")), (messi.pelle = true);
      if (label === "src/shells/scrittoio/mobile/mobile.css") (head += stile(nuovo.telefono, "nuovo:telefono")), (messi.telefono = true);
    }
    if (!messi.struttura) head += stile(nuovo.struttura, "nuovo:struttura");
    if (!messi.pelle) head += stile(nuovo.pelle, "nuovo:pelle");
    if (!messi.telefono) head += stile(nuovo.telefono, "nuovo:telefono");
    // I valori di serie del corpo e della misura vengono dopo le preferenze, come
    // farebbe series.ts cambiato (le preferenze di partenza ne derivano).
    head += stile(nuovo.serie, "nuovo:serie");
    // «Com'era», sopra tutto.
    if (prima) head += stile(prima, "com'era");
    return \`<!doctype html><html\${attr(cap.a)}><head>\${head}<title>\${cap.t.replace(/</g, "&lt;")}</title></head><body\${attr(cap.ba)}>\${testo(cap.b)}</body></html>\`;
  }
  function ripristina(doc) {
    for (const el of doc.querySelectorAll("[data-proto-style]")) el.setAttribute("style", el.getAttribute("data-proto-style"));
    const r = doc.documentElement;
    if (r.hasAttribute("data-proto-style")) r.setAttribute("style", r.getAttribute("data-proto-style"));
    // Un canvas disegnato da fuori non si ridipinge in un frame senza script:
    // al suo posto va un'immagine con gli stessi attributi e la stessa misura.
    const MISURE = ["display", "position", "top", "right", "bottom", "left", "width", "height", "min-height", "margin", "border-radius", "box-shadow", "background-color", "z-index", "pointer-events"];
    const tele = [...doc.querySelectorAll("canvas[data-proto-src]")].map((c) => {
      const cs = doc.defaultView.getComputedStyle(c);
      const misure = MISURE.map((k) => \`\${k}: \${cs.getPropertyValue(k)}\`).join("; ");
      const img = doc.createElement("img");
      for (const a of c.attributes) if (!["data-proto-src", "width", "height", "style"].includes(a.name)) img.setAttribute(a.name, a.value);
      if (!img.hasAttribute("aria-label")) img.alt = "";
      img.setAttribute("style", misure);
      img.src = c.getAttribute("data-proto-src");
      c.replaceWith(img);
      return img.decode().catch(() => {});
    });
    scorri(doc);
    return Promise.all(tele);
  }
  // Il segno delle schede lo mette il kit, misurando la scheda scelta
  // (\`kit/tabs.ts\`, \`place\`): qui lo si rimisura, perché il CSS nuovo ne
  // cambia le misure e la cattura ha quelle di prima.
  function segni(doc) {
    for (const ind of doc.querySelectorAll(".kit-tab-indicator:not([hidden])")) {
      const fila = ind.parentElement;
      const scelta = fila.querySelector(':scope > .kit-tab[aria-selected="true"]');
      if (!scelta) continue;
      if (fila.getAttribute("aria-orientation") === "vertical") {
        ind.style.top = \`\${scelta.offsetTop}px\`;
        ind.style.height = \`\${scelta.offsetHeight}px\`;
      } else {
        ind.style.left = \`\${scelta.offsetLeft}px\`;
        ind.style.width = \`\${scelta.offsetWidth}px\`;
      }
    }
  }
  function scorri(doc) {
    for (const el of doc.querySelectorAll("[data-proto-scroll]")) {
      const [x, y] = el.getAttribute("data-proto-scroll").split(",").map(Number);
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
  function metti_fuoco(doc) {
    const s = STATI.find((x) => x.id === scelto.stato);
    if (!scelto.fuoco) return;
    // Il primo controllo visibile e acceso che risponde al selettore dello stato.
    const visibile = (el) => !el.disabled && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0);
    const el = [...doc.querySelectorAll(s.fuoco)].find(visibile) ?? doc.querySelector("[data-proto-focus]");
    el?.focus({ preventScroll: true, focusVisible: true });
  }
  function scala() {
    const cap = dati.caps[capId()];
    const w = cap.v.w;
    const h = cap.v.h;
    const main = box.parentElement;
    const cs = getComputedStyle(main);
    const avail = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const s = Math.min(1, avail / w);
    frame.width = String(w);
    frame.height = String(h);
    $("proto-scala").textContent = \`#proto-schermo { transform: scale(\${s}); } #proto-box { width: \${Math.round(w * s)}px; height: \${Math.round(h * s)}px; }\`;
  }
  function mostra() {
    if (!dati) return;
    const s = STATI.find((x) => x.id === scelto.stato);
    const d700 = !s.w700;
    $("larghezza-700").disabled = d700;
    if (d700 && scelto.larghezza === "700") {
      scelto.larghezza = "piena";
      $("larghezza-piena").checked = true;
    }
    document.documentElement.setAttribute("data-theme", scelto.luce);
    const cap = dati.caps[capId()];
    delete box.dataset.pronto;
    scala();
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      Promise.all([ripristina(doc), doc.fonts.ready]).then(() => {
        segni(doc);
        scorri(doc);
        requestAnimationFrame(() => {
          metti_fuoco(doc);
          box.dataset.pronto = capId();
        });
      });
    };
    frame.srcdoc = documento(cap);
    $("proto-nome").textContent = s.nome;
    $("proto-dice").textContent = s.dice;
    $("proto-task").textContent = s.task.join(", ");
  }
  $("proto-stato").addEventListener("change", (e) => ((scelto.stato = e.target.value), mostra()));
  for (const r of document.querySelectorAll('input[name="luce"]')) r.addEventListener("change", (e) => ((scelto.luce = e.target.value), mostra()));
  for (const r of document.querySelectorAll('input[name="larghezza"]')) r.addEventListener("change", (e) => ((scelto.larghezza = e.target.value), mostra()));
  for (const c of document.querySelectorAll('input[name="prima"]')) c.addEventListener("change", (e) => (e.target.checked ? scelto.prima.add(e.target.value) : scelto.prima.delete(e.target.value), mostra()));
  $("proto-fuoco").addEventListener("click", (e) => {
    scelto.fuoco = !scelto.fuoco;
    e.currentTarget.setAttribute("aria-pressed", String(scelto.fuoco));
    const doc = frame.contentDocument;
    if (doc && scelto.fuoco) metti_fuoco(doc);
    else if (doc) doc.activeElement?.blur?.();
  });
  addEventListener("resize", () => dati && scala());
  const q = new URLSearchParams(location.search);
  if (q.get("stato") && STATI.some((x) => x.id === q.get("stato"))) scelto.stato = q.get("stato");
  if (q.get("luce") === "dark") scelto.luce = "dark";
  if (q.get("larghezza") === "700") scelto.larghezza = "700";
  for (const v of (q.get("prima") ?? "").split(",")) if (["ombra", "vassoio", "sezioni"].includes(v)) scelto.prima.add(v);
  $("proto-stato").value = scelto.stato;
  $("luce-notte").checked = scelto.luce === "dark";
  $("larghezza-700").checked = scelto.larghezza === "700";
  for (const v of scelto.prima) $(\`prima-\${v}\`).checked = true;
  carica().then(mostra);
})();
</script>
</body>
</html>
`;
await writeFile(out, html);
console.log("scritto", out, Math.round(html.length / 1024), "KB; testi", texts.length, "di cui toppe", texts.filter((t) => typeof t !== "string").length, "; dati", Math.round(blob.length / 1024), "KB");
