// La porta del banco: ciò che `src/host/ipc.ts` diventa quando a girare è il
// banco e non l'app.
//
// # Come si sostituisce
//
// Non c'è nessun `if (banco)` da nessuna parte nella shell, e non ce n'è uno
// qui: la sostituzione la fa `vite.banco.config.ts` con un `resolve.alias` su
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
// Quindi qui sopra a `finto.ts` c'è una **scenografia**: le risposte delle
// feature che il banco mette in scena. Non è un host più accomodante — è un
// allestimento, e la differenza sta in cosa se ne conclude: da una foto si
// conclude qualcosa sul CSS, mai sul comportamento del kernel.
//
// Ciò che la scenografia aggiunge è enumerato in `RISPOSTE` e in `ALBERI`, in un
// posto solo, così si legge cosa il banco finge senza cercarlo.
//
// # La luce arriva dalla query string
//
// `?luce=dark|light`. Va decisa **prima** del primo fotogramma, o si fotografa
// mezzo montaggio: `theme.ts` applica la cache di `localStorage` all'avvio e
// poi rilegge l'impostazione dal canale dati, quindi il banco scrive tutte e
// due — la cache qui sotto, prima che `main.ts` giri, e il valore di
// `appearance.theme` fra le impostazioni che serve.
import { creaHostFinto, type Opzioni } from "../src/host/finto";
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
import { CORPUS, RESA } from "./corpus";

// ---------------------------------------------------------------------------
// Ciò che il banco decide dalla query string.
// ---------------------------------------------------------------------------

const parametri = new URLSearchParams(window.location.search);

/// La luce da fotografare. Il ripiego è lo scuro, che è la luce in cui Fub è
/// sempre stato — la stessa scelta di `theme.ts`.
export const LUCE: "dark" | "light" = parametri.get("luce") === "light" ? "light" : "dark";

/// Il vault che si apre: nessuno con `?vault=vuoto`, che è la scena della
/// finestra senza vault — l'unica in cui metà delle superfici non esiste, e
/// l'unica che si fotografa per vedere cosa resta.
const RADICE = parametri.get("vault") === "vuoto" ? null : "/Vault del banco";

// `theme.ts` legge questa chiave prima di chiedere qualunque cosa al canale
// dati. Scriverla qui — cioè all'`import` di questo modulo, che Vite mette
// prima di `main.ts` perché `main.ts` lo importa — è ciò che evita il mezzo
// fotogramma nella luce sbagliata.
try {
  window.localStorage.setItem("fub.appearance.theme", LUCE);
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
function vista(
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

const VISTE: ViewSpec[] = [
  vista("outline", "Struttura", "right_sidebar", "list", 0),
  vista("backlinks", "Backlink", "right_sidebar", "link", 1),
  vista("properties", "Proprietà", "right_sidebar", "tag", 2),
  vista("tags", "Tag", "left_sidebar", "tag", 0),
  vista("graph", "Grafo", "main", "graph", 0),
  vista("trash", "Cestino", "left_sidebar", "trash", 1),
];

/// Un `CommandSpec` di lettura, che è la forma della gran parte.
function comando(
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
const COMANDI_DEL_BANCO: CommandSpec[] = [
  comando("note.create", "Crea una nota", "Una nota nuova nella cartella corrente", "Mod-n", true),
  comando("note.rename", "Rinomina la nota", "Cambia il nome del documento aperto", "Mod-Shift-r", true),
  comando("note.trash", "Cestina la nota", "Sposta il documento nel cestino", null, true),
  comando("search.open", "Cerca nel vault", "Apre il pannello di ricerca", null),
  comando("daily.open", "Apri la nota di oggi", "Il diario del giorno, creandolo se manca", "Mod-Shift-d", true),
  comando("vault.undo", "Annulla l'ultima operazione", "La pila strutturale", "Mod-Alt-z", true),
  comando("trash.empty", "Svuota il cestino", "Cancella davvero ciò che è cestinato", null, true),
  comando("stats.open", "Statistiche del documento", "Parole, caratteri, collegamenti", null),
];

/// Le impostazioni: una per **ogni** specie di `SettingKind`, perché il pannello
/// disegna un controllo diverso per ciascuna e una scena che ne mostrasse solo
/// due fotograferebbe metà del form.
const IMPOSTAZIONI: SettingEntry[] = [
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
    value: LUCE,
    source: "machine",
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
const BUNDLE: BundleInfo[] = [
  { id: "fub.core", name: "Core", mounted: true, trust: "core" },
  { id: "fub.outline", name: "Struttura", mounted: true, trust: "core" },
  { id: "fub.graph", name: "Grafo", mounted: true, trust: "core" },
  { id: "fub.versioning", name: "Versioni", mounted: false, trust: "core" },
] as BundleInfo[];

/// I vault che questa macchina conosce, per la scheda «Vault».
const VAULT_CONOSCIUTI = [
  { path: "/Vault del banco", name: "Vault del banco", icon: "📷", favorite: true, last_opened: 0 },
  { path: "/Appunti", name: "", icon: null, favorite: false, last_opened: 0 },
] as unknown as KnownVault[];

// ---------------------------------------------------------------------------
// La scenografia: le risposte del canale dati che `finto.ts` non dà.
// ---------------------------------------------------------------------------

/// L'organizzazione del vault: due note appuntate, tre icone, uno spazio. Il
/// finto risponde tutto vuoto — che è onesto e invisibile.
const ORGANIZZAZIONE: Organization = {
  icons: { "Benvenuto.md": "👋", Guida: "📘", Diario: "📅" },
  pinned: ["Benvenuto.md", "Guida/Sintassi di Fub.md"],
  order: {},
  spaces: ["Guida", "Diario", "Progetti"],
};

/// Un lavoro lungo **in corso**: è la sola scena in cui il centro attività ha
/// qualcosa dentro, e senza di lui la barra di stato si fotografa spenta.
const LAVORI: JobStatus[] = [
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
const RISPOSTE: Partial<Record<IndexQuery["kind"], (q: IndexQuery) => IndexResult>> = {
  render_preview: (q) => {
    const doc = (q as { doc: string }).doc;
    const html = RESA[doc] ?? `<p>${(CORPUS[doc] ?? "").split("\n")[0] ?? ""}</p>`;
    return { kind: "render_preview", value: { html, parts: [] } };
  },
  tags: () => ({ kind: "tags", value: { items: TAG, offset: 0, total: TAG.length } }),
  organization: () => ({ kind: "organization", value: ORGANIZZAZIONE }),
  jobs: () => ({ kind: "jobs", value: LAVORI }),
};

/// Gli alberi delle view della scenografia, per id. Sono `UiNode` veri e li
/// disegna `ui/node.ts` vero: è la ragione per cui il pannello di destra si può
/// fotografare senza inventarsi del markup: **non c'è markup**, c'è un albero
/// del contratto e il renderer della shell.
const ALBERI: Record<string, UiNode> = {
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

const opzioni: Opzioni = {
  file: CORPUS,
  radice: RADICE,
  view: VISTE,
  comandi: COMANDI_DEL_BANCO,
  impostazioni: IMPOSTAZIONI,
};

const host = creaHostFinto(opzioni);

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
    banco: {
      emetti: typeof host.emetti;
      guasta: typeof host.guasta;
      frena: typeof host.frena;
      chiamate: typeof host.chiamate;
      luce: "dark" | "light";
    };
  }
}

window.banco = {
  emetti: host.emetti,
  guasta: host.guasta,
  frena: host.frena,
  chiamate: host.chiamate,
  luce: LUCE,
};

const dietro = host.modulo.api;

export const api: typeof host.modulo.api = {
  ...dietro,
  queryIndex: (q) => {
    const risposta = RISPOSTE[q.kind];
    return risposta ? Promise.resolve(risposta(q)) : dietro.queryIndex(q);
  },
  renderView: (view, instance, params) => {
    const albero = ALBERI[view];
    return albero ? Promise.resolve(albero) : dietro.renderView(view, instance, params);
  },
  // Un'azione di una view della scenografia non fa niente e **lo dice
  // ridisegnando l'albero di prima**: è la risposta minima che il protocollo
  // accetta, e non un `throw` — un click di troppo durante una scena non deve
  // far morire una foto.
  viewAction: (view, instance, params, action, payload, fields) => {
    const albero = ALBERI[view];
    if (!albero) return dietro.viewAction(view, instance, params, action, payload, fields);
    return Promise.resolve({ kind: "replace" as const, root: albero });
  },
  listBundles: () => Promise.resolve(BUNDLE),
  knownVaults: () => Promise.resolve(VAULT_CONOSCIUTI),
};

export const onKernelEvent = host.modulo.onKernelEvent;
export const allaChiusura = host.modulo.allaChiusura;
export const finestra = host.modulo.finestra;
