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
// Il cuore è `src/host/finto.ts`, che è già l'host finto degli e2e e risponde a
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
import { createFakeHost, type Options } from "../src/host/fake";
import { MARKDOWN_SYNTAX } from "../src/rules/syntax.generated";
import type {
  BundleInfo,
  CommandSpec,
  IndexQuery,
  IndexResult,
  JobStatus,
  KnownVault,
  Organization,
  SettingEntry,
  UiNode,
  ViewSpec,
} from "../src/host/contract";
import { CORPUS, OUTPUT } from "./corpus";

// ---------------------------------------------------------------------------
// Ciò che il banco decide dalla query string.
// ---------------------------------------------------------------------------

const params = new URLSearchParams(globalThis.window.location.search);

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
    open_by_default: true,
    preferred_size: null,
    closable: false,
  };
}

const VIEWS: ViewSpec[] = [
  view("outline", "Struttura", "right_sidebar", "list", 0),
  view("backlinks", "Backlink", "right_sidebar", "link", 1),
  view("properties", "Proprietà", "right_sidebar", "tag", 2),
  view("tags", "Tag", "left_sidebar", "tag", 0),
  view("graph", "Grafo", "main", "graph", 0),
  view("trash", "Cestino", "left_sidebar", "trash", 1),
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
  command("note.create", "Crea una nota", "Una nota nuova nella cartella corrente", "Mod-n", true),
  command("note.rename", "Rinomina la nota", "Cambia il nome del documento aperto", "Mod-Shift-r", true),
  command("note.trash", "Cestina la nota", "Sposta il documento nel cestino", null, true),
  command("search.open", "Cerca nel vault", "Apre il pannello di ricerca", null),
  command("daily.open", "Apri la nota di oggi", "Il diario del giorno, creandolo se manca", "Mod-Shift-d", true),
  command("vault.undo", "Annulla l'ultima operazione", "La pila strutturale", "Mod-Alt-z", true),
  command("trash.empty", "Svuota il cestino", "Cancella davvero ciò che è cestinato", null, true),
  command("stats.open", "Statistiche del documento", "Parole, caratteri, collegamenti", null),
];

/// Le settings: una per **ogni** specie di `SettingKind`, perché il pannello
/// disegna un controllo diverso per ciascuna e una scena che ne mostrasse solo
/// due fotograferebbe metà del form.
const SETTINGS: SettingEntry[] = [
  {
    spec: {
      key: "appearance.theme",
      label: "Tema",
      description: "In che luce si guarda Fub. Vuoto = come il sistema.",
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
      key: "appearance.density",
      label: "Densità",
      description: "Compatta o allarga la spaziatura dei componenti senza muovere la scocca.",
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
      key: "appearance.body",
      label: "Corpo del testo (px)",
      description: "Dimensione del testo nelle superfici di lettura.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 16, min: 12, max: 28 },
      program_writable: false,
    },
    value: 16,
    source: "default",
  },
  {
    spec: {
      key: "appearance.line-height",
      label: "Interlinea",
      description: "Passo verticale della prosa lunga.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 1.7, min: 1.2, max: 2.4 },
      program_writable: false,
    },
    value: 1.7,
    source: "default",
  },
  {
    spec: {
      key: "appearance.measure",
      label: "Misura della riga (caratteri)",
      description: "Larghezza massima della colonna di lettura.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 70, min: 40, max: 100 },
      program_writable: false,
    },
    value: 70,
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
        default: "literata",
        options: [
          { value: "literata", label: "Literata" },
          { value: "inter", label: "Inter" },
          { value: "system", label: "Del sistema" },
        ],
      },
      program_writable: false,
    },
    value: "literata",
    source: "default",
  },
  {
    spec: {
      key: "appearance.accent",
      label: "Tinta dell'accento (0–360)",
      description: "Tinta OKLCH; chiarezza e croma vengono derivati per mantenere il contrasto.",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "number", default: 130, min: 0, max: 360 },
      program_writable: false,
    },
    value: 130,
    source: "default",
  },
  {
    spec: {
      key: "appearance.zoom",
      label: "Zoom interfaccia",
      description: "Scala nativa della finestra, da 0,5 a 2.",
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
// La scenografia: le risposte del canale dati che `finto.ts` non dà.
// ---------------------------------------------------------------------------

/// L'organizzazione del vault: due note appuntate, tre icone, uno spazio. Il
/// finto risponde tutto vuoto — che è onesto e invisibile.
const ORGANIZATION: Organization = {
  icons: { "Benvenuto.md": "👋", Guida: "📘", Diario: "📅" },
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
/// Ciò che non è qui dentro passa a `finto.ts` **intatto**, regola del lancio
/// compresa: un banco che rispondesse a tutto non direbbe più quale query la
/// shell ha imparato a fare da sola.
const RESPONSES: Partial<Record<IndexQuery["kind"], (q: IndexQuery) => IndexResult>> = {
  render_preview: (q) => {
    const doc = (q as { doc: string }).doc;
    const html = OUTPUT[doc] ?? `<p>${(CORPUS[doc] ?? "").split("\n")[0] ?? ""}</p>`;
    return { kind: "render_preview", value: { html, parts: [] } };
  },
  tags: () => ({ kind: "tags", value: { items: TAG, offset: 0, total: TAG.length } }),
  organization: () => ({ kind: "organization", value: ORGANIZATION }),
  jobs: () => ({ kind: "jobs", value: JOBS }),
};

/// Gli alberi delle view della scenografia, per id. Sono `UiNode` veri e li
/// disegna `ui/node.ts` vero: è la ragione per cui il pannello di destra si può
/// fotografare senza inventarsi del markup: **non c'è markup**, c'è un albero
/// del contratto e il renderer della shell.
const TREES: Record<string, UiNode> = {
  outline: {
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
  backlinks: {
    node: "list",
    items: [
      { node: "list_item", title: "Benvenuto", subtitle: "…sta in [[Sintassi di Fub]], i colori…", action: { action: "open", payload: "Benvenuto.md" }, selected: false },
      { node: "list_item", title: "Il banco che vede", subtitle: "…Vedi anche [[Sintassi di Fub]] e una…", action: { action: "open", payload: "Progetti/Il banco che vede.md" }, selected: false },
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
  trash: {
    node: "empty_state",
    title: "Il cestino è vuoto",
    detail: "Ciò che si cestina resta qui finché non lo si svuota.",
    action: null,
  },
  graph: {
    node: "custom",
    ns: "fub:graph",
    payload: {
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
};

// ---------------------------------------------------------------------------
// La porta.
// ---------------------------------------------------------------------------

const options: Options = {
  file: CORPUS,
  extensions: ["md", "fubsheet"],
  root: ROOT,
  view: VIEWS,
  commands: BENCH_COMMANDS,
  settings: SETTINGS,
  syntaxForms: [...MARKDOWN_SYNTAX],
};

const host = createFakeHost(options);

/// L'host del banco, esposto sulla finestra perché il **fotografo** possa
/// guidarlo da fuori: emettere un evento del kernel, guastare una porta,
/// frenarla. Sono i tre gesti che una scena non può fare cliccando — un avviso
/// non ha un bottone che lo produca — e senza di loro tre scene su diciotto non
/// esisterebbero.
///
/// Sta su `window` e non in un `export` perché chi la chiama è Playwright, cioè
/// codice che non condivide il grafo dei moduli con la pagina.
declare global {
  interface Window {
    bench: {
      emit: typeof host.emit;
      fault: typeof host.fault;
      throttle: typeof host.throttle;
      calls: typeof host.calls;
      light: "dark" | "light";
    };
  }
}

globalThis.window.bench = {
  emit: host.emit,
  fault: host.fault,
  throttle: host.throttle,
  calls: host.calls,
  light: LIGHT,
};

const behind = host.module.api;

export const api: typeof host.module.api = {
  ...behind,
  queryIndex: (q) => {
    const response = RESPONSES[q.kind];
    return response ? Promise.resolve(response(q)) : behind.queryIndex(q);
  },
  renderView: (view, instance, params) => {
    const tree = TREES[view];
    return tree ? Promise.resolve(tree) : behind.renderView(view, instance, params);
  },
  // Un'azione di una view della scenografia non fa niente e **lo dice
  // ridisegnando l'albero di prima**: è la risposta minima che il protocollo
  // accetta, e non un `throw` — un click di troppo durante una scena non deve
  // far morire una foto.
  viewAction: (view, instance, params, action, payload, fields) => {
    const tree = TREES[view];
    if (!tree) return behind.viewAction(view, instance, params, action, payload, fields);
    return Promise.resolve({ kind: "replace" as const, root: tree });
  },
  listBundles: () => Promise.resolve(BUNDLE),
  knownVaults: () => Promise.resolve(KNOWN_VAULTS),
};

export const onKernelEvent = host.module.onKernelEvent;
export const onClose = host.module.onClose;
export const window = host.module.window;
