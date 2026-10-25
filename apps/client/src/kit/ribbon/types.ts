// La forma delle schede di una barra multifunzione: schede, gruppi, colonne e
// controlli, come li disegna `ribbon.ts` qui accanto.
//
// È una dichiarazione e non sa di chi è: `V` è la vista che i controlli
// leggono (la cella attiva di un foglio, il paragrafo di un documento), `K`
// sono le chiavi delle etichette di chi la dichiara. Un controllo si vede se
// il catalogo serve il suo comando, e si spegne con la ragione del catalogo
// quando il comando è spento.

/// I parametri di un comando, che diventano il suo testo JSON.
export type Params = Readonly<Record<string, unknown>>;

/// Un testo da mostrare: una chiave del catalogo, o un valore com'è (il nome
/// di una funzione, di un carattere, di un foglio).
export type Text<K extends string> = K | { readonly raw: string };

/// Una voce di menu: un comando con i suoi parametri, una finestra, un testo
/// da cominciare, o un menu più in là.
export interface MenuEntry<K extends string> {
  readonly label: Text<K>;
  readonly id?: string;
  readonly params?: Params;
  /// Apre questa finestra con `params` invece di dare il comando `id`.
  readonly dialog?: string;
  /// Scrive questo testo dove si scrive invece di dare un comando.
  readonly write?: string;
  /// Un menu che si apre al posto di questo, con i comandi che lo fanno vedere.
  readonly submenu?: () => readonly MenuEntry<K>[] | Promise<readonly MenuEntry<K>[]>;
  readonly requires?: readonly string[];
  readonly icon?: string;
  readonly swatches?: readonly string[];
  readonly description?: string;
  readonly separator?: boolean;
  readonly checked?: boolean;
  readonly choice?: "radio" | "checkbox";
}

/// Ciò che ogni controllo ha.
export interface ControlBase<V, K extends string> {
  readonly label: K;
  /// I tasti dopo la lettera della scheda.
  readonly keytip: string;
  /// Un'icona del repertorio, o un segno scritto come «B».
  readonly icon?: string;
  readonly glyph?: string;
  /// Grande: icona sopra il nome. Piccolo: in una fila, con il nome soltanto
  /// se `labelled`.
  readonly size?: "large" | "small";
  readonly labelled?: boolean;
  /// Una classe in più sul controllo, per il segno («grassetto»).
  readonly className?: string;
  /// Si vede soltanto se vale, oltre al catalogo: un controllo che serve a un
  /// tipo di oggetto e non agli altri.
  readonly when?: (view: V) => boolean;
}

/// Un pulsante che dà un comando; `pressed` lo fa interruttore.
export interface ButtonControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "button";
  readonly id: string;
  readonly params?: Params | ((view: V) => Params);
  /// Apre questa finestra con `params` invece di dare il comando `id`; la
  /// finestra può dipendere dallo stato.
  readonly dialog?: string | ((view: V) => string);
  /// Chiede alla shell un'azione sua invece di dare il comando `id`, che
  /// resta la condizione perché il pulsante si veda.
  readonly shell?: string;
  readonly pressed?: (view: V) => boolean;
}

/// Un pulsante diviso: la parte grande dà il comando, la freccia apre un menu
/// di varianti. Con `remember`, la parte grande ripete l'ultima scelta.
export interface SplitControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "split";
  readonly id: string;
  readonly params?: Params;
  readonly menu: (view: V) => readonly MenuEntry<K>[];
  readonly menuLabel: K;
  readonly remember?: boolean;
  readonly pressed?: (view: V) => boolean;
}

/// Un pulsante che apre soltanto un menu.
export interface MenuControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "menu";
  readonly items: (view: V) => readonly MenuEntry<K>[] | Promise<readonly MenuEntry<K>[]>;
  /// I comandi che lo fanno vedere, quando le voci arrivano dopo.
  readonly requires?: readonly string[];
}

/// Un elenco a discesa nativo: il carattere, la dimensione, il formato.
export interface SelectControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "select";
  readonly id: string;
  readonly width: number;
  readonly options: (view: V) => readonly { readonly value: string; readonly label: Text<K> }[];
  readonly value: (view: V) => string | null;
  readonly params: (value: string) => Params | null;
}

/// Una casella da spuntare.
export interface CheckControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "check";
  readonly id: string;
  readonly checked: (view: V) => boolean;
  readonly params: (on: boolean, view: V) => Params;
}

/// Un campo di testo che dà il comando quando cambia.
export interface FieldControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: "field";
  readonly id: string;
  readonly width: number;
  readonly value: (view: V) => string;
  readonly params: (value: string, view: V) => Params;
}

/// I controlli che la barra sa disegnare da sé.
export type KitControl<V, K extends string> =
  ButtonControl<V, K> | SplitControl<V, K> | MenuControl<V, K> | SelectControl<V, K> | CheckControl<V, K> | FieldControl<V, K>;

/// Un controllo di una specie in più, che disegna chi dichiara la barra
/// (`RibbonOptions.extra`): una tavolozza, una galleria.
export interface ExtraControl<V, K extends string> extends ControlBase<V, K> {
  readonly kind: string;
  readonly id: string;
}

/// Una colonna di un gruppo: un controllo grande, o righe di controlli piccoli.
export type RibbonColumn<C> = C | { readonly rows: readonly (readonly C[])[] };

export interface RibbonGroup<C, K extends string> {
  readonly id: string;
  readonly label: K;
  /// L'icona del gruppo raccolto, quando la barra è stretta.
  readonly icon: string;
  /// Il tasto del gruppo raccolto.
  readonly keytip: string;
  readonly columns: readonly RibbonColumn<C>[];
}

export interface RibbonTab<C, K extends string> {
  readonly id: string;
  readonly label: K;
  readonly keytip: string;
  readonly groups: readonly RibbonGroup<C, K>[];
  /// Una scheda che c'è soltanto in un contesto: quale, lo dice chi la
  /// dichiara (`RibbonOptions.contextShown`).
  readonly contextual?: string;
}

/// I controlli di una colonna, nell'ordine in cui si leggono.
export function columnControls<C extends object>(column: RibbonColumn<C>): readonly C[] {
  return "rows" in column ? column.rows.flat() : [column];
}

/// I controlli di un gruppo.
export function groupControls<C extends object, K extends string>(group: RibbonGroup<C, K>): readonly C[] {
  return group.columns.flatMap(columnControls);
}
