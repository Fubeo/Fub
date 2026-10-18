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

export interface ShellComponent {
  readonly name: string;
  readonly states: readonly ComponentState[];
  /** Le classi pubbliche che il componente espone alla pelle. */
  readonly hooks: readonly string[];
}

export interface PartAnatomy {
  /** Il nome del pezzo: `skin/<part>.css`. */
  readonly part: string;
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
