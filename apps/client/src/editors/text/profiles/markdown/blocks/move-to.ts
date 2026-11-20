// «Sposta in…» (E13, T32) dal lato dell'editor: il blocco (o la tratta di
// blocchi) detto in byte del file, e le domande prima di spostarlo — la nota,
// poi dove (in fondo, o sotto un suo titolo), poi che cosa resta al suo posto
// (un link, niente, una trasclusione). Lo spostamento lo fa il comando del
// nucleo `note.block.move`, che scrive le due note insieme e dà un annulla
// solo: qui non si tocca il documento, lo ricarica la sessione dopo la
// scrittura. La porta (`MoveBlockPort`) la dà chi monta l'editor
// (`state/move-block.ts`): l'editor non parla con l'host.
import type { EditorState } from "@codemirror/state";
import { errorText } from "../../../../../host/errors";
import { actions, openFrame, pickFromList } from "../../../../../ui/dialogs";
import { icon, registerIcon } from "../../../../../ui/icons";
import { liveStrings } from "../strings";
import type { Block } from "./model";
import type { BlockRun } from "./move";
import { spanOf } from "./selection";

/// Che cosa resta dove stava il blocco.
export type MoveLeave = "link" | "none" | "embed";

/// Una nota dove il blocco può andare.
export interface MoveNote {
  readonly id: string;
  readonly title: string;
}

/// Un titolo della nota d'arrivo: lo slug lo nomina al comando.
export interface MoveHeading {
  readonly slug: string;
  readonly text: string;
  readonly level: number;
  /// Dove comincia, in byte del file: nella stessa nota, un titolo dentro ciò
  /// che si sposta non è una destinazione.
  readonly start: number;
}

/// Lo spostamento chiesto al comando.
export interface MoveRequest {
  readonly doc: string;
  readonly at: readonly [number, number];
  readonly text: string;
  readonly to: string;
  readonly heading: string | null;
  readonly leave: MoveLeave;
}

/// Chi sposta davvero: le note del vault, i titoli di una nota, e il comando.
/// `move` dà `null` se è andata, altrimenti la frase che dice perché no.
export interface MoveBlockPort {
  notes(): Promise<readonly MoveNote[]>;
  headings(doc: string): Promise<readonly MoveHeading[]>;
  move(request: MoveRequest): Promise<string | null>;
}

/// Il blocco in byte UTF-8 del file com'è sul disco: `state.sliceDoc()` rende
/// gli a capo del file (`EditorState.lineSeparator`), quindi anche i `\r`.
export function blockBytes(state: EditorState, blocks: readonly Block[], run: BlockRun): { at: [number, number]; text: string } {
  const { from, to } = spanOf(blocks, run);
  const encoder = new TextEncoder();
  const start = encoder.encode(state.sliceDoc(0, from)).length;
  const text = state.sliceDoc(from, to);
  return { at: [start, start + encoder.encode(text).length], text };
}

/// La figura della voce, quella del prototipo: una freccia verso una pagina.
/// Si registra la prima volta che serve, se il repertorio non ne ha già una
/// (un tema può averla ridisegnata); resta, come le figure dei diagrammi. Dà
/// sempre `true`, per stare dentro la condizione della voce.
export function registerMoveIcon(): true {
  if (icon("move") === "") registerIcon("move", ["M3.75 12h10.5", "M10.5 7.5l4.5 4.5-4.5 4.5", "M16.5 4.5h3.75v15H16.5"]);
  return true;
}

/// Dove va e che cosa resta: la risposta della seconda domanda.
export interface MoveChoice {
  readonly heading: string | null;
  readonly leave: MoveLeave;
}

/// La prima domanda: la nota. `null` se l'utente ha chiuso.
export async function chooseNote(port: MoveBlockPort, current: string): Promise<MoveNote | null> {
  // Per nome, come le cerca chi scrive; la nota stessa per ultima, perché
  // è la scelta meno frequente (spostare sotto un altro titolo).
  const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const notes = [...await port.notes()].sort((a, b) =>
    Number(a.id === current) - Number(b.id === current) || byName.compare(a.title, b.title) || byName.compare(a.id, b.id));
  return pickFromList({
    title: liveStrings.t("blocks.move.title"),
    placeholder: liveStrings.t("blocks.move.search"),
    items: notes.map((note) => ({
      label: note.title,
      detail: note.id === current ? liveStrings.t("blocks.move.here", { path: note.id }) : note.id,
      value: note,
    })),
  });
}

function option(text: string, value: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

/// La seconda domanda, su una finestra sola: dove (in fondo alla nota, o in
/// fondo alla sezione di un titolo) e che cosa resta al posto del blocco. I
/// valori di partenza sono il gesto del prototipo — in fondo, col link — così
/// Invio sposta subito. Nella stessa nota non resta niente, e la domanda non
/// c'è; la trasclusione porta un blocco solo.
export function chooseWhere(note: MoveNote, headings: readonly MoveHeading[], options: { same: boolean; single: boolean }): Promise<MoveChoice | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: MoveChoice | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(liveStrings.t("blocks.move.into", { name: note.title }), () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";
    const field = (label: string, select: HTMLSelectElement): HTMLLabelElement => {
      const wrap = document.createElement("label");
      const name = document.createElement("span");
      name.className = "palette-label";
      name.textContent = label;
      wrap.append(name, select);
      return wrap;
    };
    const where = document.createElement("select");
    where.name = "where";
    where.append(option(liveStrings.t("blocks.move.end"), ""));
    for (const heading of headings) {
      // Il rientro dice il livello, come nella Struttura.
      const indent = " ".repeat(Math.max(0, heading.level - 1));
      where.append(option(`${indent}${liveStrings.t("blocks.move.under", { name: heading.text })}`, heading.slug));
    }
    form.append(field(liveStrings.t("blocks.move.where"), where));
    const leave = document.createElement("select");
    leave.name = "leave";
    leave.append(option(liveStrings.t("blocks.move.leave.link"), "link"));
    leave.append(option(liveStrings.t("blocks.move.leave.none"), "none"));
    if (options.single) leave.append(option(liveStrings.t("blocks.move.leave.embed"), "embed"));
    const leaveField = field(liveStrings.t("blocks.move.leave"), leave);
    leaveField.hidden = options.same;
    form.append(leaveField);
    form.append(actions(liveStrings.t("blocks.move.ok"), () => settle(null)));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle({ heading: where.value === "" ? null : where.value, leave: options.same ? "none" : (leave.value as MoveLeave) });
    });
    // Invio su una tendina conferma, come in un campo di testo: la tendina
    // chiusa non ha altro da fare con Invio.
    form.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target instanceof HTMLSelectElement) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    frame.box.append(form);
    where.focus();
  });
}

/// Le domande in fila e poi lo spostamento. `range` dà i byte del blocco quando
/// tutto è deciso: se intanto il testo è cambiato dà `null`, e non si sposta
/// niente. Dice com'è andata con `notify`; l'esito buono lo dice chi
/// sposta, con il suo «Annulla».
export async function moveWithQuestions(
  port: MoveBlockPort,
  doc: string,
  single: boolean,
  range: () => { at: [number, number]; text: string } | null,
  notify: (message: string, tone: "info" | "guasto") => void,
): Promise<void> {
  try {
    const note = await chooseNote(port, doc);
    if (!note) return;
    const same = note.id === doc;
    const all = await port.headings(note.id);
    const now = range();
    if (!now) return notify(liveStrings.t("blocks.move.gone"), "guasto");
    const headings = same ? all.filter((heading) => heading.start < now.at[0] || heading.start >= now.at[1]) : all;
    const choice = await chooseWhere(note, headings, { same, single });
    if (!choice) return;
    const block = range();
    if (!block) return notify(liveStrings.t("blocks.move.gone"), "guasto");
    const failed = await port.move({ doc, at: block.at, text: block.text, to: note.id, heading: choice.heading, leave: choice.leave });
    if (failed !== null) notify(liveStrings.t("blocks.move.failed", { reason: failed }), "guasto");
  } catch (error) {
    notify(liveStrings.t("blocks.move.failed", { reason: errorText(error) }), "guasto");
  }
}
