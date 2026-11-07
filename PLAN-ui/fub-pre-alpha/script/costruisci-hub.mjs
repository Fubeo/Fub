// Costruisce la pagina dell'artifact «Fub pre-alpha» da PLAN.md.
// node costruisci-hub.mjs <PLAN.md> <cartella del simulatore> <out>
// In <out>: index.html, e accanto i file del simulatore (simulatore.html,
// sim-dati-N.js, sim-stati.js, vista-sim.js, solo-simulatore.js, piani/).
// `marked` viene da apps/client (FUB_CLIENT, o quello del repository).
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const qui = dirname(fileURLToPath(import.meta.url));
const client = process.env.FUB_CLIENT ?? join(qui, "../../../apps/client");
const { Marked } = await import(pathToFileURL(join(client, "node_modules/marked/lib/marked.esm.js")).href);

const [planPath, simDir, out] = process.argv.slice(2);
if (!out) throw new Error("uso: node costruisci-hub.mjs <PLAN.md> <sim> <out>");
await mkdir(out, { recursive: true });
const fileSim = ["simulatore.html", "sim-stati.js", "vista-sim.js", "solo-simulatore.js", ...(await readdir(simDir)).filter((f) => /^sim-dati-\d+\.js$/.test(f))];
for (const f of fileSim) await cp(join(simDir, f), join(out, f));
await cp(join(simDir, "piani"), join(out, "piani"), { recursive: true });

// Gli stati e gli scenari del simulatore, per i numeri della testa.
const finestra = {};
runInNewContext(await readFile(join(simDir, "sim-stati.js"), "utf8"), { window: finestra });
const STATI = finestra.SIM_STATI;
const SCENARI = finestra.SIM_SCENARI ?? [];
const daApprovare = STATI.filter((s) => s.prov !== "cattura").length;

const plan = await readFile(planPath, "utf8");
const commit = execSync("git rev-parse --short HEAD", { cwd: join(planPath, "..") }).toString().trim();

// ── Le sezioni di PLAN.md ────────────────────────────────────────────────────
const parti = plan.split(/^## /m);
const testa = parti.shift();
const sezioni = parti.map((p) => {
  const nl = p.indexOf("\n");
  return { titolo: p.slice(0, nl).trim(), corpo: p.slice(nl + 1) };
});
const sez = (t) => {
  const s = sezioni.find((x) => x.titolo === t);
  if (!s) throw new Error(`manca la sezione «${t}»`);
  return s;
};
const campo = (nome) => {
  const m = testa.match(new RegExp(`^${nome}:([\\s\\S]*?)(?=^[A-Z][^\\n:]*:|(?![\\s\\S]))`, "m"));
  return m ? m[1].trim().replace(/\s*\n\s*/g, " ") : "";
};

const slug = (t) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let prefisso = "x";
const ids = new Set();
const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      let id = `${prefisso}--${slug(text)}`;
      while (ids.has(id)) id += "-";
      ids.add(id);
      const liv = Math.min(6, depth + 1);
      return `<h${liv} id="${id}">${this.parser.parseInline(tokens)}</h${liv}>\n`;
    },
    link({ href, title, tokens }) {
      const t = this.parser.parseInline(tokens);
      return `<a href="${esc(href)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ""}>${t}</a>`;
    },
  },
});
const md = (testo, pre) => {
  prefisso = pre;
  return marked
    .parse(testo)
    .replace(/<table>/g, '<div class="tabella"><table>')
    .replace(/<\/table>/g, "</table></div>");
};
const sottoVoci = (testo, pre) =>
  [...testo.matchAll(/^### (.+)$/gm)].map((m) => ({ t: m[1].replace(/`/g, ""), id: `${pre}--${slug(m[1])}` }));
const indice = (voci) =>
  voci.length
    ? `<nav class="indice" aria-label="In questa parte"><ul>${voci.map((v) => `<li><a href="#${v.id}">${esc(v.t)}</a></li>`).join("")}</ul></nav>`
    : "";

// ── Parte 1 · il simulatore ─────────────────────────────────────────────────
const dalProto = sez("Dal prototipo");
const parte1 = `
<div class="sim-cornice">
  <div class="sim-testa">
    <p>Il simulatore di tutta la pre-alpha: ${STATI.length} stati, da S1 a S${Math.max(...STATI.map((s) => s.n))}, e
    ${SCENARI.length} scenari da passare con Avanti e Indietro. Si usa come il prodotto: ogni clic porta a uno stato,
    cambia lo schermo o dice che cosa farebbe. In alto si scelgono lo stato, lo scenario, la luce, la larghezza
    (piena, 700 px, telefono) e il movimento. Sotto lo schermo ogni stato dice da dove viene (cattura del client,
    composta, nuova) e dove va ogni suo pezzo. ${daApprovare} stati, i composti e i nuovi, aspettano un sì:
    «Approvare gli stati nuovi e composti» scrive la frase da incollare nella risposta.</p>
    <a class="bottone" href="simulatore.html" target="_blank" rel="noopener">Apri a tutta pagina</a>
  </div>
  <iframe id="sim-iframe" src="simulatore.html" title="Il simulatore di Fub pre-alpha" loading="eager"></iframe>
</div>
<div class="testo">
<h2 id="simulatore--dal-prototipo">Dal prototipo</h2>
${indice(sottoVoci(dalProto.corpo, "simulatore"))}
${md(dalProto.corpo, "simulatore")}
</div>`;

// ── Parte 2 · il backend ────────────────────────────────────────────────────
const back = sez("Il backend, area per area");
const parte2 = `<div class="testo">
<h2 id="backend--il-backend">Il backend, area per area</h2>
${indice(sottoVoci(back.corpo, "backend"))}
${md(back.corpo, "backend")}
</div>`;

// ── Parte 3 · la strada ─────────────────────────────────────────────────────
// La fase di ogni task PA viene dalle tabelle di «L'ordine» (la prima colonna,
// «PA T4, T5 · …»); la colonna «Dipende da» aggiunge la domanda che aspetta.
// Un task che non sta in nessuna tabella parte solo con la risposta alla sua
// domanda (la riga «Ondate» della testa).
const FASE = {};
for (const [, lettera, corpo] of sez("L'ordine").corpo.matchAll(/^### Fase ([A-D]) ·[^\n]*\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
  for (const riga of corpo.split("\n").filter((l) => /^\| PA T\d/.test(l))) {
    const celle = riga.split("|").map((c) => c.trim());
    const aspetta = [...`${celle[3]} ${celle[4]}`.matchAll(/(?:solo se|risposta a) (D\d+)/g)].map((m) => m[1]);
    for (const n of celle[1].split(" · ")[0].match(/T\d+/g) ?? []) {
      FASE[n] = `Fase ${lettera}${aspetta.length ? ` · aspetta ${[...new Set(aspetta)].join(", ")}` : ""}`;
    }
  }
}
const tasks = sezioni.filter((s) => /^T\d+ · /.test(s.titolo));
for (const t of tasks) {
  const num = t.titolo.split(" · ")[0];
  FASE[num] ??= "dopo la sua risposta";
}
const ultimoTask = tasks.at(-1).titolo.split(" · ")[0];
const fasi = new Set(Object.values(FASE).map((f) => f.split(" · ")[0]).filter((f) => f.startsWith("Fase"))).size;
const strada = ["La definizione", "Dentro e fuori", "L'ordine"].map(sez);
const diff = sez("Differenze fra piani e codice");
const voci3 = [
  ...strada.map((s) => ({ t: s.titolo, id: `strada--${slug(s.titolo)}` })),
  { t: `I task del piano (PA T1–${ultimoTask})`, id: "strada--i-task" },
  { t: diff.titolo, id: `strada--${slug(diff.titolo)}` },
];
const blocco = (s) => `<h2 id="strada--${slug(s.titolo)}">${esc(s.titolo)}</h2>\n${md(s.corpo, "strada")}`;
// I campi del modello ognuno nel suo paragrafo, l'etichetta in grassetto; la
// prova come comandi.
const CAMPI = /^(Perché|Ramo|Chi|Tocca|Non toccare|Dipende da|Cosa fare|Dal prototipo|Casi limite|Fatto quando|Prova|Stato):\s?/;
const campi = (t) =>
  t
    .split("\n")
    .map((l) => {
      const m = l.match(CAMPI);
      if (!m) return l;
      let resto = l.slice(m[0].length);
      if (m[1] === "Prova" && !resto.includes("`")) resto = resto.split("; ").map((c) => (/^(scripts|cargo|cd |npm|npx|node)/.test(c) ? "`" + c + "`" : c)).join("; ");
      return `\n**${m[1]}:** ${resto}`;
    })
    .join("\n");
const taskHtml = tasks
  .map((t) => {
    const [num, ...resto] = t.titolo.split(" · ");
    const stato = (t.corpo.match(/^Stato: (.*)$/m) || [, ""])[1].replace(/^\[ \] /, "");
    return `<details class="task" id="strada--${num.toLowerCase()}">
  <summary><span class="task-num">${num}</span><span class="task-titolo">${md(resto.join(" · "), "t").replace(/^<p>|<\/p>\s*$/g, "")}</span><span class="chip">${esc(FASE[num] ?? "")}</span><span class="chip chip-stato">${esc(stato)}</span></summary>
  <div class="task-corpo">${md(campi(t.corpo), `strada-${num.toLowerCase()}`)}</div>
</details>`;
  })
  .join("\n");
const parte3 = `<div class="testo">
${indice(voci3)}
${strada.map(blocco).join("\n")}
<h2 id="strada--i-task">I task del piano (PA T1–${ultimoTask})</h2>
<p>I task degli altri piani restano nei loro <code>PLAN.md</code>; questi tengono insieme la pre-alpha. Ogni task ha il formato di
<code>PLAN.modello.md</code>: un coder con ragionamento medio lo fa da solo.</p>
<p class="azioni-task"><button type="button" class="bottone" data-tutti="1">Apri tutti</button> <button type="button" class="bottone" data-tutti="0">Chiudi tutti</button></p>
${taskHtml}
${blocco(diff)}
</div>`;

// ── Parte 4 · le domande ────────────────────────────────────────────────────
const dom = sez("Domande aperte");
const [introD, ...ds] = dom.corpo.split(/^### /m);
const ASPETTA = {
  D1: "l'APK di PA T22", D2: "griglia T1–T9", D3: "i task grafici di N6", D4: "il simulatore, prima della consegna",
  D5: "S2 T22, K5 T21–T23", D6: "PA T11", D7: "PA T9", D8: "PA T22", D9: "PA T18", D10: "PA T10", D11: "PA T22", D12: "nessuno",
  D13: "il merge di #290 (K2)", D14: "PA T33", D15: "PA T34", D16: "PA T40", D17: "PA T42", D18: "PA T46",
};
// Il consiglio in una riga, fedele all'opzione «(consigliata)» di PLAN.md.
const CONSIGLIO = {
  D1: "L'APK esce con la cornice provvisoria, segnato «sperimentale»; il piano del telefono parte dopo la pre-alpha.",
  D2: "Approvato così com'è.",
  D3: "Li disegno io adesso, nella cornice di Scrittoio 2, sullo stesso link.",
  D4: "Le compongo adesso nel simulatore: ogni editor nella cornice di Scrittoio 2.",
  D5: "La cornice di Scrittoio 2 con il contenuto di K5: gli strumenti nella colonna del kit, i gettoni del motore nella banda.",
  D6: "Un vassoio solo, il più chiaro, per la barra a schede, la fila e la colonna, com'è sul ramo.",
  D7: "Sì, diretta, solo per `cfg(windows)`, alla versione che il lockfile ha già.",
  D8: "deb, rpm e AppImage, come oggi.",
  D9: "I modelli di issue su GitHub, più le Discussions per le domande.",
  D10: "Mi dici dove li hai visti.",
  D11: "Solo nella CI: si costruisce, parte e si chiude; le note della pre-release lo dicono.",
  D12: "Va bene così.",
  D13: "Prima del merge, come dice K2 D-2: fai il protocollo sulla PR (da solo o con una persona), e i compiti di K2 tornano nella prova finale.",
  D14: "Dove si legge, il nome diventa Fub o il disegno; resta solo nel codice e nelle pagine di riferimento.",
  D15: "`extends`, come `\"extends\": \"fub.serie\"`.",
  D16: "Dentro: un tema può ridisegnare ogni icona, per nome; i nomi restano stabili.",
  D17: "«Carta» e «Salvia».",
  D18: "La scheda segue il lessico: «Acceso», «Togli», e una guardia sui testi `settings.components.*`.",
};
// Una domanda già decisa comincia con «**Decisa dall'utente … : X.**»: nel
// riassunto si legge la decisione, non il consiglio. D5 («L'utente ha chiesto
// di vedere …») resta aperta.
const domande = ds.map((d) => {
  const nl = d.indexOf("\n");
  const titolo = d.slice(0, nl).trim();
  const corpo = d.slice(nl + 1);
  const num = titolo.split(" · ")[0];
  const cons = corpo.match(/^- \*\*([A-Z]) \(consigliata[^)]*\)\.\*\*/m);
  if (!cons || !CONSIGLIO[num]) throw new Error(`${num}: manca il consiglio`);
  const decisa = corpo.trimStart().match(/^\*\*(Decisa dall'utente[^*]*?)\*\*/);
  const consiglio = decisa ? `**${decisa[1].replace(/\.$/, "")}.**` : `**${cons[1]}.** ${CONSIGLIO[num]}`;
  return { num, titolo, corpo, consiglio, decisa: !!decisa };
});
const aperte = domande.filter((d) => !d.decisa);
const tabellaD = `<div class="tabella"><table class="riassunto"><thead><tr><th>Domanda</th><th>Il mio consiglio, o la decisione</th><th>Che cosa aspetta</th></tr></thead><tbody>
${domande
  .map((d) => `<tr><td><a href="#domande--${slug(d.titolo)}">${md(d.titolo, "r").replace(/^<p>|<\/p>\s*$/g, "")}</a></td><td>${md(d.consiglio, "r").replace(/^<p>|<\/p>\s*$/g, "")}</td><td>${esc(ASPETTA[d.num] ?? "")}</td></tr>`)
  .join("\n")}
</tbody></table></div>`;
const parte4 = `<div class="testo">
<h2 id="domande--domande-aperte">Domande aperte</h2>
${md(introD, "domande")}
${tabellaD}
${domande.map((d) => `<section class="domanda" aria-labelledby="domande--${slug(d.titolo)}">${md(`### ${d.titolo}\n\n${d.corpo}`, "domande")}</section>`).join("\n")}
</div>`;

// ── Parte 5 · come si implementa ────────────────────────────────────────────
const come = sez("Come si implementa");
const parte5 = `<div class="testo">
<h2 id="come--come-si-implementa">Come si implementa</h2>
${indice(sottoVoci(come.corpo, "come"))}
${md(come.corpo, "come")}
</div>`;

// ── La testa ────────────────────────────────────────────────────────────────
const fatti = (sez("La definizione").corpo.match(/^\d+\. /gm) || []).length;
const obiettivo = campo("Obiettivo").replace(/^./, (c) => c.toUpperCase());
const html = `<title>Fub pre-alpha</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,400..700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Una pagina di lavoro del piano: la testa col goal e le scelte da fare, cinque
   schede (il simulatore a tutta larghezza, le altre come testo a colonna). */
:root {
  /* i colori di foundation.css di Fub, gli stessi del simulatore */
  --bg: #e8edf5;
  --sheet: #fcfdff;
  --sheet-2: #f3f6f9;
  --bg-elev: #ffffff;
  --text: #1a1f29;
  --muted: #5a5f6a;
  --border: #d3d8e0;
  --accent: #2b56cc;
  --accent-wash: #d8e5ff;
  --ok: #1d7a46;
  --ok-wash: #dcf3e5;
  --warn: #8a5a00;
  --warn-wash: #fbefd6;
  --code-bg: #eef2f8;
  --font-ui: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --gutter-l: max(16px, env(safe-area-inset-left, 0px));
  --gutter-r: max(16px, env(safe-area-inset-right, 0px));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae;
    --border: #2c323c; --accent: #82a8fd; --accent-wash: #213156; --ok: #6fd39a; --ok-wash: #173326; --warn: #f0c060;
    --warn-wash: #3a2c10; --code-bg: #1b2029; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0e16; --sheet: #151a21; --sheet-2: #1d222a; --bg-elev: #212730; --text: #e5e8ed; --muted: #a0a5ae;
  --border: #2c323c; --accent: #82a8fd; --accent-wash: #213156; --ok: #6fd39a; --ok-wash: #173326; --warn: #f0c060;
  --warn-wash: #3a2c10; --code-bg: #1b2029; color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--font-ui); overflow-x: hidden; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--sheet-2); }
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
code { font-family: var(--font-mono); font-size: 0.86em; background: var(--code-bg); padding: 0.05em 0.3em; border-radius: 4px; overflow-wrap: anywhere; }
pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 13px; overflow-wrap: normal; }

.testa { background: var(--sheet-2); border-bottom: 1px solid var(--border); padding-left: var(--gutter-l); padding-right: var(--gutter-r); padding-block: 22px 18px; }
.testa-dentro { max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px 32px; align-items: start; }
.testa h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.15; letter-spacing: -0.01em; text-wrap: balance; }
.testa .obiettivo { margin: 0 0 12px; max-width: 70ch; color: var(--text); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 9px; border-radius: 999px; background: var(--bg-elev); box-shadow: inset 0 0 0 1px var(--border); color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.chip.ok { background: var(--ok-wash); color: var(--ok); box-shadow: none; }
.chip.attesa { background: var(--warn-wash); color: var(--warn); box-shadow: none; }
.decidere { background: var(--sheet); border-radius: 12px; box-shadow: 0 0 0 1px var(--border); padding: 14px 16px; }
.decidere h2 { margin: 0 0 6px; font-size: 15px; }
.decidere ol { margin: 0; padding-left: 20px; }
.decidere li + li { margin-top: 4px; }

.schede { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--border); padding-left: var(--gutter-l); padding-right: var(--gutter-r); }
.schede ul { max-width: 1400px; margin: 0 auto; padding: 0; list-style: none; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.schede a { display: block; padding: 11px 14px 9px; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 500; }
.schede a .n { font-family: var(--font-mono); font-size: 12px; margin-right: 6px; color: var(--muted); }
.schede a[aria-current="page"] { color: var(--text); border-bottom-color: var(--accent); }
.schede a[aria-current="page"] .n { color: var(--accent); }

main { padding-left: var(--gutter-l); padding-right: var(--gutter-r); padding-block: 20px 64px; }
.parte { max-width: 1400px; margin: 0 auto; }
.testo { max-width: 960px; margin: 0 auto; }
.testo > h2:first-child, .testo > nav:first-child + h2 { margin-top: 8px; }
h2 { font-size: 22px; line-height: 1.25; margin: 40px 0 10px; text-wrap: balance; scroll-margin-top: 64px; }
h3 { font-size: 17px; line-height: 1.3; margin: 28px 0 8px; text-wrap: balance; scroll-margin-top: 64px; }
h4 { font-size: 15px; margin: 20px 0 6px; scroll-margin-top: 64px; }
p, li { max-width: 78ch; }
li + li { margin-top: 3px; }
.indice { margin: 4px 0 18px; }
.indice ul { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0; list-style: none; }
.indice li { margin: 0; max-width: none; }
.indice a { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--sheet); box-shadow: inset 0 0 0 1px var(--border); color: var(--text); text-decoration: none; font-size: 13px; }
.indice a:hover { background: var(--accent-wash); }
.tabella { overflow-x: auto; margin: 12px 0 18px; border-radius: 10px; box-shadow: 0 0 0 1px var(--border); background: var(--sheet); }
table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 13.5px; line-height: 1.45; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--border); }
th { background: var(--sheet-2); font-weight: 600; position: sticky; top: 0; }
tr:last-child td { border-bottom: 0; }
td code, th code { font-size: 0.82em; }

.sim-cornice { margin: 0 auto 8px; }
.sim-testa { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 20px; margin-bottom: 10px; }
.sim-testa p { margin: 0; color: var(--muted); max-width: 90ch; }
#sim-iframe { display: block; width: 100%; height: min(1180px, calc(100vh - 120px)); min-height: 560px; border: 0; border-radius: 12px; box-shadow: 0 0 0 1px var(--border); background: var(--bg); }
.bottone { display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; }
.bottone:hover { background: var(--accent-wash); }

.task { background: var(--sheet); border-radius: 10px; box-shadow: 0 0 0 1px var(--border); margin: 8px 0; scroll-margin-top: 64px; }
.task summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; padding: 10px 14px; cursor: pointer; list-style: none; }
.task summary::-webkit-details-marker { display: none; }
.task summary::before { content: "▸"; color: var(--muted); width: 1em; flex: none; }
.task[open] summary::before { content: "▾"; }
.task-num { font-family: var(--font-mono); font-weight: 600; color: var(--accent); flex: none; }
.task-titolo { flex: 1 1 22rem; min-width: 0; font-weight: 500; }
.task-corpo { padding: 0 16px 8px 40px; border-top: 1px solid var(--border); }
.task-corpo p:first-child { margin-top: 12px; }
.azioni-task { display: flex; gap: 8px; }

.domanda { background: var(--sheet); border-radius: 12px; box-shadow: 0 0 0 1px var(--border); padding: 2px 18px 8px; margin: 14px 0; }
.domanda h3 { margin-top: 16px; }
.domanda strong { color: var(--text); }
.domanda li:has(> strong:first-child) { margin-top: 10px; }
table.riassunto td:first-child { min-width: 14rem; }

@media (max-width: 860px) {
  .testa-dentro { grid-template-columns: minmax(0, 1fr); }
  .task-corpo { padding-left: 16px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>

<header class="testa">
  <div class="testa-dentro">
    <div>
      <h1>Fub pre-alpha</h1>
      <p class="obiettivo">${md(obiettivo, "o").replace(/^<p>|<\/p>\s*$/g, "")}</p>
      <ul class="chips">
        <li class="chip ok">Definizione confermata il 2026-11-05</li>
        <li class="chip attesa">Secondo giro: ${daApprovare} stati da approvare</li>
        <li class="chip">${STATI.length} stati · ${SCENARI.length} scenari</li>
        <li class="chip">${fatti} punti di «Fatto quando»</li>
        <li class="chip">${tasks.length} task nuovi · ${fasi} fasi</li>
        <li class="chip">${aperte.length} domande aperte su ${domande.length}</li>
        <li class="chip"><code>piano/fub-pre-alpha</code> @ ${commit}</li>
      </ul>
    </div>
    <section class="decidere" aria-labelledby="da-decidere">
      <h2 id="da-decidere">Che cosa ti chiedo</h2>
      <ol>
        <li>Passa il <a href="#simulatore">simulatore</a>: gli scenari, le due luci, 700 px e telefono. Gli stati composti e nuovi (${daApprovare})
        aspettano un sì: segna quelli da rivedere, e incolla la frase che il simulatore scrive.</li>
        <li>Rispondi alle <a href="#domande">domande aperte</a> (${aperte.map((d) => d.num).join(", ")}). Per ognuna c'è il mio consiglio per primo.</li>
        <li>D5 (la testa del disegno) si sceglie guardando le due forme, tutte e due nel simulatore.</li>
      </ol>
    </section>
  </div>
</header>
<nav class="schede" aria-label="Le parti del piano">
  <ul>
    <li><a href="#simulatore"><span class="n">1</span>Simulatore</a></li>
    <li><a href="#backend"><span class="n">2</span>Backend</a></li>
    <li><a href="#strada"><span class="n">3</span>Strada</a></li>
    <li><a href="#domande"><span class="n">4</span>Domande aperte</a></li>
    <li><a href="#come"><span class="n">5</span>Come si implementa</a></li>
  </ul>
</nav>
<main>
  <section class="parte" id="parte-simulatore" data-parte="simulatore" aria-label="Simulatore">${parte1}</section>
  <section class="parte" id="parte-backend" data-parte="backend" aria-label="Backend" hidden>${parte2}</section>
  <section class="parte" id="parte-strada" data-parte="strada" aria-label="Strada" hidden>${parte3}</section>
  <section class="parte" id="parte-domande" data-parte="domande" aria-label="Domande aperte" hidden>${parte4}</section>
  <section class="parte" id="parte-come" data-parte="come" aria-label="Come si implementa" hidden>${parte5}</section>
</main>
<script>
(() => {
  const parti = [...document.querySelectorAll(".parte")];
  const link = [...document.querySelectorAll(".schede a")];
  const mostra = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    const nome = (h.split("--")[0] || "simulatore").replace(/^strada-t\\d+$/, "strada");
    const qui = parti.find((p) => p.dataset.parte === nome) ? nome : "simulatore";
    for (const p of parti) p.hidden = p.dataset.parte !== qui;
    for (const a of link) {
      if (a.getAttribute("href") === "#" + qui) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    const bersaglio = h.includes("--") ? document.getElementById(h) : null;
    if (bersaglio) {
      if (bersaglio.tagName === "DETAILS") bersaglio.open = true;
      bersaglio.closest("details")?.setAttribute("open", "");
      requestAnimationFrame(() => bersaglio.scrollIntoView({ block: "start" }));
    } else if (h && !h.includes("--")) {
      window.scrollTo(0, 0);
    }
  };
  addEventListener("hashchange", mostra);
  mostra();
  for (const b of document.querySelectorAll("[data-tutti]")) {
    b.addEventListener("click", () => {
      for (const d of document.querySelectorAll("#parte-strada details.task")) d.open = b.dataset.tutti === "1";
    });
  }
})();
</script>
`;
await writeFile(join(out, "index.html"), html);
console.log("ok", join(out, "index.html"), (html.length / 1024).toFixed(0) + " KB", "task", tasks.length, "domande", domande.length);
