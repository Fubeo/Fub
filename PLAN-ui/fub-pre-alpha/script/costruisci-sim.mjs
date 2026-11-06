// Costruisce il simulatore v2 di Fub pre-alpha in <out>/:
//   simulatore.html     la pagina: il CSS nuovo per file di destinazione, il DOM
//                       nuovo (<template data-toppa>), i comandi del simulatore
//   sim-dati-N.js       le catture compresse (gzip, base64 a pezzi di ~6 MB)
//   sim-stati.js        l'elenco degli stati, gli scenari, i pezzi, i piani
//   vista-sim.js        la vista (monta uno stato nell'iframe)
//   solo-simulatore.js  le interazioni finte (non vanno nel codice)
//   piani/*.html        le pagine approvate dei piani, tali e quali
//   dal-prototipo.md    la tabella «Dal prototipo» per PLAN.md
// node costruisci-sim.mjs <out>
//
// Le catture del client (catture/, centinaia di MB) non stanno nel repository.
// Senza di loro lo script riusa i dati già impacchettati: DATI=<cartella con
// sim-dati-N.js> (di solito PLAN-ui/fub-pre-alpha stessa). Così toppe,
// blocchi, scenari, vista e interazioni si rifanno dal repository; per
// cambiare una cattura serve catturarla di nuovo (cattura.mjs).
// Con DATI, RIFATTE=<cartella di <id>-<luce>.json presi da cattura.mjs>
// sostituisce solo quelle catture (o ne aggiunge di nuove) e tiene le altre
// impacchettate: così basta catturare di nuovo gli stati che cambiano.
import { readFile, writeFile, readdir, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pulisciBody, texts, metti, testoDi, impostaFinestra } from "./impacco.mjs";
import { costruisciElenco, GRUPPI, PIANI, TEL_CSS, root } from "./elenco-sim.mjs";
import { SCENARI } from "./scenari-sim.mjs";
import { PEZZI } from "./pezzi-sim.mjs";
import { ECCEZIONI } from "./eccezioni-sim.mjs";
import { datiDi } from "./dati-sim.mjs";

const t0 = Date.now();
const here = dirname(fileURLToPath(import.meta.url));
const [out] = process.argv.slice(2);
if (!out) throw new Error("uso: node costruisci-sim.mjs <out>");
// I dati di prima, se si costruisce senza catture: vanno letti prima di
// scrivere, perché <out> può essere la stessa cartella.
const prima = process.env.DATI ? await datiDi(process.env.DATI) : null;
if (process.env.RIFATTE && !prima) throw new Error("RIFATTE vale solo con DATI");
const rifatte = new Map(
  process.env.RIFATTE
    ? (await readdir(process.env.RIFATTE)).filter((f) => /-(light|dark)\.json$/.test(f)).map((f) => [f.replace(/\.json$/, ""), join(process.env.RIFATTE, f)])
    : [],
);
await mkdir(join(out, "piani"), { recursive: true });
// I caratteri dal client delle catture (FUB_CLIENT); servono solo senza DATI.
const fontsDir = join(process.env.FUB_CLIENT ?? join(root, "../../apps/client"), "public/fonts");
const temiFile = process.env.TEMI ?? join(root, "out", "temi.json");
const PIANO = join(root, "piani");
const avvisi = [];

// ── Il DOM nuovo: i <template data-toppa> di toppe/*.html ───────────────────
// Ogni modello comincia col commento di destinazione «→ file; task» e non ha
// stili in linea: lo stile sta nei blocchi CSS, come nel codice.
const templates = new Map(); // id → { file, nome, dest, task }
const toppeHtml = [];
const problemi = [];
for (const f of (await readdir(join(root, "toppe"))).filter((f) => f.endsWith(".html")).sort()) {
  const text = await readFile(join(root, "toppe", f), "utf8");
  if (/\sstyle\s*=/i.test(text)) problemi.push(`${f}: uno stile in linea`);
  if (/<script/i.test(text)) problemi.push(`${f}: uno script`);
  for (const m of text.matchAll(/<template data-toppa="([^"]+)"([^>]*)>([\s\S]*?)<\/template>/g)) {
    const [, id, resto, corpo] = m;
    const c = /^\s*<!-- → ([\s\S]*?) -->/.exec(corpo);
    if (!c) problemi.push(`${f} ${id}: manca il commento di destinazione`);
    const nome = /data-nome="([^"]*)"/.exec(resto)?.[1];
    if (!nome) problemi.push(`${f} ${id}: manca data-nome`);
    if (templates.has(id)) problemi.push(`${f} ${id}: doppio (anche in ${templates.get(id).file})`);
    const commento = (c?.[1] ?? "").replace(/\s+/g, " ").trim();
    const i = commento.lastIndexOf("; ");
    templates.set(id, { file: f, nome, dest: i < 0 ? commento : commento.slice(0, i), task: i < 0 ? "" : commento.slice(i + 2) });
  }
  toppeHtml.push(`<!-- toppe/${f} -->\n${text.trim()}`);
}
if (problemi.length) throw new Error(`toppe:\n  ${problemi.join("\n  ")}`);

// ── L'elenco degli stati (assegna i numeri S nuovi in numeri-sim.json) ───────
const { elenco, catture, indice } = costruisciElenco({
  templates: new Set(templates.keys()),
  indice: prima ? new Map([...Object.keys(prima.caps).map((k) => [k, "DATI"]), ...rifatte]) : null,
});
const per = new Map(elenco.map((s) => [s.id, s]));
const usate = new Set(elenco.flatMap((s) => s.toppe.filter((t) => t.html).map((t) => t.html)));
for (const id of templates.keys()) if (!usate.has(id)) avvisi.push(`toppa mai usata: ${id}`);
for (const sc of SCENARI) {
  for (const [k, p] of sc.passi.entries()) {
    if (!per.has(p.stato)) throw new Error(`scenario ${sc.id}, passo ${k + 1}: stato sconosciuto ${p.stato}`);
    if (p.larghezza && !["piena", "700", "tel"].includes(p.larghezza)) throw new Error(`scenario ${sc.id}: larghezza ${p.larghezza}`);
  }
}

// ── Il CSS nuovo, per file di destinazione ──────────────────────────────────
const VAR = /\/\*\s*variante ([\w-]+)\s*\*\/([\s\S]*?)\/\*\s*fine variante \1\s*\*\//g;
const blocchi = {};
for (const f of (await readdir(join(root, "blocchi"))).filter((f) => f.endsWith(".css")).sort()) {
  blocchi[f.replace(/\.css$/, "")] = await readFile(join(root, "blocchi", f), "utf8");
}
const corpo = (text) => text.replace(/^\/\* → [^*\n]*\*\/\n/, "");
const senzaVarianti = (text) => text.replace(VAR, "");
// [destinazione, posto nello schermo, blocchi, task, tema]
// «struttura», «pelle», «telefono» e «serie» sono di Scrittoio 2; «prealpha» è
// il CSS nuovo di questo piano (tiene la sua intestazione: dice già file e
// task); «tema» sono i due temi d'esempio, montati solo quando lo stato li veste.
const DEST = [
  ["theme/scrittoio/structure.css", "struttura", ["00-structure", "70-kit-struttura", "70f-kit-fila-struttura"], "S2 T3, T4, T9, T16, T20, T21, T27"],
  ["theme/scrittoio/skin/kit.css", "pelle", ["71-kit", "72-kit-vassoio", "71f-kit-fila"], "S2 T16, T20"],
  ["theme/scrittoio/skin/frame.css", "pelle", ["10-frame"], "S2 T3, T4, T7, T9"],
  ["theme/scrittoio/skin/drawers.css", "pelle", ["20-drawers", "21-icone"], "S2 T8, T14"],
  ["theme/scrittoio/skin/tree.css", "pelle", ["30-tree"], "S2 T8"],
  ["theme/scrittoio/skin/sheets.css", "pelle", ["40-sheets"], "S2 T5, T6, T27"],
  ["theme/scrittoio/skin/document.css", "pelle", ["50-document"], "S2 T11, T12"],
  ["theme/scrittoio/skin/media.css", "pelle", ["85-media", "86-craft"], "S2 T18, T19"],
  ["theme/scrittoio/skin/nodes.css", "pelle", ["60-nodes", "61-nodes"], "S2 T9, T13"],
  ["theme/scrittoio/skin/graph.css", "pelle", ["81-graph"], "S2 T10"],
  ["theme/scrittoio/skin/menus.css", "pelle", ["65-menus"], "S2 T10"],
  ["theme/scrittoio/skin/launcher.css", "pelle", ["82-launcher"], "S2 T10"],
  ["theme/scrittoio/skin/centres.css", "pelle", ["45-centres"], "S2 T5"],
  ["theme/scrittoio/skin/settings.css", "pelle", ["80-settings"], "S2 T10"],
  ["theme/scrittoio/skin/welcome.css", "pelle", ["83-welcome"], "S2 T10"],
  ["shells/scrittoio/mobile/mobile.css", "telefono", ["90-mobile"], "S2 T3, T4, T5, T7, T11, T27"],
  ["theme/scrittoio/series.ts", "serie", ["01-series"], "S2 T11"],
  ["theme/scrittoio/recipe.ts", "serie", ["02-ruoli"], "S2 T16, T27"],
  ["theme/scrittoio/skin/frame.css", "prealpha", ["92-prealpha-banda"], "D5 A: K5 T21–T23 con S2 T4"],
  ["theme/scrittoio/skin/draw.css", "prealpha", ["92-prealpha-disegno"], "K5 T21, PA T27"],
  ["theme/scrittoio/skin/settings.css", "prealpha", ["92-prealpha-impostazioni"], "PA T29, T36–T38"],
  ["theme/scrittoio/skin/nodes.css", "prealpha", ["92-prealpha-lavagna"], "N6 T26–T28, PA T28"],
  ["theme/scrittoio/skin/media.css", "prealpha", ["92-prealpha-media"], "PA T30"],
  ["theme/examples/carta/ (fogli e skin.css)", "tema", ["93-tema-carta"], "PA T42, D17", "carta"],
  ["theme/examples/salvia/ (i due fogli)", "tema", ["93-tema-salvia"], "PA T42, D17", "salvia"],
];
const usati = new Set(DEST.flatMap((d) => d[2]));
for (const k of Object.keys(blocchi)) if (!usati.has(k)) throw new Error(`blocco senza destinazione: ${k}`);
for (const d of DEST) for (const f of d[2]) if (!blocchi[f]) throw new Error(`blocco che non c'è: ${f}`);
const destinazioni = DEST.map(([dest, posto, files, task, tema]) => {
  const proprio = posto === "prealpha" || posto === "tema";
  const css = proprio
    ? files.map((f) => senzaVarianti(blocchi[f]).trim()).join("\n\n") + "\n"
    : (blocchi[files[0]].startsWith(`/* → ${dest}:`) ? "" : `/* → ${dest} (${task}) */\n`) + files.map((f) => corpo(senzaVarianti(blocchi[f])).trim()).join("\n\n") + "\n";
  return { dest, posto, task, tema, files, css };
});

// ── I caratteri: tutti quelli che Aspetto può scegliere ─────────────────────
const fonts = prima ? prima.fonts : [];
if (!prima) {
  for (const f of (await readdir(fontsDir)).filter((f) => f.endsWith(".woff2")).sort()) {
    fonts.push([f.replace(/\.woff2$/, ""), (await readFile(join(fontsDir, f))).toString("base64")]);
  }
}
const tutti = new Set(fonts.map(([n]) => n));
const pulisci = (css) =>
  css.replace(/@font-face\s*{[^}]*}/g, (rule) => {
    const m = /\/fonts\/([\w-]+)\.woff2/.exec(rule);
    return m && !tutti.has(m[1]) ? "" : rule;
  });

// ── Le catture: in ordine di id, chiaro e scuro vicini (la finestra delle
// toppe di impacco.mjs guarda solo i vicini) ─────────────────────────────────
impostaFinestra(10);
const caps = {};
// Senza catture: la tabella dei testi e le catture tornano come erano (gli
// indici dei testi restano gli stessi).
if (prima) texts.push(...prima.texts);
for (const id of [...catture].sort()) {
  for (const luce of ["light", "dark"]) {
    const p = indice.get(`${id}-${luce}`);
    if (!p) throw new Error(`cattura mancante: ${id}-${luce}`);
    if (prima && p === "DATI") {
      caps[`${id}-${luce}`] = prima.caps[`${id}-${luce}`];
      continue;
    }
    const j = JSON.parse(await readFile(p, "utf8"));
    caps[`${id}-${luce}`] = {
      a: j.attrs,
      ba: j.bodyAttrs,
      b: metti(pulisciBody(j.body), "h", "body"),
      c: j.css.filter((s) => s.text.trim()).map((s) => [s.label, s.media, metti(pulisci(s.text), "c", s.label)]),
      v: j.viewport,
      t: j.title,
    };
  }
}
for (let i = 0; i < texts.length; i += 1) testoDi(i);
const tCatture = Date.now();

// ── L'albero: che stato apre ogni file, dove si vede aperta ogni cartella ────
const PREFERITI = {
  "Benvenuto.md": "nota-riposo",
  "Guida/Live.md": "live-tabella",
  "Guida/Sintassi di Fub.md": "schede",
  "Disegni/logo-studio.vectorcraft": "craft",
  "Connettori.svg": "disegno",
  "Documenti/Oggetti.docx": "documento-oggetti",
  "Documenti/Prova.docx": "documento",
  "Documenti/Riservato.docx": "sola-lettura",
  "Dati/Conti.xlsx": "foglio",
  "Foto/IMG_0398.CR3": "foto",
  "Casa/Affitto di via Roma.md": "nota-pdf",
  "Casa/contratto-affitto.pdf": "pdf",
  "Progetti/Mappa del banco.canvas": "lav-impianto",
};
const fileStato = {};
for (const [path, stato] of Object.entries(PREFERITI)) {
  if (!per.has(stato)) throw new Error(`stato sconosciuto per ${path}: ${stato}`);
  fileStato[path] = stato;
}
const cartelle = {};
for (const id of [...catture].sort()) {
  if (!per.has(id)) continue;
  const body = testoDi(caps[`${id}-light`].b);
  for (const m of body.matchAll(/<li[^>]*data-path="([^"]+)"[^>]*aria-expanded="true"[^>]*>/g)) {
    if (!cartelle[m[1]]) cartelle[m[1]] = id;
  }
}

// ── I dati, a pezzi ─────────────────────────────────────────────────────────
// I temi (D12 B) vengono da temi-sim.mjs; senza catture, dai dati di prima
// se TEMI non dice altro.
const temi = prima && !process.env.TEMI ? prima.temi : JSON.parse(await readFile(temiFile, "utf8"));
const dati = { fonts, texts, caps, fileStato, cartelle, temi };
const blob = gzipSync(Buffer.from(JSON.stringify(dati)), { level: 9 }).toString("base64");
const PARTE = 6 * 1024 * 1024; // multiplo di 4: ogni pezzo si decodifica da solo
for (const f of await readdir(out)) if (/^sim-dati(-\d+)?\.js$/.test(f)) await rm(join(out, f));
const parti = [];
for (let i = 0, k = 1; i < blob.length; i += PARTE, k += 1) {
  const nome = `sim-dati-${k}.js`;
  await writeFile(join(out, nome), `// solo simulatore: le catture del client vero del banco, compresse (gzip, base64), pezzo ${k}.\n(window.SIM_DATI_PARTI ||= []).push("${blob.slice(i, i + PARTE)}");\n`);
  parti.push(nome);
}

// ── L'elenco per la pagina ──────────────────────────────────────────────────
const js = (v) => JSON.stringify(v).replace(/<\/(script)/gi, "<\\/$1");
await writeFile(
  join(out, "sim-stati.js"),
  [
    "// solo simulatore: l'elenco degli stati (con il numero S, la provenienza, le",
    "// toppe e gli strati), i gruppi, gli scenari, i pezzi, le pagine dei piani e",
    "// le eccezioni ai clic. Generato da costruisci-sim.mjs: non si modifica a mano.",
    `window.SIM_STATI = ${js(elenco)};`,
    `window.SIM_GRUPPI = ${js(GRUPPI)};`,
    `window.SIM_SCENARI = ${js(SCENARI)};`,
    `window.SIM_PEZZI = ${js(PEZZI)};`,
    `window.SIM_PIANI = ${js(PIANI)};`,
    `window.SIM_ECCEZIONI = ${js(ECCEZIONI)};`,
    `window.SIM_TEL_CSS = ${js(TEL_CSS)};`,
    "",
  ].join("\n"),
);
await copyFile(join(here, "vista-sim.js"), join(out, "vista-sim.js"));
await copyFile(join(here, "solo-simulatore.js"), join(out, "solo-simulatore.js"));

// ── Le pagine dei piani ─────────────────────────────────────────────────────
const fontePiani = process.env.PROTO ?? (existsSync(PIANO) ? PIANO : join(out, "piani"));
for (const p of PIANI) {
  const src = join(fontePiani, p.file);
  const dst = join(out, "piani", p.file);
  if (resolve(src) === resolve(dst)) continue;
  let html = await readFile(src, "utf8");
  if (!/^\s*<!doctype/i.test(html)) {
    html = `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${html}\n</head>\n<body></body>\n</html>\n`;
  }
  await writeFile(dst, html);
}

// ── «Dal prototipo»: la tabella per PLAN.md ─────────────────────────────────
const pianoDi = new Map(PIANI.map((p) => [p.id, p]));
const PROV = { cattura: "cattura", composta: "composta, da approvare", nuova: "nuova, da approvare" };
const pipe = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
// Un pezzo preso da un'altra cattura: se la cattura è una pagina approvata
// (p-*), la fonte è la pagina; se è il client, è il DOM del client delle
// catture, spostato. «Il DOM» da solo non si scrive mai: dice sempre di chi.
const paginaDi = new Map(JSON.parse(await readFile(join(here, "piani-giro2.json"), "utf8")).map((x) => [x.id, x.pagina.split("/").pop()]));
const pezzoDa = (da) => (paginaDi.has(da) ? `un pezzo di piani/${paginaDi.get(da)} (la pagina approvata, cattura ${da})` : `un pezzo della cattura ${da} (il DOM del client delle catture, spostato)`);
const destStato = (s) => {
  const d = new Set();
  for (const t of s.toppe) if (t.html) d.add(`toppe: ${templates.get(t.html).dest}`);
  for (const t of s.toppe) if (t.da) d.add(pezzoDa(t.da));
  if (s.strati.length && s.piano) d.add(`piani/${pianoDi.get(s.piano).file}`);
  if (s.tema) d.add(DEST.find((x) => x[4] === s.tema)[0]);
  if (d.size) return [...d].join("; ");
  // Nessun pezzo nuovo: la cattura (o lo stato composto da sole catture) dà il
  // DOM del client delle catture; «I pezzi di questo stato» dice quali pezzi
  // sono uguali a main e quali sono un ritocco di Scrittoio 2.
  return s.prov === "cattura" ? "la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi" : "catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi";
};
const righeStati = elenco.map((s) => `| S${s.n} | \`${s.id}\` | ${pipe(GRUPPI.find(([g]) => g === s.g)[1])} | ${PROV[s.prov]} | ${pipe(s.task.join(", "))} | ${pipe(destStato(s))} |`);
const chiUsa = (id) => elenco.filter((s) => s.toppe.some((t) => t.html === id)).map((s) => `S${s.n}`);
const righePezzi = [...templates].map(([id, t]) => `| \`${id}\` | ${pipe(t.nome)} | ${pipe(t.dest)} | ${pipe(t.task)} | ${chiUsa(id).join(", ") || "—"} |`);
const righeCss = destinazioni.map((d) => `| \`${d.dest}\` | ${d.posto} | ${d.files.map((f) => `\`${f}.css\``).join(", ")} | ${pipe(d.task)} | ${Math.round(d.css.length / 102.4) / 10} KB |`);
const conta = (p) => elenco.filter((s) => s.prov === p).length;
const nDi = new Map(elenco.map((s) => [s.id, s.n]));
const righeScenari = SCENARI.map((sc) => `| \`${sc.id}\` | ${pipe(sc.nome)} | ${sc.passi.length} | ${sc.passi.map((x) => `S${nDi.get(x.stato)}`).join(" → ")} |`);
await writeFile(
  join(out, "dal-prototipo.md"),
  [
    "<!-- Generato da PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs: non si modifica a mano. -->",
    "",
    `${elenco.length} stati: ${conta("cattura")} catture, ${conta("composta")} composti, ${conta("nuova")} nuovi da approvare. ${SCENARI.length} scenari.`,
    "",
    "#### Gli stati",
    "",
    "| S | Stato | Gruppo | Provenienza | Task | Da dove si copia |",
    "|---|---|---|---|---|---|",
    ...righeStati,
    "",
    "#### Gli scenari",
    "",
    "| Scenario | Che cosa fa la persona | Passi | Gli stati, in ordine |",
    "|---|---|---|---|",
    ...righeScenari,
    "",
    "#### I pezzi nuovi (DOM scritto a mano, `toppe/*.html`)",
    "",
    "| Modello | Che cos'è | Destinazione | Task | Stati |",
    "|---|---|---|---|---|",
    ...righePezzi,
    "",
    "#### Il CSS nuovo",
    "",
    "| File | Posto | Blocchi | Task | Peso |",
    "|---|---|---|---|---|",
    ...righeCss,
    "",
  ].join("\n"),
);

// ── La pagina ───────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noScriptEnd = (s) => s.replace(/<\/(script|style)/gi, "<\\/$1");
const destCss = destinazioni
  .map((d) => `<style media="not all" data-destinazione="${esc(d.dest)}" data-posto="${d.posto}"${d.tema ? ` data-tema="${d.tema}"` : ""} data-task="${esc(d.task)}">\n${noScriptEnd(d.css)}</style>`)
  .join("\n");
const destList = destinazioni.map((d) => `        <tr><td><code>${esc(d.dest)}</code></td><td>${esc(d.posto)}</td><td>${esc(d.task)}</td><td>${Math.round(d.css.length / 102.4) / 10} KB</td></tr>`).join("\n");
const pianiList = PIANI.map((p) => `        <li><a href="piani/${p.file}">${esc(p.nome)}</a> <span class="sim-task">${esc(p.piano)} ${esc(p.task)}</span> <span class="sim-muto">${esc(p.ok)}</span></li>`).join("\n");
const eccList = ECCEZIONI.length
  ? ECCEZIONI.map((e) => `        <li><code>${esc(e.sel ?? e.testo)}</code>: ${esc(e.perche)}</li>`).join("\n")
  : "        <li>Nessuna: ogni clic porta a uno stato, cambia lo schermo o dice che cosa farebbe.</li>";

const html = `<!doctype html>
<html lang="it" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulatore pre-alpha</title>
<!--
  Il simulatore v2 di Fub pre-alpha (piano/fub-pre-alpha, PLAN-ui/fub-pre-alpha/).
  Lo schermo è il client vero del banco fotografato stato per stato: DOM e CSS
  copiati, compressi in sim-dati-N.js e rimontati in un iframe senza script.
  Sopra il CSS copiato si monta il CSS nuovo, un <style> per file di
  destinazione, nello stesso posto dove andrà nel codice. Il DOM nuovo sta nei
  <template data-toppa> in fondo a questa pagina, ognuno col suo commento di
  destinazione e task; le pagine dei piani (piani/) entrano nella cornice come
  strati. Ogni stato dice se è una cattura, composto o nuovo da approvare.
  vista-sim.js monta gli stati; solo-simulatore.js finge le interazioni.
  Nessuno dei due va nel codice.
-->
<style>
/* solo simulatore: la pagina attorno allo schermo. */
:root {
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
  --ok: #1d7a46;
  --ok-wash: #dcf3e5;
  --warn: #8a5a00;
  --warn-wash: #fbefd6;
  --new: #a3215f;
  --new-wash: #fbe1ec;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-8: 24px;
  --radius-chip: 6px;
  --radius-control: 8px;
  --radius-sheet: 12px;
  --font-ui: "Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae; --border: #2c323c;
    --accent: #82a8fd; --accent-wash: #213156; --focus-ring: #82a8fd; --ok: #7fd3a0; --ok-wash: #173326; --warn: #f0c46a; --warn-wash: #3a2e12;
    --new: #f59ac3; --new-wash: #3f1a2c;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae; --border: #2c323c;
  --accent: #82a8fd; --accent-wash: #213156; --focus-ring: #82a8fd; --ok: #7fd3a0; --ok-wash: #173326; --warn: #f0c46a; --warn-wash: #3a2e12;
  --new: #f59ac3; --new-wash: #3f1a2c;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.45 var(--font-ui); overflow-x: hidden; }
a { color: var(--accent); }
button { font: inherit; }
.sim-bar {
  position: sticky; top: 0; z-index: 3;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4) var(--space-6);
  padding: var(--space-4) max(var(--space-6), env(safe-area-inset-right)) var(--space-4) max(var(--space-6), env(safe-area-inset-left));
  background: var(--sheet-2); border-bottom: 1px solid var(--border);
}
.sim-bar h1 { margin: 0 var(--space-4) 0 0; font-size: 15px; font-weight: 600; }
.sim-field { display: inline-flex; align-items: center; gap: var(--space-3); min-width: 0; max-width: 100%; }
.sim-bar select, .sim-bar button, .sim-passi button, .sim-azioni button {
  min-height: 32px; border: 1px solid var(--border); border-radius: var(--radius-control);
  background: var(--bg-elev); color: var(--text); padding: 0 var(--space-5);
}
.sim-bar select { max-width: min(100%, 24rem); min-width: 0; }
.sim-seg { display: inline-flex; margin: 0; padding: 2px; border: 0; border-radius: var(--radius-control); background: var(--bg-elev); box-shadow: 0 0 0 1px var(--border); }
.sim-seg legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.sim-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.sim-seg label { padding: var(--space-2) var(--space-5); border-radius: var(--radius-chip); color: var(--muted); cursor: pointer; }
.sim-seg input:checked + label { background: var(--accent-wash); color: var(--accent); }
.sim-seg input:disabled + label { opacity: 0.4; cursor: default; }
.sim-seg input:focus-visible + label, select:focus-visible, button:focus-visible, a:focus-visible, textarea:focus-visible, input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--focus-ring); outline-offset: 2px;
}
button[aria-pressed="true"] { background: var(--accent-wash); color: var(--accent); border-color: transparent; }
button:disabled { opacity: 0.45; }
.sim-msg {
  min-height: 22px; margin: 0; padding: var(--space-2) max(var(--space-6), env(safe-area-inset-left));
  color: var(--warn); background: var(--warn-wash); font-size: 13px;
}
.sim-msg:empty { background: transparent; }
.sim-passi {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4) var(--space-5);
  padding: var(--space-4) max(var(--space-6), env(safe-area-inset-left));
  background: var(--accent-wash); color: var(--text);
}
.sim-passi[hidden] { display: none; }
.sim-passi b { color: var(--accent); }
.sim-passi span { flex: 1 1 20rem; min-width: 0; }
main { padding: var(--space-6) max(var(--space-6), env(safe-area-inset-right)) var(--space-8) max(var(--space-6), env(safe-area-inset-left)); max-width: 1340px; margin: 0 auto; }
.sim-box { position: relative; display: flex; justify-content: center; align-items: flex-start; gap: var(--space-6); }
.sim-fig { margin: 0; min-width: 0; }
.sim-fig[hidden] { display: none; }
.sim-fig figcaption { margin: 0 0 var(--space-3); font-size: 13px; color: var(--muted); }
.sim-fig figcaption[hidden] { display: none; }
#sim-fig-b .sim-vetro { cursor: pointer; }
.sim-vetro {
  overflow: hidden; border-radius: var(--radius-sheet);
  box-shadow: 0 0 0 1px var(--border), 0 8px 24px rgb(0 0 0 / 0.12); background: var(--sheet);
}
.sim-vetro iframe { display: block; border: 0; transform-origin: 0 0; background: var(--bg); }
.sim-segno { position: absolute; pointer-events: none; border: 2px solid var(--accent); border-radius: 4px; box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.18); }
.sim-segno[hidden] { display: none; }
.sim-manca { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-5); border-radius: var(--radius-control); background: var(--warn-wash); color: var(--warn); font-size: 13px; }
.sim-manca[hidden] { display: none; }
.sim-didascalia { margin: var(--space-6) 0 var(--space-4); }
.sim-didascalia h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-3) var(--space-4); margin: 0 0 var(--space-3); font-size: 16px; }
.sim-didascalia p { margin: 0 0 var(--space-3); max-width: 75ch; }
.sim-didascalia p[hidden] { display: none; }
.sim-numero { font-variant-numeric: tabular-nums; color: var(--muted); }
.sim-prov { display: inline-block; padding: 0 var(--space-3); border-radius: var(--radius-chip); font-size: 12px; font-weight: 600; }
.sim-prov[data-prov="cattura"] { background: var(--ok-wash); color: var(--ok); }
.sim-prov[data-prov="composta"] { background: var(--warn-wash); color: var(--warn); }
.sim-prov[data-prov="nuova"] { background: var(--new-wash); color: var(--new); }
.sim-azioni { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.sim-azioni button[hidden] { display: none; }
.sim-task { display: inline-block; padding: 0 var(--space-3); border-radius: var(--radius-chip); background: var(--accent-wash); color: var(--accent); font-size: 12px; font-weight: 600; }
.sim-muto { color: var(--muted); font-size: 13px; }
.sim-come { display: inline-block; padding: 0 var(--space-3); border-radius: var(--radius-chip); font-size: 12px; font-weight: 600; }
.sim-come[data-come="nuovo"] { background: var(--new-wash); color: var(--new); }
.sim-come[data-come="cambiato"], .sim-come[data-come="composto"] { background: var(--warn-wash); color: var(--warn); }
.sim-come[data-come="uguale"] { background: var(--ok-wash); color: var(--ok); }
.sim-pezzi { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
.sim-pezzi li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2) var(--space-5); padding: var(--space-4) var(--space-5); border-radius: var(--radius-control); background: var(--sheet); box-shadow: 0 0 0 1px var(--border); }
.sim-pezzi .sim-dest { grid-column: 1 / -1; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.sim-pezzi button { border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-elev); color: var(--text); font-size: 13px; padding: 2px var(--space-4); }
.sim-pezzi pre { grid-column: 1 / -1; max-height: 260px; overflow: auto; margin: 0; padding: var(--space-4); border-radius: var(--radius-chip); background: var(--sheet-2); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.sim-pezzi pre[hidden] { display: none; }
.sim-revisione { list-style: none; margin: var(--space-4) 0 0; padding: 0; columns: 2 22rem; column-gap: var(--space-8); }
.sim-revisione li { break-inside: avoid; margin: 0 0 var(--space-2); }
.sim-revisione label { color: var(--muted); font-size: 13px; white-space: nowrap; }
.sim-frase { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
.sim-frase textarea { flex: 1 1 24rem; min-width: 0; min-height: 3.2em; padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-elev); color: var(--text); font: inherit; resize: vertical; }
.sim-frase button { min-height: 32px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--bg-elev); color: var(--text); padding: 0 var(--space-5); }
details { margin: var(--space-4) 0; padding: var(--space-4) var(--space-6); border-radius: var(--radius-control); background: var(--sheet-2); }
summary { cursor: pointer; font-weight: 600; }
details li { margin: var(--space-2) 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: top; }
code { font-size: 12.5px; overflow-wrap: anywhere; }
.sim-tabella { overflow-x: auto; }
@media (max-width: 600px) {
  .sim-bar { gap: var(--space-3) var(--space-4); }
  .sim-bar h1 { width: 100%; }
  .sim-field { width: 100%; }
  .sim-bar select { flex: 1 1 auto; max-width: none; }
  .sim-box { gap: var(--space-4); }
}
</style>
<!-- Il CSS nuovo, un blocco per file di destinazione: spento qui (media="not all"), lo monta lo schermo. -->
${destCss}
<style id="sim-scala"></style>
</head>
<body>
<header class="sim-bar" aria-label="Comandi del simulatore">
  <h1>Fub pre-alpha · simulatore</h1>
  <span class="sim-field">
    <label for="sim-stato">Stato</label>
    <select id="sim-stato"></select>
  </span>
  <span class="sim-field">
    <label for="sim-scenario">Scenario</label>
    <select id="sim-scenario"><option value="">Nessuno</option></select>
  </span>
  <fieldset class="sim-seg" id="sim-luce">
    <legend>Luce</legend>
    <input type="radio" name="luce" id="luce-giorno" value="light" checked><label for="luce-giorno">Giorno</label>
    <input type="radio" name="luce" id="luce-notte" value="dark"><label for="luce-notte">Notte</label>
  </fieldset>
  <fieldset class="sim-seg" id="sim-larghezza">
    <legend>Larghezza</legend>
    <input type="radio" name="larghezza" id="larghezza-piena" value="piena" checked><label for="larghezza-piena">Piena</label>
    <input type="radio" name="larghezza" id="larghezza-700" value="700"><label for="larghezza-700">700 px</label>
    <input type="radio" name="larghezza" id="larghezza-tel" value="tel"><label for="larghezza-tel">Telefono</label>
  </fieldset>
  <fieldset class="sim-seg" id="sim-moto">
    <legend>Movimento</legend>
    <input type="radio" name="moto" id="moto-pieno" value="pieno" checked><label for="moto-pieno">Pieno</label>
    <input type="radio" name="moto" id="moto-calmo" value="calmo"><label for="moto-calmo">Calmo</label>
    <input type="radio" name="moto" id="moto-ridotto" value="ridotto"><label for="moto-ridotto">Ridotto</label>
  </fieldset>
  <button type="button" id="sim-fuoco" aria-pressed="false">Fuoco sul controllo principale</button>
  <button type="button" id="sim-segna" aria-pressed="false">Segna il nuovo</button>
</header>
<p class="sim-msg" id="sim-msg" role="status" aria-live="polite"></p>
<nav class="sim-passi" id="sim-passi" aria-label="I passi dello scenario" hidden>
  <button type="button" id="sim-passo-prima">← Indietro</button>
  <span><b id="sim-passo-n"></b> · <span id="sim-passo-dice"></span></span>
  <button type="button" id="sim-passo-fuori" hidden>Torna al passo</button>
  <button type="button" id="sim-passo-dopo">Avanti →</button>
</nav>
<main>
  <div class="sim-box" id="sim-box" data-solo>
    <figure class="sim-fig" id="sim-fig-a">
      <figcaption id="sim-cap-a" hidden></figcaption>
      <div class="sim-vetro"><iframe id="sim-schermo" title="Lo schermo di Fub nello stato scelto" sandbox="allow-same-origin"></iframe></div>
    </figure>
    <figure class="sim-fig" id="sim-fig-b" hidden>
      <figcaption id="sim-cap-b"></figcaption>
      <div class="sim-vetro"><iframe id="sim-gemello" title="L'altra forma dello stesso stato, da confrontare" sandbox="allow-same-origin"></iframe></div>
    </figure>
    <div class="sim-segno" id="sim-segno" hidden></div>
  </div>
  <p class="sim-manca" id="sim-manca" role="alert" hidden></p>
  <section class="sim-didascalia" aria-live="polite">
    <h2><span class="sim-numero" id="sim-numero"></span><span id="sim-nome"></span><span class="sim-prov" id="sim-provenienza"></span></h2>
    <p id="sim-dice"></p>
    <p id="sim-perche" class="sim-muto" hidden></p>
    <p id="sim-vicino" class="sim-muto" hidden></p>
    <p>Task: <span id="sim-task"></span></p>
    <p id="sim-piano" hidden>La pagina del piano: <a id="sim-piano-link" href="#"></a></p>
    <p class="sim-azioni">
      <button type="button" id="sim-rivedi" aria-pressed="false">Da rivedere</button>
      <button type="button" id="sim-azzera">Aspetto di serie</button>
    </p>
  </section>
  <details open>
    <summary>I pezzi di questo stato</summary>
    <p class="sim-muto">Ogni pezzo dice il file che lo costruisce e il task. «nuovo» è DOM scritto a mano per questo piano (con «Segna il nuovo» si vede nello schermo); «composto» è DOM vero spostato o la pagina di un piano; «cambiato» e «uguale» dicono se il DOM di main cambia. «Indica» lo segna; «DOM» mostra quello da copiare.</p>
    <ul class="sim-pezzi" id="sim-pezzi"></ul>
    <p class="sim-muto" id="sim-pezzi-vuoto" hidden>Nessun pezzo segnato in questo stato.</p>
  </details>
  <details>
    <summary>Approvare gli stati nuovi e composti (<span id="sim-conta-rivedere">0</span> da rivedere)</summary>
    <p class="sim-muto">Gli stati «nuova» e «composta» aspettano un sì. Segna quelli da rivedere (anche col bottone sotto lo schermo): la frase si scrive da sola, da incollare nella risposta. Il segno resta in questo browser.</p>
    <div class="sim-frase">
      <textarea id="sim-frase" readonly aria-label="La frase di approvazione"></textarea>
      <button type="button" id="sim-copia">Copia la frase</button>
    </div>
    <ul class="sim-revisione" id="sim-revisione"></ul>
  </details>
  <details>
    <summary>Che cosa si può fare nello schermo</summary>
    <ul>
      <li>Ogni controllo risponde: porta a un altro stato, cambia lo schermo, o dice in alto che cosa farebbe. I clic che non portano altrove sono elencati sotto.</li>
      <li>Nell'albero un file apre il suo editor, una cartella si apre e si chiude. Le linguette portano alla loro scheda. «Nuovo» chiede il tipo.</li>
      <li>Nella nota si scrive davvero (non si salva). «/» apre il menu dei blocchi: frecce, Invio, Esc, e le lettere filtrano. Il tasto destro apre il menu giusto.</li>
      <li>Ctrl+O, Ctrl+K o la pillola aprono l'avvio rapido; Ctrl+P i comandi. Il menu del marchio, il chip del vault, l'attività e l'ispettore portano ai loro stati.</li>
      <li>Impostazioni › Aspetto: tema, contrasto, densità, accento, spazio dell'interfaccia, zoom, corpo, interlinea, misura e carattere cambiano davvero lo schermo, e restano negli altri stati (D12 B).</li>
      <li>Al telefono: scorrere verso l'alto apre il cassetto, verso il basso torna indietro, una pressione lunga apre il menu.</li>
      <li>Gli scenari vanno passo per passo con Avanti e Indietro; «Segna il nuovo» circonda il DOM scritto a mano.</li>
    </ul>
  </details>
  <details>
    <summary>I clic che non portano altrove</summary>
    <ul>
${eccList}
    </ul>
  </details>
  <details>
    <summary>Il CSS nuovo, per file di destinazione</summary>
    <div class="sim-tabella"><table>
      <thead><tr><th>File</th><th>Posto</th><th>Task</th><th>Peso</th></tr></thead>
      <tbody>
${destList}
      </tbody>
    </table></div>
    <p class="sim-muto">Il testo sta nei blocchi <code>&lt;style data-destinazione&gt;</code> in testa a questa pagina, già senza le varianti «com'era». «prealpha» è il CSS di questo piano; «tema» sono i due temi d'esempio.</p>
  </details>
  <details>
    <summary>Le pagine dei piani</summary>
    <ul>
${pianiList}
    </ul>
  </details>
</main>
<div hidden id="sim-toppe">
${toppeHtml.join("\n")}
</div>
${parti.map((p) => `<script src="${p}"></script>`).join("\n")}
<script src="sim-stati.js"></script>
<script src="solo-simulatore.js"></script>
<script src="vista-sim.js"></script>
</body>
</html>
`;
if (/\sstyle\s*=/i.test(html.replace(/<template[\s\S]*?<\/template>/g, ""))) throw new Error("la pagina ha uno stile in linea");
await writeFile(join(out, "simulatore.html"), html);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(
  `scritto ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s (catture ${((tCatture - t0) / 1000).toFixed(1)} s)\n`,
  `pagina ${kb(html.length)}; dati ${kb(blob.length)} in ${parti.length} pezzi; catture ${Object.keys(caps).length}; testi ${texts.length}, toppe ${texts.filter((t) => typeof t !== "string").length}\n`,
  `stati ${elenco.length} (cattura ${conta("cattura")}, composta ${conta("composta")}, nuova ${conta("nuova")}); scenari ${SCENARI.length}; modelli ${templates.size}`,
);
for (const a of avvisi) console.log("avviso:", a);
