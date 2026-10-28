/**
 * La forma dell'anatomia della serie Scrittoio.
 *
 * Un **pezzo** di pelle (`skin/<pezzo>.css`) ha accanto il suo modulo
 * (`anatomia/<pezzo>.ts`) che dice quali componenti veste, con quali hook e in
 * quali stati. I due file si scrivono e si controllano insieme: il presidio
 * confronta le classi nominate dal CSS con gli hook dichiarati qui, nei due
 * versi e pezzo per pezzo, così chi aggiunge un componente tocca due file suoi
 * e nessun elenco comune.
 */

export const STATE_NAMES = [
  "rest",
  "hover",
  "pressed",
  "selected",
  "focused",
  "disabled",
  "dragging",
] as const;

export type StateName = (typeof STATE_NAMES)[number];

export interface ComponentState {
  readonly name: StateName;
  readonly label: string;
}

/**
 * Lo strato di una classe, cioè chi ha l'autorità su come si vede:
 *
 * - `cornice`: barre, pannelli, menu, righelli, scrivania. Sempre del tema;
 * - `segno`: ciò che Fub disegna sul contenuto — selezione, cursore, fuoco,
 *   ricerca, revisioni, correttore, commenti, maniglie. Del tema, con i colori
 *   della carta su cui sta;
 * - `contenuto`: ciò che il file dice. Chi ne ha l'autorità lo dichiara la
 *   modalità della superficie, con il suo aspetto (`theme/content-look.ts`).
 */
export const LAYERS = ["cornice", "segno", "contenuto"] as const;

export type Layer = (typeof LAYERS)[number];

export interface ShellComponent {
  readonly name: string;
  readonly states: readonly ComponentState[];
  /** Le classi pubbliche che il componente espone alla pelle. */
  readonly hooks: readonly string[];
  /** Lo strato dei suoi hook; assente, quello del pezzo. */
  readonly layer?: Layer;
  /** Gli hook di un altro strato da quello del componente. */
  readonly layers?: Readonly<Record<string, Layer>>;
  /**
   * Il contenuto offre anche l'aspetto `file` o `adattato`: le sue classi di
   * contenuto valgono soltanto sotto `.look-tema`, e lo stesso un selettore di
   * tipo dentro una delle cornici di `scope`, che lo contengono. Lo fa
   * rispettare il sanitizer (`ContentGate`).
   */
  readonly gate?: { readonly scope: readonly string[] };
  /**
   * Gli hook di contenuto che la pelle della casa non veste: la superficie non
   * offre l'aspetto `tema`, e nessuna pelle li veste. Restano pubblici perché
   * il gate li riconosca in una pelle di terzi.
   */
  readonly unstyled?: readonly string[];
}

export interface PartAnatomy {
  /** Il nome del pezzo: `skin/<part>.css`. */
  readonly part: string;
  /** Lo strato dei suoi componenti, quando non ne dichiarano uno. */
  readonly layer: Layer;
  readonly components: readonly ShellComponent[];
}

const LABELS: Readonly<Record<StateName, string>> = {
  rest: "riposo",
  hover: "hover",
  pressed: "premuto",
  selected: "selezionato",
  focused: "a fuoco",
  disabled: "disabilitato",
  dragging: "trascinamento",
};

export const S = (name: StateName): ComponentState => ({ name, label: LABELS[name] });

/** Gli insiemi di stati che ricorrono. */
export const REST: readonly ComponentState[] = [S("rest")];
export const INTERACTIVE: readonly ComponentState[] = [
  S("rest"),
  S("hover"),
  S("pressed"),
  S("focused"),
  S("disabled"),
];
export const SELECTABLE: readonly ComponentState[] = [...INTERACTIVE, S("selected")];
export const DRAGGABLE: readonly ComponentState[] = [...SELECTABLE, S("dragging")];
