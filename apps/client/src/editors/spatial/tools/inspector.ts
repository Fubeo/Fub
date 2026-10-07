// Il pannello degli attributi (livello Esperto): il tag dell'oggetto scelto,
// riga per riga, come lo scrive il file. Sta accanto al foglio, sotto
// l'albero degli oggetti quando anche quello è aperto. Le regole sui valori
// sono in `attributes.ts`; qui c'è come si leggono e si scrivono.
//
// - **Una tabella**, col nome dell'attributo come intestazione di riga e come
//   nome del campo: chi non vede il foglio sente «fill, #0072b2» e sa dov'è.
// - **Un valore parte con Invio, o lasciando il campo.** Esc lo riporta a
//   com'era, e di nuovo torna al foglio. Un valore che il formato non ammette
//   non parte: resta scritto e segnato, con accanto che cosa ci vuole.
// - **Il disegno può cambiare mentre si scrive**: un annulla, chi lavora
//   insieme. Le righe si aggiornano per chiave, e il campo che ha il fuoco
//   con un valore scritto a metà non si tocca; un altro oggetto scelto lo
//   riporta a com'è.
// - **Ciò che ha un padrone si legge soltanto**, con la ragione accanto; un
//   documento in sola lettura si legge tutto.
// - **Il pannello tiene i suoi tasti.** Le scorciatoie del foglio non partono
//   da qui (l'editor non le guarda): un `?` o un Canc scritti in un valore
//   restano lì, e un Canc sul pulsante che toglie un attributo non toglie
//   l'oggetto.

import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import {
  canonicalValue,
  fieldOf,
  idProblem,
  initialValue,
  kindOf,
  MAX_ID_LENGTH,
  type Field,
  type IdProblem,
  type Note,
  type Row,
  type Subject,
  type ValueProblem,
} from "./attributes";
import { customColor } from "./palette";

/// Oltre questi caratteri un valore che si legge soltanto si mostra tagliato.
export const SHOWN_CHARS = 200;

/// Che cosa mostra il pannello.
export interface InspectorView {
  /// L'oggetto scelto da solo; `null` con nessuno o con più d'uno.
  readonly subject: Subject | null;
  /// La chiave della selezione: un oggetto diverso, anche allo stesso posto,
  /// ne ha un'altra.
  readonly key: string | null;
  /// Il nome a parole dell'oggetto.
  readonly label: string;
  /// Quanti oggetti sono scelti.
  readonly count: number;
  readonly editable: boolean;
}

export interface InspectorOptions {
  /// Scrive `value` in `key`, o lo toglie con `null`: `null` se il disegno
  /// l'ha accettato, altrimenti la ragione per cui no.
  onSet(subject: Subject, key: string, value: string | null): string | null;
  /// Dà a `subject` l'id `next`, come `onSet`.
  onRename(subject: Subject, next: string): string | null;
  /// Vero se un elemento del documento porta già `id`.
  taken(id: string): boolean;
  /// Vero se una parte estranea del disegno cita `id`.
  cited(id: string): boolean;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
  /// Esc su un campo senza niente da annullare: il fuoco torna al foglio.
  onLeave(): void;
}

export interface Inspector {
  /// Il pannello: titolo, oggetto, attributi e aggiunta.
  readonly element: HTMLElement;
  update(view: InspectorView): void;
  /// Il fuoco al primo campo, o al pannello se non ce n'è.
  focus(): void;
  /// Vero se il pannello sta dentro quello delle proprietà, come una sua
  /// sezione: il titolo è della sezione, e il pannello non è più una regione
  /// della pagina.
  nest(nested: boolean): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/// Una riga disegnata: l'id, o un attributo.
interface Line {
  readonly key: string;
  readonly tr: HTMLTableRowElement;
  readonly label: HTMLLabelElement;
  readonly cell: HTMLTableCellElement;
  readonly swatch: HTMLElement;
  readonly note: HTMLElement;
  readonly error: HTMLElement;
  readonly remove: HTMLButtonElement;
  control: Control;
  /// Che campo è: cambia, e il campo si rifà.
  shape: string;
  /// Il valore scritto nel campo l'ultima volta: un campo che dice altro ha
  /// un valore scritto a metà.
  shown: string;
  /// L'attributo; `null` per la riga dell'id.
  row: Row | null;
}

const ID_KEY = "id";

const NOTES: Readonly<Record<Note, DrawKey>> = {
  ink: "draw.attributes.note.ink",
  arrow: "draw.attributes.note.arrow",
  shape: "draw.attributes.note.shape",
  width: "draw.attributes.note.width",
  fubdraw: "draw.attributes.note.fubdraw",
  link: "draw.attributes.note.link",
  image: "draw.attributes.note.image",
  namespace: "draw.attributes.note.namespace",
  long: "draw.attributes.note.long",
};

const VALUE_PROBLEMS: Readonly<Record<ValueProblem, DrawKey>> = {
  empty: "draw.attributes.problem.empty",
  paint: "draw.attributes.problem.paint",
  length: "draw.attributes.problem.length",
  size: "draw.attributes.problem.size",
  opacity: "draw.attributes.problem.opacity",
  dashes: "draw.attributes.problem.dashes",
  keyword: "draw.attributes.problem.keyword",
  spacing: "draw.attributes.problem.spacing",
  decoration: "draw.attributes.problem.decoration",
  family: "draw.attributes.problem.family",
  transform: "draw.attributes.problem.transform",
  points: "draw.attributes.problem.points",
  path: "draw.attributes.problem.path",
  aspect: "draw.attributes.problem.aspect",
};

const ID_PROBLEMS: Readonly<Record<IdProblem, DrawKey>> = {
  empty: "draw.attributes.id.empty",
  long: "draw.attributes.id.long",
  form: "draw.attributes.id.form",
  reserved: "draw.attributes.id.reserved",
  taken: "draw.attributes.id.taken",
  cited: "draw.attributes.id.cited",
};

/// Un valore come si legge in un campo che non si scrive: tagliato oltre
/// [`SHOWN_CHARS`].
const shownValue = (value: string): string => (value.length > SHOWN_CHARS ? `${value.slice(0, SHOWN_CHARS)}…` : value);

/// Una voce di una scelta.
function optionOf(value: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  return option;
}

/// Il campo di un valore che si scrive: una riga, più righe, o una scelta.
function controlFor(field: Field, value: string): Control {
  if (field.kind === "choice") {
    const select = document.createElement("select");
    const options = field.options.includes(value) ? field.options : [...field.options, value];
    select.append(...options.map(optionOf));
    return select;
  }
  if (field.kind === "area") {
    const area = document.createElement("textarea");
    area.rows = 3;
    area.spellcheck = false;
    return area;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  return input;
}

export function createInspector(life: Lifetime, options: InspectorOptions): Inspector {
  const element = document.createElement("section");
  element.className = "draw-inspector";
  element.id = identifier("draw-inspector");
  const header = document.createElement("div");
  header.className = "draw-inspector-header";
  const heading = document.createElement("h2");
  heading.className = "draw-inspector-title";
  heading.id = identifier("draw-inspector-title");
  const subjectLine = document.createElement("p");
  subjectLine.className = "draw-inspector-subject";
  header.append(heading, subjectLine);
  const empty = document.createElement("p");
  empty.className = "draw-inspector-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-inspector-scroll";
  const table = document.createElement("table");
  table.className = "draw-inspector-table";
  table.setAttribute("aria-labelledby", heading.id);
  // Le intestazioni delle colonne si sentono e non si vedono: la tabella si
  // legge da sé.
  const head = document.createElement("thead");
  head.className = "sr-only";
  const headRow = document.createElement("tr");
  head.append(headRow);
  const columns = (["draw.attributes.name", "draw.attributes.value", "draw.attributes.actions"] as const).map((key) => {
    const th = document.createElement("th");
    th.scope = "col";
    headRow.append(th);
    return [th, key] as const;
  });
  const body = document.createElement("tbody");
  table.append(head, body);
  /// Le righe disegnate, in ordine.
  const trs = (): HTMLTableRowElement[] => Array.from(body.children) as HTMLTableRowElement[];

  // Aggiungere: il nome, il valore, il pulsante.
  const add = document.createElement("div");
  add.className = "draw-inspector-add";
  add.setAttribute("role", "group");
  const addHeading = document.createElement("p");
  addHeading.className = "draw-inspector-add-title";
  addHeading.id = identifier("draw-inspector-add");
  add.setAttribute("aria-labelledby", addHeading.id);
  const addKey = document.createElement("select");
  addKey.className = "draw-inspector-input";
  let addValue: Control = controlFor({ kind: "line" }, "");
  addValue.className = "draw-inspector-input";
  const addValueSlot = document.createElement("div");
  addValueSlot.className = "draw-inspector-add-value";
  addValueSlot.append(addValue);
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "draw-button draw-inspector-add-button";
  const addError = document.createElement("p");
  addError.className = "draw-inspector-error";
  addError.id = identifier("draw-inspector-add-error");
  addError.hidden = true;
  add.append(addHeading, addKey, addValueSlot, addButton, addError);
  scroller.append(table, add);
  // Senza un oggetto non c'è tabella: prima del primo aggiornamento, come dopo.
  scroller.hidden = true;
  element.setAttribute("aria-labelledby", heading.id);
  element.tabIndex = -1;
  element.append(header, empty, scroller);

  let view: InspectorView = { subject: null, key: null, label: "", count: 0, editable: false };
  let lines = new Map<string, Line>();
  /// Il nome scelto nell'aggiunta, e i nomi fra cui si sceglie.
  let adding: string | null = null;
  let addable: readonly string[] = [];
  /// Vero mentre le righe si ridisegnano: un campo tolto dal DOM non scrive
  /// il suo valore.
  let rendering = false;

  // --- Una riga ---------------------------------------------------------------

  const createLine = (key: string): Line => {
    const tr = document.createElement("tr");
    tr.dataset.key = key;
    const th = document.createElement("th");
    th.scope = "row";
    th.className = "draw-inspector-key";
    const label = document.createElement("label");
    label.textContent = key;
    th.append(label);
    const cell = document.createElement("td");
    cell.className = "draw-inspector-value";
    const swatch = document.createElement("span");
    swatch.className = "draw-inspector-swatch";
    swatch.setAttribute("aria-hidden", "true");
    swatch.hidden = true;
    const note = document.createElement("p");
    note.className = "draw-inspector-note";
    note.id = identifier("draw-inspector-note");
    note.hidden = true;
    const error = document.createElement("p");
    error.className = "draw-inspector-error";
    error.id = identifier("draw-inspector-error");
    error.hidden = true;
    const actions = document.createElement("td");
    actions.className = "draw-inspector-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "draw-button draw-inspector-remove";
    const glyph = iconEl("trash");
    if (glyph !== null) remove.append(glyph);
    actions.append(remove);
    const control = controlFor({ kind: "line" }, "");
    const field = document.createElement("div");
    field.className = "draw-inspector-field";
    field.append(control, swatch);
    cell.append(field, note, error);
    tr.append(th, cell, actions);
    const line: Line = { key, tr, label, cell, swatch, note, error, remove, control, shape: "", shown: "", row: null };
    life.listen(remove, "click", () => removeLine(line));
    return line;
  };

  /// Il nome di una riga e quello del suo pulsante, nella lingua di adesso.
  const nameLine = (line: Line): void => {
    const text = t("draw.attributes.remove", { key: line.key });
    line.remove.setAttribute("aria-label", text);
    line.remove.title = text;
    if (line.row === null) {
      (line.control as HTMLInputElement).placeholder = t("draw.attributes.id.none");
    }
  };

  /// Chi descrive il campo: la nota e l'errore che si vedono.
  const describeLine = (line: Line): void => {
    const ids = [line.note, line.error].filter((part) => !part.hidden).map((part) => part.id);
    if (ids.length === 0) line.control.removeAttribute("aria-describedby");
    else line.control.setAttribute("aria-describedby", ids.join(" "));
  };

  const showError = (line: Line, text: string | null): void => {
    line.error.hidden = text === null;
    line.error.textContent = text ?? "";
    if (text === null) line.control.removeAttribute("aria-invalid");
    else line.control.setAttribute("aria-invalid", "true");
    describeLine(line);
  };

  /// Il campione accanto a un colore che si scrive.
  const showSwatch = (line: Line, value: string): void => {
    const color = line.row?.note === null && kindOf(line.key) === "paint" ? customColor(value) : null;
    line.swatch.hidden = color === null;
    if (color !== null) line.swatch.style.setProperty("--swatch", color);
  };

  /// Porta `line` alla riga `row` (`null` per l'id) dell'oggetto di adesso.
  /// `fresh` vuol dire un altro oggetto: un valore scritto a metà si perde.
  const paintLine = (line: Line, row: Row | null, fresh: boolean): void => {
    const { subject, editable } = view;
    const readOnly = row !== null && row.note !== null;
    const value = row === null ? (subject?.id ?? "") : readOnly ? shownValue(row.value) : row.value;
    const field: Field = row === null || readOnly ? { kind: "line" } : row.field;
    const shape = `${readOnly ? "read" : "edit"}|${field.kind}|${field.kind === "choice" ? field.options.join("\u0000") : ""}`;
    line.row = row;
    if (shape !== line.shape) {
      const focused = document.activeElement === line.control;
      const next = controlFor(field, value);
      next.className = "draw-inspector-input";
      next.id = identifier("draw-inspector-field");
      line.label.htmlFor = next.id;
      line.control.replaceWith(next);
      line.control = next;
      line.shape = shape;
      line.shown = "";
      if (focused) next.focus({ preventScroll: true });
      fresh = true;
    }
    const control = line.control;
    // Un valore scritto a metà resta finché ha il fuoco, e uno che non è
    // partito finché non lo si corregge o lo si lascia con Esc.
    const keep = !fresh && control.value !== line.shown && (document.activeElement === control || !line.error.hidden);
    if (!keep) {
      if (control.value !== value) control.value = value;
      showError(line, null);
    }
    line.shown = value;
    // Un campo che si legge soltanto resta raggiungibile, e si copia.
    if (control instanceof HTMLSelectElement) control.disabled = !editable;
    else control.readOnly = readOnly || !editable;
    line.remove.hidden = row === null || readOnly || !editable;
    const noteText = row === null || row.note === null
      ? ""
      : row.value.length > SHOWN_CHARS
        ? `${t(NOTES[row.note])} ${t("draw.attributes.size", { size: String(row.value.length), shown: String(SHOWN_CHARS) })}`
        : t(NOTES[row.note]);
    line.note.hidden = noteText === "";
    line.note.textContent = noteText;
    showSwatch(line, control.value);
    describeLine(line);
    nameLine(line);
  };

  // --- Le righe ---------------------------------------------------------------

  /// Il campo che ha il fuoco nelle righe, col suo posto.
  const focusedAt = (): number => {
    const active = document.activeElement;
    if (active === null || !body.contains(active)) return -1;
    return trs().findIndex((tr) => tr.contains(active));
  };

  /// Porta il fuoco al campo della riga `at`, o della più vicina; senza righe,
  /// all'aggiunta o al pannello.
  const focusNear = (at: number, prefer: "control" | "remove"): void => {
    const rows = trs();
    const tr = rows[Math.min(at, rows.length - 1)];
    const line = tr === undefined ? undefined : lines.get(tr.dataset.key!);
    if (line !== undefined) {
      const target = prefer === "remove" && !line.remove.hidden ? line.remove : line.control;
      target.focus({ preventScroll: true });
    } else if (!add.hidden) {
      addKey.focus({ preventScroll: true });
    } else {
      element.focus({ preventScroll: true });
    }
  };

  const renderRows = (subject: Subject, fresh: boolean): void => {
    const lost = focusedAt();
    const wanted: Array<[string, Row | null]> = [[ID_KEY, null], ...subject.rows.map((row) => [row.key, row] as [string, Row])];
    const next = new Map<string, Line>();
    rendering = true;
    try {
      for (const [key, row] of wanted) {
        const line = lines.get(key) ?? createLine(key);
        paintLine(line, row, fresh || !lines.has(key));
        next.set(key, line);
      }
      for (const [key, line] of lines) if (!next.has(key)) line.tr.remove();
      lines = next;
      let at = 0;
      for (const line of next.values()) {
        if (body.children[at] !== line.tr) body.insertBefore(line.tr, body.children[at] ?? null);
        at++;
      }
    } finally {
      rendering = false;
    }
    // Una riga col fuoco che se n'è andata lo lascia alla sua vicina.
    if (lost >= 0 && focusedAt() < 0 && !add.contains(document.activeElement)) focusNear(lost, "control");
  };

  // --- Aggiungere -------------------------------------------------------------

  /// Il campo del valore per il nome `key`, col suo valore di partenza.
  const showAddValue = (key: string): void => {
    const value = initialValue(key);
    const next = controlFor(fieldOf(key), value);
    next.className = "draw-inspector-input";
    next.value = value;
    next.setAttribute("aria-label", t("draw.attributes.add.value", { key }));
    next.setAttribute("aria-describedby", addError.id);
    addValue.replaceWith(next);
    addValue = next;
    showAddError(null);
  };

  const showAddError = (text: string | null): void => {
    addError.hidden = text === null;
    addError.textContent = text ?? "";
    if (text === null) addValue.removeAttribute("aria-invalid");
    else addValue.setAttribute("aria-invalid", "true");
  };

  const renderAdd = (subject: Subject, fresh: boolean): void => {
    add.hidden = !view.editable || subject.addable.length === 0;
    const same = !fresh && addable.length === subject.addable.length && addable.every((key, at) => subject.addable[at] === key);
    if (same) return;
    // Aggiunto un attributo, si passa a quello che lo seguiva: dopo
    // `stroke`, `stroke-width`.
    const was = adding === null ? -1 : addable.indexOf(adding);
    addable = subject.addable;
    addKey.replaceChildren(...addable.map(optionOf));
    const keep = adding !== null && addable.includes(adding) && !fresh;
    adding = keep ? adding : (addable[fresh || was < 0 ? 0 : Math.min(was, addable.length - 1)] ?? null);
    if (adding !== null) addKey.value = adding;
    if (!keep && adding !== null) showAddValue(adding);
  };

  life.listen(addKey, "change", () => {
    adding = addKey.value;
    showAddValue(adding);
  });

  const commitAdd = (): void => {
    const { subject, editable } = view;
    if (subject === null || !editable || adding === null) return;
    const key = adding;
    const result = canonicalValue(subject.tag, key, addValue.value);
    if ("problem" in result || result.value === null) {
      const text = t("problem" in result ? VALUE_PROBLEMS[result.problem] : "draw.attributes.problem.identity");
      showAddError(text);
      options.announce(text);
      return;
    }
    const failure = options.onSet(subject, key, result.value);
    if (failure !== null) {
      showAddError(failure);
      options.announce(failure);
      return;
    }
    options.announce(t("draw.attributes.added", { key }));
    // Si ricomincia dal nome, che è già il seguente; senza altro da
    // aggiungere, il fuoco va alla riga nuova.
    if (add.hidden) lines.get(key)?.control.focus({ preventScroll: true });
    else addKey.focus({ preventScroll: true });
  };

  life.listen(addButton, "click", () => commitAdd());

  // --- Scrivere ---------------------------------------------------------------

  /// Scrive il valore di `line`, se è cambiato. Un valore che non va resta
  /// segnato; `loud` lo dice anche a voce. Falso se non è partito.
  const commitLine = (line: Line, loud: boolean): boolean => {
    const { subject, editable } = view;
    const draft = line.control.value;
    if (subject === null || !editable || draft === line.shown) return true;
    const fail = (text: string): false => {
      showError(line, text);
      if (loud) options.announce(text);
      return false;
    };
    const before = line.shown;
    if (line.row === null) {
      const next = draft.trim();
      if (next === (subject.id ?? "")) {
        line.control.value = before;
        showError(line, null);
        return true;
      }
      const problem = idProblem(subject, next, options.taken, options.cited);
      if (problem !== null) return fail(t(ID_PROBLEMS[problem], { id: problem === "cited" ? subject.id! : next, max: String(MAX_ID_LENGTH) }));
      line.control.value = line.shown = next;
      const failure = options.onRename(subject, next);
      if (failure !== null) {
        line.shown = before;
        line.control.value = draft;
        return fail(failure);
      }
      options.announce(t("draw.attributes.renamed", { id: next }));
      return true;
    }
    const result = canonicalValue(subject.tag, line.key, draft);
    if ("problem" in result) return fail(t(VALUE_PROBLEMS[result.problem]));
    if (result.value === line.row.value) {
      line.control.value = before;
      showError(line, null);
      showSwatch(line, before);
      return true;
    }
    if (result.value !== null) line.control.value = line.shown = result.value;
    const key = line.key;
    const failure = options.onSet(subject, key, result.value);
    if (failure !== null) {
      line.shown = before;
      line.control.value = draft;
      return fail(failure);
    }
    // Una `transform` che diventa l'identità si toglie, e la riga con lei:
    // il fuoco passa alla vicina.
    options.announce(t(result.value === null ? "draw.attributes.removed" : "draw.attributes.changed", { key }));
    return true;
  };

  const removeLine = (line: Line): void => {
    const { subject, editable } = view;
    if (subject === null || !editable || line.row === null || line.row.note !== null) return;
    const at = focusedAt();
    const failure = options.onSet(subject, line.key, null);
    if (failure !== null) {
      showError(line, failure);
      options.announce(failure);
      return;
    }
    options.announce(t("draw.attributes.removed", { key: line.key }));
    if (at >= 0) focusNear(at, "remove");
  };

  /// La riga di un campo.
  const lineOf = (target: EventTarget | null): Line | null => {
    if (!(target instanceof HTMLElement)) return null;
    const tr = target.closest("tr");
    const line = tr === null ? undefined : lines.get(tr.dataset.key ?? "");
    return line !== undefined && line.control === target ? line : null;
  };

  life.listen(element, "keydown", (event) => {
    const line = lineOf(event.target);
    const inAdd = event.target === addValue || event.target === addKey;
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (line !== null && line.control.value !== line.shown) {
        line.control.value = line.shown;
        showError(line, null);
        showSwatch(line, line.shown);
      } else {
        options.onLeave();
      }
    } else if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // Una scelta di una riga parte quando si fa; quelle dell'aggiunta
      // aspettano Invio, come il valore.
      if (line !== null && !(line.control instanceof HTMLSelectElement)) commitLine(line, true);
      else if (inAdd) commitAdd();
      else return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(element, "input", (event) => {
    const line = lineOf(event.target);
    if (line !== null) showSwatch(line, line.control.value);
  });

  life.listen(element, "change", (event) => {
    // Una scelta parte quando si fa.
    const line = lineOf(event.target);
    if (line !== null && line.control instanceof HTMLSelectElement) commitLine(line, true);
  });

  life.listen(element, "focusout", (event) => {
    if (rendering) return;
    const line = lineOf(event.target);
    if (line !== null && !(line.control instanceof HTMLSelectElement)) commitLine(line, false);
  });

  // --- Il pannello ------------------------------------------------------------

  const showSubject = (): void => {
    const { subject, count, label } = view;
    subjectLine.hidden = subject === null;
    if (subject !== null) subjectLine.textContent = t("draw.attributes.subject", { object: label, tag: subject.tag });
    empty.hidden = subject !== null;
    empty.textContent = count > 1 ? t("draw.attributes.many", { count: String(count) }) : t("draw.attributes.none");
  };

  const relabel = (): void => {
    heading.textContent = t("draw.attributes");
    for (const [th, key] of columns) th.textContent = t(key);
    addHeading.textContent = t("draw.attributes.add.title");
    addKey.setAttribute("aria-label", t("draw.attributes.add.key"));
    addButton.textContent = t("draw.attributes.add");
    addValue.setAttribute(
      "aria-label",
      adding === null ? t("draw.attributes.value") : t("draw.attributes.add.value", { key: adding }),
    );
    for (const line of lines.values()) paintLine(line, line.row, false);
    showSubject();
  };

  return {
    element,
    update(next) {
      const fresh = next.key !== view.key;
      view = next;
      showSubject();
      if (next.subject === null) {
        // Il fuoco in un campo che se ne va resta nel pannello.
        const lost = scroller.contains(document.activeElement);
        rendering = true;
        scroller.hidden = true;
        for (const line of lines.values()) line.tr.remove();
        rendering = false;
        lines = new Map();
        addable = [];
        adding = null;
        if (lost) element.focus({ preventScroll: true });
        return;
      }
      scroller.hidden = false;
      renderRows(next.subject, fresh);
      renderAdd(next.subject, fresh);
    },
    focus() {
      const first = lines.get(ID_KEY)?.control;
      if (first !== undefined && !scroller.hidden) first.focus({ preventScroll: true });
      else element.focus({ preventScroll: true });
    },
    nest(nested) {
      element.toggleAttribute("data-nested", nested);
      heading.hidden = nested;
      if (nested) element.removeAttribute("aria-labelledby");
      else element.setAttribute("aria-labelledby", heading.id);
    },
    relabel,
  };
}
