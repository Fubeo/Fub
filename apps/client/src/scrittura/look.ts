// I comandi del carattere di Scrittura sulle marche di `marks.ts`: dire se
// un'enfasi è accesa, cambiare carattere, misura, colore ed evidenziatore,
// fare un passo della scala delle misure. Valgono per ogni schema che monta
// quelle marche; chi li monta dice che cosa è un paragrafo e l'aspetto che il
// paragrafo dà di suo, che un tratto uguale non riscrive.
import type { Mark as PmMark, MarkType, Node as PmNode, Schema } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

/// Le misure che i menu propongono e su cui «Ingrandisci» e «Riduci» fanno
/// un passo, come in Word.
export const FONT_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 1638;

/// Un oggetto in linea (un'immagine, un campo) non ha un carattere: i comandi
/// lo saltano.
function opaque(node: PmNode): boolean {
  return node.type.spec.atom === true;
}

/// La marca è accesa su tutta la selezione (o nelle marche del cursore).
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  let all = true;
  let any = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true;
    if (opaque(node)) return false;
    any = true;
    if (!type.isInSet(node.marks)) all = false;
    return false;
  });
  return any && all;
}

export function clampSize(pt: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(pt * 2) / 2));
}

/// L'aspetto che un paragrafo dà ai suoi tratti.
export interface BaseLook {
  readonly font?: string;
  readonly size?: number;
}

export interface LookOptions {
  readonly schema: Schema;
  /// Vero per il blocco in cui si scrive.
  readonly paragraph: (node: PmNode) => boolean;
  /// L'aspetto del paragrafo, se ne dà uno.
  readonly base: (paragraph: PmNode) => BaseLook | null;
  /// La misura senza una scritta né quella del paragrafo.
  readonly fallbackSize: number;
  /// Il colore dell'evidenziatore senza un colore scritto.
  readonly highlight: string;
}

/// L'aspetto del testo scelto: un campo è `null` dove la scelta ne mescola
/// più d'uno. `hl` è `null` anche dove il testo non è evidenziato.
export interface LookState {
  readonly font: string | null;
  readonly size: number | null;
  readonly color: string | null;
  readonly hl: string | null;
}

export interface LookCommands {
  selectedLook(state: EditorState): LookState;
  setFont(family: string | null): Command;
  setSize(pt: number | null): Command;
  stepSize(direction: 1 | -1): Command;
  setColor(value: string | null): Command;
  setHighlight(color: string | null): Command;
}

/// I comandi del carattere per uno schema; `auto` è il colore che si legge
/// dove un tratto non ne scrive uno.
export function lookCommands(options: LookOptions, auto: string): LookCommands {
  const { schema, paragraph: isParagraph, base } = options;

  const lookAt = (marks: readonly PmMark[], paragraph: PmNode | null): { font?: string; size?: number; color: string; hl: string | null } => {
    const own = paragraph === null ? null : base(paragraph);
    let font = own?.font;
    let size = own?.size;
    let color = auto;
    let hl: string | null = null;
    for (const mark of marks) {
      const name = mark.type.name;
      if (name === "font") font = mark.attrs.family as string;
      else if (name === "size") size = mark.attrs.pt as number;
      else if (name === "color") color = mark.attrs.value as string;
      else if (name === "h") hl = (mark.attrs.color as string | null) ?? options.highlight;
    }
    return { font, size, color, hl };
  };

  const selectedLook = (state: EditorState): LookState => {
    const { from, to, empty, $from } = state.selection;
    if (empty) {
      const look = lookAt(state.storedMarks ?? $from.marks(), isParagraph($from.parent) ? $from.parent : null);
      return { font: look.font ?? null, size: look.size ?? null, color: look.color, hl: look.hl };
    }
    const seen: ReturnType<typeof lookAt>[] = [];
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (!node.isInline) return true;
      if (!opaque(node)) seen.push(lookAt(node.marks, parent));
      return false;
    });
    if (seen.length === 0) return { font: null, size: null, color: null, hl: null };
    const common = <T>(pick: (look: ReturnType<typeof lookAt>) => T): T | null =>
      seen.every((look) => pick(look) === pick(seen[0]!)) ? pick(seen[0]!) : null;
    return {
      font: common((look) => look.font ?? null),
      size: common((look) => look.size ?? null),
      color: common((look) => look.color),
      hl: common((look) => look.hl),
    };
  };

  /// I tratti della scelta, ciascuno col suo paragrafo.
  const selectedRuns = (state: EditorState): { from: number; to: number; paragraph: PmNode; node: PmNode }[] => {
    const out: { from: number; to: number; paragraph: PmNode; node: PmNode }[] = [];
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isInline) return true;
      if (!opaque(node) && parent) out.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), paragraph: parent, node });
      return false;
    });
    return out;
  };

  /// Mette su ogni tratto scelto la marca che `make` sceglie per lui
  /// (`null`: nessuna). Senza scelta vale per ciò che si scrive dopo.
  const setMarkPerRun =
    (type: MarkType, make: (run: { paragraph: PmNode; marks: readonly PmMark[] }) => PmMark | null): Command =>
    (state, dispatch) => {
      const { empty, $from } = state.selection;
      if (empty) {
        if (!isParagraph($from.parent)) return false;
        if (dispatch) {
          const marks = type.removeFromSet(state.storedMarks ?? $from.marks());
          const mark = make({ paragraph: $from.parent, marks: state.storedMarks ?? $from.marks() });
          dispatch(state.tr.setStoredMarks(mark ? mark.addToSet(marks) : marks));
        }
        return true;
      }
      const runs = selectedRuns(state);
      if (runs.length === 0) return false;
      if (dispatch) {
        const tr = state.tr;
        for (const run of runs) {
          tr.removeMark(run.from, run.to, type);
          const mark = make({ paragraph: run.paragraph, marks: run.node.marks });
          if (mark) tr.addMark(run.from, run.to, mark);
        }
        dispatch(tr);
      }
      return true;
    };

  const marks = schema.marks;
  return {
    selectedLook,
    // Il carattere del paragrafo non si scrive: il tratto torna a seguirlo.
    setFont: (family) =>
      setMarkPerRun(marks.font!, ({ paragraph }) => (family && family !== base(paragraph)?.font ? marks.font!.create({ family }) : null)),
    setSize: (pt) =>
      setMarkPerRun(marks.size!, ({ paragraph }) => {
        if (pt === null || !Number.isFinite(pt)) return null;
        const size = clampSize(pt);
        return size !== base(paragraph)?.size ? marks.size!.create({ pt: size }) : null;
      }),
    // Un passo della scala per ogni tratto, dalla sua misura.
    stepSize: (direction) =>
      setMarkPerRun(marks.size!, ({ paragraph, marks: own }) => {
        const from = base(paragraph)?.size;
        const current = (marks.size!.isInSet(own)?.attrs.pt as number | undefined) ?? from ?? options.fallbackSize;
        const next =
          direction > 0
            ? FONT_SIZES.find((size) => size > current) ?? clampSize(current + 10)
            : [...FONT_SIZES].reverse().find((size) => size < current) ?? clampSize(current - 1);
        return next !== from ? marks.size!.create({ pt: next }) : null;
      }),
    // `null` riporta il colore a quello del paragrafo.
    setColor: (value) => setMarkPerRun(marks.color!, () => (value ? marks.color!.create({ value }) : null)),
    setHighlight: (color) =>
      setMarkPerRun(marks.h!, () => (color ? marks.h!.create({ color: color === options.highlight ? null : color }) : null)),
  };
}
