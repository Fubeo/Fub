// @vitest-environment happy-dom
//
// Le tre porte (E26): le azioni di un blocco stanno nel menu del tasto
// destro, nella barra di formato e nella maniglia con Ctrl O, le stesse da
// ogni porta; sopra un blocco a riposo non c'è nessun pulsante.
//
// I gruppi di blocco dichiarati dalla superficie (`blockGroup(at)`, T11) non
// ci sono ancora. Fino ad allora il gruppo di una specie è ciò che il tasto
// destro offre già su quel blocco della famiglia «Trasforma in» (testo, i sei
// titoli, i tre elenchi, citazione, callout, codice, sezione a scomparsa):
// «Trasforma il blocco» sul testo, «Livello» su un titolo, «Tipo di elenco»
// su un elenco. Le altre porte devono offrire le stesse azioni. Quando
// `blockGroup` arriva, `groupOf` legge da lì.
//
// Le porte si leggono dove vivono davvero:
// - il tasto destro: il menu che la superficie compone sul blocco
//   (`contextMenu`), con le azioni dei suoi sottomenu: è da lì che nasce il
//   gruppo;
// - la barra di formato: i pulsanti che `toolbarGroups` disegna dalle spec
//   della barra, per le azioni che la superficie sa eseguire;
// - la maniglia: «Trasforma in» dei Blocchi (`TARGETS`);
// - Ctrl O: i comandi della barra nel registro, letti dal crate che li
//   dichiara (`crates/fub-features/src/formatting.rs`).
//
// Le regole sono pure (`doorGaps`, `buttonsAtRest`): un caso finto le rompe e
// prova che la guardia morde.
import { afterEach, describe, expect, it } from "vitest";
import type { CommandSpec } from "../../../../host/contract";
import type { SurfaceMenu, SurfaceMenuEntry } from "../../../core/editor-menu";
import type { EditorSurface } from "../../../core/registry";
import { toolbarGroups } from "../../../../panels/format-bar";
import { TARGETS } from "./blocks/handles";
import type { TransformTarget } from "./blocks/transform";
import { mountMarkdownSurface } from "./surface";

/// L'azione dell'editor che porta un blocco a ogni specie: tutte le specie,
/// il tipo lo controlla.
const ACTION_OF: Readonly<Record<TransformTarget, string>> = {
  paragraph: "markdown.paragraph",
  heading1: "markdown.heading.1",
  heading2: "markdown.heading.2",
  heading3: "markdown.heading.3",
  heading4: "markdown.heading.4",
  heading5: "markdown.heading.5",
  heading6: "markdown.heading.6",
  bullet: "markdown.list.bullet",
  ordered: "markdown.list.ordered",
  task: "markdown.list.task",
  quote: "markdown.quote",
  callout: "markdown.callout",
  code: "markdown.codeblock",
  details: "markdown.details",
};
const SPECIES = Object.keys(ACTION_OF) as TransformTarget[];
const BLOCK_ACTIONS: ReadonlySet<string> = new Set(Object.values(ACTION_OF));

/// Il gruppo di un blocco: le azioni della famiglia che il tasto destro offre
/// su di lui, nell'ordine del menu.
const groupOf = (rightClick: ReadonlySet<string>): string[] => [...rightClick].filter((action) => BLOCK_ACTIONS.has(action));

/// Le specie che oggi non hanno gruppo, col perché: il loro gruppo nasce con
/// T11 (Compito: scadenza; Codice: lingua, copia). Quando il tasto destro
/// comincia a offrirne, il test chiede di toglierle da qui.
const NO_GROUP_YET: ReadonlyMap<TransformTarget, string> = new Map([
  ["task", "il tasto destro su un compito offre i gesti del compito, non ancora azioni di blocco"],
  ["code", "il tasto destro su un blocco di codice non offre ancora azioni di blocco"],
]);

/// Un blocco di ogni specie, col cursore dentro (dopo `|`).
const SAMPLES: Readonly<Record<TransformTarget, string>> = {
  paragraph: "Un pa|ragrafo.",
  heading1: "# Ti|tolo",
  heading2: "## Ti|tolo",
  heading3: "### Ti|tolo",
  heading4: "#### Ti|tolo",
  heading5: "##### Ti|tolo",
  heading6: "###### Ti|tolo",
  bullet: "- pun|to",
  ordered: "1. pri|mo",
  task: "- [ ] fa|re",
  quote: "> cita|zione",
  callout: "> [!note] Nota\n> cor|po",
  code: "```js\nx |= 1\n```",
  details: "<details>\n<summary>Ti|tolo</summary>\n\ncorpo\n</details>",
};

type Door = "barra di formato" | "maniglia" | "Ctrl O";

/// I buchi conosciuti, col perché: una porta che manca un'azione e lo sa.
/// Ognuno è una domanda aperta, non una regola; quando la porta lo copre, il
/// test chiede di toglierlo da qui.
const KNOWN_GAPS: ReadonlyMap<string, string> = new Map([
  ["maniglia markdown.heading.4", "«Trasforma in» della maniglia arriva al Titolo 3, come Notion"],
  ["maniglia markdown.heading.5", "«Trasforma in» della maniglia arriva al Titolo 3, come Notion"],
  ["maniglia markdown.heading.6", "«Trasforma in» della maniglia arriva al Titolo 3, come Notion"],
]);

/// Le azioni del gruppo che una porta non offre, come «porta azione».
function doorGaps(group: readonly string[], doors: Readonly<Record<Door, ReadonlySet<string>>>): string[] {
  return (Object.entries(doors) as [Door, ReadonlySet<string>][]).flatMap(([door, offered]) =>
    group.filter((action) => !offered.has(action)).map((action) => `${door} ${action}`));
}

/// I pulsanti che si vedono sul foglio fermo: non al passaggio né a
/// richiesta (`data-presence`, che la pelle nasconde a riposo) e non
/// contenuto. Il contenuto è l'icona della pagina, i pulsanti delle proprietà
/// della testata («Aggiungi una proprietà» si vede sempre in Scrittura, come
/// nel prototipo, scelta dell'utente del 2026-11-15) e la riga dei dati, come
/// nella scena «a riposo» del banco (`writingAtRest` in `bench/scene.mjs`), e
/// il triangolo della sezione a scomparsa, che è il blocco stesso come la
/// casella di un compito. In più «+ riga»/«+ colonna» della tabella, che il
/// tema della tabella nasconde finché il puntatore non ci passa
/// (`.tb-frame:hover`) senza ancora il segno della presenza.
const CONTENT = ".cm-fub-page-icon, .cm-fub-page-props button, .note-facts *, .cm-fub-details-arrow, .tb-add";
function buttonsAtRest(sheet: Element): Element[] {
  return [...sheet.querySelectorAll("button, [role=button]")]
    .filter((el) => !el.closest("[data-presence]") && !el.matches(CONTENT) && !el.closest("[hidden]"));
}
const nameOf = (el: Element): string => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;

/// I pulsanti che oggi si vedono a riposo e non dovrebbero, col perché: il
/// prototipo non vuole pulsanti sul foglio. Ognuno è un buco aperto; quando
/// sparisce, il test chiede di toglierlo da qui.
const KNOWN_AT_REST: ReadonlyMap<string, string> = new Map([
  [
    ".cm-fub-code-header button",
    "Lingua, A capo e Copia nella testata del blocco di codice si vedono sempre (skin/document-blocks.css): " +
      "vanno nel gruppo «Codice» della barra di formato (T11) o al passaggio",
  ],
]);

/// Le azioni di un menu della superficie, dentro i sottomenu.
function actionsOf(entries: readonly SurfaceMenuEntry[] | undefined): string[] {
  return (entries ?? []).flatMap((entry) =>
    typeof entry === "string" ? [] : [...(entry.action ? [entry.action] : []), ...actionsOf(entry.items)]);
}

function menuActions(menu: SurfaceMenu): Set<string> {
  return new Set([menu.context, menu.format, menu.transform, menu.edit, menu.insert, menu.tail, menu.searchable].flatMap(actionsOf));
}

/// Il modulo di Node col nome calcolato: il client non ha i tipi di Node.
async function readCrateFile(path: string): Promise<string> {
  const prefix = "node:";
  const fs = (await import(/* @vite-ignore */ `${prefix}fs`)) as { readFileSync(path: URL, encoding: "utf8"): string };
  // Il file di qui in una variabile: con `import.meta.url` scritto dentro
  // `new URL`, Vite farebbe del percorso un'importazione della cartella.
  const here = import.meta.url;
  return fs.readFileSync(new URL(`../../../../../../../${path}`, here), "utf8");
}

/// Gli id dei pulsanti della barra nel registro, in `BUTTONS`: la prima
/// stringa di ogni pulsante.
async function formattingCommands(): Promise<string[]> {
  const source = await readCrateFile("crates/fub-features/src/formatting.rs");
  const body = /const BUTTONS: &\[Button\] = &\[([\s\S]*?)\n\];/.exec(source)?.[1];
  if (!body) throw new Error("BUTTONS non trovato in formatting.rs");
  return [...body.matchAll(/\[\s*"([^"]+)",/g)].map((found) => found[1]!);
}

const spec = (id: string): CommandSpec => ({
  id,
  title: id,
  description: "",
  keybinding: null,
  params: [],
  scope: { writes: false, reach: "session", reversible: true },
  surfaces: ["toolbar"],
});

const mounted: { surface: EditorSurface; parent: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, parent } of mounted.splice(0)) {
    surface.destroy();
    parent.remove();
  }
});

/// Una nota in Scrittura (coi Blocchi), col cursore dove sta `|`.
function writing(sample: string): { surface: EditorSurface; parent: HTMLElement } {
  const at = sample.indexOf("|");
  const doc = sample.replace("|", "");
  const parent = document.createElement("div");
  document.body.append(parent);
  const surface = mountMarkdownSurface({ paneId: "porte", documentId: "note/porte.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenWikilinkBeside: () => {},
    onOpenPath: () => {},
    onShowFile: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  surface.buffer.setDoc(doc);
  surface.setMode("live_preview");
  if (at >= 0) surface.reveal({ span: { start: at, end: at } });
  const entry = { surface, parent };
  mounted.push(entry);
  return entry;
}

describe("le guardie delle tre porte", () => {
  it("mordono su un caso finto: una porta senza un'azione, un pulsante fisso sul blocco", () => {
    const all = new Set(["a", "b"]);
    expect(doorGaps(["a", "b"], { "barra di formato": new Set(["a"]), maniglia: all, "Ctrl O": all })).toEqual(["barra di formato b"]);
    expect(groupOf(new Set(["markdown.heading.2", "shell.doc.search", "markdown.quote"]))).toEqual(["markdown.heading.2", "markdown.quote"]);
    const sheet = document.createElement("div");
    sheet.innerHTML = `
      <div data-presence="hover"><button class="cm-fub-block-add"></button></div>
      <div class="cm-fub-code-header"><button class="cm-fub-code-copy"></button></div>
      <div class="cm-widget"><button class="diagramma-esporta"></button><span role="button" class="stile"></span></div>`;
    expect(buttonsAtRest(sheet).map(nameOf)).toEqual(["button.cm-fub-code-copy", "button.diagramma-esporta", "span.stile"]);
  });
});

describe("le tre porte", () => {
  it("i buchi conosciuti sono ancora buchi", async () => {
    const handle = new Set(TARGETS.map((target) => ACTION_OF[target]));
    const crate = new Set(await formattingCommands());
    for (const gap of KNOWN_GAPS.keys()) {
      const [door, action] = gap.split(" ") as [string, string];
      expect(door === "maniglia" ? handle.has(action) : crate.has(action), `${gap} ora c'è: va tolto dai buchi`).toBe(false);
    }
  });

  it.each(SPECIES)("su un blocco %s le altre porte offrono il gruppo del tasto destro", async (species) => {
    const { surface } = writing(SAMPLES[species]);
    const menu = surface.contextMenu!(null);
    expect(menu, "nessun menu sul blocco").not.toBeNull();
    const ids = await formattingCommands();
    const bar = toolbarGroups(ids.map(spec), surface.editorActions);
    const group = groupOf(menuActions(menu!));
    expect(group.length === 0, NO_GROUP_YET.get(species) ?? "il tasto destro non offre azioni di blocco").toBe(NO_GROUP_YET.has(species));
    const doors: Record<Door, ReadonlySet<string>> = {
      "barra di formato": new Set(bar.flatMap((group) => [...group.inline, ...group.menu]).flatMap((entry) => (entry.action ? [entry.action] : []))),
      maniglia: new Set(TARGETS.map((target) => ACTION_OF[target])),
      "Ctrl O": new Set(ids),
    };
    expect(doorGaps(group, doors).filter((gap) => !KNOWN_GAPS.has(gap))).toEqual([]);
  });

  it("nessun pulsante sopra un blocco a riposo", () => {
    const { parent } = writing(
      `${Object.values(SAMPLES).join("\n\n").replaceAll("|", "")}\n\n| Nome | Voto |\n| --- | --- |\n| Ada | 10 |\n\n---\n\n$$\nx^2\n$$\n`,
    );
    // Il foglio fermo: nessun fuoco, il puntatore fuori.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const sheet = parent.querySelector(".cm-editor");
    expect(sheet).not.toBeNull();
    const seen = buttonsAtRest(sheet!);
    const known = [...KNOWN_AT_REST.keys()];
    expect(seen.filter((el) => !known.some((selector) => el.matches(selector))).map(nameOf)).toEqual([]);
    for (const selector of known) {
      expect(seen.some((el) => el.matches(selector)), `${selector} non si vede più a riposo: va tolto dai buchi`).toBe(true);
    }
  });
});
