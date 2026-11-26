// La porta del banco (`fake-ipc.ts`): viste, comandi e impostazioni.
import { COMPONENT_SCENARIO } from "../src/host/fake";
import type { CommandSpec, SettingEntry, ViewSpec } from "../src/host/contract";
import { SPECS as SLASH_SPECS } from "../src/panels/slash/fixture.test-data";
import { treeSceneSetting } from "./craft-fixture";
import { MAP_TILE_SITE } from "./base-fixture";
import { deskCase, deskScene } from "./desk-scene";
import { params } from "./fake-ipc-casi";
import { WORKBOOK_DOC } from "./fake-ipc-griglia";
import { TREE_SCENE, DAY_PAGE, TYPE_PAGE } from "./fake-ipc-documenti";
import { INDICE_PARAM, MOTORE_PARAM, LIGHT } from "./fake-ipc-disegno";

// ---------------------------------------------------------------------------
// L'allestimento: view, comandi, impostazioni.
// ---------------------------------------------------------------------------

/// Una `ViewSpec` piena. Le view del banco sono quelle che `fub-features`
/// registra davvero, coi loro id veri (`fub_features::*::*_VIEW`): un tema che
/// veste `#views-right` deve vestire *quelle*, non dei nomi inventati.
export function view(
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
export const DESK = DESK_CASE === null ? null : deskScene(DESK_CASE);

export const VIEWS: ViewSpec[] = [
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
export function command(
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
export const BENCH_COMMANDS: CommandSpec[] = [
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
export const NEW_FILE_COMMANDS: CommandSpec[] = params.get("nuovo") === "tutto"
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
export const ON_MOBILE = globalThis.window.location.pathname.endsWith("/mobile.html") || params.get("formatbar") === "1";
export const FORMAT_COMMANDS: CommandSpec[] = (
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
export const SLASH_COMMANDS: readonly CommandSpec[] = params.get("slash") === "1" ? SLASH_SPECS : [];

/// `?toolbar=nascosta`: la forma della barra di formato scelta (`editor.toolbar`
/// di `crates/fub-host/src/settings.rs`), per le scene della mini-barra (T12).
/// Senza, l'impostazione non c'è e la barra ha la forma di serie.
const TOOLBAR_FORM = params.get("toolbar");
export const TOOLBAR_SETTING_ROW: readonly SettingEntry[] = TOOLBAR_FORM === null ? [] : [{
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
export const ON_SHELL = globalThis.window.location.pathname.endsWith("/index.html");
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

export const SETTINGS: SettingEntry[] = [
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
export const DRAW_WORKSPACE: readonly SettingEntry[] = [
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
export const COMPONENT_SCENARIO_MOTORE_SPENTO = (() => {
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
export const DRAW_SAVED_WORKSPACES: readonly SettingEntry[] = [
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
export const DRAW_KEYS: readonly SettingEntry[] =
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
export const DRAW_ENGINE_PREFS: readonly SettingEntry[] =
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
export const CRAFT_SETTINGS: readonly SettingEntry[] = params.get("craft") === "1" || TREE_SCENE !== null
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
export const WORKBOOK_CHROME: readonly SettingEntry[] = WORKBOOK_DOC === null ? [] : [
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
export const DAY_FOLDER: readonly SettingEntry[] = DAY_PAGE ? [{
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
export const PROPERTIES_DISPLAY: readonly SettingEntry[] = [{
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
export const MATH_SETTINGS: readonly SettingEntry[] = !params.has("mathsource") && !params.has("mathhelp") ? [] : [{
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
export const GRID_PREFERENCES: readonly SettingEntry[] = WORKBOOK_DOC === null && params.get("grigliapref") !== "1" ? [] : [{
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
export const TILES_PARAM = params.get("tessere");
export const MAP_TILE_SETTING: readonly SettingEntry[] = TILES_PARAM === null ? [] : [{
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
export async function benchTile(url: string): Promise<ArrayBuffer> {
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
export const PROPERTY_TYPES_SETTING: readonly SettingEntry[] = params.get("tipi") !== "1" ? [] : [{
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
