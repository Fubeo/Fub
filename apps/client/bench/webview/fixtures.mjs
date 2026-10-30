// Il vault e la configurazione degli scenari, scritti in una cartella
// temporanea: mai il vault di chi misura.
//
// - `S1/Lunga.md`: una nota di 5.000 righe (S1);
// - `S2/Nota 00001.md` … `S2/Nota 10000.md`: diecimila note, ognuna col suo
//   titolo e tre collegamenti alle vicine, così sono anche il grafo di S4;
// - `S3/Lavagna.canvas`: trecento schede, venti delle quali note vive;
// - `S5/Foglio.svg`: un disegno pesante, duemila tracciati, per la penna;
// - `S7/Blocchi.md`: una nota di 2.000 righe a blocchi, per i Blocchi;
// - `config/settings.json`: le impostazioni di macchina con la sonda accesa.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/// Scrive vault e configurazione sotto `root` e ne restituisce i percorsi.
export function writeFixtures(root) {
  const vault = join(root, "vault");
  const config = join(root, "config");
  for (const dir of ["S1", "S2", "S3", "S5", "S7"]) mkdirSync(join(vault, dir), { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(join(vault, "S1", "Lunga.md"), longNote());
  for (let i = 1; i <= NOTES; i++) writeFileSync(join(vault, "S2", `${noteName(i)}.md`), note(i));
  writeFileSync(join(vault, "S3", "Lavagna.canvas"), board());
  writeFileSync(join(vault, "S5", "Foglio.svg"), drawing());
  writeFileSync(join(vault, "S7", "Blocchi.md"), blocksNote());
  // Il formato del livello macchina (`fub_kernel::settings`, schema 2).
  writeFileSync(join(config, "settings.json"), JSON.stringify({ version: 2, values: { "perf.probe": true } }, null, 2) + "\n");
  return { vault, config };
}
