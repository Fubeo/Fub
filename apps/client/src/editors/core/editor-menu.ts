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
