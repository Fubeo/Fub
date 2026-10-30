// Il menu dell'editor: ciò che una superficie offre al tasto destro, detto
// come dati.
//
// La superficie sa cosa c'è sotto il puntatore — una parola segnata, un link,
// una cella, un nodo — e quali dei suoi gesti valgono lì; la shell sa come si
// disegna un menu e in che ordine stanno le sue parti (`panels/editor-menu.ts`).
// Fra le due passano soltanto id, testi, booleani e funzioni senza argomenti:
// nessun DOM, nessun oggetto CodeMirror.
//
// # Le sezioni
//
// Ogni menu dell'editor ha la stessa anatomia, nello stesso ordine, e una
// sezione vuota non c'è: ciò che sta sotto il puntatore (`context`), gli
// appunti (`clipboard`), il formato (`format`, `transform`, `edit`), cosa
// inserire (`insert`), i comandi del vault (`commands`) e le utilità (`tail`).
//
// # Le voci
//
// Una voce scritta come stringa è un id che la shell risolve: un'azione
// dell'editor che la superficie conosce (nome dal comando che la dichiara,
// icona, stato e accordo come nella barra di formattazione) o un comando della
// shell o del registro (nome, accordo e disponibilità come nella palette). Un
// id che adesso non si risolve non si vede. Una voce scritta come oggetto porta
// il suo nome e il suo gesto, con un id stabile per chi la cerca.

import type { SelectionBox } from "./editor-actions";

/// Che cosa sta sotto il puntatore: dice alla shell quali voci comuni hanno
/// senso, e ai plugin su cosa agiscono.
export type SurfaceMenuTargetKind =
  | "text"
  | "selection"
  | "link"
  | "image"
  | "table"
  | "heading"
  | "list"
  | "code"
  | "properties"
  | "cell"
  | "row"
  | "column"
  | "corner"
  | "sheet"
  | "object"
  | "node"
  | "edge"
  | "group"
  | "empty"
  | "page"
  | "media";

export interface SurfaceMenuItem {
  /// L'id stabile della voce: un'azione, un comando, o un nome della superficie.
  readonly id: string;
  readonly label: string;
  /// Il nome di un'icona del repertorio (`ui/icons.ts`).
  readonly icon?: string;
  /// L'accordo con cui lo stesso gesto si fa da tastiera, nella sintassi delle
  /// scorciatoie (`Mod-b`).
  readonly chord?: string | null;
  readonly description?: string;
  /// Assente vale vero. Una voce spenta si vede e dice perché in `description`.
  readonly enabled?: boolean;
  readonly danger?: boolean;
  /// Una voce che commuta: il suo stato adesso.
  readonly checked?: boolean;
  /// Un sottomenu.
  readonly items?: readonly SurfaceMenuEntry[];
  readonly run?: () => void;
  /// Un comando della palette da eseguire dopo `run`, o al suo posto: «Modifica
  /// da qui» porta il cursore e poi chiede alla shell di cambiare modalità.
  readonly command?: string;
}

export type SurfaceMenuEntry = string | SurfaceMenuItem;

/// Un gesto degli appunti, eseguito dalla superficie sui suoi dati.
export type SurfaceClipboardOp = "cut" | "copy" | "paste" | "paste-plain" | "select-all";

export interface SurfaceMenuClipboard {
  /// I gesti offerti qui, e se adesso si possono fare: una chiave assente non
  /// si vede, una falsa si vede spenta.
  readonly offers: Readonly<Partial<Record<SurfaceClipboardOp, boolean>>>;
  run(op: SurfaceClipboardOp): void;
  /// «Copia come ▸»: i formati in cui la superficie sa copiare la selezione.
  readonly copyAs?: readonly SurfaceMenuItem[];
}

export interface SurfaceMenu {
  readonly target: { readonly kind: SurfaceMenuTargetKind; readonly ref?: string };
  /// Dove aprire il menu quando la richiesta non porta un punto (il tasto
  /// Menu, Maiusc+F10): sotto il cursore o la cosa scelta, in coordinate della
  /// finestra. Senza, il menu si apre sul riquadro.
  readonly at?: { readonly x: number; readonly y: number };
  /// La sezione 1: le voci per ciò che sta sotto il puntatore, le correzioni
  /// del correttore per prime.
  readonly context?: readonly SurfaceMenuEntry[];
  readonly clipboard?: SurfaceMenuClipboard;
  /// «Formato ▸»: i gesti sul carattere.
  readonly format?: readonly SurfaceMenuEntry[];
  /// «Trasforma in ▸»: i gesti sul blocco.
  readonly transform?: readonly SurfaceMenuEntry[];
  /// Le voci di formato che stanno al primo livello (Paragrafo…, Formato celle…).
  readonly edit?: readonly SurfaceMenuEntry[];
  /// «Inserisci ▸».
  readonly insert?: readonly SurfaceMenuEntry[];
  /// Offre «Comandi ▸»: i comandi del registro dichiarati per il «/».
  readonly commands?: boolean;
  /// La nota o il file del vault sotto il puntatore, per le voci dei plugin.
  readonly note?: { readonly kind: "note" | "file"; readonly id: string } | null;
  /// La sezione 6: le utilità, in fondo.
  readonly tail?: readonly SurfaceMenuEntry[];
  /// La superficie vuole la mini-barra sopra il menu: si formatta qui.
  readonly miniBar?: boolean;
}

/// La mini-barra di una superficie con controlli suoi (un documento di Word,
/// un foglio): la monta nel contenitore e torna come smontarla.
export interface SurfaceMiniBar {
  mount(host: HTMLElement): () => void;
}

/// Le sezioni del menu «/» nel testo, nell'ordine in cui si vedono.
export type SlashSection =
  | "suggested" | "favorites" | "recent" | "text" | "lists" | "blocks" | "code"
  | "media" | "people" | "style" | "page" | "vault";

/// Il passo che una voce con «›» apre nello stesso riquadro.
export type SlashPicker = "table" | "color" | "date" | "callout" | "note" | "embed" | "code" | "diagram";

/// Una voce del menu «/» nel testo, già filtrata e ordinata dalla shell
/// (`panels/slash/entries.ts`): la superficie la disegna e, scelta, la esegue.
export interface SlashMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /// Il nome di un'icona del repertorio, o `""`.
  readonly icon: string;
  /// A destra: la scorciatoia Markdown (`#`, `- [ ]`) o l'accordo.
  readonly hint: string | null;
  readonly section: SlashSection;
  /// Un'azione dell'editor che la superficie esegue da sé; altrimenti un
  /// comando del registro, che esegue la shell.
  readonly action: boolean;
  /// La voce apre un passo invece di eseguirsi subito.
  readonly picker: SlashPicker | null;
  /// Gli argomenti già detti, per un comando rapido («/tab 3x4»).
  readonly params: Readonly<Record<string, unknown>>;
  /// Un comando rapido, scritto con gli argomenti.
  readonly quick: boolean;
  /// La parte del nome che risponde a ciò che si è scritto.
  readonly span: readonly [number, number] | null;
  /// Trovata per le iniziali o con un errore di battitura.
  readonly why: "iniziali" | "forse" | null;
}

/// Dove si scrive il «/»: lo dice la superficie, lo usano la testata e i
/// Suggeriti.
export interface SlashPlace {
  /// Su una riga vuota il blocco scelto prende la riga; dopo del testo ne
  /// nasce uno sotto.
  readonly line: "empty" | "after-text";
  /// Il blocco sopra il cursore.
  readonly above: "heading" | "task" | "list" | "quote" | "paragraph" | null;
  /// Il cursore sta in un elenco.
  readonly inList: boolean;
}

/// Una scelta fatta nel pannello: la voce, i suoi argomenti (dal passo o dal
/// comando rapido) e se il blocco va sotto (⇧↵).
export interface SlashChoice {
  readonly entry: SlashMenuEntry;
  readonly params: Readonly<Record<string, unknown>>;
  readonly below: boolean;
}

/// Il «/» su una selezione: il pannello diventa «Trasforma».
export interface SlashTransform {
  /// Quante righe sono scelte.
  readonly lines: number;
  /// Il testo scelto, com'è.
  readonly before: string;
  /// Il testo dopo l'azione `id`, senza eseguirla; `null` se non cambia
  /// niente o se l'azione non sa farlo.
  after(id: string): string | null;
}

/// Ciò che il pannello dice alla superficie, e ciò che le chiede.
export interface SlashPanelEvents {
  choose(choice: SlashChoice): void;
  /// Esc: il pannello si chiude e il «/testo» resta.
  dismiss(): void;
  /// La voce attiva è cambiata: la superficie aggiorna `aria-activedescendant`.
  active(id: string | null): void;
  /// I titoli della pagina, per l'anteprima dell'Indice.
  outline(): readonly { readonly level: number; readonly text: string }[];
  /// Ctrl+/, o Invio senza risultati: la palette di tutti i comandi, con ciò
  /// che si è scritto.
  palette(query: string): void;
  /// Presente quando il «/» agisce su una selezione.
  readonly transform?: SlashTransform;
}

/// Il pannello del «/», disegnato dalla shell coi pezzi del kit: la
/// superficie lo posa accanto al cursore e gli passa ciò che si scrive.
export interface SlashPanel {
  readonly dom: HTMLElement;
  /// L'id dell'elenco, per `aria-controls`.
  readonly listId: string;
  /// Ciò che si è scritto dopo il «/» è cambiato.
  update(query: string, place: SlashPlace): void;
  /// Un tasto mentre il pannello è aperto: `true` se l'ha preso.
  key(event: KeyboardEvent): boolean;
  /// Posato sotto o sopra il cursore, dentro il contenitore dei tooltip;
  /// `caretX` è dove sta il cursore, in coordinate del pannello: l'entrata
  /// nasce da lì. Torna a ogni nuova posa; l'entrata parte la prima volta.
  placed(above: boolean, caretX: number): void;
  /// Chiude, con la sua uscita.
  close(): void;
}

/// Ciò che la shell dà alla superficie per il menu «/» nel testo.
export interface SlashMenuHost {
  /// L'impostazione `editor.slash`: spenta, il «/» è testo.
  enabled(): boolean;
  /// Un pannello nuovo. `has` dice quali azioni dell'editor la superficie sa
  /// eseguire adesso.
  panel(events: SlashPanelEvents, has: (id: string) => boolean): SlashPanel;
  /// Una voce è stata scelta, e il «/query» è già sparito: la shell la
  /// ricorda fra i recenti e, se è un comando, lo esegue accanto al cursore
  /// (`anchor`) dell'editor che sta in `owner`.
  chosen(entry: SlashMenuEntry, owner: HTMLElement, anchor: SelectionBox | null, selection?: string): void;
  /// La palette di tutti i comandi accanto al cursore, già filtrata da
  /// `query`.
  palette(query: string, owner: HTMLElement, anchor: SelectionBox | null): void;
}
