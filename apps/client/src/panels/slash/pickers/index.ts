// I passi del «/»: ciò che una voce con «›» apre nello stesso riquadro. La
// tabella, il colore, la data, il riquadro, la nota da collegare o
// incorporare, il linguaggio del codice e il diagramma.
//
// Un passo non prende il fuoco: il pannello gli passa i tasti finché è
// aperto, e Backspace o Esc tornano all'elenco. Scelto, dice gli argomenti
// della voce (`done`), gli stessi di un comando rapido.
import type { SlashMenuEntry, SlashPicker } from "../../../editors/core/editor-menu";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { calloutStep, colorStep, diagramStep, tableStep } from "./grids";
import { dateStep } from "./date";
import { codeStep, noteStep } from "./search";

/// Una nota che si può collegare, com'è scritta nel link.
export interface NoteChoice {
  /// Il nome mostrato.
  readonly label: string;
  /// La cartella, per distinguere due note con lo stesso nome.
  readonly detail: string;
  /// Ciò che va fra le doppie quadre: il nome, o il percorso quando il nome
  /// non basta.
  readonly target: string;
}

/// Ciò che i passi chiedono alla shell.
export interface StepDeps {
  /// Il giorno di oggi.
  today(): Date;
  /// I colori del testo e del fondo, come voci del «/».
  colors(): { readonly text: readonly SlashMenuEntry[]; readonly fill: readonly SlashMenuEntry[] };
  /// Le note che rispondono a `query`; vuota, le recenti.
  notes(query: string): Promise<readonly NoteChoice[]>;
  /// I titoli della nota `target`.
  headings(target: string): Promise<readonly { readonly level: number; readonly text: string }[]>;
}

/// Ciò che il passo dice al pannello.
export interface StepHost {
  /// Scelto: la voce da eseguire (di serie quella del passo) e i suoi argomenti.
  done(choice: { readonly entry?: SlashMenuEntry; readonly params: Readonly<Record<string, unknown>> }): void;
  /// La scelta dentro il passo è cambiata: il conto e l'attivo da ridire.
  changed(): void;
}

export interface SlashStep {
  readonly dom: HTMLElement;
  /// La riga del conto: che cosa è scelto, o che cosa si può scrivere.
  hint(): string;
  /// L'id della cella scelta, per `aria-activedescendant`.
  active(): string | null;
  /// Un tasto: `true` se l'ha preso.
  key(event: KeyboardEvent): boolean;
  /// Si sta scrivendo un filtro: Backspace cancella una lettera invece di
  /// tornare all'elenco.
  typing(): boolean;
  dispose(): void;
}

export interface StepContext {
  readonly entry: SlashMenuEntry;
  readonly deps: StepDeps;
  readonly host: StepHost;
  /// Del passo: si chiude con `dispose`.
  readonly life: Lifetime;
}

const STEPS: Readonly<Record<SlashPicker, (context: StepContext) => SlashStep>> = {
  table: tableStep,
  color: colorStep,
  date: dateStep,
  callout: calloutStep,
  note: (context) => noteStep(context, false),
  embed: (context) => noteStep(context, true),
  code: codeStep,
  diagram: diagramStep,
};

/// Il passo della voce, o `null` se non ne ha.
export function openStep(entry: SlashMenuEntry, deps: StepDeps, host: StepHost): SlashStep | null {
  if (!entry.picker) return null;
  const life = openLifetime();
  const step = STEPS[entry.picker]({ entry, deps, host, life });
  return {
    ...step,
    dispose() {
      step.dispose();
      life.close();
    },
  };
}
