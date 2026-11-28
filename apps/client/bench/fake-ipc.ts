// La porta del banco: ciò che `src/host/ipc.ts` diventa quando a girare è il
// banco e non l'app.
//
// # Come si sostituisce
//
// Non c'è nessun `if (banco)` da nessuna parte nella shell, e non ce n'è uno
// qui: la sostituzione la fa `vite.bench.config.ts` con un `resolve.alias` su
// `src/host/ipc.ts`. `main.ts` importa quello che ha sempre importato, il
// presidio del §1.3 (`host/no-tauri-outside-host.test.ts`) resta verde perché
// non è cambiata una riga di `src/`, e ciò che si fotografa è la shell vera —
// non una sua imitazione montata a mano.
//
// # Cosa è finto e cosa no
//
// Il cuore è `src/host/fake.ts`, che è già l'host finto degli e2e e risponde a
// **tutta** la porta col vault in memoria. Quel file ha tre regole, e la terza
// è «ciò che non sa fare LANCIA»: è la regola giusta per un e2e, dove una
// risposta vuota è indistinguibile da «non c'era niente» e fa passare un
// presidio mentre la shell chiede la cosa sbagliata.
//
// Per un banco che **fotografa**, la stessa regola dice un'altra cosa: `tags`
// risponde una pagina vuota, quindi il pannello dei tag si fotografa vuoto, e
// una fotografia di un pannello vuoto non mostra nessun difetto di un pannello.
// Quindi qui sopra a `fake.ts` c'è una **scenografia**: le risposte delle
// feature che il banco mette in scena. Non è un host più accomodante — è un
// allestimento, e la differenza sta in cosa se ne conclude: da una foto si
// conclude qualcosa sul CSS, mai sul comportamento del kernel.
//
// Ciò che la scenografia aggiunge è enumerato in `RISPOSTE` e in `ALBERI`, in un
// posto solo, così si legge cosa il banco finge senza cercarlo.
//
// # La luce arriva dalla query string
//
// `?light=dark|light`. Va decisa **prima** del primo fotogramma, o si fotografa
// mezzo montaggio: `theme.ts` applica la cache di `localStorage` all'avvio e
// poi rilegge l'impostazione dal canale dati, quindi il banco scrive tutte e
// due — la cache qui sotto, prima che `main.ts` giri, e il valore di
// `appearance.theme` fra le impostazioni che serve.
import { COMPONENT_SCENARIO, createFakeHost, type GridBytesFake, type Options } from "../src/host/fake";
import { MARKDOWN_SYNTAX } from "../src/rules/syntax.generated";
import { pageName } from "../src/rules/mirrored";
import XLSX_GRID from "../src/__fixtures__/xlsx-grid.json";
import type {
  DocumentMatch,
  GridBytesSession,
  GridBytesWindow,
  Heading,
  IndexQuery,
  IndexResult,
  PluginError,
  QueryExpr,
  Span,
  UiNode,
  ViewUpdate,
} from "../src/host/contract";
import { inShellLanguage } from "./fake-english";
import { documentEmbedHtml, LIVE_DOC } from "./live-fixture";
import { PHOTO_CRAFT, photoResources } from "./photo-fixture";
import {
  craftSceneCraft,
  craftSceneRender,
  craftSceneResources,
  pdfSceneFiles,
  pdfScenePreview,
  pdfSceneResources,
  PDF_SCENE_WORDCRAFT,
  treeSceneFiles,
  treeScenePreview,
  treeSceneResources,
} from "./craft-fixture";
import { rawSceneCraft, rawScenePreview, rawSceneResources } from "./raw-fixture";
import { BASE_DOC, baseFixture } from "./base-fixture";
import { CRAFT_BUNDLE_NS, CRAFT_PREVIEW_COMMAND, type CraftPreview } from "../src/host/craft";
import { CORPUS, OUTPUT, RESOURCES } from "./corpus";
import { EXPORT_FONTS, exportFontsOutcome, exportFontsWriter, VAULT_FONTS_COMMAND } from "./export-fonts-fixture";
import { GiroWorkbook, giroResources } from "./giro-fixture";
import {
  GraphBenchMetadata,
  ConnectorsBenchMetadata,
  TreeBenchMetadata,
  LargeBenchMetadata,
  params,
  GRAPH_PAYLOAD,
  TREE,
  TREE_ARRIVALS,
  LIVE,
} from "./fake-ipc-casi";
import {
  WORKBOOK,
  WORKBOOK_DOC,
  BOARDS,
  GRID_CASE,
  benchWindow,
  BENCH_SESSION,
  LARGE_SESSION,
  SIZES_ANSWER,
  SIZE_COMMANDS,
  CELLS_ANSWER,
  CELL_COMMANDS,
  lastSized,
  savedSized,
  rememberSavedSized,
  reopenSized,
  sizedOutcome,
  sizedWindow,
  LARGE_WINDOWS,
  RESULT_CASE,
  BENCH_OUTCOMES,
} from "./fake-ipc-griglia";
import {
  RICH_DOC,
  EXPORT_FONTS_SCENE,
  PHOTO,
  CRAFT_SCENE,
  RAW_SCENE,
  PDF_SCENE,
  PDF_PROFILES,
  TREE_SCENE,
  TRASH_FULL,
  trashEmptyNode,
  trashWithThree,
  LIVE_DRAWS,
} from "./fake-ipc-documenti";
import {
  DRAWING,
  benchLastInstance,
  BENCH_WINDOW_COMMAND,
  DRAWING_ENGINE,
  LIGHT,
  ROOT,
  NEW_VAULT,
  COMPONENTS_START,
} from "./fake-ipc-disegno";
import {
  DESK,
  VIEWS,
  command,
  BENCH_COMMANDS,
  NEW_FILE_COMMANDS,
  ON_MOBILE,
  FORMAT_COMMANDS,
  SLASH_COMMANDS,
  TOOLBAR_SETTING_ROW,
  ON_SHELL,
  SETTINGS,
  DRAW_WORKSPACE,
  COMPONENT_SCENARIO_MOTORE_SPENTO,
  DRAW_SAVED_WORKSPACES,
  DRAW_KEYS,
  DRAW_ENGINE_PREFS,
  CRAFT_SETTINGS,
  WORKBOOK_CHROME,
  DAY_FOLDER,
  PROPERTIES_DISPLAY,
  MATH_SETTINGS,
  GRID_PREFERENCES,
  TILES_PARAM,
  MAP_TILE_SETTING,
  benchTile,
  PROPERTY_TYPES_SETTING,
} from "./fake-ipc-impostazioni";
import {
  BUNDLE,
  KNOWN_VAULTS,
  ORGANIZATION,
  JOBS,
  TAG,
  NOTE_FACTS,
  askedDocs,
  embedSection,
  embedBlock,
  plainHtml,
  printComments,
} from "./fake-ipc-scenografia";
export { LIGHT } from "./fake-ipc-disegno";

/// La Base delle scene `base-*` (`?base=1`, T15; `?base=venti`, T16;
/// `?base=calendario`, T17; `?base=tempo`, T34; `?base=nota`, T18, la stessa
/// di `1` incorporata nella nota della Live, con la voce «Base» del «/»):
/// `Opere.base` e le note di `Opere/`, con le domande `fub.base` e i comandi
/// `base.view.*` che il finto da solo non ha. Gli attrezzi del finto li chiede
/// quando servono, cioè dopo che il finto è nato.
const BASE_PARAM = params.get("base");
const BASE_IN_NOTE = BASE_PARAM === "nota";
/// Il menu «Esporta» del riquadro (`?esporta-menu=1`, T80): c'è solo con
/// `export.run` nel kernel, che il banco di solito non ha.
const EXPORT_MENU = params.get("esporta-menu") === "1";
const BASE_VARIANT = BASE_IN_NOTE ? "1" : BASE_PARAM;
const BASE = BASE_VARIANT === "1" || BASE_VARIANT === "venti" || BASE_VARIANT === "calendario" || BASE_VARIANT === "tempo" || BASE_VARIANT === "mappa"
  ? baseFixture(() => ({
      revision: async (doc) => (await host.module.api.readDocument(doc)).revision,
      writeByCommand: async (doc, text) => {
        const { revision } = await host.module.api.readDocument(doc);
        await host.module.api.writeDocument(doc, text, { kind: "descends_from", value: revision });
        host.emit({ type: "document_changed", id: doc });
      },
    }), BASE_VARIANT)
  : null;

/// I finti del gruppo «editor» del giro (`?giro=editor`, vedi
/// `giro-fixture.ts`): il manuale in PDF di quattro pagine e, con
/// `?workbook=1`, la cartella che risponde alla formula e all'ordine che il
/// giro chiede e ricorda che cosa il salvataggio ha innestato, al posto della
/// modifica registrata delle scene.
const GIRO_EDITOR = params.get("giro") === "editor";
if (GIRO_EDITOR && (GRID_CASE !== null || RESULT_CASE !== null)) throw new RangeError("giro=editor has a workbook of its own");
const GIRO_WORKBOOK = GIRO_EDITOR && WORKBOOK_DOC !== null
  ? new GiroWorkbook(
    WORKBOOK_DOC,
    // Il JSON allarga le unioni del contratto (`kind`, `lock`) a `string`.
    BENCH_SESSION as unknown as GridBytesSession,
    XLSX_GRID.windows.find((window) => window.sheet === BENCH_SESSION.active) as unknown as GridBytesWindow,
    // Il finto di sotto e il suo registro nascono più giù: si leggono alla
    // prima chiamata.
    { openGridBytes: (...args) => behind.openGridBytes(...args) },
    (call) => host.calls.push(call),
  )
  : null;

const RESPONSES: Partial<Record<IndexQuery["kind"], (q: IndexQuery) => IndexResult>> = {
  render_preview: (q) => {
    const doc = (q as { doc: string }).doc;
    const html = OUTPUT[doc] ?? plainHtml(CORPUS[doc] ?? "");
    return { kind: "render_preview", value: { html, parts: [] } };
  },
  // La resa per la stampa (lo spazio «Esporta in PDF», T70; «Stampa»): la
  // stessa resa della lettura, come la darebbe il kernel per la carta.
  render_print: (q) => {
    const doc = (q as { doc: string }).doc;
    const html = printComments(doc, OUTPUT[doc] ?? (doc === LIVE_DOC && LIVE !== null ? plainHtml(LIVE.text, true, true) : plainHtml(CORPUS[doc] ?? "")));
    return { kind: "render_print", value: { html, parts: [] } };
  },
  render_embed: (q) => {
    if (q.kind !== "render_embed") throw new Error("Richiesta embed non valida");
    // Una Base incorporata (`?base=nota`, T18): il blocco `fub:base` che il
    // kernel darebbe, col testo del file e la vista della sezione. Le domande
    // `fub.base` del finto rispondono per `Opere.base` qualunque sia il file.
    if (BASE !== null && q.page.endsWith(".base") && !q.block) {
      // Come il kernel, accanto al testo il path del file (`base`): la Base
      // incorporata da un file scrive le sue viste lì.
      const source = BASE.files[BASE_DOC] ?? "";
      const doc = q.page.includes("/") ? q.page : BASE_DOC;
      return {
        kind: "render_embed",
        value: {
          doc_id: doc,
          html: '<div class="ui-slot" data-ui-slot="0" data-custom-kind="base"></div>',
          parts: [{ slot: 0, kind: "base", node: { node: "custom", ns: "fub:base", payload: { source, base: doc, view: q.heading ?? null, container: doc }, fallback: [] } }],
        },
      };
    }
    // Un documento di videoscrittura che un caso della Live incorpora (la
    // scheda di documento, T44): il modello comune reso, dalla proiezione che
    // il vault ha adesso. Il kernel non regge una sezione di un documento:
    // con un titolo dà lo stesso il documento intero, come la scheda chiede.
    const richFile = /\.(docx|odt)$/i.test(q.page)
      ? Object.keys(LIVE?.files ?? {}).find((id) => id === q.page || id.endsWith(`/${q.page}`))
      : undefined;
    if (richFile !== undefined && !q.block) {
      const projection = host.files()[richFile] ?? LIVE!.files![richFile]!;
      return { kind: "render_embed", value: { doc_id: richFile, html: documentEmbedHtml(projection), parts: [] } };
    }
    const page = q.page.endsWith(".md") ? q.page : `${q.page}.md`;
    // Una nota che un caso della Live riporta (la trasclusione viva): la
    // sezione dal suo titolo al prossimo dello stesso livello, letta dal
    // vault com'è adesso, come la rende il kernel dopo un salvataggio.
    const liveFile = LIVE?.files?.[page];
    if (liveFile !== undefined) {
      const text = host.files()[page] ?? liveFile;
      const part = q.block ? embedBlock(text, q.block) : embedSection(text, q.heading ?? null);
      return { kind: "render_embed", value: { doc_id: page, html: plainHtml(part), parts: [] } };
    }
    const doc = Object.keys(CORPUS).find((id) => id === page || id.endsWith(`/${page}`));
    if (!doc || OUTPUT[doc] === undefined || q.heading || q.block) {
      throw new Error(`Embed non dichiarato nel banco: ${q.page}`);
    }
    return { kind: "render_embed", value: { doc_id: doc, html: OUTPUT[doc], parts: [] } };
  },
  // Le etichette di tutto il vault; quelle di una nota sola (la riga dei
  // dati sotto il titolo) sono della nota Benvenuto, come il prototipo.
  tags: (q) => {
    const docs = q.kind === "tags" ? askedDocs(q.matching) : null;
    if (docs === null) return { kind: "tags", value: { items: TAG, offset: 0, total: TAG.length } };
    const items = docs.flatMap((doc) => NOTE_FACTS[doc]?.tags ?? []).map((name) => ({ name, count: 1 }));
    return { kind: "tags", value: { items, offset: 0, total: items.length } };
  },
  // Quante note citano una nota: il finto non tiene i backlink.
  backlinks: (q) => {
    const total = q.kind === "backlinks" ? (NOTE_FACTS[q.target]?.links ?? 0) : 0;
    return { kind: "backlinks", value: { items: [], offset: 0, total } };
  },
  // I titoli `#` di una nota del corpus (`headingsOf`): quelli che «Sposta
  // in…» offre come destinazione, e quelli della Struttura.
  outline: (q) => ({ kind: "outline", value: q.kind === "outline" ? headingsOf(q.doc) : [] }),
  jobs: () => ({ kind: "jobs", value: JOBS }),
};

/// I titoli `#` di una nota del vault finto, coi byte del sorgente: è l'indice
/// dei titoli del finto (la domanda `outline`), letto dai file del vault come
/// l'indice vero. Lo slug è quello semplice, minuscole e trattini; ogni
/// documento che non è una nota Markdown (un PDF, le sue annotazioni, una
/// lavagna) non ha titoli.
function headingsOf(doc: string): Heading[] {
  const source = doc.endsWith(".md") ? (options.file?.[doc] ?? "") : "";
  const encoder = new TextEncoder();
  const value: Heading[] = [];
  let offset = 0;
  let fence = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const found = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (found) {
      const text = found[2]!;
      const start = encoder.encode(source.slice(0, offset)).length;
      const slug = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
      value.push({ level: found[1]!.length, text, slug, span: { start, end: start + encoder.encode(line).length }, explicit_anchor: null });
    }
    offset += line.length + 1;
  }
  return value;
}

/// Il documento davanti, come la shell l'ha pubblicato (`setActiveContext`):
/// la Struttura del finto lo legge come il provider vero legge
/// `active_context` (`fub-features/src/outline.rs`).
let frontDoc: string | null = null;

/// Chi punta a una nota, nella scenografia: le righe di «In entrata» sotto la
/// Struttura. Il provider le legge dai backlink dell'indice; il finto non li
/// tiene, e le dichiara qui per le note che le foto mostrano (per Sintassi di
/// Fub le stesse dei Collegamenti).
const OUTLINE_INCOMING: Readonly<Record<string, readonly string[]>> = {
  "Benvenuto.md": ["Guida/Sintassi di Fub.md", "Progetti/Il banco che vede.md", "Diario/2026-08-19.md"],
  "Guida/Sintassi di Fub.md": ["Benvenuto.md", "Progetti/Il banco che vede.md"],
};

type TreeItem = Extract<UiNode, { node: "tree_item" }>;

/// I titoli da `at` in poi che stanno sotto `parent`, e l'indice del primo che
/// non ci sta più: «figlio» vuol dire di livello maggiore, come `subtree` del
/// provider, così una nota che salta un livello non perde titoli. Il salto
/// porta il posto del titolo (da 1), e solo chi ha figli nasce aperto.
function headingItems(headings: readonly Heading[], at: number, parent: number): [TreeItem[], number] {
  const items: TreeItem[] = [];
  let index = at;
  while (index < headings.length && headings[index]!.level > parent) {
    const heading = headings[index]!;
    const [children, next] = headingItems(headings, index + 1, heading.level);
    items.push({
      node: "tree_item",
      label: heading.text,
      selected: false,
      expanded: children.length > 0,
      action: { action: "goto", payload: index + 1 },
      children,
    });
    index = next;
  }
  return [items, index];
}

/// «In entrata · N» sotto la Struttura, come `build_incoming_section`: il nome
/// della nota e la sua cartella; senza riferimenti la sezione non c'è.
function incomingSection(doc: string): UiNode | null {
  const sources = OUTLINE_INCOMING[doc] ?? [];
  if (sources.length === 0) return null;
  return {
    node: "section", title: `In entrata · ${sources.length}`, collapsed: false, key: "outline-incoming", children: [{
      node: "list",
      items: sources.map((source): UiNode => ({
        node: "list_item",
        title: pageName(source),
        subtitle: source.includes("/") ? source.slice(0, source.lastIndexOf("/")).split("/").pop()! : null,
        action: { action: "open", payload: { doc: source } },
        selected: false,
        key: `${source}#0`,
        drag: { kind: "document", doc: source },
      })),
    }],
  };
}

/// La Struttura del documento davanti, con la regola del provider `outline`:
/// nessun documento, lo stato vuoto «nessuna nota»; un documento senza titoli
/// (un PDF, le sue annotazioni, una lavagna, una nota senza `#`), lo stato
/// vuoto «nessun titolo», con «In entrata» se qualcuno lo cita; altrimenti
/// l'albero dei titoli e, sotto, «In entrata».
function outlineTree(): UiNode {
  if (frontDoc === null) return { node: "empty_state", title: "Nessuna nota aperta.", detail: null, action: null };
  const headings = headingsOf(frontDoc);
  const incoming = incomingSection(frontDoc);
  if (headings.length === 0) {
    const empty: UiNode = { node: "empty_state", title: "Nessun heading.", detail: null, action: null };
    return incoming === null ? empty : { node: "stack", dir: "column", gap: 2, children: [empty, incoming] };
  }
  const [roots] = headingItems(headings, 0, 0);
  return { node: "stack", dir: "column", gap: 2, children: [{ node: "tree", roots }, ...(incoming === null ? [] : [incoming])] };
}

/// Gli alberi delle view della scenografia, per id. Sono `UiNode` veri e li
/// disegna `ui/node.ts` vero: è la ragione per cui il pannello di destra si può
/// fotografare senza inventarsi del markup: **non c'è markup**, c'è un albero
/// del contratto e il renderer della shell.
const TREES: Record<string, UiNode> = {
  // Le forme sono quelle del provider `backlinks` (fub-features): una sezione
  // per parte, col numero nel titolo, chiusa quando è vuota; il filtro in
  // fondo, chiuso.
  backlinks: {
    node: "stack",
    dir: "column",
    gap: 4,
    children: [
      {
        node: "section", title: "In entrata · 2", collapsed: false, key: "incoming", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Benvenuto", subtitle: "…sta in Sintassi di Fub, i colori della nota e i link…", action: { action: "open", payload: "Benvenuto.md" }, selected: false, drag: { kind: "document", doc: "Benvenuto.md" } },
            { node: "list_item", title: "Il banco che vede", subtitle: "Vedi anche Sintassi di Fub e una delle scene del banco.", action: { action: "open", payload: "Progetti/Il banco che vede.md" }, selected: false, drag: { kind: "document", doc: "Progetti/Il banco che vede.md" } },
          ],
        }],
      },
      {
        node: "section", title: "Dalle proprietà · 1", collapsed: false, key: "property_links", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Frammenti di codice", subtitle: "Proprietà: guida, vedi", action: { action: "open", payload: "Guida/Frammenti di codice.md" }, selected: false, drag: { kind: "document", doc: "Guida/Frammenti di codice.md" } },
          ],
        }],
      },
      {
        node: "section", title: "In uscita · 2", collapsed: false, key: "outgoing", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Benvenuto", subtitle: "Un wikilink risolto: Benvenuto.", action: { action: "open", payload: "Benvenuto.md" }, selected: false, drag: { kind: "document", doc: "Benvenuto.md" } },
            { node: "list_item", title: "Frammenti di codice", subtitle: "Uno con alias: i frammenti.", action: { action: "open", payload: "Guida/Frammenti di codice.md" }, selected: false, drag: { kind: "document", doc: "Guida/Frammenti di codice.md" } },
          ],
        }],
      },
      {
        node: "section", title: "Menzioni non collegate · 1", collapsed: false, key: "unlinked", children: [{
          node: "list",
          items: [{
            node: "stack", dir: "row", gap: 6, children: [
              { node: "list_item", title: "Nota lunga", subtitle: "…la sintassi di fub resta la stessa in ogni nota…", action: { action: "open", payload: "Guida/Nota lunga.md" }, selected: false, drag: { kind: "document", doc: "Guida/Nota lunga.md" } },
              { node: "button", label: "Collega", intent: "neutral", action: { action: "convert", payload: null } },
            ],
          }],
        }],
      },
      {
        node: "section", title: "Menzioni uscenti non collegate · 0", collapsed: true, key: "outbound_unlinked", children: [
          { node: "empty_state", title: "Nessuna menzione non collegata.", detail: null, action: null },
        ],
      },
      {
        node: "section", title: "Filtro avanzato", collapsed: true, key: "filter_section", children: [
          { node: "text_input", field: "filter", label: "Filtro (QueryExpr JSON)", value: "", placeholder: null, action: { action: "filter", payload: null } },
        ],
      },
    ],
  },
  properties: {
    node: "key_value",
    entries: [
      { label: "Parole", value: "412" },
      { label: "Collegamenti", value: "6" },
      { label: "Tag", value: "sintassi" },
      { label: "Modificata", value: "19 agosto 2026" },
    ],
  },
  // Le forme sono quelle del provider `history` (fub-features): righe
  // leggere, e i gesti nell'anteprima della versione scelta, che parte dal
  // confronto con la nota attuale.
  history: {
    node: "stack",
    dir: "column",
    gap: 1,
    children: [
      { node: "text", content: "Versioni: 4" },
      {
        node: "list",
        items: [
          { node: "list_item", key: "0", title: "19 agosto 2026, 09:12", subtitle: "Versione attuale", action: { action: "preview", payload: 0 }, selected: false },
          { node: "list_item", key: "1", title: "18 agosto 2026, 17:40", subtitle: "+22 byte", action: { action: "preview", payload: 1 }, selected: true },
          { node: "list_item", key: "2", title: "18 agosto 2026, 11:02", subtitle: "+1.139 byte", action: { action: "preview", payload: 2 }, selected: false },
          { node: "list_item", key: "3", title: "12 agosto 2026, 11:05", subtitle: "Prima versione · 2.251 byte", action: { action: "preview", payload: 3 }, selected: false },
        ],
      },
      {
        node: "section", title: "Versione del 18 agosto 2026, 17:40", collapsed: false, key: "preview:1", children: [
          { node: "stack", dir: "row", gap: 4, children: [
            { node: "button", label: "Ripristina", intent: "primary", action: { action: "restore", payload: 1 } },
            { node: "button", label: "Mostra il testo", intent: "neutral", action: { action: "show_text", payload: 1 } },
            { node: "button", label: "Copia il testo", intent: "neutral", action: { action: "copy", payload: 1 } },
            { node: "button", label: "Chiudi l'anteprima", intent: "neutral", action: { action: "close_preview", payload: null } },
          ] },
          { node: "stack", dir: "column", gap: 0, children: [
            { node: "text", content: "Rispetto a questa versione, la nota attuale ha 2 righe in più e 1 in meno." },
            { node: "text", content: "… 4 righe uguali" },
            { node: "text", content: "  ## Testo" },
            { node: "stack", dir: "row", gap: 1, children: [{ node: "badge", label: "−", intent: "danger" }, { node: "text", content: "Prosa normale, con **grassetto** e *corsivo*." }] },
            { node: "stack", dir: "row", gap: 1, children: [{ node: "badge", label: "+", intent: "primary" }, { node: "text", content: "Prosa normale, con **grassetto**, *corsivo*, ~~barrato~~." }] },
            { node: "stack", dir: "row", gap: 1, children: [{ node: "badge", label: "+", intent: "primary" }, { node: "text", content: "Un apice^ e una nota a piè di pagina[^1]." }] },
            { node: "text", content: "  " },
          ] },
        ],
      },
    ],
  },
  stats: {
    node: "stack",
    dir: "row",
    gap: 12,
    children: [
      { node: "text", content: "412 parole" },
      { node: "text", content: "2 min di lettura" },
    ],
  },
  tags: {
    node: "list",
    items: TAG.map((t) => ({
      node: "list_item" as const,
      title: `#${t.name}`,
      subtitle: `${t.count} note`,
      action: { action: "filter", payload: t.name },
      selected: t.name === "tema",
    })),
  },
  trash: TRASH_FULL ? trashWithThree() : {
    node: "empty_state",
    title: "Il cestino è vuoto",
    detail: "Ciò che si cestina resta qui finché non lo si svuota.",
    action: null,
  },
  graph: {
    node: "custom",
    ns: "fub:graph",
    payload: GRAPH_PAYLOAD ?? {
      nodes: [
        "Benvenuto.md",
        "Guida/Sintassi di Fub.md",
        "Guida/Frammenti di codice.md",
        "Diario/2026-08-19.md",
        "Progetti/Il banco che vede.md",
        "Progetti/Archivio/Prima idea.md",
      ],
      edges: [
        { from: "Benvenuto.md", to: "Guida/Sintassi di Fub.md" },
        { from: "Benvenuto.md", to: "Guida/Frammenti di codice.md" },
        { from: "Progetti/Il banco che vede.md", to: "Guida/Sintassi di Fub.md" },
        { from: "Diario/2026-08-19.md", to: "Progetti/Il banco che vede.md" },
        { from: "Progetti/Archivio/Prima idea.md", to: "Progetti/Il banco che vede.md" },
      ],
    },
    fallback: [{ node: "text", content: "Il grafo, per chi non sa disegnarlo." }],
  },
  // La pagina del tipo (T33) in fondo a `Tipi/Libro.md`: la forma è quella
  // di `fub_features::properties` (`note_type_page`), un gruppo col conto e
  // le proprietà in evidenza del tipo. Solo nella scena `?live=tipo-pagina`.
  note_type_page: {
    node: "stack",
    dir: "column",
    gap: 0,
    children: [{
      node: "section", title: "Note di tipo Libro · 2", collapsed: false, key: "type-notes", children: [{
        node: "list",
        items: [
          { node: "list_item", title: "Dune", subtitle: "Frank Herbert", action: { action: "note_type.page.open", payload: { doc: "Biblioteca/Dune.md" } }, selected: false, key: "Biblioteca/Dune.md" },
          { node: "list_item", title: "Live", subtitle: "Frank Herbert · letto", action: { action: "note_type.page.open", payload: { doc: "Guida/Live.md" } }, selected: false, key: "Guida/Live.md" },
        ],
      }],
    }],
  },
  // La pagina del giorno (T39) in fondo a `Diario/2026-08-19.md`: la forma è
  // quella di `fub_features::template` (`day_page`), i tre gruppi col conto.
  // Solo nelle scene `?giorno=1`, che dichiarano la view.
  day_page: {
    node: "stack",
    dir: "column",
    gap: 4,
    children: [
      {
        node: "section", title: "Compiti di oggi · 2", collapsed: false, key: "day-tasks", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Mandare le foto del banco", subtitle: "Il banco che vede", action: { action: "day.open", payload: { doc: "Progetti/Il banco che vede.md" } }, selected: false, key: "Progetti/Il banco che vede.md#4" },
            { node: "list_item", title: "Rileggere la sintassi delle date, e dire a Mario cosa cambia nei frammenti di codice", subtitle: "Sintassi di Fub", action: { action: "day.open", payload: { doc: "Guida/Sintassi di Fub.md" } }, selected: false, key: "Guida/Sintassi di Fub.md#9" },
          ],
        }],
      },
      {
        node: "section", title: "Stesso giorno · 1", collapsed: false, key: "day-same", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Il banco che vede", subtitle: "scadenza", action: { action: "day.open", payload: { doc: "Progetti/Il banco che vede.md" } }, selected: false, key: "Progetti/Il banco che vede.md" },
          ],
        }],
      },
      {
        node: "section", title: "Create e cambiate · 3", collapsed: false, key: "day-changed", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Il banco che vede", subtitle: "Cambiata alle 18:40", action: { action: "day.open", payload: { doc: "Progetti/Il banco che vede.md" } }, selected: false, key: "Progetti/Il banco che vede.md" },
            { node: "list_item", title: "Frammenti di codice", subtitle: "Cambiata alle 11:05", action: { action: "day.open", payload: { doc: "Guida/Frammenti di codice.md" } }, selected: false, key: "Guida/Frammenti di codice.md" },
            { node: "list_item", title: "Benvenuto", subtitle: "Cambiata alle 09:12", action: { action: "day.open", payload: { doc: "Benvenuto.md" } }, selected: false, key: "Benvenuto.md" },
          ],
        }],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// La porta.
// ---------------------------------------------------------------------------

const options: Options = {
  file: TREE !== null ? TREE.files : NEW_VAULT ? {} : {
    ...CORPUS,
    ...(DRAWING === null ? {} : { [DRAWING.doc]: DRAWING.text }),
    // Il testo di una cartella è il suo giornale, vuoto sul disco.
    ...(WORKBOOK_DOC === null ? {} : { [WORKBOOK_DOC]: "" }),
    // Le lavagne delle scene `lavagna-*`.
    ...BOARDS,
    // Il testo di un documento di videoscrittura è la sua proiezione.
    ...(RICH_DOC === null ? {} : { [RICH_DOC.doc]: RICH_DOC.text }),
    // La nota della Live, per le scene che la chiedono.
    ...(LIVE === null ? {} : { [LIVE_DOC]: LIVE.text, ...LIVE.files }),
    ...(PDF_SCENE === null ? {} : pdfSceneFiles(PDF_SCENE)),
    ...(TREE_SCENE === null ? {} : treeSceneFiles()),
    ...(BASE === null ? {} : BASE.files),
  },
  resources: TREE !== null || NEW_VAULT ? {} : {
    ...RESOURCES,
    ...(PHOTO === null ? {} : photoResources(PHOTO)),
    ...(CRAFT_SCENE === null ? {} : craftSceneResources()),
    ...(RAW_SCENE === null ? {} : rawSceneResources(RAW_SCENE)),
    ...(PDF_SCENE === null ? {} : pdfSceneResources()),
    ...(TREE_SCENE === null ? {} : treeSceneResources()),
    ...(GIRO_EDITOR ? giroResources() : {}),
  },
  root: ROOT,
  view: VIEWS,
  commands: [
    // Con `?formatbar=1&slash=1` ci sono tutti e due, come nell'host vero
    // (il giro sul banco, `bench/giro/scrivere.mjs`, e «+ Inserisci» della
    // barra): le voci della barra restano nel loro ordine, ma una che c'è
    // anche nel «/» è quella del «/», che porta anche la superficie `slash`;
    // le altre voci del «/» vengono dopo, senza ripetere gli id. Da soli,
    // ognuno dà ciò che dava.
    ...BENCH_COMMANDS,
    ...NEW_FILE_COMMANDS,
    ...(ON_MOBILE ? FORMAT_COMMANDS.map((format) => SLASH_COMMANDS.find((slash) => slash.id === format.id) ?? format) : []),
    ...(ON_MOBILE ? SLASH_COMMANDS.filter((slash) => !FORMAT_COMMANDS.some((format) => format.id === slash.id)) : SLASH_COMMANDS),
    // Il PDF annotato ha «Annota», il comando della feature `draw`.
    ...(PDF_SCENE === "annotato" ? [command("pdf.annotate", "Annota il PDF", "Crea o apre le annotazioni del PDF", null, true)] : []),
    // Con le Basi accese c'è `base.view.add`, e il «/» offre «Base».
    ...(BASE_IN_NOTE ? [command("base.view.add", "Aggiungi una vista", "Aggiunge una vista alla Base", null, true)] : []),
    // Con `export.run` il riquadro di una nota ha «Esporta ▸»: HTML e PDF.
    ...(EXPORT_MENU ? [command("export.run", "Export documents", "Run a registered export target", null)] : []),
  ],
  settings: [...SETTINGS, ...DAY_FOLDER, ...(DRAWING === null && PDF_SCENE !== "annotato" && !LIVE_DRAWS ? [] : [...DRAW_WORKSPACE, ...DRAW_SAVED_WORKSPACES]), ...DRAW_KEYS, ...DRAW_ENGINE_PREFS, ...CRAFT_SETTINGS, ...WORKBOOK_CHROME, ...PROPERTIES_DISPLAY, ...PROPERTY_TYPES_SETTING, ...TOOLBAR_SETTING_ROW, ...MATH_SETTINGS, ...GRID_PREFERENCES, ...MAP_TILE_SETTING],
  // Le tessere della mappa (`?base=mappa`): il finto le chiede solo dopo il
  // controllo della riga `map.tile-hosts`, come l'host.
  ...(TILES_PARAM === null ? {} : { mapTile: benchTile }),
  syntaxForms: [...MARKDOWN_SYNTAX],
  ...(BASE === null ? {} : { customQueries: { "fub.base": (query: unknown) => BASE.query(query) } }),
  ...(WORKBOOK_DOC === null ? {} : {
    // Il JSON allarga le unioni del contratto (`kind`, `lock`) a `string`.
    gridBytes: WORKBOOK === "large" ? {
      surface: XLSX_GRID.surface,
      session: LARGE_SESSION,
      windows: LARGE_WINDOWS,
    } as GridBytesFake : {
      surface: XLSX_GRID.surface,
      session: BENCH_SESSION,
      windows: [...XLSX_GRID.windows, XLSX_GRID.edit.window, ...(GIRO_WORKBOOK?.windows ?? [])].map(benchWindow),
      commits: [XLSX_GRID.edit.commit],
      ...(BENCH_OUTCOMES === undefined ? {} : { outcomes: BENCH_OUTCOMES }),
    } as GridBytesFake,
  }),
  ...(DRAWING === null && PDF_SCENE !== "annotato" && !LIVE_DRAWS ? {} : { draw: true }),
  // Il motore del disegno (`drawing`) c'è solo con `?drawing=`: senza, le
  // porte del disegno rispondono `unserved` come l'host senza il componente,
  // e gli strumenti del disegno restano quelli del client.
  ...(DRAWING_ENGINE === undefined ? {} : { drawing: DRAWING_ENGINE }),
  ...(PHOTO === null ? {} : { craft: PHOTO_CRAFT }),
  ...(CRAFT_SCENE === null ? {} : {
    craft: craftSceneCraft(CRAFT_SCENE),
    craftRender: craftSceneRender(async (doc, size) =>
      ((await host.module.api.invokeCommand("craft.preview", { doc, size })).effect as { payload: CraftPreview }).payload),
  }),
  ...(RAW_SCENE === null ? {} : { craft: rawSceneCraft(RAW_SCENE) }),
  ...(PDF_SCENE === null ? {} : {
    // Il bundle `fub.craft` acceso, e WordCraft installata per il prestito.
    craft: { docs: {} },
    externalEditors: async (doc: string | null) => (doc === null || doc.endsWith(".docx") ? [PDF_SCENE_WORDCRAFT] : []),
    openWith: async (_path: string, editor: string) => ({ editor, how: "new_process" as const }),
  }),
  // Il bundle `fub.craft` acceso: le miniature le dice `treeScenePreview`.
  ...(TREE_SCENE === null ? {} : { craft: { docs: {} } }),
  // L'organizzazione con cui il vault si apre: il finto la tiene da qui in poi.
  organization: ORGANIZATION,
  // La pagina «Componenti» non è scenografia: sono le risposte registrate
  // dall'host vero (vault di prova con «Studio»), le stesse dei test. Una
  // scelta che lo scenario non ha la porta la rifiuta, come nei test.
  // `?componenti=solo-note` parte da un altro stato registrato.
  components: COMPONENTS_START === "motore-spento" ? COMPONENT_SCENARIO_MOTORE_SPENTO : COMPONENT_SCENARIO,
  ...(COMPONENTS_START === null ? {} : { componentsStart: COMPONENTS_START }),
  ...(NEW_VAULT ? { initialVault: null, componentsStart: "nuovo" } : {}),
};

const host = createFakeHost(options);
const writeExportFonts = exportFontsWriter((id, bytes) => host.module.api.resourceWrite(id, bytes, null));

/// **Lo strato d'avvio fermo a uno stato**, per le scene che lo fotografano
/// (`avvio-*` in `scene.mjs`). Si decide qui, alla nascita del fake, perché
/// `window.bench` arriva quando l'avvio è già partito: con le porte che il fake
/// ha già, senza un meccanismo nuovo.
///
/// - `avvio=attesa`: `openVault` resta in volo per sempre. La shell è in piedi
///   (`data-pronta`), la fase è «vault», e lo strato resta sopra l'app.
/// - `avvio=guasto`: `initialVault` rifiuta, `init()` lancia e
///   `mountDesktopShell` finisce nel guasto dello strato. Non `openVault`:
///   `openInitialVault` ne cattura l'errore e lo dice nell'app.
const AVVIO = params.get("avvio");
if (AVVIO === "attesa") host.throttle("openVault");
else if (AVVIO === "guasto") host.fault("initialVault", "il ponte non risponde");

/// L'host del banco, esposto sulla finestra perché il **fotografo** possa
/// guidarlo da fuori: emettere un evento del kernel, guastare una porta,
/// frenarla. Sono i tre gesti che una scena non può fare cliccando — un avviso
/// non ha un bottone che lo produca — e senza di loro tre scene su diciotto non
/// esisterebbero. Il quarto, la scrittura da fuori, è del giro sul banco: un
/// evento emesso da qui ha l'origine di una scrittura della shell, e la shell
/// lo prenderebbe per l'eco di un suo salvataggio; quello del watcher no.
///
/// Sta su `window` e non in un `export` perché chi la chiama è Playwright, cioè
/// codice che non condivide il grafo dei moduli con la pagina.
declare global {
  var __fubGraphBench: GraphBenchMetadata;
  var __fubConnectorsBench: ConnectorsBenchMetadata;
  var __fubLargeBench: LargeBenchMetadata;
  var __fubTreeBench: TreeBenchMetadata;
  var __fubLiveBench: Readonly<{ doc: string | null; cursor: number | null; head: number | null }>;
  interface Window {
    bench: {
      emit: typeof host.emit;
      fault: typeof host.fault;
      throttle: typeof host.throttle;
      /// Riscrive un file come l'altra applicazione o il sync: i byte
      /// cambiano e l'evento arriva dal watcher (il giro sul banco,
      /// `bench/giro/guasti.mjs`).
      writeFromOutside: typeof host.writeFromOutside;
      calls: typeof host.calls;
      light: "dark" | "light";
      /// La finestra del comando sul disegno aperto (K6 T6): la famiglia pronta,
      /// che si carica, o che non si carica.
      finestra: (stato: "finestra" | "caricamento" | "errore") => Promise<void>;
      /// Solo nello Scrittoio: dichiara le voci di un tema (vedi sotto).
      themeSettings?: () => Promise<void>;
    };
  }
}

/// Le porte di `gridBytesCommand` frenate o guaste dal banco, viste anche da
/// chi risponde alle misure tirate (`?misure=si`) al posto del finto.
const sizeGates: { held: Promise<void> | null; fault: boolean } = { held: null, fault: false };

globalThis.window.bench = {
  emit: host.emit,
  fault: (gate, reason) => {
    const restore = host.fault(gate, reason);
    if (gate !== "gridBytesCommand") return restore;
    sizeGates.fault = true;
    return () => {
      sizeGates.fault = false;
      restore();
    };
  },
  throttle: (gate) => {
    const release = host.throttle(gate);
    if (gate !== "gridBytesCommand") return release;
    let open = () => {};
    const held = new Promise<void>((resolve) => { open = resolve; });
    sizeGates.held = held;
    return () => {
      if (sizeGates.held === held) sizeGates.held = null;
      open();
      release();
    };
  },
  writeFromOutside: host.writeFromOutside,
  calls: host.calls,
  light: LIGHT,
  finestra: (stato: "finestra" | "caricamento" | "errore") => benchFinestra(stato),
};

/// La finestra «Sposta tracciato» del banco (K6 T6), aperta sul disegno
/// dell'ultima apertura. `finestra`: la famiglia è pronta, col modulo del
/// prototipo. `caricamento`: la famiglia non arriva. `errore`: la memoria dei
/// motori è piena, e «Riprova» rifà la promessa. Le frasi del caricamento e
/// del titolo di `caricamento` ed `errore` sono quelle del prototipo
/// (`PLAN-ui/disegno-completo.html`, la finestra «Ombra esterna»).
async function benchFinestra(stato: "finestra" | "caricamento" | "errore"): Promise<void> {
  if (benchLastInstance === null) throw new Error("il banco: il disegno non è aperto");
  const instance = benchLastInstance;
  const { apriFinestra } = await import("../src/editors/spatial/motore/finestre");
  const { openLifetime } = await import("../src/ui/lifetime");
  const vita = openLifetime();
  const modulo = {
    campi: [
      { nome: "distanza", tipo: "numero" as const },
      { nome: "giunzioni", tipo: "scelta" as const, valori: ["vivo", "arrotondato", "smussato"] },
      { nome: "limite", tipo: "numero" as const, min: 1 },
    ],
  };
  const attesa = new Promise<void>(() => {});
  const pronto = stato === "finestra" ? Promise.resolve() : stato === "errore" ? Promise.reject("no_memory") : attesa;
  const aperta = stato === "finestra";
  void apriFinestra(
    modulo,
    pronto,
    (valori, anteprima) =>
      host.module.api
        .drawingCommand(instance, { revision: "0", id: BENCH_WINDOW_COMMAND, selection: [], value: valori, preview: anteprima })
        .then((outcome) => ({ anteprima: outcome.preview, rifiuto: outcome.refused })),
    {
      id: "banco.tracciato.sposta",
      titolo: aperta ? "Sposta tracciato" : "Ombra esterna",
      descrizione: aperta ? "Un tracciato nuovo, parallelo a quello scelto, alla distanza che scrivi. Un numero negativo lo porta dentro." : undefined,
      azione: aperta ? "Sposta" : undefined,
      campi: { distanza: "Spostamento", giunzioni: "Giunzioni", limite: "Limite angolo vivo" },
      scelte: { giunzioni: { vivo: "Angolo vivo", arrotondato: "Arrotondato", smussato: "Smussato" } },
      unita: { distanza: "px", limite: "×" },
      iniziali: { distanza: 6, giunzioni: "arrotondato", limite: 4 },
      caricamento: aperta ? undefined : "Sto preparando gli effetti: la prima volta ci vuole un momento.",
      vita,
      sulFoglio: () => {},
      riprova: stato === "errore" ? () => attesa : undefined,
    },
  );
}

/// Le voci di un tema, per la scena che fotografa la loro schermata. Il tema di
/// serie non ne dichiara, e una schermata che non c'è non si fotografa: la
/// scena le dichiara da fuori, dopo l'avvio, al posto della sorgente vera. Una
/// voce per specie di controllo — interruttore, scelta breve, scelta lunga,
/// numero — e una già cambiata, perché «azzera» si veda.
///
/// Solo nella finestra principale, e con un `import()`: il modulo della schermata porta
/// con sé la sua geometria, che nelle altre pagine non deve entrare.
if (ON_SHELL) {
  globalThis.window.bench.themeSettings = async () => {
    const { setThemeSettingsSource } = await import("../src/shells/scrittoio/preferences/theme-settings");
    const specs = [
      {
        key: "fub.serie:trama",
        label: "Trama della carta",
        description: "Una grana leggera sul fondo dei fogli.",
        kind: { kind: "toggle" as const, default: true },
      },
      {
        key: "fub.serie:angoli",
        label: "Angoli dei fogli",
        description: "Quanto sono arrotondati i fogli e le schede.",
        kind: {
          kind: "choice" as const,
          default: "morbidi",
          options: [
            { value: "vivi", label: "Vivi" },
            { value: "morbidi", label: "Morbidi" },
            { value: "tondi", label: "Tondi" },
          ],
        },
      },
      {
        key: "fub.serie:scrivania",
        label: "Fondo della scrivania",
        description: "Che cosa si vede dietro i fogli.",
        kind: {
          kind: "choice" as const,
          default: "tinta",
          options: [
            { value: "tinta", label: "Tinta unita" },
            { value: "quadretti", label: "Carta a quadretti" },
            { value: "righe", label: "Carta a righe" },
            { value: "legno", label: "Venatura del legno" },
          ],
        },
      },
      {
        key: "fub.serie:margine",
        label: "Margine dei fogli",
        description: "Lo spazio bianco attorno al testo, in pixel.",
        kind: { kind: "number" as const, default: 24, min: 0, max: 48, step: 1 },
      },
    ];
    const chosen = new Map<string, boolean | string | number>([["fub.serie:trama", false]]);
    const listeners = new Set<() => void>();
    const changed = (): void => {
      for (const listener of [...listeners]) listener();
    };
    setThemeSettingsSource({
      read: () =>
        Promise.resolve({
          themeId: "fub.serie",
          themeName: "Scrittoio",
          entries: specs.map((spec) => ({ spec, value: chosen.get(spec.key) ?? spec.kind.default })),
        }),
      write: (key, value) => {
        chosen.set(key, value);
        changed();
        return Promise.resolve();
      },
      reset: (key) => {
        chosen.delete(key);
        changed();
        return Promise.resolve();
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
  };
}

const behind = host.module.api;

/// **Il cestino vero del finto**, fuori dalla scena dei tre file: ciò che il
/// finto host ha cestinato (`note.trash`) nella forma del provider `trash`
/// (fub-features, `trash.rs`), una riga per voce col nome della nota e
/// «Ripristina», e sotto «Svuota il cestino». Serve al giro sul banco
/// (`bench/giro/guasti.mjs`), che cestina una nota, la ritrova qui e la
/// rimette. Il finto non sa quando una voce è stata cestinata: la riga non ha
/// la data che il provider scrive sotto il nome. Vuoto, il pannello resta lo
/// stato vuoto della scenografia, quello che le foto conoscono.
function liveTrash(): UiNode | undefined {
  if (TRASH_FULL) return undefined;
  const entries = host.trash();
  if (entries.length === 0) return undefined;
  const asking = trashAsking;
  return {
    node: "stack",
    dir: "column",
    gap: 1,
    children: [
      {
        node: "list",
        items: entries.map(({ id, original }): UiNode => ({
          node: "stack",
          key: id,
          dir: "row",
          gap: 1,
          children: [
            { node: "list_item", title: pageName(original), subtitle: null, action: null, selected: false },
            { node: "button", key: `restore:${id}`, label: "Ripristina", intent: "primary", action: { action: "restore", payload: { entry: id, original } } },
          ],
        })),
      },
      trashEmptyNode(entries.length, asking),
    ],
  };
}

/// Se il cestino del finto sta chiedendo «Svuoto davvero?». Come nel provider
/// vive in memoria, non nello stato di vista: ricaricare la pagina la chiude.
let trashAsking = false;

/// I comandi che possono cambiare il cestino del finto.
const TRASH_COMMANDS: ReadonlySet<string> = new Set(["note.trash", "trash.os", "folder.trash", "trash.restore", "trash.empty"]);

/// Il cestino del finto in una riga confrontabile: cambia solo se è cambiato
/// il cestino.
function trashFingerprint(): string {
  return JSON.stringify(host.trash());
}

/// Un'azione sul cestino vero del finto: «Ripristina» passa dal comando
/// `trash.restore` e porta alla nota dove il comando dice di averla rimessa,
/// come il provider; «Svuota» dal comando `trash.empty`. `undefined` se il
/// cestino è quello della scenografia.
///
/// Il kernel non rimette una nota sopra un file che occupa il suo nome
/// (`already_exists`, e il provider chiede un nome libero); il finto invece
/// scriverebbe sopra. Il banco non rischia la copia: col nome occupato
/// l'azione fallisce come il comando vero, e niente si sovrascrive.
async function liveTrashAction(action: string, payload: unknown): Promise<ViewUpdate | undefined> {
  if (TRASH_FULL || host.trash().length === 0) return undefined;
  if (action === "restore") {
    const { entry, original } = payload as { entry: string; original: string };
    if (host.files()[original] !== undefined) {
      throw { kind: "already_exists", message: `«${pageName(original)}» c'è già: il cestino non la rimette sopra un'altra nota.` } satisfies PluginError;
    }
    const outcome = await api.invokeCommand("trash.restore", { entry });
    const back = outcome.effect.kind === "navigate" ? outcome.effect.doc : original;
    return { kind: "navigate", doc_id: back };
  }
  // Svuotare chiede prima, come il provider: «Svuota il cestino» apre la
  // domanda, il sì passa dal comando `trash.empty`, il no (o Esc) la chiude.
  if (action === "empty" || action === "cancel") {
    trashAsking = action === "empty";
    return { kind: "replace", root: liveTrash() ?? TREES.trash! };
  }
  if (action === "empty_confirm") {
    if (!trashAsking) return { kind: "replace", root: liveTrash() ?? TREES.trash! };
    trashAsking = false;
    await api.invokeCommand("trash.empty");
    return { kind: "replace", root: liveTrash() ?? TREES.trash! };
  }
  return undefined;
}

/// Le specie di query che rispondono testo dell'host: le altre portano il
/// vault, che non si traduce.
const HOST_TEXT: ReadonlySet<IndexQuery["kind"]> = new Set(["settings", "jobs"]);

/// L'albero di una view della scenografia, nella lingua della shell. Della
/// struttura soltanto gli stati vuoti e «In entrata»: le voci dell'albero sono
/// i titoli della nota.
function treeOf(view: string): UiNode | undefined {
  if (view === "outline") {
    const tree = outlineTree();
    if (tree.node !== "stack") return inShellLanguage(tree);
    return { ...tree, children: tree.children.map((child) => (child.node === "tree" ? child : inShellLanguage(child))) };
  }
  const tree = TREES[view];
  return tree && inShellLanguage(tree);
}

/// L'albero con scelta la voce il cui salto porta `payload`, e nessun'altra.
function choose(node: UiNode, payload: unknown): UiNode {
  if (node.node === "stack") return { ...node, children: node.children.map((item) => choose(item, payload)) };
  if (node.node === "tree") return { ...node, roots: node.roots.map((item) => choose(item, payload) as typeof item) };
  if (node.node !== "tree_item") return node;
  return {
    ...node,
    selected: node.action?.payload === payload,
    children: node.children.map((item) => choose(item, payload) as typeof item),
  };
}

/// Il testo cercato da una query di documenti, se ne cerca uno.
function searchedText(expr: QueryExpr): string | null {
  for (const clause of expr.any) {
    for (const literal of clause.all) {
      if (!literal.negated && literal.predicate.kind === "text") return literal.predicate.text;
    }
  }
  return null;
}

const utf8 = new TextEncoder();
/// Quanto testo sta attorno all'occorrenza in un estratto (caratteri).
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/// L'estratto che darebbe l'indice: la riga del corpo in cui il primo termine
/// compare, tagliata attorno all'occorrenza, con gli intervalli in byte di ogni
/// termine. Il finto host risponde i documenti senza estratto, e la foto della
/// ricerca mostrerebbe un elenco di nomi che il prodotto non mostra.
function snippetOf(doc: string, text: string): Pick<DocumentMatch, "snippet" | "highlights"> {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  const body = (CORPUS[doc] ?? "").replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n").map((line) => line.replace(/^[#>\-*\s]+/, "").trim());
  const line = lines.find((each) => terms.some((term) => each.toLowerCase().includes(term)));
  if (!line || terms.length === 0) return {};
  const at = line.toLowerCase().indexOf(terms.find((term) => line.toLowerCase().includes(term))!);
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(line.length, at + SNIPPET_AFTER);
  const snippet = `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
  const lower = snippet.toLowerCase();
  const highlights: Span[] = [];
  for (const term of terms) {
    for (let index = lower.indexOf(term); index !== -1; index = lower.indexOf(term, index + term.length)) {
      const before = utf8.encode(snippet.slice(0, index)).length;
      highlights.push({ start: before, end: before + utf8.encode(snippet.slice(index, index + term.length)).length });
    }
  }
  highlights.sort((a, b) => a.start - b.start);
  return { snippet, highlights };
}

/// Ogni risposta dell'indice, per `tree.mjs`: la domanda e la risposta, con
/// l'ora di ciascuna. Senza il banco dell'albero la risposta passa com'è, e non
/// si registra niente.
async function timedQuery(q: IndexQuery, answer: () => Promise<IndexResult>): Promise<IndexResult> {
  if (TREE === null) return answer();
  const requestedAt = performance.now();
  const result = await answer();
  const scope = q.kind === "folders" ? q.under : q.kind === "entries" ? q.within : null;
  TREE_ARRIVALS.push({
    kind: q.kind,
    scope: scope?.path ?? null,
    descendants: scope?.descendants ?? null,
    requestedAt,
    answeredAt: performance.now(),
  });
  return result;
}

/// Il grafico della cartella del banco nelle scene dei grafici (T54,
/// `live=grafici`): la cartella generata non ne ha, e il finto lo aggiunge
/// alle finestre che toccano le sue celle. Il disegno è quello che
/// `fub-format-xlsx` dà per l'istogramma «Vendite» di
/// `tests/objects.rs` (GridCraft, `chart_svg`), copiato com'è.
const CHART_ID = 1;
const CHART_RANGE = "A1:E14";
const CHART_SCENE = params.get("live") === "grafici";
const CHART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="280" viewBox="0 0 320 280" font-family="Helvetica,Arial,sans-serif" style=""><rect x="0" y="0" width="320" height="280" fill="#ffffff" stroke="#d9d9d9" stroke-width="1"/><text x="160" y="20.92" font-size="14" text-anchor="middle" fill="#595959">Vendite</text><text x="17" y="256.55" font-size="9" text-anchor="end" fill="#595959">0</text><text x="17" y="220.73" font-size="9" text-anchor="end" fill="#595959">1</text><text x="17" y="184.92" font-size="9" text-anchor="end" fill="#595959">2</text><text x="17" y="149.1" font-size="9" text-anchor="end" fill="#595959">3</text><text x="17" y="113.28" font-size="9" text-anchor="end" fill="#595959">4</text><text x="17" y="77.47" font-size="9" text-anchor="end" fill="#595959">5</text><text x="17" y="41.65" font-size="9" text-anchor="end" fill="#595959">6</text><polyline points="21,253.4 306,253.4" fill="none" stroke="#bfbfbf" stroke-width="0.75"/><text x="68.5" y="263.42" font-size="9" text-anchor="middle" fill="#595959">1</text><text x="163.5" y="263.42" font-size="9" text-anchor="middle" fill="#595959">2</text><text x="258.5" y="263.42" font-size="9" text-anchor="middle" fill="#595959">3</text><rect x="49.5" y="145.95" width="38" height="107.45" fill="#156082"/><rect x="144.5" y="74.32" width="38" height="179.08" fill="#156082"/><rect x="239.5" y="181.77" width="38" height="71.63" fill="#156082"/></svg>';
/// La finestra col grafico, se tocca le sue celle (A1:E14: il finto dà solo
/// le finestre che partono da A1, e il grafico sta lì).
function withChart<W extends { sheet: string; row_start: number; column_start: number; rows: unknown[]; columns: unknown[]; objects: unknown[] }>(window: W): W {
  if (!CHART_SCENE || window.sheet !== "s1") return window;
  const touches = window.row_start <= 13 && window.rows.length > 0
    && window.column_start <= 4 && window.columns.length > 0;
  if (!touches) return window;
  const chart = {
    kind: "chart", id: CHART_ID, row: 0, column: 0, dx: 0, dy: 0, width: 320, height: 280,
    alt: "Vendite", svg: CHART_SVG, media: null, shape: null, missing: null,
  };
  return { ...window, objects: [...window.objects, chart] };
}

/// Le parti che le schede di foglio della nota chiedono (`fub.part`, T43),
/// solo nella Live delle schede vive (`live=schede-vive`) e nella battuta con
/// le schede (`live=battuta-schede-<n>`), e le celle dei valori nel testo (T53,
/// `live=valori-cella` e `live=battuta-valori-100`) e negli estratti (T49,
/// `live=estratti`): la risposta che
/// `fub-format-xlsx/src/parts.rs` darebbe per la cartella del banco, che non
/// ricalcola e non scrive. Una parte sconosciuta è persa, con le parti che la
/// cartella ha.
const SHEET_PARTS_CASES = new Set(["schede-vive", "valori-cella", "battuta-valori-100", "grafici", "estratti"]);
const SHEET_PARTS_LIVE = params.get("live") ?? "";
const SHEET_PARTS: Readonly<Record<string, unknown>> | null = SHEET_PARTS_CASES.has(SHEET_PARTS_LIVE) || SHEET_PARTS_LIVE.startsWith("battuta-schede-")
  ? {
      "": { found: true, kind: "active", sheet: "s1", range: "A1:F6" },
      "Conti!A1:C4": { found: true, kind: "range", sheet: "s1", range: "A1:C4" },
      // L'estratto che «Estrai» scrive dalle celle scelte (T49, `live=estratti`).
      // (Il finto dà solo le finestre che partono da A1: l'estratto ci parte.)
      "Conti!A1:B2": { found: true, kind: "range", sheet: "s1", range: "A1:B2" },
      // Le celle dei valori nel testo: 800, -120, 680, 50.00%, la cella
      // vuota D2 e l'errore #DIV/0! di C4.
      ...Object.fromEntries(["B2", "B3", "B4", "C2", "D2", "C4"]
        .map((cell) => [`Conti!${cell}`, { found: true, kind: "range", sheet: "s1", range: cell }])),
      // Il grafico «Vendite» (T54, `live=grafici`): le celle che copre e il
      // suo id nel file.
      Vendite: { found: true, kind: "chart", sheet: "s1", range: CHART_RANGE, chart: CHART_ID },
    }
  : null;
const SHEET_PARTS_LOST = {
  found: false,
  parts: XLSX_GRID.session.sheets.map((sheet) => ({ kind: "sheet", name: sheet.name })),
};
/// `selection.set` della griglia che si apre scrivendo (la scheda porta la
/// selezione alla prima cella della parte): il provider la sposta e basta.
function sheetSelection(params: string): { sheet: string; selection: string; active: string } {
  const { range = "A1" } = JSON.parse(params || "{}") as { range?: string };
  const bang = range.lastIndexOf("!");
  const name = bang < 0 ? null : range.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'");
  const sheet = BENCH_SESSION.sheets.find((each) => each.name === name)?.id ?? BENCH_SESSION.active;
  const at = range.slice(bang + 1);
  return { sheet, selection: at, active: at.split(":")[0]! };
}
/// Il finto dà a ogni apertura la stessa sessione (`i1`): con più schede
/// della stessa cartella, quella che chiude (la parte persa) chiuderebbe
/// anche le altre. Come l'host, qui ogni apertura ha la sua istanza; sotto,
/// la sessione del finto si chiude quando se ne va l'ultima.
const sheetInstances = new Map<string, string>();
const sheetOpenCount = new Map<string, number>();
let sheetOpens = 0;
function sheetInstance(instance: string): string {
  return sheetInstances.get(instance) ?? instance;
}
function sheetPartOutcome(text: string | null, selection = { sheet: BENCH_SESSION.active, selection: "A1", active: "A1" }) {
  return {
    commit: {
      revision: BENCH_SESSION.revision,
      edit: { from: 0, to: 0, deleted: "", inserted: "" },
      invalidation: { kind: "cells", cells: [] },
    },
    sheets: BENCH_SESSION.sheets,
    hidden: BENCH_SESSION.hidden,
    selection,
    result: text === null ? null : JSON.stringify(SHEET_PARTS?.[text] ?? SHEET_PARTS_LOST),
    dialog: null,
    commands: BENCH_SESSION.commands,
    book: BENCH_SESSION.book,
  };
}

export const api: typeof host.module.api = {
  ...behind,
  // Il documento davanti è quello che la Struttura legge: quando cambia, la
  // Struttura è vecchia, come la dichiara il kernel (`follows` del provider).
  setActiveContext: async (context) => {
    const stale = await behind.setActiveContext(context);
    const doc = context?.doc ?? null;
    if (doc === frontDoc) return stale;
    frontDoc = doc;
    return stale.includes("outline") ? stale : [...stale, "outline"];
  },
  ...(SHEET_PARTS === null ? {} : {
    openGridBytes: async (...args: Parameters<typeof behind.openGridBytes>) => {
      const session = await behind.openGridBytes(...args);
      const instance = `${session.instance}.${++sheetOpens}`;
      sheetInstances.set(instance, session.instance);
      sheetOpenCount.set(session.instance, (sheetOpenCount.get(session.instance) ?? 0) + 1);
      return { ...session, instance };
    },
    gridBytesWindow: async (surface: string, instance: string, request: Parameters<typeof behind.gridBytesWindow>[2]) =>
      withChart(await behind.gridBytesWindow(surface, sheetInstance(instance), request)),
    applyGridBytes: (surface: string, instance: string, request: Parameters<typeof behind.applyGridBytes>[2]) =>
      behind.applyGridBytes(surface, sheetInstance(instance), request),
    gridBytesCommands: (surface: string, instance: string, selection: Parameters<typeof behind.gridBytesCommands>[2]) =>
      behind.gridBytesCommands(surface, sheetInstance(instance), selection),
    closeGridBytes: async (surface: string, instance: string) => {
      const real = sheetInstances.get(instance);
      if (real === undefined) return behind.closeGridBytes(surface, instance);
      sheetInstances.delete(instance);
      const left = (sheetOpenCount.get(real) ?? 1) - 1;
      if (left > 0) {
        sheetOpenCount.set(real, left);
        return;
      }
      sheetOpenCount.delete(real);
      return behind.closeGridBytes(surface, real);
    },
    gridBytesCommand: (...args: Parameters<typeof behind.gridBytesCommand>) => {
      args[1] = sheetInstance(args[1]);
      const [, , request] = args;
      if (request.command.id === "selection.set") {
        return Promise.resolve(sheetPartOutcome(null, sheetSelection(request.command.params)) as Awaited<ReturnType<typeof behind.gridBytesCommand>>);
      }
      if (request.command.id !== "fub.part") return behind.gridBytesCommand(...args);
      const asked = (JSON.parse(request.command.params || "{}") as { part?: string }).part ?? "";
      return Promise.resolve(sheetPartOutcome(asked) as Awaited<ReturnType<typeof behind.gridBytesCommand>>);
    },
  }),
  ...(SIZES_ANSWER || CELLS_ANSWER ? {
    gridBytesCommand: async (surface, instance, request) => {
      // Le misure (e i riempimenti e gli incolla, con `?risposte=si`) le
      // serve il banco; il resto, e una porta resa guasta, il finto. La
      // chiamata si registra come la registra il finto, e una porta frenata
      // tiene in volo anche la risposta del banco.
      const answered = (SIZES_ANSWER && SIZE_COMMANDS.has(request.command.id)) || (CELLS_ANSWER && CELL_COMMANDS.has(request.command.id));
      if (!answered || sizeGates.fault) return behind.gridBytesCommand(surface, instance, request);
      host.calls.push({ gate: "gridBytesCommand", args: [instance, request] });
      if (sizeGates.held) await sizeGates.held;
      return sizedOutcome(request.revision, request);
    },
    gridBytesWindow: async (surface, instance, request) =>
      sizedWindow(await behind.gridBytesWindow(surface, instance, request), request.revision),
    // Il salvataggio scrive le misure nel file e riapre la cartella senza
    // giornale: come l'host vero, il finto la riapre con le misure salvate.
    writeDocument: async (id, source, base, ...rest) => {
      const written = await behind.writeDocument(id, source, base, ...rest);
      if (id === WORKBOOK_DOC && lastSized !== null) rememberSavedSized();
      return written;
    },
    openGridBytes: async (surface, doc, journal, base) => {
      const session = await behind.openGridBytes(surface, doc, journal, base);
      if (journal !== "" || savedSized === null) return session;
      reopenSized();
      return { ...session, revision: savedSized };
    },
  } satisfies Partial<typeof host.module.api> : {}),
  invokeCommand: async (id, args, ...rest) => {
    // L'anteprima del RAW della scena: il finto non sa leggere un RAW.
    const doc = (args as { doc?: unknown } | null)?.doc;
    if (RAW_SCENE !== null && id === CRAFT_PREVIEW_COMMAND && typeof doc === "string") {
      const size = (args as { size?: unknown }).size === "large" ? "large" : "small";
      const payload = rawScenePreview(RAW_SCENE, doc, size);
      if (payload !== null) return { notify: null, effect: { kind: "custom", ns: CRAFT_BUNDLE_NS, payload }, undo: null, partial: null };
    }
    // L'anteprima del PDF o del Word delle scene T31: il finto non li sa leggere.
    if (PDF_SCENE !== null && id === CRAFT_PREVIEW_COMMAND && typeof doc === "string") {
      const size = (args as { size?: unknown }).size === "large" ? "large" : "small";
      const payload = pdfScenePreview(PDF_SCENE, doc, size);
      if (payload !== null) return { notify: null, effect: { kind: "custom", ns: CRAFT_BUNDLE_NS, payload }, undo: null, partial: null };
    }
    // Le miniature dell'albero delle scene T26: il finto non sa leggere i file.
    if (TREE_SCENE !== null && id === CRAFT_PREVIEW_COMMAND && typeof doc === "string") {
      const payload = treeScenePreview(doc, (args as { size?: unknown }).size === "large" ? "large" : "small");
      if (payload !== null) return { notify: null, effect: { kind: "custom", ns: CRAFT_BUNDLE_NS, payload }, undo: null, partial: null };
    }
    if (PDF_PROFILES !== null && id === "pdf.profiles") {
      return { notify: null, effect: { kind: "custom", ns: "fub.pdf.profiles", payload: PDF_PROFILES }, undo: null, partial: null };
    }
    // I caratteri del vault per la stampa: il finto non sa leggerli.
    if (id === VAULT_FONTS_COMMAND) {
      if (!EXPORT_FONTS_SCENE) return { ...exportFontsOutcome(), effect: { ...exportFontsOutcome().effect, payload: { ...EXPORT_FONTS, caratteri: [] } } };
      await writeExportFonts();
      return exportFontsOutcome();
    }
    // Il gesto della barra della Base delle scene `base-*`.
    const based = BASE?.invoke(id, args);
    if (based) return based as ReturnType<typeof behind.invokeCommand>;
    const trashBefore = TRASH_COMMANDS.has(id) ? trashFingerprint() : null;
    const outcome = await behind.invokeCommand(id, args, ...rest);
    // Dopo un comando che cambia il cestino il kernel vero rifà l'indice, e il
    // provider `trash` si fa ridisegnare a ogni giro dell'indice (`refresh`
    // di `trash.rs`). Il finto l'indice non l'ha: i due eventi partono qui,
    // perché l'albero ritrovi la nota rimessa e il pannello si aggiorni. Solo
    // se il cestino è cambiato davvero: le altre scene non si ridisegnano.
    if (trashBefore !== null && trashFingerprint() !== trashBefore) {
      host.emit({ type: "index_updated" });
      host.emit({ type: "view_invalidated", view: "trash", instance: null });
    }
    return outcome;
  },
  queryIndex: (q) => timedQuery(q, async () => {
    // Le note con un'icona (`icon:` nel frontmatter), come le legge l'indice:
    // il finto non sa leggere le proprietà, e del banco ce l'ha solo la nota
    // della Live delle scene della pagina.
    const asked = q.kind === "documents" ? q.matching.any[0]?.all[0]?.predicate : undefined;
    if (q.kind === "documents" && asked?.kind === "property" && asked.filter.key === "icon") {
      const icon = LIVE === null ? undefined : /^---\n(?:.*\n)*?icon: (.+)\n/.exec(LIVE.text)?.[1];
      const items = icon === undefined ? [] : [{ doc: LIVE_DOC, properties: [{ key: "icon", value: icon }] }];
      return { kind: "documents", value: { items, offset: 0, total: items.length } };
    }
    const response = RESPONSES[q.kind];
    const result = response ? response(q) : await behind.queryIndex(q);
    if (BASE !== null && q.kind === "documents" && result.kind === "documents") {
      // Le proprietà delle note della Base, come le leggerebbe l'indice dal
      // frontmatter: il finto non le legge.
      return {
        ...result,
        value: { ...result.value, items: result.value.items.map((hit) => {
          const properties = BASE.properties(hit.doc);
          return properties === null ? hit : { ...hit, properties };
        }) },
      };
    }
    if (q.kind === "documents" && result.kind === "documents" && LIVE !== null && q.select?.kind === "keys") {
      // Le classi della nota della Live (`cssclasses: [wide]`), come le
      // leggerebbe l'indice dal frontmatter: le scene della pagina larga.
      const classes = /^---\n(?:.*\n)*?cssclasses: \[([^\]]*)\]\n/.exec(LIVE.text)?.[1];
      if (classes !== undefined && result.value.items.some((hit) => hit.doc === LIVE_DOC)) {
        const value = classes.split(",").map((name) => name.trim()).filter(Boolean);
        return {
          ...result,
          value: { ...result.value, items: result.value.items.map((hit) => hit.doc === LIVE_DOC ? { ...hit, properties: [{ key: "cssclasses", value }] } : hit) },
        };
      }
    }
    if (q.kind === "entries" && result.kind === "entries") {
      // L'ultima modifica delle note della riga dei dati: il finto le dà
      // tutte a zero.
      return {
        ...result,
        value: { ...result.value, items: result.value.items.map((entry) => NOTE_FACTS[entry.id] ? { ...entry, mtime: NOTE_FACTS[entry.id]!.mtime } : entry) },
      };
    }
    if (q.kind === "documents" && result.kind === "documents") {
      const text = searchedText(q.matching);
      if (text) {
        return {
          ...result,
          value: { ...result.value, items: result.value.items.map((hit) => ({ ...hit, ...snippetOf(hit.doc, text) })) },
        };
      }
    }
    return HOST_TEXT.has(q.kind) ? inShellLanguage(result) : result;
  }),
  listViews: async (vault) => inShellLanguage(await behind.listViews(vault)),
  listCommands: async (vault) => inShellLanguage(await behind.listCommands(vault)),
  renderView: (view, instance, params) => {
    if (view === "desk" && DESK) return Promise.resolve(DESK.tree(instance ?? "main"));
    const tree = (view === "trash" ? liveTrash() : undefined) ?? treeOf(view);
    return tree ? Promise.resolve(tree) : behind.renderView(view, instance, params);
  },
  // Un'azione di una view della scenografia non fa niente e **lo dice
  // ridisegnando l'albero di prima**: è la risposta minima che il protocollo
  // accetta, e non un `throw` — un click di troppo durante una scena non deve
  // far morire una foto. Tranne il salto dell'indice: come il provider vero,
  // segna scelto il titolo a cui si è andati, e il banco del moto vede la
  // sagoma della voce scelta scorrere.
  viewAction: async (view, instance, params, action, payload, fields) => {
    if (view === "desk" && DESK) return { kind: "replace" as const, root: DESK.act(instance ?? "main", action, payload) };
    const live = view === "trash" ? await liveTrashAction(action, payload) : undefined;
    if (live) return live;
    // Il cestino della scenografia sa chiedere, e solo chiedere: il sì non
    // distrugge le sue tre voci, che le foto conoscono.
    if (view === "trash" && TRASH_FULL && (action === "empty" || action === "cancel" || action === "empty_confirm")) {
      return { kind: "replace" as const, root: trashWithThree(action === "empty") };
    }
    const tree = treeOf(view);
    if (!tree) return behind.viewAction(view, instance, params, action, payload, fields);
    const root = view === "outline" && action === "goto" ? choose(tree, payload) : tree;
    return { kind: "replace" as const, root };
  },
  // Il profilo di serie di un vault appena aperto, come lo dà l'host («Default»,
  // `default_profile_name` del kernel): il pannello Profili si fotografa col suo
  // stato vero, non con l'errore del finto che non ha un servizio di profili.
  settingsProfiles: async () => ({ active: "Default", names: ["Default"] }),
  listBundles: () => Promise.resolve(inShellLanguage(BUNDLE)),
  knownVaults: () => Promise.resolve(KNOWN_VAULTS),
  // La cartella del gruppo «editor» del giro (`giro-fixture.ts`): risponde
  // lei alla formula e all'ordine, e sa che cosa il salvataggio ha innestato.
  ...(GIRO_WORKBOOK === null ? {} : {
    openGridBytes: (...args: Parameters<typeof behind.openGridBytes>) => GIRO_WORKBOOK.openGridBytes(...args),
    applyGridBytes: (...args: Parameters<typeof behind.applyGridBytes>) => GIRO_WORKBOOK.applyGridBytes(...args),
    gridBytesCommand: (...args: Parameters<typeof behind.gridBytesCommand>) => GIRO_WORKBOOK.gridBytesCommand(...args),
    writeDocument: async (...args: Parameters<typeof behind.writeDocument>) => {
      const revision = await behind.writeDocument(...args);
      GIRO_WORKBOOK.saved(args[0], args[1]);
      return revision;
    },
  }),
};

export const onKernelEvent = host.module.onKernelEvent;
export const onClose = host.module.onClose;
export const window = host.module.window;
// Il ponte mobile: lo chiede solo l'ingresso mobile (`mobile.html`).
export { nativeMobileBridge } from "./fake-mobile-bridge";
