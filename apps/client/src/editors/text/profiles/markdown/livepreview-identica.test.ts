// Le decorazioni della Live, byte per byte, su note campione: quelle del banco
// (la nota lunga di S1, la battuta con un po' di tutto, i casi della Live) e
// una nota ricca di segni che si toccano (commenti, formule, note, scadenze,
// promemoria, HTML, punteggiatura dopo i pezzi nascosti). Per ogni nota,
// politica, cursore e tratto, l'impronta di `computeDecorations` deve restare
// quella di `src/__fixtures__/live-decorations.json`, scritta dal codice di
// prima che gli intervalli si leggessero ordinati (PERF-12): un indice nuovo
// non cambia che cosa si vede.
//
// Un cambio voluto delle decorazioni rigenera il file:
// `UPDATE_MIRROR=1 npx vitest run src/editors/text/profiles/markdown/livepreview-identica.test.ts`.
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { computeDecorations, footnoteLabelsField, revealOf } from "./livepreview";
import type { RevealPolicy } from "../../live-reveal";
import { CORPUS } from "../../../../../bench/corpus";
import { LIVE_CASES, longNote, typingCardsNote, typingNote, typingValuesNote } from "../../../../../bench/live-fixture";
import golden from "../../../../__fixtures__/live-decorations.json";

/// La nota di S1 (`bench/webview/fixtures.mjs`): 5.000 righe, un paragrafo
/// ogni quaranta, e in ogni riga un grassetto e un wikilink seguito dal punto.
function s1Note(): string {
  const name = (i: number) => `Nota ${String(i).padStart(5, "0")}`;
  const lines = ["# Una nota lunga", ""];
  for (let i = 1; lines.length < 5000; i++) {
    if (i % 40 === 0) lines.push(`## Sezione ${i / 40}`, "");
    else lines.push(`Riga ${i}: il corso di analisi del lunedì, con **una parola** in grassetto e un [[${name((i % 10000) + 1)}]].`);
  }
  return lines.slice(0, 5000).join("\n") + "\n";
}

/// Una sezione dove i segni si toccano: ogni indice della Live ha un caso.
/// Le date sono lontane, perché l'aspetto di una scadenza non dipenda dal
/// giorno in cui gira la prova.
function richSection(i: number): string {
  return [
    `## Ricca ${i}`,
    "",
    `Un passo {==da rivedere==}{>>Anna: va bene così? **no**<<}{>>Teo: sì [[Nota]]<<} e poi $a_${i}^2$ e $$b$$, una nota[^n${i}] e una in riga^[con *corsivo*].`,
    `Il codice \`[[non link]] #nontag ==no==\`, un <kbd>Ctrl</kbd> e <span class="x">uno span</span>, un %%commento%% e ==evidenza==.`,
    `Un link [testo](https://esempio.it/a#b) e un URL https://esempio.it/c#d, [[Pagina|alias]], ![[foto.png]], ![[doc.pdf|120]], #tag/${i}.`,
    `Punteggiatura dopo i pezzi: [[Uno]], **due**; \`tre\`. $x$! [[Quattro|q]]? ~~barrato~~: x^sup^ e x~sub~.`,
    `Formula che va a capo $a +`,
    `b$ e testo, \\# non titolo, \\*non enfasi\\*.`,
    "",
    `[^n${i}]: La definizione della nota ${i}, con [[un link]].`,
    "",
    `- [ ] Spedire i cataloghi 📅 2001-01-0${(i % 9) + 1} con \`📅 2099-12-31\` ⏰ 2099-01-01 09:00`,
    `  che continua 📅 2099-02-02 sulla riga dopo`,
    `- [x] Fatto ==evidenziato== [[Nota]] 📅 2001-03-03 ⏰ 2001-03-03 08:00`,
    `- [ ] Con la data nel codice \`📅 2099-04-04\` e [[Pagina 📅 2099-05-05]]`,
    `- [ ] Promemoria che non si legge ⏰ domani`,
    `1. Primo **punto** ^blocco${i}`,
    "",
    `> [!tip] Consiglio ${i}`,
    `> con **forza** e [[link]]`,
    "",
    `> citazione con #tag e $y$`,
    "",
    "<div>",
    `blocco HTML con [[non link]] e #nontag`,
    "</div>",
    "",
    "<!-- pagina -->",
    "",
    "***",
    "",
    "```js",
    `const v${i} = "[[x]] #y";`,
    "```",
    "",
    `| a | b |`,
    `| --- | --- |`,
    `| ${i} [[c]] | $z$ ==h== |`,
    "",
    `Riferimento ![immagine][ref] e ![locale](immagini/a.png "titolo"). ^ancora${i}`,
    "",
  ].join("\n");
}

function richNote(): string {
  return [
    "---",
    "titolo: ricca",
    "---",
    "",
    ...Array.from({ length: 12 }, (_, i) => richSection(i)),
    "[ref]: immagini/b.png",
    "",
  ].join("\n");
}

interface Sample {
  readonly text: string;
  readonly cursor: number | null;
  readonly head?: number;
  /// I tratti da decorare, in righe: tutto il testo, e per le note grandi
  /// qualche finestra della misura di un viewport.
  readonly windows?: readonly (readonly [number, number])[];
  readonly cells?: boolean;
}

function samples(): Record<string, Sample> {
  const out: Record<string, Sample> = {};
  for (const [name, live] of Object.entries(LIVE_CASES)) out[`live/${name}`] = live;
  for (const [name, text] of Object.entries(CORPUS)) if (name.endsWith(".md")) out[`corpus/${name}`] = { text, cursor: null };
  const s1 = s1Note();
  out["s1"] = { text: s1, cursor: s1.length - 1, windows: [[1, 160], [2400, 2560], [4840, 5000]] };
  const typing = typingNote(50);
  out["battuta-50"] = { ...typing, windows: [[1, 901], [400, 560]] };
  out["lunga-200"] = longNote(200);
  out["schede"] = { ...typingCardsNote(20, 5, true), cells: true };
  out["valori"] = { ...typingValuesNote(20, 10), cells: true };
  const rich = richNote();
  out["ricca"] = { text: rich, cursor: rich.indexOf("Spedire") };
  return out;
}

const POLICIES: readonly RevealPolicy[] = ["riga", "elemento", "mai"];

/// L'impronta di una lista di decorazioni: due FNV-1a a 32 bit sul JSON.
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/// Le impronte di un campione: per ogni cursore (nessuno, quello del caso, un
/// terzo, due terzi, la fine) e politica, il testo intero o le sue finestre.
function prints(sample: Sample): Record<string, string> {
  const base = EditorState.create({ doc: sample.text, extensions: [markdown({ base: markdownGrammar }), footnoteLabelsField] });
  ensureSyntaxTree(base, base.doc.length, 60_000);
  const length = base.doc.length;
  const cursors: { name: string; selection: EditorSelection }[] = [
    { name: "zero", selection: EditorSelection.single(0) },
    { name: "terzo", selection: EditorSelection.single(Math.floor(length / 3)) },
    { name: "fine", selection: EditorSelection.single(length) },
  ];
  if (sample.cursor !== null) cursors.push({ name: "caso", selection: EditorSelection.single(sample.cursor, sample.head ?? sample.cursor) });
  const out: Record<string, string> = {};
  for (const { name, selection } of cursors) {
    const state = base.update({ selection }).state;
    for (const policy of POLICIES) {
      const reveal = revealOf(state, policy);
      const windows = sample.windows ?? [[1, state.doc.lines]];
      for (const [first, last] of windows) {
        const from = state.doc.line(first).from;
        const to = state.doc.line(Math.min(last, state.doc.lines)).to;
        out[`${name}/${policy}/${first}-${last}`] = fingerprint(computeDecorations(state, reveal, from, to, undefined, sample.cells ?? false));
      }
    }
  }
  return out;
}

const update = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.UPDATE_MIRROR === "1";

describe("le decorazioni della Live restano byte per byte", () => {
  const all = samples();
  if (update) {
    it("rigenera l'impronta", async () => {
      const result: Record<string, string | Record<string, string>> = {
        $generato: "File generato da apps/client/src/editors/text/profiles/markdown/livepreview-identica.test.ts, non modificare a mano; "
          + "rigenera con UPDATE_MIRROR=1 npx vitest run src/editors/text/profiles/markdown/livepreview-identica.test.ts da apps/client",
      };
      for (const [name, sample] of Object.entries(all)) result[name] = prints(sample);
      const fs = await import(/* @vite-ignore */ "node:" + "fs");
      const path = new URL("../../../../__fixtures__/live-decorations.json", import.meta.url);
      fs.writeFileSync(path, `${JSON.stringify(result, null, 1)}\n`);
    }, 300_000);
    return;
  }
  it("la nota ricca ha i segni che gli indici leggono", () => {
    const rich = all["ricca"]!;
    const state = EditorState.create({ doc: rich.text, selection: { anchor: rich.cursor ?? 0 }, extensions: [markdown({ base: markdownGrammar }), footnoteLabelsField] });
    ensureSyntaxTree(state, state.doc.length, 60_000);
    const kinds = new Set<string>();
    for (const policy of POLICIES) for (const d of computeDecorations(state, revealOf(state, policy))) kinds.add(d.kind);
    expect([...kinds].sort()).toEqual(expect.arrayContaining([
      "callout-line", "code", "codeblock-line", "footnote-back", "footnote-label", "highlight", "hide", "html", "image",
      "link", "math", "nobreak", "strong", "sup", "tag", "task-due", "task-reminder", "task-reminder-source", "wikilink",
    ]));
  });
  for (const [name, sample] of Object.entries(all)) {
    it(name, () => {
      expect(prints(sample)).toEqual((golden as Record<string, string | Record<string, string>>)[name]);
    });
  }
});
