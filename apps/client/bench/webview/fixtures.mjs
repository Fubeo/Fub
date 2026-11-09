// Il vault e la configurazione degli scenari, scritti in una cartella
// temporanea: mai il vault di chi misura.
//
// - `S1/Lunga.md`: una nota di 5.000 righe (S1);
// - `S2/Nota 00001.md` … `S2/Nota 10000.md`: diecimila note, ognuna col suo
//   titolo e tre collegamenti alle vicine, così sono anche il grafo di S4;
// - `S3/Lavagna.canvas`: trecento schede, venti delle quali note vive;
// - `S5/Foglio.svg`: un disegno pesante, duemila tracciati, per la penna;
// - `S7/Blocchi.md`: una nota di 2.000 righe a blocchi, per i Blocchi;
// - `R1/`: un file per modalità, per la memoria (R1): un documento Word e
//   un PDF e un'immagine presi dalle prove del repo, e un foglio Excel
//   scritto qui;
// - `T1/Tessere.png`: un fotogramma di 2880 × 1800 RGBA senza compressione,
//   i byte che T1 legge a tessere;
// - `S8/Lezione.canvas` e `S8/voti.xlsx`: la lavagna dell'inchiostro di N4
//   (S8): una scheda con una tabella Markdown di 100 × 100 celle, una scheda
//   col foglio `.xlsx` di 100 × 100 celle e 2000 tratti già scritti sulle
//   due schede e sulla lavagna;
// - `config/settings.json`: le impostazioni di macchina con la sonda accesa.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { FRAME, storedPng } from "./tiles.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/// I file di R1 presi dalle prove del repo: il nome nel vault e da dove.
export const MODE_FILES = {
  "Documento.docx": "crates/fub-format-rich/tests/corpus/docx/stili-elenchi-tabelle.docx",
  "Stampa.pdf": "crates/fub-features/tests/baselines/draw/scena.pdf",
  "Immagine.png": "crates/fub-features/tests/baselines/draw/scena.png",
};

export const NOTES = 10_000;
export const LONG_LINES = 5_000;
export const BLOCK_LINES = 2_000;
export const CARDS = 300;
export const LIVE_CARDS = 20;

/// Il nome della nota `i` di S2, da 1 a `NOTES`.
export const noteName = (i) => `Nota ${String(i).padStart(5, "0")}`;

function longNote() {
  const lines = ["# Una nota lunga", ""];
  for (let i = 1; lines.length < LONG_LINES; i++) {
    if (i % 40 === 0) lines.push(`## Sezione ${i / 40}`, "");
    else lines.push(`Riga ${i}: il corso di analisi del lunedì, con **una parola** in grassetto e un [[${noteName((i % NOTES) + 1)}]].`);
  }
  return lines.slice(0, LONG_LINES).join("\n") + "\n";
}

/// Paragrafi, titoli e voci separati da righe vuote: un blocco ogni due righe.
function blocksNote() {
  const lines = ["# Una nota a blocchi", ""];
  for (let i = 1; lines.length < BLOCK_LINES; i++) {
    if (i % 25 === 0) lines.push(`## Capitolo ${i / 25}`, "");
    else if (i % 7 === 0) lines.push(`- Blocco ${i}: una voce dell'elenco`, "");
    else lines.push(`Blocco ${i}: un paragrafo da spostare, con **una parola** in grassetto.`, "");
  }
  return lines.slice(0, BLOCK_LINES).join("\n") + "\n";
}

function note(i) {
  const near = [i - 1, i + 1, i + 97].map((n) => ((n - 1 + NOTES) % NOTES) + 1);
  return `# ${noteName(i)}\n\nUna nota del vault grande. Rimanda a ${near.map((n) => `[[${noteName(n)}]]`).join(", ")}.\n\n- una voce\n- un'altra voce\n`;
}

function board() {
  const nodes = [];
  const columns = 20;
  for (let i = 0; i < CARDS; i++) {
    const x = (i % columns) * 280;
    const y = Math.floor(i / columns) * 220;
    const base = { id: `scheda-${i}`, x, y, width: 240, height: 180 };
    nodes.push(i < LIVE_CARDS
      ? { ...base, type: "file", file: `S2/${noteName(i + 1)}.md` }
      : { ...base, type: "text", text: `## Scheda ${i}\n\nUn appunto della lavagna, con un elenco:\n\n- primo\n- secondo` });
  }
  const edges = nodes.slice(1).map((node, i) => ({ id: `arco-${i}`, fromNode: nodes[i].id, toNode: node.id }));
  return JSON.stringify({ nodes, edges }, null, 2) + "\n";
}

function drawing() {
  const paths = [];
  for (let i = 0; i < 2_000; i++) {
    const x = (i * 37) % 1600;
    const y = (i * 53) % 1000;
    paths.push(`<path d="M ${x} ${y} c 20 -30 40 30 60 0 s 40 30 60 0" fill="none" stroke="#335" stroke-width="2"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">\n${paths.join("\n")}\n</svg>\n`;
}

/// Un archivio ZIP senza compressione: abbastanza per un `.xlsx` di prova.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8");
    const file = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, file, data);
    centrals.push(central, file);
    offset += local.length + file.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/// La lettera della colonna `n`, da 1: `A`, …, `Z`, `AA`, …
function column(n) {
  let name = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

/// Un foglio di `height` righe per `width` colonne, il testo nella prima e
/// numeri nelle altre, nel minimo che un `.xlsx` vuole: di serie 200 × 6, il
/// foglio di R1.
function workbook(height = 200, width = 6) {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rows = [];
  for (let r = 1; r <= height; r++) {
    const cells = [`<c r="A${r}" t="inlineStr"><is><t>Riga ${r}</t></is></c>`];
    for (let c = 2; c <= width; c++) cells.push(`<c r="${column(c)}${r}"><v>${r * (c - 1)}</v></c>`);
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="Conti" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetData>${rows.join("")}</sheetData></worksheet>`],
  ]);
}

/// S8: le celle della tabella e del foglio (righe × colonne, l'intestazione
/// della tabella compresa), i tratti già scritti e i campioni di ognuno.
export const INK_TABLE = { rows: 100, columns: 100 };
export const INK_STROKES = 2_000;
const INK_SAMPLES = 24;

/// S8: le schede della lavagna, coi nomi che lo scenario cerca. T23 rilancia
/// lo stesso scenario sugli stessi dati: cambia solo che cosa la scheda del
/// `.xlsx` mostra.
export const INK_BOARD = {
  file: "S8/Lezione.canvas",
  sheet: "S8/voti.xlsx",
  table: { id: "tabella", x: 0, y: 0, width: 1200, height: 800 },
  sheetCard: { id: "voti", x: 1260, y: 0, width: 640, height: 420 },
  // I tratti liberi stanno sotto le schede, in coordinate della lavagna.
  free: { x: 0, y: 860, width: 1900, height: 600 },
};

/// I tratti per livello: metà sulla tabella, un quarto sul foglio, un quarto
/// liberi.
const INK_SHARE = { tabella: 1_000, voti: 500, free: 500 };

/// Il pennello e il colore della penna di serie della lavagna (D-5).
const INK_BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
const INK_COLOR = "#0072b2";

/// Il piccolo codificatore della §5 di `docs/reference/scene-format.md`:
/// scala 100, canali `xypt`, il primo campione assoluto e gli altri come
/// differenza dal precedente, ogni valore quantizzato con
/// `floor(v × scala + 0,5)`.
function encodeInk(samples) {
  const quantized = samples.map(({ x, y, p, t }) => [Math.floor(x * 100 + 0.5), Math.floor(y * 100 + 0.5), Math.floor(p * 255 + 0.5), Math.floor(t + 0.5)]);
  const fields = quantized.map((sample, i) => sample.map((value, j) => {
    const delta = i === 0 ? value : value - quantized[i - 1][j];
    return String(delta === 0 ? 0 : delta);
  }).join(","));
  return `1 s100 cxypt ${fields.join(" ")}`;
}

/// Il tratto `k` di un livello largo `width` e alto `height` con l'origine
/// in `ox`, `oy`: un'onda corta, sempre la stessa per lo stesso `k`, dentro
/// il livello.
function inkStroke(prefix, k, { ox = 0, oy = 0, width, height }, anchor) {
  const x0 = ox + 20 + ((k * 137) % (width - 120));
  const y0 = oy + 30 + ((k * 71) % (height - 60));
  const samples = [];
  for (let i = 0; i < INK_SAMPLES; i++) {
    samples.push({ x: x0 + i * 3.5, y: y0 + 12 * Math.sin(i / 3 + k), p: 0.4 + ((i * 7 + k) % 40) / 100, t: i * 8 });
  }
  return { id: `${prefix}-${k}`, tool: "pen", at: "2026-11-02T09:20:31.250Z", brush: INK_BRUSH, color: INK_COLOR, anchor, ink: encodeInk(samples) };
}

/// Il livello `fub:ink` di una scheda: le unità sono quelle della scheda.
function cardInk(card, count) {
  const anchor = { kind: "card", width: card.width, height: card.height };
  return { v: 1, strokes: Array.from({ length: count }, (_, k) => inkStroke(`s8-${card.id}`, k, card, anchor)) };
}

/// Una tabella Markdown di `rows` righe (l'intestazione compresa) per
/// `columns` colonne.
function inkTable({ rows, columns }) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  const lines = [
    line(Array.from({ length: columns }, (_, c) => `C${c + 1}`)),
    line(Array(columns).fill("---")),
  ];
  for (let r = 1; r < rows; r++) lines.push(line(Array.from({ length: columns }, (_, c) => `${r}.${c + 1}`)));
  return `## Voti della lezione\n\n${lines.join("\n")}\n`;
}

/// La lavagna di S8.
function inkBoard() {
  const { table, sheetCard, free } = INK_BOARD;
  // Liberi vuol dire in coordinate della lavagna: sotto le schede.
  const area = { ox: free.x, oy: free.y, width: free.width, height: free.height };
  const freeStrokes = Array.from({ length: INK_SHARE.free }, (_, k) => inkStroke("s8-libero", k, area, { kind: "free" }));
  const nodes = [
    { id: table.id, type: "text", text: inkTable(INK_TABLE), x: table.x, y: table.y, width: table.width, height: table.height, "fub:ink": cardInk(table, INK_SHARE.tabella) },
    { id: sheetCard.id, type: "file", file: INK_BOARD.sheet, x: sheetCard.x, y: sheetCard.y, width: sheetCard.width, height: sheetCard.height, "fub:ink": cardInk(sheetCard, INK_SHARE.voti) },
  ];
  return JSON.stringify({ nodes, edges: [], "fub:ink": { v: 1, strokes: freeStrokes } }, null, 2) + "\n";
}

/// Scrive vault e configurazione sotto `root` e ne restituisce i percorsi.
export function writeFixtures(root) {
  const vault = join(root, "vault");
  const config = join(root, "config");
  for (const dir of ["S1", "S2", "S3", "S5", "S7", "S8", "R1", "T1"]) mkdirSync(join(vault, dir), { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(join(vault, "S1", "Lunga.md"), longNote());
  for (let i = 1; i <= NOTES; i++) writeFileSync(join(vault, "S2", `${noteName(i)}.md`), note(i));
  writeFileSync(join(vault, "S3", "Lavagna.canvas"), board());
  writeFileSync(join(vault, "S5", "Foglio.svg"), drawing());
  writeFileSync(join(vault, "S7", "Blocchi.md"), blocksNote());
  writeFileSync(join(vault, "R1", "Tabella.xlsx"), workbook());
  writeFileSync(join(vault, INK_BOARD.file), inkBoard());
  writeFileSync(join(vault, INK_BOARD.sheet), workbook(INK_TABLE.rows, INK_TABLE.columns));
  writeFileSync(join(vault, "T1", "Tessere.png"), storedPng(FRAME.width, FRAME.height));
  for (const [name, from] of Object.entries(MODE_FILES)) copyFileSync(join(repo, from), join(vault, "R1", name));
  // Il formato del livello macchina (`fub_kernel::settings`, schema 2).
  writeFileSync(join(config, "settings.json"), JSON.stringify({ version: 2, values: { "perf.probe": true } }, null, 2) + "\n");
  return { vault, config };
}
