// La porta del banco (`fake-ipc.ts`): il vault di prova (documenti,
// etichette, lavori, icone) e la resa dei documenti in HTML.

import type { BundleInfo, JobStatus, KnownVault, Organization, QueryExpr } from "../src/host/contract";
import { LIVE_DOC } from "./live-fixture";
import { params } from "./fake-ipc-casi";

/// I componenti montati, per la scheda «Componenti» delle impostazioni.
///
/// `satisfies` è deliberato: queste fixture attraversano lo stesso confine
/// dell'host reale, quindi un campo nuovo nel contratto deve rompere il
/// type-check invece di arrivare come errore dentro una fotografia.
export const BUNDLE = [
  {
    id: "fub.core",
    name: "Core",
    mounted: true,
    kind: "component",
    trust: "core",
    permissions: {},
  },
  {
    id: "fub.outline",
    name: "Struttura",
    mounted: true,
    kind: "component",
    trust: "core",
    permissions: { "fub:read-vault": true, "fub:read-session": true },
  },
  {
    id: "fub.graph",
    name: "Grafo",
    mounted: true,
    kind: "component",
    trust: "core",
    permissions: { "fub:read-vault": true },
  },
  {
    id: "fub.versioning",
    name: "Versioni",
    mounted: false,
    kind: "component",
    trust: "core",
    permissions: {
      "fub:call-service": true,
      "fub:read-selection": true,
      "fub:read-session": true,
      "fub:read-vault": true,
      "fub:run-command": true,
      "fub:write-settings": true,
      "fub:write-vault": true,
    },
  },
] satisfies BundleInfo[];

/// I vault che questa macchina conosce, per la scheda «Vault».
export const KNOWN_VAULTS = [
  {
    root: "/Bench vault",
    name: "Vault del banco",
    icon: "📷",
    favorite: true,
    last_opened: 0,
    keys_seen: {},
  },
  {
    root: "/Appunti",
    name: "",
    icon: null,
    favorite: false,
    last_opened: 0,
    keys_seen: {},
  },
] satisfies KnownVault[];

// ---------------------------------------------------------------------------
// La scenografia: le risposte del canale dati che `fake.ts` non dà.
// ---------------------------------------------------------------------------

/// Le icone del vault: le figure monocrome `fub:<nome>`, come il mockup. Con
/// `?icone=emoji` tornano le emoji di prima, perché una scena le possa ancora
/// fotografare; ogni altro valore del parametro vale le figure.
const ICONS: Record<string, string> =
  params.get("icone") === "emoji"
    ? { "Benvenuto.md": "👋", Guida: "📘", Diario: "📅" }
    : { Guida: "fub:book", Diario: "fub:calendar" };

/// L'organizzazione del vault con cui il banco parte: due note appuntate, le
/// icone, uno spazio. Il finto la tiene (`createFakeHost`) e la fa seguire alle
/// rinomine come il kernel: un'appuntata rinominata resta appuntata.
export const ORGANIZATION: Organization = {
  icons: ICONS,
  pinned: ["Benvenuto.md", "Guida/Sintassi di Fub.md"],
  order: {},
  spaces: ["Guida", "Diario", "Progetti"],
};

/// Un lavoro lungo **in corso**: è la sola scena in cui il centro attività ha
/// qualcosa dentro, e senza di lui la barra di stato si fotografa spenta.
export const JOBS: JobStatus[] = [
  {
    id: "1",
    job: "Reindicizzazione del vault",
    plugin: "fub.core",
    since: 0,
    progress: { done: 340, total: 512, label: "Guida/Nota lunga.md" },
  },
  {
    id: "2",
    job: "Snapshot delle versioni",
    plugin: "fub.versioning",
    since: 0,
    progress: null,
  },
];

/// I tag del vault, coi loro conti. Gerarchici apposta: il pannello li innesta,
/// e un elenco piatto non fotograferebbe il rientro.
export const TAG = [
  { name: "tema", count: 12 },
  { name: "tema/colore", count: 7 },
  { name: "tema/moto", count: 3 },
  { name: "banco", count: 9 },
  { name: "seduta-31", count: 4 },
  { name: "sintassi", count: 2 },
];

/// Le risposte che la scenografia aggiunge al canale dati, per specie di query.
/// Ciò che non è qui dentro passa a `fake.ts` **intatto**, regola del lancio
/// compresa: un banco che rispondesse a tutto non direbbe più quale query la
/// shell ha imparato a fare da sola.
/// I dati della riga sotto il titolo, per nota: Benvenuto ha due etichette,
/// tre collegamenti ed è stata modificata due ore prima dell'ora del banco,
/// come nel prototipo. La nota delle scene della Live (`?live=`) ha gli
/// stessi, perché la loro foto si confronta con lo stesso stato.
const BENVENUTO_FACTS = { tags: ["tema", "banco"], links: 3, mtime: Date.parse("2026-08-19T07:30:00+02:00") };
export const NOTE_FACTS: Record<string, { tags: string[]; links: number; mtime: number }> = {
  "Benvenuto.md": BENVENUTO_FACTS,
  [LIVE_DOC]: BENVENUTO_FACTS,
};

/// I documenti nominati da una domanda ristretta (`theseDocuments`), o `null`
/// per una domanda su tutto il vault.
export function askedDocs(expr: QueryExpr): string[] | null {
  if (expr.any.length === 0) return null;
  const docs = expr.any.flatMap((clause) => clause.all.flatMap((literal) =>
    !literal.negated && literal.predicate.kind === "docs" ? literal.predicate.docs : []));
  return docs.length > 0 ? docs : null;
}

/// La sezione di `text` sotto il titolo `heading`, titolo compreso, fino al
/// prossimo titolo dello stesso livello o più alto; senza titolo, tutto.
export function embedSection(text: string, heading: string | null): string {
  if (heading === null) return text;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, "").trim() === heading);
  if (start < 0) throw new Error(`Titolo non trovato nel banco: ${heading}`);
  const level = /^#+/.exec(lines[start]!)![0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#{1,6} /.test(lines[end]!) && /^#+/.exec(lines[end]!)![0].length <= level)) end++;
  return lines.slice(start, end).join("\n").trim();
}

/// Il blocco col suo `^id` a fine paragrafo (il blocco sincronizzato, T30),
/// senza l'id, come lo rende il kernel. Un id che non c'è è l'errore del
/// kernel: la resa scrive «Blocco non trovato».
export function embedBlock(text: string, block: string): string {
  const mark = new RegExp(`\\s\\^${block.replace(/[^A-Za-z0-9-]/g, "")}\\s*$`);
  const found = text.split(/\n\s*\n/).find((paragraph) => mark.test(paragraph));
  if (found === undefined) throw new Error(`Blocco non trovato nel banco: ^${block}`);
  return found.replace(mark, "").trim();
}

/// Una resa di Markdown per le note che il banco non ha scritte a mano in
/// `OUTPUT`: titoli, paragrafi, elenchi (con le caselle dei compiti), blocchi
/// di codice, collegamenti e grassetto. Non è il renderer vero, e non vuole
/// esserlo: basta a non mostrare il sorgente grezzo, col suo `#`, nell'anteprima.
/// `fences`: un recinto dice la sua lingua (`language-mermaid`), come nella
/// resa vera; serve alla resa per la stampa della Live (i diagrammi, T75).
/// `print`: come la resa per la stampa del core, ogni blocco dice dove sta nel
/// sorgente (`data-fub-source-start`/`-end`, in byte) e `<!-- pagina -->` è il
/// segnaposto che volta pagina (il clic sulla pagina, T76).
export function plainHtml(markdown: string, fences = false, print = false): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const encoder = new TextEncoder();
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += encoder.encode(line).length + 1;
  }
  /// Gli attributi della posizione di un blocco dalla riga `from` alla `to`.
  const at = (from: number, to: number): string =>
    print ? ` data-fub-source-start="${starts[from]}" data-fub-source-end="${starts[to]! + encoder.encode(lines[to]!).length}"` : "";
  const out: string[] = [];
  let paragraph: string[] = [];
  let paragraphFrom = 0;
  let items: string[] = [];
  let itemsFrom = 0;
  let fence: string[] | null = null;
  let fenceFrom = 0;
  let info = "";
  let row = -1;
  const flush = (): void => {
    if (paragraph.length > 0) out.push(`<p${at(paragraphFrom, paragraphFrom + paragraph.length - 1)}>${paragraph.map(inline).join(" ")}</p>`);
    if (items.length > 0) out.push(`<ul${at(itemsFrom, itemsFrom + items.length - 1)}>${items.join("")}</ul>`);
    paragraph = [];
    items = [];
  };
  for (const line of lines) {
    row++;
    if (fence !== null) {
      if (line.startsWith("```")) {
        const language = fences && /^[a-z]+$/u.test(info) ? ` class="language-${info}"` : "";
        out.push(`<pre${at(fenceFrom, row)}><code${language}>${esc(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      fence = [];
      fenceFrom = row;
      info = line.slice(3).trim().toLowerCase();
      continue;
    }
    // `<!-- pagina -->` volta pagina sulla carta; a schermo non c'è, come
    // nella resa vera.
    if (/^\s*<!--\s*pagina\s*-->\s*$/u.test(line)) {
      flush();
      if (print) out.push(`<div${at(row, row)} class="page-break" data-page-break="mano"></div>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      out.push(`<h${level}${at(row, row)}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const item = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (item) {
      if (paragraph.length > 0) flush();
      if (items.length === 0) itemsFrom = row;
      const box = item[1] === undefined ? "" : `<input type="checkbox" disabled${item[1] === " " ? "" : " checked"}> `;
      items.push(`<li${at(row, row)}>${box}${inline(item[2]!)}</li>`);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (items.length > 0) flush();
    if (paragraph.length === 0) paragraphFrom = row;
    paragraph.push(line);
  }
  if (fence !== null) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}

/// I commenti di una discussione, come il kernel li porta nella resa per la
/// stampa (`<template class="comment-note">`, inerti: la lettura non li ha).
/// Servono alla sezione Contenuto dello spazio «Esporta in PDF» (T74): una
/// discussione di due messaggi in un paragrafo, un commento in una cella.
const PRINT_COMMENTS: Record<string, readonly (readonly [string, string])[]> = {
  "Guida/Sintassi di Fub.md": [
    [
      "va a capo e continua sulla riga dopo.",
      '<template class="comment-note" data-author="Anna Rossi" data-date="2026-11-04">Si può dire in meno parole?</template><template class="comment-note" data-author="Bruno Neri" data-date="2026-11-05">La lascerei: è l\'esempio del ritorno a capo.</template>',
    ],
    ["della scocca", '<template class="comment-note" data-author="Carla Bianchi" data-date="2026-11-06">Vale anche per le icone?</template>'],
  ],
};

export function printComments(doc: string, html: string): string {
  let out = html;
  for (const [after, notes] of PRINT_COMMENTS[doc] ?? []) out = out.replace(after, `${after}${notes}`);
  return out;
}
