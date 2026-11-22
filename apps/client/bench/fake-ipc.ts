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
import { COMPONENT_SCENARIO, createFakeHost, type DrawingFake, type GridBytesFake, type Options } from "../src/host/fake";
import { MARKDOWN_SYNTAX } from "../src/rules/syntax.generated";
import { pageName } from "../src/rules/mirrored";
import XLSX_GRID from "../src/__fixtures__/xlsx-grid.json";
import RICH_PROJECTION from "../src/__fixtures__/rich-projection.json";
import RICH_BENCH from "../src/__fixtures__/rich-bench.json";
import RICH_CLOSED from "../src/__fixtures__/rich-closed.json";
import type {
  BundleInfo,
  CommandSpec,
  DocumentMatch,
  DrawingCommandInfo,
  DrawingCommandRequest,
  DrawingGesture,
  DrawingLoss,
  DrawingOutcome,
  GridBytesSession,
  GridBytesWindow,
  GridCommand,
  GridCommandOutcome,
  GridCommandRequest,
  Heading,
  IndexQuery,
  IndexResult,
  JobStatus,
  KnownVault,
  Organization,
  PluginError,
  QueryExpr,
  SettingEntry,
  Span,
  UiNode,
  ViewSpec,
  ViewUpdate,
} from "../src/host/contract";
import { inShellLanguage } from "./fake-english";
import { gridJournalText } from "../src/state/grid-journal";
import { SPECS as SLASH_SPECS } from "../src/panels/slash/fixture.test-data";
import { CONNECTORS_DOC, connectorsFixture, type ConnectorsFixture } from "./connectors-fixture";
import { DEFS_ID } from "../src/editors/spatial/scene/ids";
import { RISPOSTE, rispostaDiFamiglia } from "./disegno-famiglie/risposte";
import { comandiProva, comandiSelezione, comandiTrasformazioni, INDICE_PROVA } from "./disegno-indice-prova";
import { selezioneDelClic } from "./disegno-clic";
import { LARGE_DOC, largeFixture, type LargeFixture } from "./large-fixture";
import { documentEmbedHtml, LIVE_DOC, liveCase } from "./live-fixture";
import { treeFixture, type TreeFixture } from "./vault-fixture";
import { PHOTO_CRAFT, photoCase, photoResources } from "./photo-fixture";
import {
  craftSceneCase,
  craftSceneCraft,
  craftSceneRender,
  craftSceneResources,
  pdfSceneCase,
  pdfSceneFiles,
  pdfScenePreview,
  pdfSceneResources,
  PDF_SCENE_WORDCRAFT,
  treeSceneCase,
  treeSceneFiles,
  treeScenePreview,
  treeSceneResources,
  treeSceneSetting,
} from "./craft-fixture";
import { rawSceneCase, rawSceneCraft, rawScenePreview, rawSceneResources } from "./raw-fixture";
import { BASE_DOC, baseFixture, MAP_TILE_SITE } from "./base-fixture";
import { CRAFT_BUNDLE_NS, CRAFT_PREVIEW_COMMAND, type CraftPreview } from "../src/host/craft";
import { CORPUS, OUTPUT, RESOURCES } from "./corpus";
import { deskCase, deskScene } from "./desk-scene";
import { EXPORT_FONTS, exportFontsOutcome, exportFontsWriter, VAULT_FONTS_COMMAND } from "./export-fonts-fixture";
import { GiroWorkbook, giroResources } from "./giro-fixture";
import {
  generateGraphFixture as graphFixture,
  type GraphFixture,
} from "./graph-fixture";

type GraphBenchMetadata = Readonly<{
  fixture: Readonly<{
    nodes: readonly string[];
    edges: readonly { readonly from: string; readonly to: string }[];
    seed: number;
    digest: string;
  }> | null;
}>;

/// Ciò che le scene del disegno (`scene.mjs`) leggono del disegno dei
/// connettori: dove sta, le forme e i connettori con ciò che li unisce, i nodi.
type ConnectorsBenchMetadata = Readonly<{
  fixture: Readonly<{
    doc: string;
    shapes: ConnectorsFixture["shapes"];
    connectors: ConnectorsFixture["connectors"];
    hubs: ConnectorsFixture["hubs"];
    labels: ConnectorsFixture["labels"];
    elements: number;
    bytes: number;
    digest: string;
  }> | null;
}>;

/// Ciò che il banco dell'albero (`tree.mjs`) legge del vault che apre: le
/// cartelle, la catena, il nome lungo e la nota da cercare, e quando ogni
/// risposta dell'indice è arrivata al client.
type TreeBenchMetadata = Readonly<{
  fixture: Readonly<{
    total: number;
    folders: TreeFixture["folders"];
    big: string;
    chain: TreeFixture["chain"];
    deepest: string;
    longName: string;
    target: string;
    digest: string;
  }> | null;
  arrivals: TreeArrival[];
}>;

/// Una risposta dell'indice durante il banco dell'albero: di che specie è la
/// domanda, di quale cartella (`scope`, `null` se non ne ha una), e l'ora della
/// domanda e quella della risposta, in millisecondi dall'avvio della pagina. Il
/// finto risponde sul thread della pagina, quindi il suo tempo sta dentro i
/// fotogrammi: il banco lo conta a parte.
type TreeArrival = {
  kind: IndexQuery["kind"];
  scope: string | null;
  descendants: boolean | null;
  requestedAt: number;
  answeredAt: number;
};

/// Ciò che il banco delle scene grandi (`large.mjs`) legge del disegno che
/// apre: dove sta, quanto è grande, il rettangolo da scegliere.
type LargeBenchMetadata = Readonly<{
  fixture: Readonly<{
    doc: string;
    elements: number;
    objects: number;
    strokes: number;
    size: LargeFixture["size"];
    cells: number;
    columns: number;
    target: LargeFixture["target"];
    bytes: number;
    digest: string;
  }> | null;
}>;

// ---------------------------------------------------------------------------
// Ciò che il banco decide dalla query string.
// ---------------------------------------------------------------------------

const params = new URLSearchParams(globalThis.window.location.search);

const graphNodesParam = params.get("graphNodes");
const graphSeedParam = params.get("graphSeed");
let GRAPH_PAYLOAD: { nodes: string[]; edges: { from: string; to: string }[] } | null = null;
let GRAPH_FIXTURE: GraphFixture | null = null;

if (graphNodesParam === null) {
  if (graphSeedParam !== null) {
    throw new RangeError("graphSeed requires graphNodes");
  }
} else {
  const nodeCount =
    graphNodesParam === "2000" ? 2_000 : graphNodesParam === "10000" ? 10_000 : null;
  if (nodeCount === null) {
    throw new RangeError("graphNodes must be 2000 or 10000");
  }

  let seed = 6;
  if (graphSeedParam !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(graphSeedParam)) {
      throw new RangeError("graphSeed must be a canonical decimal uint32");
    }
    seed = Number(graphSeedParam);
    if (seed > 0xffff_ffff) {
      throw new RangeError("graphSeed must be a canonical decimal uint32");
    }
  }

  GRAPH_FIXTURE = graphFixture(nodeCount, seed);
  Object.freeze(GRAPH_FIXTURE.nodes);
  for (const edge of GRAPH_FIXTURE.edges) Object.freeze(edge);
  Object.freeze(GRAPH_FIXTURE.edges);
  Object.freeze(GRAPH_FIXTURE);
  GRAPH_PAYLOAD = { nodes: GRAPH_FIXTURE.nodes, edges: GRAPH_FIXTURE.edges };
}

globalThis.__fubGraphBench = Object.freeze({
  fixture: GRAPH_FIXTURE
    ? Object.freeze({
        nodes: GRAPH_FIXTURE.nodes,
        edges: GRAPH_FIXTURE.edges,
        seed: graphSeedParam === null ? 6 : Number(graphSeedParam),
        digest: GRAPH_FIXTURE.digest,
      })
    : null,
});

// `?connectors=N` mette nel vault il disegno di N connettori
// (`connectors-fixture.ts`), con due forme ogni tre connettori, accende la
// feature `draw`, che apre un `.svg` come disegno, e mette l'editor al livello
// Standard. Senza, il vault e le impostazioni restano quelli che le foto
// conoscono.
//
// Questo modulo sta nel giro fra le stringhe della shell e l'host
// (`i18n/strings.ts` legge le impostazioni dall'host, che qui è lui): ciò che
// importa si valuta mentre le stringhe sono a metà. Perciò i due disegni si
// fanno coi moduli dell'editor che non leggono le stringhe: un catalogo
// valutato qui troverebbe quello della shell non ancora pronto, e la pagina
// del catalogo del banco non partirebbe.
const connectorsParam = params.get("connectors");
let CONNECTORS: ConnectorsFixture | null = null;
if (connectorsParam !== null) {
  if (!/^[1-9]\d*$/.test(connectorsParam)) throw new RangeError("connectors must be a positive decimal integer");
  CONNECTORS = connectorsFixture(Number(connectorsParam));
}

globalThis.__fubConnectorsBench = Object.freeze({
  fixture: CONNECTORS
    ? Object.freeze({
        doc: CONNECTORS_DOC,
        shapes: CONNECTORS.shapes,
        connectors: CONNECTORS.connectors,
        hubs: CONNECTORS.hubs,
        labels: CONNECTORS.labels,
        elements: CONNECTORS.elements,
        bytes: new TextEncoder().encode(CONNECTORS.text).length,
        digest: CONNECTORS.digest,
      })
    : null,
});

// `?large=N` mette nel vault la lavagna di N elementi del banco delle scene
// grandi (`large-fixture.ts`), e accende l'editor come `?connectors=N`. Non
// sta insieme all'altro disegno.
const largeParam = params.get("large");
let LARGE: LargeFixture | null = null;
if (largeParam !== null) {
  if (CONNECTORS !== null) throw new RangeError("large is a drawing of its own");
  if (!/^[1-9]\d*$/.test(largeParam)) throw new RangeError("large must be a positive decimal integer");
  LARGE = largeFixture(Number(largeParam));
}

globalThis.__fubLargeBench = Object.freeze({
  fixture: LARGE
    ? Object.freeze({
        doc: LARGE_DOC,
        elements: LARGE.elements,
        objects: LARGE.objects,
        strokes: LARGE.strokes,
        size: LARGE.size,
        cells: LARGE.cells,
        columns: LARGE.columns,
        target: LARGE.target,
        bytes: new TextEncoder().encode(LARGE.text).length,
        digest: LARGE.digest,
      })
    : null,
});

// `?vault=5000` mette nel vault i cinquemila file del banco dell'albero
// (`vault-fixture.ts`), e basta: né il corpus né la scenografia, perché
// l'albero conta i file del vault e non deve contarne altri. `TREE_ARRIVALS`
// dice quando ogni risposta dell'indice arriva al client: il primo disegno si
// misura da lì.
const TREE: TreeFixture | null = params.get("vault") === "5000" ? treeFixture() : null;
const TREE_ARRIVALS: TreeArrival[] = [];

globalThis.__fubTreeBench = Object.freeze({
  fixture: TREE
    ? Object.freeze({
        total: TREE.total,
        folders: TREE.folders,
        big: TREE.big,
        chain: TREE.chain,
        deepest: TREE.deepest,
        longName: TREE.longName,
        target: TREE.target,
        digest: TREE.digest,
      })
    : null,
  arrivals: TREE_ARRIVALS,
});

// `?live=<caso>` mette nel vault la nota delle scene della Live
// (`live-fixture.ts`), con il punto del cursore che la scena legge da qui.
// Soltanto le scene che la chiedono la hanno.
const LIVE = liveCase(params.get("live"));

globalThis.__fubLiveBench = Object.freeze({
  doc: LIVE === null ? null : LIVE_DOC,
  cursor: LIVE?.cursor ?? null,
  head: LIVE?.head ?? null,
});

/// La cartella di Excel della scena `grid-workbook` (`?workbook=1`). È un
/// file che soltanto quella scena ha: l'albero e i conteggi delle altre
/// restano quelli delle loro baseline. Sessione e finestre sono quelle che
/// `fub-format-xlsx` produce davvero (`tests/ts_grid.rs`).
///
/// `?workbook=large` apre invece una cartella grande, fatta qui in codice
/// con la forma di `xlsx-grid.json`: la scena `grid-large` dei controlli G1.
const WORKBOOK = params.get("workbook");
const WORKBOOK_DOC = WORKBOOK === "1" ? "Dati/Conti.xlsx" : WORKBOOK === "large" ? "Dati/Grande.xlsx" : null;

/// Le lavagne delle scene `lavagna-*` del banco dell'accessibilità (T61,
/// `?lavagna=1`): una vuota e una con un gruppo, tre schede di testo, una nota
/// e i fili, etichettati e no. Solo quelle scene le hanno: l'albero e i
/// conteggi delle altre restano quelli delle loro baseline.
const BOARDS: Readonly<Record<string, string>> = params.get("lavagna") === "1"
  ? {
      "Lavagne/Vuota.canvas": JSON.stringify({ nodes: [], edges: [] }, null, "\t"),
      "Lavagne/Statistica.canvas": JSON.stringify({
        nodes: [
          { id: "gruppo", type: "group", x: 0, y: 0, width: 600, height: 320, label: "Media e varianza" },
          { id: "varianza", type: "text", x: 32, y: 48, width: 240, height: 120, text: "# Varianza\nQuanto i dati si allontanano dalla media." },
          { id: "media", type: "file", x: 320, y: 48, width: 240, height: 160, file: "Benvenuto.md" },
          { id: "istogramma", type: "text", x: 680, y: 48, width: 240, height: 120, text: "Istogramma", color: "4" },
          { id: "dubbio", type: "text", x: 680, y: 240, width: 240, height: 80, text: "Perché il quadrato?" },
        ],
        edges: [
          { id: "f1", fromNode: "varianza", toNode: "media", label: "vedi" },
          { id: "f2", fromNode: "istogramma", toNode: "varianza", label: "si vede qui" },
          { id: "f3", fromNode: "dubbio", toNode: "varianza" },
        ],
      }, null, "\t"),
    }
  : {};

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

/// Gli stati della barra dei fogli che la cartella generata non ha
/// (`?grid=table|readonly`, insieme a `?workbook=1`): una copia delle sue
/// finestre con una tabella dal nome lunghissimo sulla cella scelta, che
/// accende la sezione della tabella, oppure una copia della sessione coi
/// comandi che cambiano la cartella spenti, con il perché. Il JSON resta
/// quello che `fub-format-xlsx` produce.
const GRID_CASE = params.get("grid");
const BENCH_TABLE = {
  name: "Riepilogo_trimestrale_delle_spese_di_rappresentanza_2026",
  row: 0,
  column: 0,
  rows: 6,
  columns: 4,
  header_row: true,
  totals_row: false,
  banded_rows: true,
  banded_columns: false,
  first_column: false,
  last_column: false,
  filter_button: true,
  style: "TableStyleMedium2",
};
/// In sola lettura restano accesi soltanto i comandi che guardano.
const LOOKING = /^(file|selection|view)\.|^edit\.(selectAll|goTo|goToSpecial|find)$/;
function benchWindow<W extends { readonly sheet: string; readonly tables: readonly unknown[] }>(window: W): W {
  return GRID_CASE === "table" && window.sheet === XLSX_GRID.session.active
    ? { ...window, tables: [...window.tables, BENCH_TABLE] }
    : window;
}
const BENCH_SESSION = GRID_CASE === "readonly"
  ? {
    ...XLSX_GRID.session,
    commands: XLSX_GRID.session.commands.map((command) =>
      LOOKING.test(command.id) ? command : { ...command, enabled: false, reason: "La cartella è aperta in sola lettura." }),
  }
  : XLSX_GRID.session;

/// La cartella grande della scena `grid-large` (`?workbook=large`): 3000
/// righe per 20 colonne, la riga 1 e la colonna A bloccate, numeri, date e
/// testi lunghi che debordano nelle celle vuote dopo di loro. Le finestre
/// sono blocchi di 256 righe con tutte le colonne, come le chiede il motore.
const LARGE_ROWS = 3000;
const LARGE_COLUMNS = 20;
const LARGE_BLOCK = 256;
const LARGE_STYLE = { ...XLSX_GRID.windows[0]!.styles[0]!, bold: false, italic: false, text_color: null, horizontal: null };
const LARGE_SESSION = {
  ...XLSX_GRID.session,
  instance: "xlsx-large",
  revision: "sha256:grande",
  sheets: [{ id: "s1", name: "Grande", row_count: LARGE_ROWS, column_count: LARGE_COLUMNS }],
  active: "s1",
  hidden: [],
  notices: [],
  conflicts: [],
};
const LARGE_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
type LargeValue = { value: { kind: "text"; value: string } | { kind: "number"; value: number }; display: string };
/// Il valore della cella (riga, colonna) da zero, o `null` se è vuota. La
/// colonna D porta un testo lungo, e la E e la F restano vuote per lasciarlo
/// debordare.
function largeValue(row: number, column: number): LargeValue | null {
  const text = (value: string): LargeValue => ({ value: { kind: "text", value }, display: value });
  const number = (value: number, display = String(value)): LargeValue => ({ value: { kind: "number", value }, display });
  if (row === 0) {
    const heads = ["Voce", "Importo", "Data", "Descrizione", "", "", "Quantità"];
    if (column >= heads.length) return text(`Colonna ${column + 1}`);
    return heads[column] ? text(heads[column]!) : null;
  }
  switch (column) {
    case 0: return text(`Voce ${row}`);
    case 1: {
      const amount = Math.round(((row * 37) % 1000) * 150) / 100;
      return number(amount, amount.toFixed(2));
    }
    case 2: return number(45658 + row, `${1 + (row % 28)} ${LARGE_MONTHS[row % 12]} 2026`);
    case 3: return text(`Una descrizione lunga della voce ${row}, che deborda nelle celle vuote a destra`);
    case 4: case 5: return null;
    default: return number((row * (column + 3)) % 997);
  }
}
/// La cella della finestra in (riga, colonna) da zero con il valore `cell`.
function largeCell(row: number, column: number, cell: LargeValue) {
  return {
    key: { sheet: "s1", row: `r${row}`, column: `c${column}` },
    input: cell.display,
    style: 0,
    ...cell,
    lock: null,
    stale: false,
    conflict: false,
    data_bar: null,
    icon: null,
    comment: null,
    link: null,
  };
}
function largeWindow(start: number) {
  const count = Math.min(LARGE_BLOCK, LARGE_ROWS - start);
  const rows = Array.from({ length: count }, (_, at) => ({ id: `r${start + at}`, index: start + at, height: 20.0, hidden: false }));
  const columns = Array.from({ length: LARGE_COLUMNS }, (_, index) =>
    ({ id: `c${index}`, index, width: index === 0 ? 140.0 : index === 2 || index === 3 ? 96.0 : 64.0, hidden: false }));
  const cells = [];
  for (const row of rows) {
    for (const column of columns) {
      const cell = largeValue(row.index, column.index);
      if (cell) cells.push(largeCell(row.index, column.index, cell));
    }
  }
  return {
    revision: LARGE_SESSION.revision,
    sheet: "s1",
    row_start: start,
    column_start: 0,
    total_rows: LARGE_ROWS,
    total_columns: LARGE_COLUMNS,
    rows,
    columns,
    cells,
    styles: [LARGE_STYLE],
    merges: [],
    view: { ...XLSX_GRID.windows[0]!.view, frozen_rows: 1, frozen_columns: 1 },
    tables: [],
    objects: [],
  };
}
/// `?misure=si`, con `?workbook=large`: il finto dice sì alle misure tirate
/// (`home.columnWidth`, `home.rowHeight`) invece di rifiutarle perché non le
/// serve, come l'host vero: la revisione cambia, il giornale prende il
/// comando e le finestre rilette hanno la misura nuova. La scena
/// `grid-large-misure` dei controlli G5 (griglia T5). Il giornale qui è
/// soltanto quello delle misure: la scena non scrive celle. Una porta resa
/// guasta o frenata dal banco (`fault`, `throttle`) vale anche qui, perché la
/// risposta passa prima dal finto.
const SIZES_ANSWER = WORKBOOK === "large" && params.get("misure") === "si";
const SIZE_COMMANDS: ReadonlySet<string> = new Set(["home.columnWidth", "home.rowHeight"]);
/// `?risposte=si`, con `?workbook=large`: il finto dice sì anche ai
/// riempimenti e a `fub.pasteFrom`, e le finestre rilette hanno i valori
/// nuovi. Nella cartella di partenza C4 vale 10, C5 20 e sotto, fino a C16,
/// è vuota, come nel prototipo: tirato fino a C12, il riempimento dà 30…90.
/// La scena `grid-large-appunti` dei controlli G6 (griglia T6). Una porta
/// frenata o guasta dal banco vale anche qui.
const CELLS_ANSWER = WORKBOOK === "large" && params.get("risposte") === "si";
const CELL_COMMANDS: ReadonlySet<string> = new Set([
  "edit.autoFill",
  "edit.fillDown",
  "edit.fillRight",
  "edit.fillUp",
  "edit.fillLeft",
  "edit.fillSeries",
  "fub.pasteFrom",
]);
/// Una revisione data dal finto: le misure, colonna (o riga) → misura nei
/// pixel della cartella, e le celle cambiate, `riga:colonna` → valore (o
/// `null`, vuota).
interface Answered {
  readonly columns: ReadonlyMap<number, number>;
  readonly rows: ReadonlyMap<number, number>;
  readonly cells: ReadonlyMap<string, LargeValue | null>;
}
const sizedRevisions = new Map<string, Answered>();
/// Le celle della cartella di partenza, con `?risposte=si`.
const ANSWER_BASE: ReadonlyMap<string, LargeValue | null> = CELLS_ANSWER
  ? new Map(Array.from({ length: 13 }, (_, at): [string, LargeValue | null] => {
    const row = 3 + at;
    const value = row === 3 ? 10 : row === 4 ? 20 : null;
    return [`${row}:2`, value === null ? null : { value: { kind: "number", value }, display: String(value) }];
  }))
  : new Map();
/// I comandi del giornale che la shell tiene dall'ultima apertura: il diff
/// della risposta parte da quelli.
let sizedCommands: GridCommand[] = [];
/// L'ultima revisione data dal finto, e quella che il salvataggio ha messo
/// nel file: riaperto senza giornale, il file ha quelle misure.
let lastSized: string | null = null;
let savedSized: string | null = null;

/// L'indice da zero di una colonna in A1 («C» → 2).
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/// Un intervallo A1 («C4:C12», «B2») in righe e colonne da zero.
function rangeOf(a1: string): { r0: number; c0: number; r1: number; c1: number } {
  const corner = (cell: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(cell)!;
    return { row: Number(match[2]) - 1, column: columnIndex(match[1]!) };
  };
  const [first, last = first] = a1.split(":");
  const a = corner(first!);
  const b = corner(last!);
  return { r0: Math.min(a.row, b.row), c0: Math.min(a.column, b.column), r1: Math.max(a.row, b.row), c1: Math.max(a.column, b.column) };
}
/// L'A1 di (riga, colonna) da zero.
function cellName(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 1}`;
}
/// Il valore di (riga, colonna) nelle celle `cells` della revisione.
function answeredValue(cells: ReadonlyMap<string, LargeValue | null>, row: number, column: number): LargeValue | null {
  const key = `${row}:${column}`;
  return cells.has(key) ? cells.get(key)! : ANSWER_BASE.has(key) ? ANSWER_BASE.get(key)! : largeValue(row, column);
}

/// Un riempimento o un incolla sulle celle `cells`: scrive le celle nuove e
/// rende la selezione che lascia, come GridCraft (il riempimento selezionato,
/// la cella attiva al primo angolo della sorgente; l'incolla selezionato).
function answerCells(cells: Map<string, LargeValue | null>, command: GridCommand): { selection: string; active: string } {
  const read = (row: number, column: number) => answeredValue(cells, row, column);
  const selected = rangeOf(command.selection.split(",")[0]!);
  if (command.id === "fub.pasteFrom") {
    const asked = JSON.parse(command.params) as { source: string; move?: boolean };
    const from = rangeOf(asked.source);
    const block = Array.from({ length: from.r1 - from.r0 + 1 }, (_, r) =>
      Array.from({ length: from.c1 - from.c0 + 1 }, (_, c) => read(from.r0 + r, from.c0 + c)));
    if (asked.move) {
      for (let row = from.r0; row <= from.r1; row += 1) for (let column = from.c0; column <= from.c1; column += 1) cells.set(`${row}:${column}`, null);
    }
    block.forEach((line, r) => line.forEach((value, c) => cells.set(`${selected.r0 + r}:${selected.c0 + c}`, value)));
    const end = cellName(selected.r0 + block.length - 1, selected.c0 + block[0]!.length - 1);
    const start = cellName(selected.r0, selected.c0);
    return { selection: start === end ? start : `${start}:${end}`, active: start };
  }
  let source = selected;
  let target = selected;
  if (command.id === "edit.autoFill") {
    const asked = JSON.parse(command.params) as { source: string; target: string };
    source = rangeOf(asked.source);
    target = rangeOf(asked.target);
  } else if (command.id === "edit.fillDown" || command.id === "edit.fillSeries") {
    source = { ...selected, r1: selected.r0 };
  } else if (command.id === "edit.fillUp") {
    source = { ...selected, r0: selected.r1 };
  } else if (command.id === "edit.fillRight") {
    source = { ...selected, c1: selected.c0 };
  } else {
    source = { ...selected, c0: selected.c1 };
  }
  const down = target.c0 === source.c0 && target.c1 === source.c1;
  // Una serie lungo ogni colonna (o riga) della sorgente: con due numeri o
  // più, il passo fra gli ultimi due; altrimenti la sorgente si ripete.
  const lines = down ? source.c1 - source.c0 + 1 : source.r1 - source.r0 + 1;
  for (let line = 0; line < lines; line += 1) {
    const at = (index: number) => (down ? read(source.r0 + index, source.c0 + line) : read(source.r0 + line, source.c0 + index));
    const length = down ? source.r1 - source.r0 + 1 : source.c1 - source.c0 + 1;
    const seed = Array.from({ length }, (_, index) => at(index));
    const numbers = seed.every((value) => value?.value.kind === "number") ? seed.map((value) => value!.value.value as number) : null;
    const step = numbers && numbers.length > 1 ? numbers[numbers.length - 1]! - numbers[numbers.length - 2]! : numbers ? 0 : null;
    const first = down ? target.r0 : target.c0;
    const last = down ? target.r1 : target.c1;
    const origin = down ? source.r0 : source.c0;
    for (let index = first; index <= last; index += 1) {
      const offset = index - origin;
      if (offset >= 0 && offset < length) continue;
      let value: LargeValue | null;
      if (numbers && step !== null) {
        const number = numbers[numbers.length - 1]! + step * (offset - length + 1);
        value = { value: { kind: "number", value: number }, display: String(number) };
      } else {
        value = seed[((offset % length) + length) % length] ?? null;
      }
      cells.set(down ? `${index}:${source.c0 + line}` : `${source.r0 + line}:${index}`, value);
    }
  }
  const whole = { r0: Math.min(source.r0, target.r0), c0: Math.min(source.c0, target.c0), r1: Math.max(source.r1, target.r1), c1: Math.max(source.c1, target.c1) };
  return { selection: `${cellName(whole.r0, whole.c0)}:${cellName(whole.r1, whole.c1)}`, active: cellName(source.r0, source.c0) };
}

/// La risposta del provider a una misura tirata, o (con `?risposte=si`) a
/// un riempimento o a un incolla, su `revision`.
function sizedOutcome(revision: string, request: GridCommandRequest): GridCommandOutcome {
  const { id, params: text } = request.command;
  const known = sizedRevisions.get(revision);
  const columns = new Map(known?.columns);
  const rows = new Map(known?.rows);
  const cells = new Map(known?.cells);
  let selection = { sheet: request.command.sheet, selection: request.command.selection, active: request.command.active };
  if (CELL_COMMANDS.has(id)) {
    selection = { sheet: request.command.sheet, ...answerCells(cells, request.command) };
  } else if (id === "home.columnWidth") {
    const params = JSON.parse(text) as { cols: string; width: number };
    const [a, b] = params.cols.split(":").map(columnIndex);
    for (let index = a!; index <= b!; index += 1) columns.set(index, params.width);
  } else {
    const params = JSON.parse(text) as { rows: string; height: number };
    const [a, b] = params.rows.split(":").map((row) => Number(row) - 1);
    for (let index = a!; index <= b!; index += 1) rows.set(index, params.height);
  }
  const deleted = sizedCommands.length ? gridJournalText({ entries: [], commands: sizedCommands }) : "";
  sizedCommands = [...sizedCommands, request.command];
  const inserted = gridJournalText({ entries: [], commands: sizedCommands });
  const next = `sha256:grande-misure-${sizedRevisions.size + 1}`;
  sizedRevisions.set(next, { columns, rows, cells });
  lastSized = next;
  return {
    commit: { revision: next, edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted }, invalidation: { kind: "all" } },
    sheets: LARGE_SESSION.sheets,
    hidden: [],
    selection,
    result: null,
    dialog: null,
    commands: LARGE_SESSION.commands,
    book: LARGE_SESSION.book,
  } as GridCommandOutcome;
}

/// La finestra della revisione `revision` con le misure e le celle che il
/// finto ha dato.
function sizedWindow(window: GridBytesWindow, revision: string): GridBytesWindow {
  const sized = sizedRevisions.get(revision);
  const changed = new Map([...ANSWER_BASE, ...(sized?.cells ?? [])]);
  if (changed.size) {
    const first = window.row_start;
    const last = first + window.rows.length - 1;
    const inside = (key: string) => {
      const row = Number(key.split(":")[0]);
      return row >= first && row <= last;
    };
    const keyOf = (cell: GridBytesWindow["cells"][number]) => `${cell.key.row.slice(1)}:${cell.key.column.slice(1)}`;
    const added = [...changed].filter(([key, value]) => value !== null && inside(key)).map(([key, value]) => {
      const [row, column] = key.split(":").map(Number);
      return largeCell(row!, column!, value!) as GridBytesWindow["cells"][number];
    });
    window = { ...window, cells: [...window.cells.filter((cell) => !changed.has(keyOf(cell))), ...added] };
  }
  if (!sized) return window;
  return {
    ...window,
    columns: window.columns.map((column) => (sized.columns.has(column.index) ? { ...column, width: sized.columns.get(column.index)! } : column)),
    rows: window.rows.map((row) => (sized.rows.has(row.index) ? { ...row, height: sized.rows.get(row.index)! } : row)),
  };
}

/// Le finestre si fanno solo se la scena le chiede.
const LARGE_WINDOWS = WORKBOOK === "large"
  ? Array.from({ length: Math.ceil(LARGE_ROWS / LARGE_BLOCK) }, (_, block) => largeWindow(block * LARGE_BLOCK))
  : [];

/// Il risultato dei comandi che leggono (`?result=stats|errors|empty`,
/// insieme a `?workbook=1`): la risposta del provider alla prima esecuzione,
/// senza modifiche alla cartella. Le statistiche di una selezione, cinquecento
/// errori su un foglio dal nome lungo, nessun errore. Senza `result` il
/// comando non è servito, e la finestra del risultato dice il perché.
const RESULT_CASE = params.get("result");
const RESULT_SHEET = "Movimenti del conto corrente cointestato 2026";
const BENCH_RESULTS: Readonly<Record<string, unknown>> = {
  stats: { count: 24, numeric: 24, sum: 16437.9, average: 684.9125, min: 88.6, max: 1403.15 },
  errors: {
    errors: Array.from({ length: 500 }, (_, i) => ({
      sheet: RESULT_SHEET,
      cell: `F${i + 2}`,
      error: i % 7 === 3 ? "#VALUE!" : "#DIV/0!",
      formula: `=D${i + 2}/E${i + 2}`,
    })),
    circular: [],
  },
  empty: { errors: [], circular: [] },
};
const BENCH_OUTCOMES = RESULT_CASE !== null && RESULT_CASE in BENCH_RESULTS
  ? [{
    commit: {
      revision: BENCH_SESSION.revision,
      edit: { from: 0, to: 0, deleted: "", inserted: "" },
      invalidation: { kind: "cells", cells: [] },
    },
    sheets: BENCH_SESSION.sheets,
    hidden: BENCH_SESSION.hidden,
    selection: { sheet: BENCH_SESSION.active, selection: "B2:E7", active: "B2" },
    result: JSON.stringify(BENCH_RESULTS[RESULT_CASE]),
    dialog: null,
    commands: BENCH_SESSION.commands,
    book: BENCH_SESSION.book,
  }]
  : undefined;

/// Il documento di videoscrittura delle scene `document-*` (`?rich=…`), con
/// la proiezione che `fub-format-rich` dà davvero del file: quella con un po'
/// di tutto (`tests/ts_projection.rs`), oppure un `.odt`, uno pieno di
/// oggetti e uno protetto (`tests/ts_bench.rs`), o uno con due blocchi chiusi
/// (`tests/ts_projection.rs`). Come la cartella di Excel,
/// soltanto la sua scena lo ha.
const RICH_DOCS: Readonly<Record<string, { doc: string; text: string }>> = {
  docx: { doc: "Documenti/Prova.docx", text: RICH_PROJECTION.source },
  odt: { doc: "Documenti/Verbale.odt", text: RICH_BENCH.odt },
  objects: { doc: "Documenti/Oggetti.docx", text: RICH_BENCH.objects },
  readonly: { doc: "Documenti/Riservato.docx", text: RICH_BENCH.readonly },
  closed: { doc: "Documenti/Chiuso.docx", text: RICH_CLOSED.source },
};
const RICH_DOC = RICH_DOCS[params.get("rich") ?? ""] ?? null;

/// I caratteri del vault della scena «esporta-pdf-caratteri» (T72,
/// `?esporta-caratteri=1`, vedi `export-fonts-fixture.ts`). Le altre scene
/// hanno un vault senza caratteri.
const EXPORT_FONTS_SCENE = params.get("esporta-caratteri") === "1";

/// La foto delle scene `photo-*` (`?photo=xmp|senza`), col bundle `fub.craft`
/// acceso: la riga dei dati di LightCraft sotto la foto. Soltanto le sue
/// scene la hanno.
const PHOTO = photoCase(params.get("photo"));

/// Il disegno delle scene `craft-*` (`?craft-scheda=<caso>`, vedi
/// `craft-fixture.ts`): la scheda di un file Craft senza anteprima, con la
/// domanda, la riga «spente», «Preparo l'anteprima…» o la frase di `missing`.
const CRAFT_SCENE = craftSceneCase(params.get("craft-scheda"));
if (CRAFT_SCENE !== null && PHOTO !== null) throw new RangeError("craft-scheda is a vault of its own");

/// Il RAW delle scene `raw-*` (`?raw-scheda=dritto|girato|senza`, vedi
/// `raw-fixture.ts`): la scheda di una foto RAW col JPEG che ha dentro, dritto
/// o girato, o senza JPEG con la domanda di LightCraft.
const RAW_SCENE = rawSceneCase(params.get("raw-scheda"));
if (RAW_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null)) throw new RangeError("raw-scheda is a vault of its own");

/// Il PDF e il Word delle scene T31 (`?pdf-scena=nota|nota-senza|domanda|due-righe`,
/// vedi `craft-fixture.ts`): la nota che incorpora il PDF, la scheda del PDF
/// con la domanda sulle anteprime, il Word prestato con la domanda. Con
/// `?pdf-scena=annotato` (S2 T29) il PDF ha le sue annotazioni e la feature
/// `draw` è accesa.
const PDF_SCENE = pdfSceneCase(params.get("pdf-scena"));
if (PDF_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null || RAW_SCENE !== null)) throw new RangeError("pdf-scena is a vault of its own");

/// I profili d'esportazione delle scene `esporta-pdf-profili*`
/// (`?profili-pdf=1`, T79): due profili salvati, «Relazione» predefinito del
/// vault, come risponde `pdf.profiles` del core. Il finto non ha i comandi del
/// PDF: senza il parametro, come senza `draw`, il comando non c'è.
const PDF_PROFILES = params.get("profili-pdf") === "1"
  ? {
      profiles: [
        { id: "relazione", name: "Relazione", same_name: false, future: false, error: null, profile: { versione: 1, nome: "Relazione", tema: "relazione" } },
        { id: "tesi", name: "Tesi con commenti", same_name: false, future: false, error: null, profile: { versione: 1, nome: "Tesi con commenti", tema: "accademico", frontespizio: { frontespizio: true, indice: true, profondita_indice: 2, segnalibri: true } } },
      ],
      default_name: "Di serie",
      vault_default: "relazione",
      type_default: null,
      note_type: null,
      effective: { id: "relazione", from: "vault" },
    }
  : null;

/// L'albero delle scene T26 (`?albero=miniature|xmp`, vedi
/// `craft-fixture.ts`): le cartelle «Foto 2026» e «Progetti» con le miniature
/// accese, e gli XMP mostrati o nascosti.
const TREE_SCENE = treeSceneCase(params.get("albero"));
if (TREE_SCENE !== null && (PHOTO !== null || CRAFT_SCENE !== null || RAW_SCENE !== null || PDF_SCENE !== null)) {
  throw new RangeError("albero is a vault of its own");
}

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

/// Il cestino con tre file (`?cestino=3`): la scena del telefono che guarda
/// i bottoni «Ripristina» di righe vicine. Le altre scene lo hanno vuoto.
const TRASH_FULL = params.get("cestino") === "3";
/// La pagina del giorno (T39): `?giorno=1` dichiara la view `day_page` e la
/// cartella delle giornaliere del componente dei template (`daily.folder`).
const DAY_PAGE = params.get("giorno") === "1";
/// La pagina del tipo (T33): `?live=tipo-pagina` dichiara la view
/// `note_type_page` del componente delle proprietà.
const TYPE_PAGE = params.get("live") === "tipo-pagina";

/// «Svuota il cestino» in fondo al cestino, o la sua domanda al posto del
/// bottone, nella forma del provider `trash` (fub-features, `trash.rs`): un
/// nodo `fub.confirm` con la chiave del bottone, la domanda col conto delle
/// voci, il sì e il no, e il no per Esc.
function trashEmptyNode(count: number, asking: boolean): UiNode {
  const key = "trash-empty";
  if (!asking) {
    return { node: "button", key, label: "Svuota il cestino", intent: "danger", action: { action: "empty", payload: null } };
  }
  const cancel = { action: "cancel", payload: null };
  return {
    node: "custom",
    key,
    ns: "fub.confirm",
    payload: { cancel },
    fallback: [
      { node: "text", content: `Distruggo definitivamente ${count} voci del cestino? Non si torna indietro.` },
      { node: "button", label: "Svuota il cestino", intent: "danger", action: { action: "empty_confirm", payload: null } },
      { node: "button", label: "Annulla", intent: "neutral", action: cancel },
    ],
  };
}

/// Il cestino pieno nella forma del provider `trash` (fub-features,
/// `trash.rs`): una colonna con l'elenco, ogni voce una riga col nome, quando
/// è stata cestinata e «Ripristina», e sotto «Svuota il cestino» o, con
/// `asking`, la sua domanda.
function trashWithThree(asking = false): UiNode {
  const row = (id: string, original: string, when: string): UiNode => ({
    node: "stack",
    key: id,
    dir: "row",
    gap: 1,
    children: [
      { node: "list_item", title: original, subtitle: `Cestinata il ${when}`, action: null, selected: false },
      { node: "button", key: `restore:${id}`, label: "Ripristina", intent: "primary", action: { action: "restore", payload: { entry: id, original } } },
    ],
  });
  return {
    node: "stack",
    dir: "column",
    gap: 1,
    children: [
      {
        node: "list",
        items: [
          row("1-Bozza.md", "Bozza", "19 agosto 2026, 09:02"),
          row("2-Lista della spesa.md", "Lista della spesa", "18 agosto 2026, 17:40"),
          row("3-Prima idea.md", "Prima idea", "12 agosto 2026, 11:05"),
        ],
      },
      trashEmptyNode(3, asking),
    ],
  };
}

/// Una Live con un disegno incorporato (la scheda di disegno, T46): il banco
/// accende la feature `draw`, come l'host col componente dei disegni.
const LIVE_DRAWS = Object.keys(LIVE?.files ?? {}).some((id) => /\.svg$/i.test(id));

// `?campioni=N` (K6 T10, la scheda Risorse): il disegno dei connettori con N
// campioni del documento in `<defs>`, gradienti lineari con un `fub:name` e
// un solo stop, com'è scritto un campione che `scene/classify` legge. Senza,
// il disegno è quello di sempre.
const CAMPIONI_PARAM = params.get("campioni");

/// Il testo del disegno con `count` campioni nel primo `<defs>` aperto.
function conCampioni(text: string, count: number): string {
  if (!/^(0|[1-9]\d{0,3})$/.test(String(count))) throw new RangeError("campioni must be a count from 0 to 9999");
  const campioni = Array.from({ length: count }, (_, index) => {
    const colore = (((index + 1) * 2654435761) >>> 0) & 0xffffff;
    const hex = colore.toString(16).padStart(6, "0");
    return `<linearGradient id="campione-${index + 1}" fub:role="swatch" fub:name="Campione ${index + 1}"><stop stop-color="#${hex}"/></linearGradient>`;
  }).join("");
  return text.replace(/<defs\b[^>]*[^/]>/, (open) => `${open}${campioni}`);
}

/// Il disegno che il banco apre dall'albero, se ne ha uno.
const DRAWING = CONNECTORS !== null
  ? { doc: CONNECTORS_DOC, text: CAMPIONI_PARAM === null ? CONNECTORS.text : conCampioni(CONNECTORS.text, Number(CAMPIONI_PARAM)) }
  : LARGE !== null
    ? { doc: LARGE_DOC, text: LARGE.text }
    : null;

// `?drawing=acceso|spento|errore` dà al banco il motore del disegno (K5 T23),
// per le scene del chip del motore (`draw-engine-*` in `scene.mjs`). Senza,
// come l'host senza il componente, le porte del disegno rispondono
// `unserved` e il disegno resta sugli strumenti semplici, come lo conoscono
// le foto di prima.
//
// - `acceso`: l'apertura dice due parti che restano come sono, due righe
//   delle parti del corpus (`crates/fub-disegno/tests/corpus/perdite.tsv`)
//   sugli elementi del disegno dei connettori: le risorse in `<defs>` e la
//   prima forma. I gesti rispondono le operazioni dei vettori dei gesti
//   (`__fixtures__/disegno-gesti/`) quando il disegno e lo strumento sono
//   quelli di un vettore; ogni altro gesto non scrive niente (`empty`): il
//   motore del banco sa soltanto i vettori.
//   I comandi rispondono con `disegno-famiglie/<famiglia>.json`
//   (`disegno-famiglie/risposte.ts`).
// - `spento`: il motore spento nel vault, ogni porta del disegno `unserved`.
// - `errore`: l'apertura fallisce con `internal`, il motore è fermo.
const DRAWING_ENGINE_PARAM = params.get("drawing");
// `?indice=prova` porta al Disegno completo l'indice di prova del menu ≡ e di
// Ctrl+/ (K6 T9a, `disegno-indice-prova.ts`), al posto di quello generato, che
// è vuoto finché nessuna riga è fatta.
const INDICE_PARAM = params.get("indice");
if (DRAWING_ENGINE_PARAM !== null && !["acceso", "spento", "errore"].includes(DRAWING_ENGINE_PARAM)) {
  throw new RangeError("drawing must be acceso, spento or errore");
}
/// `?motore=prova|nuovo|rotto` (K6 T11): le preferenze del motore in
/// Impostazioni › Disegni, con il motore acceso (`?drawing=acceso`). `prova`:
/// `draw.motore` vuoto, campi accesi; `nuovo`: scritto da un Fub più nuovo;
/// `rotto`: non si legge. Nelle ultime due il riquadro è in sola lettura.
const MOTORE_PARAM = params.get("motore");
if (MOTORE_PARAM !== null && !["prova", "nuovo", "rotto"].includes(MOTORE_PARAM)) {
  throw new RangeError("motore must be prova, nuovo or rotto");
}

/// `?punti=1` (K6 T12): con la Selezione diretta o il Punto di ancoraggio
/// del motore, lo stato dello strumento dice un punto scelto sulla prima
/// forma del disegno, per la fila dei punti; senza, nessun punto.
const PUNTI_PARAM = params.get("punti");
if (PUNTI_PARAM !== null && PUNTI_PARAM !== "1") throw new RangeError("punti must be 1");

/// Lo stato dello strumento del banco con un punto scelto (`?punti=1`), o
/// `null` per una richiesta che non lo chiede.
function benchStatoCoiPunti(request: DrawingCommandRequest): DrawingOutcome | null {
  if (PUNTI_PARAM !== "1" || request.id !== "disegno.strumento.stato") return null;
  const strumento = (request.value as { strumento?: unknown } | null)?.strumento;
  if (strumento !== "directSelection" && strumento !== "anchorPoint") return null;
  const element = CONNECTORS?.shapes[0]?.id ?? "banco";
  return {
    revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null,
    state: {
      busy: false, transforming: false, wants_text: false, composing: false, cursor: "arrow", options: null,
      anchors: [{ element, subpath: 0, anchor: 0, at: [292.99, 170.14], end: false }],
    },
  };
}

/// Le righe di `prefs.list` del banco: un pezzo dell'elenco vero del motore
/// (`vendor/vectorcraft/crates/engine/src/cmd/prefscmds.rs`), con ogni tipo di
/// campo, nelle parole del motore che la sezione traduce.
const BENCH_PREFS: readonly Record<string, unknown>[] = [
  { key: "keyboardIncrement", category: "General", section: "", label: "Keyboard Increment", value: 1, kind: "number", min: 0.001, max: 1296, unit: "pt", measure: "General" },
  { key: "constrainAngle", category: "General", section: "", label: "Constrain Angle", value: 0, kind: "number", min: -360, max: 360, unit: "°" },
  { key: "cornerRadius", category: "General", section: "", label: "Corner Radius", value: 12, kind: "number", min: 0, max: 1296, unit: "pt", measure: "General" },
  { key: "usePreciseCursors", category: "General", section: "Options", label: "Use Precise Cursors", value: false, kind: "bool" },
  { key: "showToolTips", category: "General", section: "Options", label: "Show Tool Tips", value: true, kind: "bool" },
  { key: "scaleStrokes", category: "General", section: "Options", label: "Scale Strokes & Effects", value: false, kind: "bool" },
  { key: "zoomWithMouseWheel", category: "General", section: "Options", label: "Zoom with Mouse Wheel", value: false, kind: "bool" },
  { key: "selectionTolerance", category: "Selection & Anchor Display", section: "Selection", label: "Tolerance", value: 3, kind: "number", min: 1, max: 8, unit: "px" },
  { key: "anchorSize", category: "Selection & Anchor Display", section: "Anchor Points, Handle, and Bounding Box Display", label: "Size", value: 3, kind: "integer", min: 1, max: 7 },
  { key: "handleStyle", category: "Selection & Anchor Display", section: "Anchor Points, Handle, and Bounding Box Display", label: "Handles", value: "solid", kind: "choice", options: ["solid", "hollow", "large"] },
  { key: "guideColor", category: "Guides & Grid", section: "Guides", label: "Color", value: "#4affff", kind: "color" },
  { key: "guideStyle", category: "Guides & Grid", section: "Guides", label: "Style", value: "lines", kind: "choice", options: ["lines", "dots"] },
  { key: "gridColor", category: "Guides & Grid", section: "Grid", label: "Color", value: "#d0d0d0", kind: "color" },
  { key: "gridlineEvery", category: "Guides & Grid", section: "Grid", label: "Gridline every", value: 72, kind: "number", min: 1, max: 16383, unit: "pt", measure: "General" },
  { key: "gridSubdivisions", category: "Guides & Grid", section: "Grid", label: "Subdivisions", value: 8, kind: "integer", min: 1, max: 1000 },
  { key: "hyphenationExceptions", category: "Hyphenation", section: "", label: "Exceptions (comma separated)", value: "", kind: "text" },
];

/// L'esito di un comando delle preferenze del motore del banco.
function benchPrefsOutcome(request: DrawingCommandRequest): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null };
  return { ...outcome, reading: request.id === "disegno.prefs.list" ? BENCH_PREFS : null };
}

/// Un vettore dei gesti, per quel che il motore del banco ne legge.
interface BenchGestureVector {
  readonly input: string;
  readonly gesture: { readonly tool: string };
  readonly expect: { readonly ops: readonly unknown[] | null; readonly selection: readonly string[]; readonly refused: DrawingOutcome["refused"] };
}

const GESTURE_VECTORS = Object.values(
  import.meta.glob("../src/__fixtures__/disegno-gesti/*.json", { import: "default", eager: true }),
) as BenchGestureVector[];

/// Gli id nuovi che il motore del banco ha dato: uno nuovo per ogni `@n` di
/// ogni rilascio.
let benchDrawingIds = 0;

/// L'istanza dell'ultimo disegno aperto dal motore del banco: la finestra del
/// comando la usa (`window.bench.finestra`).
let benchLastInstance: string | null = null;

/// Il comando che la finestra «Sposta tracciato» del banco manda. Il banco non
/// sposta niente: la finestra si guarda, e il suo esito è una riga tratteggiata
/// sul foglio quando l'anteprima è accesa.
const BENCH_WINDOW_COMMAND = "tracciato.sposta";

/// L'esito del comando della finestra per il motore del banco: con `preview`
/// un'anteprima vuota (la forma il motore vera la calcola), altrimenti un passo
/// senza operazioni. Un comando di un altro id è una porta che il banco non
/// conosce.
function benchWindowOutcome(request: DrawingCommandRequest): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null };
  if (request.id !== BENCH_WINDOW_COMMAND) return { ...outcome, refused: "unsupported" };
  if (request.preview === true) return { ...outcome, preview: { shape: null, matrix: null, marquee: null, overlays: [] } };
  return { ...outcome, ops: "[]" };
}

/// La casella del Testo del motore del banco (K6 T16): dove il clic l'ha aperta e le righe scritte.
/// Il banco non sa misurare il carattere: il cursore sta dopo l'ultima lettera a mezzo corpo per
/// lettera, abbastanza per guardare la casella che si scrive.
let benchTypeBox: { x: number; y: number; righe: string[] } | null = null;
const BENCH_TYPE_SIZE = 24;

/// L'esito di un gesto del Testo del motore del banco: il clic apre la casella, i tasti e il testo
/// la riempiono, e finché è aperta l'anteprima mostra le righe e il cursore. La conferma scrive il
/// testo nel livello del gesto e lo lascia scelto, come il motore vero; una casella vuota non scrive
/// niente.
function benchTypeOutcome(gesture: DrawingGesture, outcome: DrawingOutcome): DrawingOutcome {
  const stato = (busy: boolean) => ({ busy, transforming: false, wants_text: busy, composing: false, cursor: "text", options: null });
  const primo = gesture.events[0];
  if (benchTypeBox === null && primo !== undefined && primo.kind === "down") benchTypeBox = { x: primo.x, y: primo.y, righe: [""] };
  const box = benchTypeBox;
  if (box === null) return { ...outcome, state: stato(false) };
  let preedit = "";
  for (const ingresso of gesture.inputs ?? []) {
    const ultima = box.righe.length - 1;
    if (ingresso.kind === "text") box.righe[ultima] += ingresso.text;
    else if (ingresso.kind === "ime") preedit = ingresso.preedit;
    else if (ingresso.kind === "key" && ingresso.pressed && ingresso.key === "Enter") box.righe.push("");
    else if (ingresso.kind === "key" && ingresso.pressed && ingresso.key === "Backspace") box.righe[ultima] = [...box.righe[ultima]!].slice(0, -1).join("");
  }
  const passo = BENCH_TYPE_SIZE * 1.2;
  const shape = {
    tag: "text",
    attrs: { x: String(box.x), y: String(box.y), "font-family": "Source Sans 3, sans-serif", "font-size": String(BENCH_TYPE_SIZE), fill: "#1a1a1a" },
    children: box.righe.map((riga, at) => ({
      tag: "tspan",
      attrs: { x: String(box.x), ...(at === 0 ? {} : { dy: String(passo) }) },
      text: at === box.righe.length - 1 ? riga + preedit : riga,
    })),
  };
  if (gesture.phase === "commit") {
    benchTypeBox = null;
    if (gesture.layer === null || box.righe.join("") === "") return { ...outcome, refused: "empty", state: stato(false) };
    const id = `oz${String(++benchDrawingIds).padStart(7, "0")}`;
    const elem = { ...shape, attrs: { id, ...shape.attrs } };
    return { ...outcome, ops: JSON.stringify([{ op: "add", parent: gesture.layer, pos: { last: true }, elem }]), selection: [id], state: stato(false) };
  }
  const ultima = box.righe[box.righe.length - 1]! + preedit;
  const cx = box.x + [...ultima].length * BENCH_TYPE_SIZE * 0.5;
  const cy = box.y + (box.righe.length - 1) * passo;
  const caret = { kind: "line" as const, a: [cx, cy - BENCH_TYPE_SIZE * 0.8] as [number, number], b: [cx, cy + BENCH_TYPE_SIZE * 0.2] as [number, number], role: "preview" as const, width: 1, dashed: false };
  return { ...outcome, preview: { shape, matrix: null, marquee: null, overlays: [caret] }, state: stato(true) };
}

/// L'esito di un gesto del motore del banco sulla copia di testo `text`.
function benchDrawingOutcome(gesture: DrawingGesture, text: string): DrawingOutcome {
  const outcome: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null };
  if (typeof gesture.tool === "object" && gesture.tool.engine.id === "type") return benchTypeOutcome(gesture, outcome);
  if (gesture.phase !== "commit") return outcome;
  const vector = GESTURE_VECTORS.find((each) => each.gesture.tool === gesture.tool && each.input === text);
  if (vector === undefined) {
    // Il clic di Selezione sceglie ciò che sta sotto il punto, come il motore (K6 T15, giro 2); gli altri
    // gesti senza vettore non cambiano niente.
    const scelta = gesture.tool === "select" ? selezioneDelClic(gesture) : null;
    return scelta === null ? { ...outcome, refused: "empty" } : { ...outcome, selection: scelta };
  }
  const names = new Map<string, string>();
  const real = (value: string): string =>
    value.replace(/@(\d+)/g, (found) => {
      if (!names.has(found)) names.set(found, `oz${String(++benchDrawingIds).padStart(7, "0")}`);
      return names.get(found)!;
    });
  return {
    ...outcome,
    ops: vector.expect.ops === null ? null : real(JSON.stringify(vector.expect.ops)),
    selection: vector.expect.selection.map(real),
    refused: vector.expect.refused,
  };
}

/// Il motore del disegno del banco, se la query ne chiede uno.
function benchDrawingEngine(): DrawingFake | undefined {
  if (DRAWING_ENGINE_PARAM === "spento") return { spento: () => true };
  if (DRAWING_ENGINE_PARAM === "errore") {
    return {
      open: () => {
        throw { kind: "internal", message: "banco: il motore del disegno si è fermato" };
      },
    };
  }
  if (DRAWING_ENGINE_PARAM !== "acceso") return undefined;
  const first = CONNECTORS?.shapes[0]?.id ?? null;
  const losses: DrawingLoss[] = [
    { element: DEFS_ID, kind: "unmapped", detail: "dentro <defs>: una risorsa, non un oggetto del disegno" },
    ...(first === null ? [] : [{ element: first, kind: "unmapped" as const, detail: "il motore non ne fa un oggetto suo" }]),
  ];
  let instances = 0;
  return {
    // I comandi della prova: quali valgono per la selezione, e il perché (K6 T9a).
    // Con `?comandi=risposti` valgono quelli a cui il banco sa rispondere
    // (`disegno-famiglie/`, K6 T12 giro 4): la finestra di Sposta tracciato e
    // Converti della sezione dei punti si aprono come col motore vero. Senza,
    // quelli delle trasformazioni (K6 T13 giro 3) e della Selezione (K6 T15).
    comandi:
      INDICE_PARAM === "prova"
        ? (selection) => comandiProva(selection)
        : params.get("comandi") === "risposti"
          ? () => comandiRisposti()
          : (selection) => [...comandiTrasformazioni(selection), ...comandiSelezione(selection)],
    open: () => {
      const instance = `banco-${++instances}`;
      benchLastInstance = instance;
      return { instance, revision: "0", mapped: 0, unmapped: losses.length, losses };
    },
    gesto: (gesture, copia) => benchDrawingOutcome(gesture, copia.text),
    // Il comando delle scene della finestra ha la sua risposta; gli altri
    // comandi del Disegno completo hanno quelle di `disegno-famiglie/`, e
    // `unserved` un comando che non ne ha una.
    comando: (request) =>
      benchStatoCoiPunti(request) ?? (request.id === BENCH_WINDOW_COMMAND
        ? benchWindowOutcome(request)
        : MOTORE_PARAM !== null && request.id.startsWith("disegno.prefs.")
          ? benchPrefsOutcome(request)
          : rispostaDiFamiglia(request)),
  };
}

/// I comandi che il banco sa fare con l'indice generato: uno per risposta di
/// `disegno-famiglie/`, accesi.
function comandiRisposti(): DrawingCommandInfo[] {
  return [...new Set(RISPOSTE.map((r) => r.comando))].map((id) => ({ id, enabled: true, disabled_reason: null }));
}

/// Il motore del disegno del banco: `undefined` senza `?drawing=`.
const DRAWING_ENGINE = benchDrawingEngine();
// L'indice di prova entra prima che il Completo chieda il suo: `indice()` lo
// memorizza alla prima chiamata, e il banco apre il disegno dopo.
if (INDICE_PARAM === "prova") {
  void import("../src/editors/spatial/completo/indice").then((modulo) => modulo.usaIndiceDiProva(INDICE_PROVA));
}

// Il ramo Darwin deve nascere prima che `mountTitlebar` legga la piattaforma:
// la query prepara il browser del banco, mai la shell di produzione.
if (params.get("platform") === "darwin") {
  Object.defineProperty(globalThis.navigator, "platform", { value: "MacIntel", configurable: true });
}

/// La luce da fotografare. Il ripiego è lo scuro, che è la luce in cui Fub è
/// sempre stato — la stessa scelta di `theme.ts`.
export const LIGHT: "dark" | "light" = params.get("light") === "light" ? "light" : "dark";

/// Il vault che si apre: nessuno con `?vault=vuoto`, che è la scena della
/// finestra senza vault — l'unica in cui metà delle superfici non esiste, e
/// l'unica che si fotografa per vedere cosa resta.
const ROOT = params.get("vault") === "vuoto" ? null : "/Bench vault";
/// `?vault=nuovo`: la finestra parte senza vault e «Crea un vault nuovo…»
/// apre una cartella vuota, coi componenti come li trova un vault appena
/// creato (`partenze.nuovo`) — la scena che chiede il profilo.
const NEW_VAULT = params.get("vault") === "nuovo";
/// Lo stato da cui parte la pagina «Componenti»: un nome delle `partenze`
/// dello scenario (`solo-note`, `tutto`). Senza, «Studio».
const COMPONENTS_START = params.get("componenti");

// `theme.ts` legge questa chiave prima di chiedere qualunque cosa al canale
// dati. Scriverla qui — cioè all'`import` di questo module, che Vite mette
// prima di `main.ts` perché `main.ts` lo importa — è ciò che evita il mezzo
// fotogramma nella luce sbagliata.
try {
  globalThis.window.localStorage.setItem("fub.appearance.theme", LIGHT);
} catch {
  // Un motore senza storage non è un motivo per non fotografare: l'altra metà
  // (l'impostazione servita qui sotto) arriva comunque.
}

// ---------------------------------------------------------------------------
// L'allestimento: view, comandi, impostazioni.
// ---------------------------------------------------------------------------

/// Una `ViewSpec` piena. Le view del banco sono quelle che `fub-features`
/// registra davvero, coi loro id veri (`fub_features::*::*_VIEW`): un tema che
/// veste `#views-right` deve vestire *quelle*, non dei nomi inventati.
function view(
  id: string,
  title: string,
  surface: ViewSpec["surface"],
  icon: string | null,
  order: number,
  openByDefault = true,
): ViewSpec {
  return {
    id,
    title,
    surface,
    refresh: { kinds: [], topics: [], subjects: [], changes: [] },
    follows: ["document"],
    params: [],
    icon,
    order,
    open_by_default: openByDefault,
    preferred_size: null,
    closable: false,
  };
}

/// La Scrivania delle scene `scrivania-*` (T40): vedi `bench/desk-scene.ts`.
const DESK_CASE = deskCase(params.get("scrivania"));
const DESK = DESK_CASE === null ? null : deskScene(DESK_CASE);

const VIEWS: ViewSpec[] = [
  view("outline", "Struttura", "right_sidebar", "struttura", 0),
  view("backlinks", "Collegamenti", "right_sidebar", "backlink", 1),
  view("properties", "Proprietà", "right_sidebar", "properties", 2),
  // Nasce chiusa come quella vera: la scheda la deve aprire lo stesso.
  view("history", "Cronologia", "right_sidebar", "history", 3, false),
  view("stats", "Statistiche", "status_bar", null, 0),
  view("tags", "Tag", "left_sidebar", "tag", 0),
  view("graph", "Grafo", "main", "graph", 0),
  view("trash", "Cestino", "left_sidebar", "trash", 1),
  // La Scrivania solo nelle sue scene: nelle altre il binario resta quello
  // delle loro foto.
  ...(DESK === null ? [] : [view("desk", "Scrivania", "main", "dashboard", 1)]),
  // La pagina del giorno (T39), con la cartella del diario del componente
  // dei template: solo nelle sue scene, perché le altre non cambino.
  ...(DAY_PAGE ? [view("day_page", "La pagina del giorno", "main", "calendar", 1)] : []),
  // La pagina del tipo (T33): solo nella sua scena.
  ...(TYPE_PAGE ? [view("note_type_page", "Le note del tipo", "main", "template", 1)] : []),
];

/// Un `CommandSpec` di lettura, che è la forma della gran parte.
function command(
  id: string,
  title: string,
  description: string,
  keybinding: string | null,
  writes = false,
): CommandSpec {
  return {
    id,
    title,
    description,
    keybinding,
    params: [],
    scope: { writes, reach: writes ? "document" : "session", reversible: writes },
    surfaces: [],
  };
}

/// I comandi che la palette elenca. Sono pochi e sono veri: la palette si
/// fotografa **piena**, perché una lista di tre righe non mostra né lo scorrere
/// né il gradino fra una riga e la successiva.
///
/// **Nessuno di questi accordi è già della shell**, e la prima stesura ne aveva
/// due (`Mod-Shift-F`, `Mod-Shift-L`) più un `F2`, che non è nemmeno premibile.
/// La shell se n'è accorta da sé e l'ha detto in un avviso all'avvio: il banco
/// stava fotografando un difetto **suo** credendolo scenografia, che è il primo
/// modo in cui un allestimento mente. Gli accordi della shell stanno in
/// `src/ui/shell-keys.generated.ts`.
const BENCH_COMMANDS: CommandSpec[] = [
  command("note.create", "Crea una nota", "Una nota nuova nella cartella corrente", "Mod-Alt-n", true),
  command("note.rename", "Rinomina la nota", "Cambia il nome del documento aperto", "Mod-Shift-r", true),
  command("note.trash", "Cestina la nota", "Sposta il documento nel cestino", null, true),
  command("search.open", "Cerca nel vault", "Apre il pannello di ricerca", null),
  command("daily.open", "Apri la nota di oggi", "Il diario del giorno, creandolo se manca", "Mod-Shift-d", true),
  command("vault.undo", "Annulla l'ultima operazione", "La pila strutturale", "Mod-Alt-z", true),
  command("trash.empty", "Svuota il cestino", "Cancella davvero ciò che è cestinato", null, true),
  command("stats.open", "Statistiche del documento", "Parole, caratteri, collegamenti", null),
];

/// Con `?nuovo=tutto` il kernel finto dichiara i comandi che creano un file di
/// ogni tipo e la nota da un modello, come l'host con tutte le feature: il menu
/// «Nuovo» del «+» (S34) ha tutte le sue voci. Senza, ha la nota e la cartella.
/// I comandi che creano un file chiedono il nome e la cartella, come quelli
/// veri: scelti dal menu aprono il modulo della palette, non un'invocazione.
const NEW_FILE_COMMANDS: CommandSpec[] = params.get("nuovo") === "tutto"
  ? [
    newFileCommand("document.create", "Nuovo documento", "Crea un documento di Word vuoto e lo apre"),
    newFileCommand("sheet.create", "Nuovo foglio", "Crea una cartella di Excel vuota e la apre"),
    newFileCommand("drawing.create", "Nuovo disegno", "Crea un disegno, vuoto o da un modello, e lo apre"),
    newFileCommand("canvas.create", "Nuova lavagna", "Crea una lavagna vuota e la apre"),
    command("note.from_template", "Nota da un modello", "Crea una nota da un modello del vault", null, true),
  ]
  : [];

function newFileCommand(id: string, title: string, description: string): CommandSpec {
  const text = (name: string, label: string) => ({ name, title: label, description: "", kind: { kind: "text" as const }, required: false });
  return { ...command(id, title, description, null, true), params: [text("name", "Nome"), text("folder", "Cartella")] };
}

/// La barra di formattazione la fotografa il telefono (`mobile.html`), dove
/// sta sopra la tastiera, e la finestra principale con `?formatbar=1`. Nelle
/// altre pagine i comandi sono quelli del banco, e le loro foto con loro.
const ON_MOBILE = globalThis.window.location.pathname.endsWith("/mobile.html") || params.get("formatbar") === "1";
const FORMAT_COMMANDS: CommandSpec[] = (
  [
    ["text.undo", "Annulla"],
    ["text.redo", "Ripeti"],
    ["markdown.heading.1", "Titolo 1"],
    ["markdown.heading.2", "Titolo 2"],
    ["markdown.bold", "Grassetto"],
    ["markdown.italic", "Corsivo"],
    ["markdown.code", "Codice"],
    ["markdown.link", "Collegamento"],
    ["markdown.list.bullet", "Elenco puntato"],
    ["markdown.list.task", "Elenco di cose da fare"],
    ["markdown.quote", "Citazione"],
  ] as const
).map(([id, title]) => ({ ...command(id, title, title, null, true), surfaces: ["toolbar"] }));

/// Le voci del «/», come le dà `fub.formatting`: soltanto nelle scene che
/// fotografano il menu (`?slash=1`), perché la palette elenca ogni comando e
/// le sue foto sono fatte coi soli comandi del banco.
const SLASH_COMMANDS: readonly CommandSpec[] = params.get("slash") === "1" ? SLASH_SPECS : [];

/// `?toolbar=nascosta`: la forma della barra di formato scelta (`editor.toolbar`
/// di `crates/fub-host/src/settings.rs`), per le scene della mini-barra (T12).
/// Senza, l'impostazione non c'è e la barra ha la forma di serie.
const TOOLBAR_FORM = params.get("toolbar");
const TOOLBAR_SETTING_ROW: readonly SettingEntry[] = TOOLBAR_FORM === null ? [] : [{
  spec: {
    key: "editor.toolbar",
    label: "Barra di formato",
    description: "La barra sopra il foglio: compatta, completa o nascosta (resta la mini-barra sul testo scelto).",
    group: "Editor",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "compatta",
      options: [
        { value: "compatta", label: "Compatta" },
        { value: "completa", label: "Completa" },
        { value: "nascosta", label: "Nascosta" },
      ],
    },
    program_writable: false,
  },
  value: TOOLBAR_FORM,
  source: "machine",
}];

/// Le settings: una per **ogni** specie di `SettingKind`, perché il pannello
/// disegna un controllo diverso per ciascuna e una scena che ne mostrasse solo
/// due fotograferebbe metà del form.
/// Il gruppo Aspetto invece è **intero**, con le voci, i testi e l'ordine di
/// `appearance_settings` (`fub-host/src/settings.rs`): la foto delle
/// impostazioni è quella della shell vera, e `fake-ipc.test.ts` lo tiene.
/// `appearance.theme-id` il form non lo mostra (ha il suo gesto nel catalogo
/// dei temi), ma c'è, come nell'host.
/// Lo spazio dell'interfaccia lo mostra solo la finestra principale
/// (`index.html`): il telefono e la finestra documento non hanno la riga.
const ON_SHELL = globalThis.window.location.pathname.endsWith("/index.html");
const CHROME_COMPACTNESS: SettingEntry = {
  spec: {
    key: "chrome.compactness",
    label: "Spazio dell'interfaccia",
    description: "Quanto posto prendono le barre attorno ai fogli: 0 comoda, 4 minima. I fogli non cambiano.",
    group: "Aspetto",
    scope: "machine",
    kind: { kind: "number", default: 0, min: 0, max: 4 },
    program_writable: false,
  },
  value: 0,
  source: "default",
};

const SETTINGS: SettingEntry[] = [
  {
    spec: {
      key: "appearance.theme",
      label: "Tema",
      description: "In che luce si guarda Fub. «Come il sistema» segue il sistema operativo.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Come il sistema" },
          { value: "light", label: "Chiaro" },
          { value: "dark", label: "Scuro" },
        ],
      },
      program_writable: false,
    },
    value: LIGHT,
    source: "machine",
  },
  {
    spec: {
      key: "appearance.theme-id",
      label: "Tema installato",
      description: "L'id del tema montato; si sceglie dal catalogo dei temi.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: "fub.serie" },
      program_writable: false,
    },
    value: "fub.serie",
    source: "default",
  },
  {
    spec: {
      key: "appearance.contrast",
      label: "Contrasto",
      description: "Segue il sistema oppure usa sempre il contrasto normale o alto.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Come il sistema" },
          { value: "normal", label: "Normale" },
          { value: "high", label: "Alto" },
        ],
      },
      program_writable: false,
    },
    value: "normal",
    source: "machine",
  },
  {
    spec: {
      key: "appearance.accent",
      label: "Tinta dell'accento",
      description: "Il colore di collegamenti, fuoco e selezione. Chiarezza e intensità si adattano da sole per restare leggibili.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 160, min: 0, max: 360 },
      program_writable: false,
    },
    value: 160,
    source: "default",
  },
  {
    spec: {
      key: "appearance.density",
      label: "Densità",
      description: "Compatta o allarga la spaziatura dei controlli senza cambiare la disposizione dei pannelli.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "comfortable",
        options: [
          { value: "compact", label: "Compatta" },
          { value: "comfortable", label: "Comoda" },
          { value: "relaxed", label: "Rilassata" },
        ],
      },
      program_writable: false,
    },
    value: "comfortable",
    source: "default",
  },
  {
    spec: {
      key: "appearance.bars",
      label: "Le barre",
      description: "Il vassoio sotto le schede, le barre dei comandi e la colonna degli strumenti: chiaro, vicino alla carta, o marcato, che si stacca di più.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "light",
        options: [
          { value: "light", label: "Chiare" },
          { value: "marked", label: "Marcate" },
        ],
      },
      program_writable: false,
    },
    value: "light",
    source: "default",
  },
  ...(ON_SHELL ? [CHROME_COMPACTNESS] : []),
  {
    spec: {
      key: "appearance.zoom",
      label: "Zoom interfaccia",
      description: "Quanto è grande tutta l'interfaccia, dal 50% al 200%.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 1, min: 0.5, max: 2 },
      program_writable: false,
    },
    value: 1,
    source: "default",
  },
  {
    spec: {
      key: "appearance.motion",
      label: "Animazioni",
      description: "Segue la preferenza del sistema, oppure toglie rimbalzi e scene, oppure riduce sempre le animazioni dell'interfaccia.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Come il sistema" },
          { value: "calm", label: "Calme" },
          { value: "reduced", label: "Ridotte" },
        ],
      },
      program_writable: false,
    },
    value: "",
    source: "default",
  },
  {
    spec: {
      key: "appearance.frame-rate",
      label: "Fotogrammi al secondo",
      description: "Tetto delle animazioni disegnate dall'interfaccia. Il massimo segue il refresh dello schermo, qualunque sia.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Massimo dello schermo" },
          { value: "240", label: "240 fps" },
          { value: "180", label: "180 fps" },
          { value: "165", label: "165 fps" },
          { value: "144", label: "144 fps" },
          { value: "120", label: "120 fps" },
          { value: "90", label: "90 fps" },
          { value: "60", label: "60 fps" },
          { value: "30", label: "30 fps" },
        ],
      },
      program_writable: false,
    },
    value: "",
    source: "default",
  },
  {
    spec: {
      key: "appearance.diagram-style",
      label: "Stile dei diagrammi",
      description: "Colori e tratto dei diagrammi Mermaid; «%% stile: nome» lo cambia per uno solo.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "armonia",
        options: [
          { value: "armonia", label: "Armonia — segue il tema" },
          { value: "acquerello", label: "Acquerello — tinte pastello" },
          { value: "aurora", label: "Aurora — colori vivi e profondi" },
          { value: "blueprint", label: "Blueprint — tavola tecnica" },
          { value: "inchiostro", label: "Inchiostro — editoriale" },
        ],
      },
      program_writable: false,
    },
    value: "armonia",
    source: "default",
  },
  {
    spec: {
      key: "appearance.content-look",
      label: "Aspetto dei documenti",
      description: "Come si mostra un file che ha un aspetto suo, come un documento: la sua pagina, o la pagina adattata alla luce del tema. Automatico sceglie la pagina, e quella adattata con il contrasto alto.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "auto",
        options: [
          { value: "auto", label: "Automatico" },
          { value: "file", label: "Pagina" },
          { value: "adattato", label: "Pagina adattata" },
        ],
      },
      program_writable: false,
    },
    value: "auto",
    source: "default",
  },
  {
    spec: {
      key: "appearance.font",
      label: "Carattere di lettura",
      description: "Famiglia usata per la prosa lunga.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "newsreader",
        options: [
          { value: "newsreader", label: "Newsreader" },
          { value: "hanken", label: "Hanken Grotesk" },
          { value: "literata", label: "Literata" },
          { value: "inter", label: "Inter" },
          { value: "system", label: "Del sistema" },
        ],
      },
      program_writable: false,
    },
    value: "newsreader",
    source: "default",
  },
  {
    spec: {
      key: "appearance.font-ui",
      label: "Carattere dell'interfaccia",
      description: "Famiglia di barre, cassetti, menu e finestre.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "hanken",
        options: [
          { value: "hanken", label: "Hanken Grotesk" },
          { value: "inter", label: "Inter" },
          { value: "system", label: "Del sistema" },
        ],
      },
      program_writable: false,
    },
    value: "hanken",
    source: "default",
  },
  {
    spec: {
      key: "appearance.font-mono",
      label: "Carattere del codice",
      description: "Famiglia a spaziatura fissa del codice e del sorgente.",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "plex",
        options: [
          { value: "plex", label: "IBM Plex Mono" },
          { value: "jetbrains", label: "JetBrains Mono" },
          { value: "system", label: "Del sistema" },
        ],
      },
      program_writable: false,
    },
    value: "plex",
    source: "default",
  },
  {
    spec: {
      key: "appearance.body",
      label: "Corpo del testo (px)",
      description: "Dimensione del testo nelle superfici di lettura.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 18, min: 12, max: 28 },
      program_writable: false,
    },
    value: 18,
    source: "default",
  },
  {
    spec: {
      key: "appearance.line-height",
      label: "Interlinea",
      description: "Passo verticale della prosa lunga.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 1.65, min: 1.2, max: 2.4 },
      program_writable: false,
    },
    value: 1.65,
    source: "default",
  },
  {
    spec: {
      key: "appearance.measure",
      label: "Misura della riga (caratteri)",
      description: "Larghezza massima della colonna di lettura.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 58, min: 40, max: 100 },
      program_writable: false,
    },
    value: 58,
    source: "default",
  },
  {
    spec: {
      key: "appearance.css-snippets",
      label: "Frammenti CSS locali",
      description: "Frammenti attivabili, locali e limitati agli hook visivi; nessuna rete o importazione CSS.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: '{"version":1,"snippets":[]}' },
      program_writable: false,
    },
    value: '{"version":1,"snippets":[]}',
    source: "default",
  },
  {
    spec: {
      key: "editor.blocks",
      label: "Blocchi: maniglie e selezione",
      description:
        "Accesi, ogni blocco ha la maniglia e il «+», Esc seleziona il blocco e Ctrl A prende il blocco, poi tutti. Spenti, Scrittura è un editor di testo: Ctrl A seleziona tutto il testo e Ctrl D la prossima occorrenza.",
      group: "Editor",
      scope: "machine",
      kind: { kind: "toggle", default: true },
      program_writable: false,
    },
    value: true,
    source: "default",
  },
  // `editor.typewriter` di `crates/fub-host/src/settings.rs` (T24): la voce
  // «Macchina da scrivere» del menu «…» la scrive, e gli editor la rileggono.
  {
    spec: {
      key: "editor.typewriter",
      label: "Macchina da scrivere",
      description:
        "La riga del cursore resta a metà altezza del foglio e il testo le scorre sotto, come il foglio in una macchina da scrivere. In cima a una nota corta il testo non scende oltre l'inizio.",
      group: "Editor",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: false,
    source: "default",
  },
  {
    spec: {
      key: "editor.line_numbers",
      label: "Numeri di riga",
      description: "Mostra la grondaia con il numero di ogni riga.",
      group: "Editor",
      scope: "vault",
      kind: { kind: "toggle", default: false },
      program_writable: true,
    },
    value: true,
    source: "vault",
  },
  {
    spec: {
      key: "editor.column_width",
      label: "Larghezza della colonna",
      description: "In caratteri. Sotto i quaranta la prosa si spezza.",
      group: "Editor",
      scope: "vault",
      kind: { kind: "number", default: 72, min: 40, max: 120 },
      program_writable: true,
    },
    value: 72,
    source: "default",
  },
  // Il nome di chi scrive, come lo dichiara l'host (`profile_settings` in
  // `crates/fub-host/src/settings.rs`): il primo commento lo chiede e lo
  // salva qui, e le risposte dopo lo firmano.
  {
    spec: {
      key: "profile.name",
      label: "Il tuo nome",
      description: "Firma i commenti che scrivi nelle note. Il nome finisce nel file della nota: chi lo apre, anche con un altro programma, lo legge. Cambiarlo vale per i commenti nuovi.",
      group: "Profilo",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value: "",
    source: "default",
  },
  {
    spec: {
      key: "vault.daily_folder",
      label: "Cartella del diario",
      description: "Dove finiscono le note del giorno.",
      group: "Vault",
      scope: "vault",
      kind: { kind: "text", default: "Diario" },
      program_writable: true,
    },
    value: "Diario",
    source: "default",
  },
  {
    spec: {
      key: "vault.excluded",
      label: "Cartelle escluse",
      description: "Non entrano nell'indice e non compaiono nella ricerca.",
      group: "Vault",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value: ["Risorse", "Progetti/Archivio"],
    source: "vault",
  },
  {
    spec: {
      key: "log.level",
      label: "Livello del log",
      description: "Quanto scrive Fub sul proprio diario di bordo.",
      group: "Diagnostica",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "warn",
        options: [
          { value: "error", label: "Solo errori" },
          { value: "warn", label: "Avvisi" },
          { value: "info", label: "Informazioni" },
          { value: "debug", label: "Diagnostica" },
        ],
      },
      program_writable: false,
    },
    value: "warn",
    source: "default",
  },
];

/// Lo spazio di lavoro e la colonna dei disegni, di serie: lo spazio scelto
/// dal menu del disegno si scrive qui.
const DRAW_WORKSPACE: readonly SettingEntry[] = [
  {
    spec: {
      key: "draw.workspace",
      label: "Spazio di lavoro",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: {
        kind: "choice",
        default: "full",
        options: [
          { value: "full", label: "Completo" },
          { value: "simple", label: "Semplice" },
        ],
      },
      program_writable: false,
    },
    value: "full",
    source: "default",
  },
  {
    spec: {
      key: "draw.toolbar",
      label: "Strumenti della colonna",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value: [],
    source: "default",
  },
];

/// `?componenti=motore-spento` (K6 T7): la partenza in cui il Motore del disegno
/// è spento, e con lui il Disegno completo che lo richiede. È costruita qui, come
/// copia della partenza `studio`, così il fixture dei componenti (specchio del
/// Rust) resta com'è.
const COMPONENT_SCENARIO_MOTORE_SPENTO = (() => {
  const base = COMPONENT_SCENARIO;
  const mappa = structuredClone(base.mappe[base.partenze.studio!]!);
  for (const riga of mappa.righe) {
    if (riga.id === "fub.motore-vettoriale" || riga.id === "fub.disegno-completo") {
      riga.acceso = false;
      riga.perche = "Spento";
    }
  }
  return { ...base, partenze: { ...base.partenze, "motore-spento": base.mappe.length }, mappe: [...base.mappe, mappa] };
})();

/// Gli spazi di lavoro salvati del disegno (K6 T7, `draw.workspaces`): un
/// elenco di voci JSON con `"v": 1`, vuoto di serie come un vault che non ne ha
/// salvati. Le scene del menu dello spazio lo lasciano così; il probe di «Salva»
/// e «Gestisci» lo riempie scrivendo l'impostazione dalla banda.
const DRAW_SAVED_WORKSPACES: readonly SettingEntry[] = [
  {
    spec: {
      key: "draw.workspaces",
      label: "Spazi di lavoro salvati",
      description: "",
      group: "Disegni",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value: [],
    source: "default",
  },
];

/// I tasti del Disegno completo cambiati dall'utente (K6 T9c, `draw.keys`): solo
/// con l'indice di prova (`?indice=prova`), che dà i comandi alla sezione
/// «Disegno completo» di Impostazioni › Scorciatoie. Con `?tasti=conflitto`
/// due tasti cambiati: «Inverti direzione tracciato» prende Ctrl+J di «Unisci»
/// (vince l'ultimo assegnato) e «Separa» resta senza tasto.
const DRAW_KEYS: readonly SettingEntry[] =
  INDICE_PARAM !== "prova"
    ? []
    : [
        {
          spec: {
            key: "draw.keys",
            label: "Tasti del Disegno completo",
            description: "",
            group: "Disegni",
            scope: "machine",
            kind: { kind: "text", default: "" },
            program_writable: false,
          },
          value:
            params.get("tasti") === "conflitto"
              ? JSON.stringify({ v: 1, insieme: null, tasti: { "draw.path.reverse": "Mod-j", "draw.ungroup": null } })
              : "",
          source: params.get("tasti") === "conflitto" ? "machine" : "default",
        },
      ];

/// Le preferenze del motore (K6 T11, `draw.motore`): solo con `?motore=`, che
/// le dà al riquadro «Motore del disegno» di Impostazioni › Disegni.
const DRAW_ENGINE_PREFS: readonly SettingEntry[] =
  MOTORE_PARAM === null
    ? []
    : [
        {
          spec: {
            key: "draw.motore",
            label: "Preferenze del Motore del disegno",
            description: "",
            group: "Disegni",
            scope: "machine",
            kind: { kind: "text", default: "" },
            program_writable: false,
          },
          value: MOTORE_PARAM === "nuovo" ? JSON.stringify({ v: 2, prefs: { gridStyle: "dots" } }) : MOTORE_PARAM === "rotto" ? "{non si legge" : "",
          source: MOTORE_PARAM === "prova" ? "default" : "machine",
        },
      ];

/// Il gruppo «App esterne» con le cinque impostazioni della feature `craft`,
/// i testi del catalogo vero (`fub-host/src/settings.rs`). Solo con
/// `?craft=1`, così le altre scene delle preferenze restano come sono.
const CRAFT_SETTING_ENTRIES: readonly SettingEntry[] = [
  {
    spec: {
      key: "craft.editor-paths",
      label: "Dove sono le app Craft",
      description:
        "Una riga per programma, come vectorcraft=/opt/vc/vectorcraft, o vectorcraft-cli=… per la riga di comando. Il percorso intero vince su quello che Fub trova da solo.",
      group: "App esterne",
      scope: "machine",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value: [],
    source: "default",
  },
  {
    spec: {
      key: "craft.cli-previews",
      label: "Anteprime fatte dalle app",
      description:
        "Fub fa fare l'anteprima di un file che non ne ha una all'app che lo apre, su una copia, solo quando apri il file tu.",
      group: "App esterne",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "ask",
        options: [
          { value: "ask", label: "Chiedi la prima volta" },
          { value: "on", label: "Accese" },
          { value: "off", label: "Spente" },
        ],
      },
      program_writable: false,
    },
    value: "ask",
    source: "default",
  },
  {
    spec: {
      key: "craft.preview-max-mib",
      label: "Peso massimo da leggere per un'anteprima (MiB)",
      description:
        "Un file che va letto intero per l'anteprima e pesa di più resta senza: i file che si leggono a pezzi non hanno limite.",
      group: "App esterne",
      scope: "machine",
      kind: { kind: "number", default: 64, min: 1, max: 4096 },
      program_writable: false,
    },
    value: 64,
    source: "default",
  },
  {
    spec: {
      key: "craft.tree-thumbnails",
      label: "Miniature nell'albero",
      description:
        "Accanto al nome di un file Craft, di un RAW, di un PDF o di un documento, la piccola anteprima che il file ha già. L'albero non avvia mai un'app.",
      group: "App esterne",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: false,
    source: "default",
  },
  {
    spec: {
      key: "craft.tree-show-xmp",
      label: "Mostra i file XMP nell'albero",
      description: "Spento, gli XMP spariscono dall'albero: la ricerca li trova e la foto mostra i loro dati.",
      group: "App esterne",
      scope: "machine",
      kind: { kind: "toggle", default: true },
      program_writable: false,
    },
    value: true,
    source: "default",
  },
];
const CRAFT_SETTINGS: readonly SettingEntry[] = params.get("craft") === "1" || TREE_SCENE !== null
  ? CRAFT_SETTING_ENTRIES.map((entry) => {
    // La scena dell'albero accende le miniature, e nasconde gli XMP se lo chiede.
    const value = TREE_SCENE === null ? null : treeSceneSetting(TREE_SCENE, entry.spec.key);
    return value === null ? entry : { ...entry, value, source: "machine" as const };
  })
  : [];

/// I due pannelli ai lati, come li dichiara l'host vero (`fub-host`,
/// `chrome.sidebar.visible` e `chrome.inspector.visible`). Le scene della barra
/// dei fogli li chiudono per dare al foglio tutta la larghezza: senza la
/// dichiarazione la scrittura fallirebbe, e la foto terrebbe l'avviso «Non ho
/// potuto ricordare come hai lasciato i pannelli». Solo con `workbook=1`, così
/// le scene delle Impostazioni non cambiano.
const WORKBOOK_CHROME: readonly SettingEntry[] = WORKBOOK_DOC === null ? [] : [
  ["chrome.sidebar.visible", "Mostra il pannello a sinistra"],
  ["chrome.inspector.visible", "Mostra il pannello a destra"],
].map(([key, label]): SettingEntry => ({
  spec: {
    key,
    label,
    description: "Lo affianca ai riquadri quando la finestra è larga abbastanza; altrimenti si apre a richiesta.",
    group: "Aspetto",
    scope: "machine",
    kind: { kind: "toggle", default: true },
    program_writable: false,
  },
  value: true,
  source: "default",
}));

/// La cartella delle giornaliere come la dichiara `fub.template`
/// (`daily.folder`): il diario del banco sta in `Diario/`.
const DAY_FOLDER: readonly SettingEntry[] = DAY_PAGE ? [{
  spec: {
    key: "daily.folder",
    label: "Cartella delle note del giorno",
    description: "Dove nascono le note del giorno.",
    group: "Note del giorno",
    scope: "vault",
    kind: { kind: "text", default: "Daily" },
    program_writable: true,
  },
  value: "Diario",
  source: "vault",
}] : [];

/// Come la nota mostra le proprietà (`editor.properties`), come la voce
/// dell'host: di macchina, di serie `visible`. Le scene della testata (T6)
/// la cambiano con `?properties=visible|hidden|source`.
const PROPERTIES_PARAM = params.get("properties");
const PROPERTIES_CHOSEN = PROPERTIES_PARAM === "visible" || PROPERTIES_PARAM === "hidden" || PROPERTIES_PARAM === "source" ? PROPERTIES_PARAM : null;
const PROPERTIES_DISPLAY: readonly SettingEntry[] = [{
  spec: {
    key: "editor.properties",
    label: "Proprietà",
    description: "Come la nota mostra il frontmatter.",
    group: "Editor",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "visible",
      options: [
        { value: "visible", label: "In evidenza" },
        { value: "hidden", label: "Nascoste" },
        { value: "source", label: "Come YAML" },
      ],
    },
    program_writable: true,
  },
  value: PROPERTIES_CHOSEN ?? "visible",
  source: PROPERTIES_CHOSEN ? "machine" : "default",
}];

/// Le due preferenze delle formule (T63), come le voci dell'host: di
/// macchina, «Mostra il LaTeX» spenta e gli aiuti pieni di serie. Le scene
/// del campo del LaTeX le cambiano con `?mathsource=1` e
/// `?mathhelp=piene|discrete|spente`.
const MATH_SOURCE_CHOSEN = params.get("mathsource") === "1";
const MATH_HELP_PARAM = params.get("mathhelp");
const MATH_HELP_CHOSEN = MATH_HELP_PARAM === "piene" || MATH_HELP_PARAM === "discrete" || MATH_HELP_PARAM === "spente" ? MATH_HELP_PARAM : null;
/// Solo nelle scene che le chiedono: le altre (le Impostazioni) restano com'erano.
const MATH_SETTINGS: readonly SettingEntry[] = !params.has("mathsource") && !params.has("mathhelp") ? [] : [{
  spec: {
    key: "editor.math.source",
    label: "Mostra il LaTeX delle formule",
    description: "Accesa, sotto la formula toccata c'è il campo del suo LaTeX e si scrive lì.",
    group: "Editor",
    scope: "machine",
    kind: { kind: "toggle", default: false },
    program_writable: true,
  },
  value: MATH_SOURCE_CHOSEN,
  source: MATH_SOURCE_CHOSEN ? "machine" : "default",
}, {
  spec: {
    key: "editor.math.help",
    label: "Aiuti nel LaTeX delle formule",
    description: "Con «Mostra il LaTeX»: quanto aiuta il campo.",
    group: "Editor",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "piene",
      options: [
        { value: "piene", label: "Pieni" },
        { value: "discrete", label: "Discreti" },
        { value: "spente", label: "Spenti" },
      ],
    },
    program_writable: true,
  },
  value: MATH_HELP_CHOSEN ?? "piene",
  source: MATH_HELP_CHOSEN ? "machine" : "default",
}];

/// Le due preferenze della griglia (griglia T9), come le voci dell'host
/// (`editor.grid.copy-mark` ed `editor.grid.selection-speed` di
/// `crates/fub-host/src/settings.rs`): di macchina, di serie `dash-pulse` e
/// `normal`. Le hanno le scene delle cartelle (`?workbook=…`), dove le
/// scene dei gesti le cambiano con `?copia=dash|pulse` e
/// `?velocita=quick|soft|none`, e con `?grigliapref=1` le Impostazioni, per
/// guardarne la riga; le altre scene delle Impostazioni restano com'erano.
const GRID_COPY_PARAM = params.get("copia");
const GRID_COPY_CHOSEN = GRID_COPY_PARAM === "dash" || GRID_COPY_PARAM === "pulse" ? GRID_COPY_PARAM : null;
const GRID_SPEED_PARAM = params.get("velocita");
const GRID_SPEED_CHOSEN = GRID_SPEED_PARAM === "quick" || GRID_SPEED_PARAM === "soft" || GRID_SPEED_PARAM === "none" ? GRID_SPEED_PARAM : null;
const GRID_PREFERENCES: readonly SettingEntry[] = WORKBOOK_DOC === null && params.get("grigliapref") !== "1" ? [] : [{
  spec: {
    key: "editor.grid.copy-mark",
    label: "Segno della copia nei fogli di calcolo",
    description: "Che cosa resta sulle celle che copi: un tratteggio largo finché non incolli, un battito che si accende e svanisce, o tutti e due. Il taglio resta sempre un tratteggio fitto.",
    group: "Editor",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "dash-pulse",
      options: [
        { value: "dash-pulse", label: "Tratteggio e battito" },
        { value: "dash", label: "Solo il tratteggio" },
        { value: "pulse", label: "Solo il battito" },
      ],
    },
    program_writable: false,
  },
  value: GRID_COPY_CHOSEN ?? "dash-pulse",
  source: GRID_COPY_CHOSEN ? "machine" : "default",
}, {
  spec: {
    key: "editor.grid.selection-speed",
    label: "Velocità della selezione nei fogli di calcolo",
    description: "Come la selezione va alla cella nuova, coi tasti e col puntatore: scivola più svelta, come di norma o più morbida, oppure salta di cella in cella. Col movimento ridotto si ferma subito, qualunque sia la scelta.",
    group: "Editor",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "normal",
      options: [
        { value: "quick", label: "Svelta" },
        { value: "normal", label: "Come di norma" },
        { value: "soft", label: "Morbida" },
        { value: "none", label: "A scatti" },
      ],
    },
    program_writable: false,
  },
  value: GRID_SPEED_CHOSEN ?? "normal",
  source: GRID_SPEED_CHOSEN ? "machine" : "default",
}];

/// `?tessere=0|1`: la riga di macchina `map.tile-hosts` (Privacy), vuota o
/// col sito di prova della mappa (`?base=mappa`). Senza il parametro la riga
/// non c'è, e le altre scene restano com'erano.
const TILES_PARAM = params.get("tessere");
const MAP_TILE_SETTING: readonly SettingEntry[] = TILES_PARAM === null ? [] : [{
  spec: {
    key: "map.tile-hosts",
    label: "Tessere delle mappe",
    description: "I siti da cui la vista Mappa di una Base può scaricare le tessere, quando premi «Attiva». Vuota, le mappe restano offline e nessuna richiesta esce dal computer.",
    group: "Privacy",
    scope: "machine",
    kind: { kind: "list", default: [] },
    program_writable: false,
  },
  value: TILES_PARAM === "1" ? [MAP_TILE_SITE] : [],
  source: TILES_PARAM === "1" ? "machine" : "default",
}];

/// Una tessera di prova, disegnata qui: un riquadro chiaro con la griglia e
/// il suo indirizzo, come PNG. Le tessere sono immagini del fornitore e non
/// seguono la luce dell'app.
async function benchTile(url: string): Promise<ArrayBuffer> {
  const [z, x, y] = new URL(url).pathname.split("/").slice(1).map((part) => Number.parseInt(part, 10));
  const canvas = new OffscreenCanvas(256, 256);
  const pen = canvas.getContext("2d")!;
  pen.fillStyle = ((x ?? 0) + (y ?? 0)) % 2 === 0 ? "#dfeee2" : "#d6e6f2";
  pen.fillRect(0, 0, 256, 256);
  pen.strokeStyle = "#9bb5a3";
  pen.lineWidth = 2;
  pen.strokeRect(1, 1, 254, 254);
  pen.fillStyle = "#4f6f5a";
  pen.font = "28px sans-serif";
  pen.fillText(`${z}/${x}/${y}`, 16, 44);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

/// `?tipi=1`: il registro dei tipi del vault (`properties.types` di
/// `crates/fub-kernel/src/properties.rs`), per le scene di Selezione e Stato
/// (T9): la testata di `live=opzioni` e la Bacheca della Base per `stato`.
const PROPERTY_TYPES_SETTING: readonly SettingEntry[] = params.get("tipi") !== "1" ? [] : [{
  spec: {
    key: "properties.types",
    label: "Tipi delle proprietà",
    description: "Il tipo di ogni proprietà del vault, con le opzioni di Selezione e Stato.",
    group: "Proprietà",
    scope: "vault",
    kind: { kind: "text", default: "" },
    program_writable: true,
  },
  value: JSON.stringify({
    version: 1,
    types: { stato: "status", sala: "select", sito: "url", fase: "status", libri: "relation" },
    targets: { libri: "Biblioteca" },
    options: {
      stato: [
        { name: "Prenotata", color: "purple", group: "todo" },
        { name: "In viaggio", color: "orange", group: "doing" },
        { name: "In restauro", color: "blue", group: "doing" },
        { name: "Arrivata", color: "green", group: "done" },
      ],
      sala: [{ name: "Grande", color: "purple" }, { name: "Piccola", color: "pink" }],
      fase: [{ name: "Bozza", color: "yellow", group: "todo" }, { name: "Chiusa", color: "green", group: "done" }],
    },
  }),
  source: "vault",
}];

/// I componenti montati, per la scheda «Componenti» delle impostazioni.
///
/// `satisfies` è deliberato: queste fixture attraversano lo stesso confine
/// dell'host reale, quindi un campo nuovo nel contratto deve rompere il
/// type-check invece di arrivare come errore dentro una fotografia.
const BUNDLE = [
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
const KNOWN_VAULTS = [
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
const ORGANIZATION: Organization = {
  icons: ICONS,
  pinned: ["Benvenuto.md", "Guida/Sintassi di Fub.md"],
  order: {},
  spaces: ["Guida", "Diario", "Progetti"],
};

/// Un lavoro lungo **in corso**: è la sola scena in cui il centro attività ha
/// qualcosa dentro, e senza di lui la barra di stato si fotografa spenta.
const JOBS: JobStatus[] = [
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
const TAG = [
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
const NOTE_FACTS: Record<string, { tags: string[]; links: number; mtime: number }> = {
  "Benvenuto.md": BENVENUTO_FACTS,
  [LIVE_DOC]: BENVENUTO_FACTS,
};

/// I documenti nominati da una domanda ristretta (`theseDocuments`), o `null`
/// per una domanda su tutto il vault.
function askedDocs(expr: QueryExpr): string[] | null {
  if (expr.any.length === 0) return null;
  const docs = expr.any.flatMap((clause) => clause.all.flatMap((literal) =>
    !literal.negated && literal.predicate.kind === "docs" ? literal.predicate.docs : []));
  return docs.length > 0 ? docs : null;
}

/// La sezione di `text` sotto il titolo `heading`, titolo compreso, fino al
/// prossimo titolo dello stesso livello o più alto; senza titolo, tutto.
function embedSection(text: string, heading: string | null): string {
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
function embedBlock(text: string, block: string): string {
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
function plainHtml(markdown: string, fences = false, print = false): string {
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

function printComments(doc: string, html: string): string {
  let out = html;
  for (const [after, notes] of PRINT_COMMENTS[doc] ?? []) out = out.replace(after, `${after}${notes}`);
  return out;
}

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
      const source = BASE.files[BASE_DOC] ?? "";
      return {
        kind: "render_embed",
        value: {
          doc_id: q.page.includes("/") ? q.page : BASE_DOC,
          html: '<div class="ui-slot" data-ui-slot="0" data-custom-kind="base"></div>',
          parts: [{ slot: 0, kind: "base", node: { node: "custom", ns: "fub:base", payload: { source, view: q.heading ?? null, container: q.page.includes("/") ? q.page : BASE_DOC }, fallback: [] } }],
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
  // I titoli `#` di una nota del corpus, coi byte del sorgente: quelli che
  // «Sposta in…» offre come destinazione. Lo slug è quello semplice, minuscole
  // e trattini; una nota fuori dal corpus non ha titoli.
  outline: (q) => {
    const source = q.kind === "outline" ? (CORPUS[q.doc] ?? "") : "";
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
    return { kind: "outline", value };
  },
  jobs: () => ({ kind: "jobs", value: JOBS }),
};

/// Gli alberi delle view della scenografia, per id. Sono `UiNode` veri e li
/// disegna `ui/node.ts` vero: è la ragione per cui il pannello di destra si può
/// fotografare senza inventarsi del markup: **non c'è markup**, c'è un albero
/// del contratto e il renderer della shell.
const TREES: Record<string, UiNode> = {
  // La forma è quella del provider `outline` (fub-features): l'albero dei
  // titoli e, sotto, «In entrata» con le note che puntano qui (le tre del
  // prototipo, per la nota Benvenuto che il banco apre per prima).
  outline: {
    node: "stack",
    dir: "column",
    gap: 2,
    children: [
      {
        node: "tree",
        roots: [
          {
            node: "tree_item",
            label: "Sintassi di Fub",
            selected: false,
            expanded: true,
            action: { action: "goto", payload: 1 },
            children: [
              { node: "tree_item", label: "Titoli", selected: false, expanded: false, action: { action: "goto", payload: 2 }, children: [] },
              {
                node: "tree_item",
                label: "Testo",
                selected: false,
                expanded: true,
                action: { action: "goto", payload: 3 },
                children: [
                  { node: "tree_item", label: "Riferimenti", selected: false, expanded: false, action: { action: "goto", payload: 4 }, children: [] },
                ],
              },
              { node: "tree_item", label: "Tabella", selected: false, expanded: false, action: { action: "goto", payload: 5 }, children: [] },
              { node: "tree_item", label: "Codice", selected: false, expanded: false, action: { action: "goto", payload: 6 }, children: [] },
            ],
          },
        ],
      },
      {
        node: "section", title: "In entrata · 3", collapsed: false, key: "outline-incoming", children: [{
          node: "list",
          items: [
            { node: "list_item", title: "Sintassi di Fub", subtitle: "Guida", action: { action: "open", payload: { doc: "Guida/Sintassi di Fub.md" } }, selected: false, key: "Guida/Sintassi di Fub.md#0", drag: { kind: "document", doc: "Guida/Sintassi di Fub.md" } },
            { node: "list_item", title: "Il banco che vede", subtitle: "Progetti", action: { action: "open", payload: { doc: "Progetti/Il banco che vede.md" } }, selected: false, key: "Progetti/Il banco che vede.md#0", drag: { kind: "document", doc: "Progetti/Il banco che vede.md" } },
            { node: "list_item", title: "2026-08-19", subtitle: "Diario", action: { action: "open", payload: { doc: "Diario/2026-08-19.md" } }, selected: false, key: "Diario/2026-08-19.md#0", drag: { kind: "document", doc: "Diario/2026-08-19.md" } },
          ],
        }],
      },
    ],
  },
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
/// struttura soltanto «In entrata»: le voci dell'albero sono i titoli della nota.
function treeOf(view: string): UiNode | undefined {
  const tree = TREES[view];
  if (!tree || view !== "outline") return tree && inShellLanguage(tree);
  if (tree.node !== "stack") return tree;
  return { ...tree, children: tree.children.map((child) => (child.node === "tree" ? child : inShellLanguage(child))) };
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
      if (id === WORKBOOK_DOC && lastSized !== null) savedSized = lastSized;
      return written;
    },
    openGridBytes: async (surface, doc, journal, base) => {
      const session = await behind.openGridBytes(surface, doc, journal, base);
      if (journal !== "" || savedSized === null) return session;
      sizedCommands = [];
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
