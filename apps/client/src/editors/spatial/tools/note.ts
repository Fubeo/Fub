// Le note delle annotazioni (formato delle annotazioni, §4): un `text` con
// `fub:note`, che porta il corpo esteso, e l'etichetta disegnata sulla
// pagina come unica riga.
//
// Il corpo si scrive in un dialogo, con l'etichetta accanto: l'etichetta è
// ciò che si vede sulla pagina, e se resta vuota è la prima riga del corpo,
// accorciata. Così una nota ha sempre un testo visibile, e nessuna nota si
// riconosce solo dal colore. *(Proposta del 3 ottobre 2026, da rivedere.)*

import { t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { actions, openFrame } from "../../../ui/dialogs";
import { formatNumber } from "../number";
import { paragraph } from "../scene/analysis";
import { isNoteBody, noteBody } from "../scene/annotations";
import type { Point } from "../scene/matrix";
import { parseFragment, scopeOf, type LeafNode } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { NS_FUB, SVG_NS, valueOf } from "../scene/xml";

/// Il carattere delle note, come nell'esempio del formato.
export const NOTE_FONT = "Inter, sans-serif";

/// La dimensione delle note, in punti.
export const NOTE_SIZE = 12;

/// Quanti caratteri dell'inizio del corpo fanno l'etichetta, se non la si
/// scrive.
const LABEL_LENGTH = 40;

export interface NoteText {
  /// Il corpo esteso, coi ritorni a capo come `\n`.
  readonly body: string;
  /// L'etichetta sulla pagina, una riga.
  readonly label: string;
}

/// L'etichetta di una nota: quella scritta, su una riga, o l'inizio della
/// prima riga del corpo.
export function noteLabel(body: string, label: string): string {
  const written = label.replace(/\s+/g, " ").trim();
  if (written !== "") return written;
  const first = body.split("\n").find((line) => line.trim() !== "")?.replace(/\s+/g, " ").trim() ?? "";
  const chars = [...first];
  return chars.length <= LABEL_LENGTH ? first : `${chars.slice(0, LABEL_LENGTH - 1).join("").trimEnd()}…`;
}

/// Il corpo e il testo disegnato di una nota, come li legge il lettore delle
/// annotazioni; `null` se l'elemento non è una nota.
export function readNote(leaf: LeafNode): NoteText | null {
  if (leaf.parent === null || leaf.facts.uri !== SVG_NS || leaf.facts.local !== "text") return null;
  const fragment = parseFragment(leaf.raw, scopeOf(leaf.parent));
  if (fragment === null) return null;
  const value = valueOf(fragment.doc.element(fragment.id)!, NS_FUB, "note");
  const body = value === undefined ? "" : noteBody(value);
  return isNoteBody(body) ? { body, label: paragraph(fragment.doc, fragment.id) } : null;
}

/// L'elemento di una nota nuova, con l'etichetta che parte da `at`. Ogni
/// ritorno a capo del corpo si scrive `&#10;`, anche se arriva come CRLF.
export function noteElem(id: string, at: Point, color: string, note: NoteText): Elem {
  const x = formatNumber(at[0], 2);
  const y = formatNumber(at[1], 2);
  return {
    tag: "text",
    attrs: { id, x, y, fill: color, "font-family": NOTE_FONT, "font-size": String(NOTE_SIZE), "fub:note": noteBody(note.body) },
    children: [{ tag: "tspan", attrs: { x, dy: "0" }, text: note.label }],
  };
}

export interface NoteDialog {
  /// Il corpo e l'etichetta di una nota che si cambia; assente per una nuova.
  readonly note?: NoteText;
}

/// Chiede corpo ed etichetta: `null` se si annulla. Il corpo vuoto, o di soli
/// spazi, non fa una nota e il dialogo non si chiude.
export function promptNote(options: NoteDialog = {}): Promise<NoteText | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: NoteText | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const editing = options.note !== undefined;
    const frame = openFrame(t(editing ? "draw.note.edit" : "draw.note.new"), () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";
    form.noValidate = true;

    const bodyField = document.createElement("label");
    const bodyName = document.createElement("span");
    bodyName.className = "palette-label";
    bodyName.textContent = t("draw.note.body");
    const body = document.createElement("textarea");
    body.rows = 5;
    body.required = true;
    body.value = options.note?.body ?? "";
    bodyField.append(bodyName, body);

    const labelField = document.createElement("label");
    const labelName = document.createElement("span");
    labelName.className = "palette-label";
    labelName.textContent = t("draw.note.label");
    const label = document.createElement("input");
    label.type = "text";
    label.autocomplete = "off";
    label.value = options.note?.label ?? "";
    labelField.append(labelName, label);

    // L'etichetta che si scriverà, se il campo resta vuoto: si vede mentre si
    // scrive il corpo.
    const showDefault = (): void => {
      label.placeholder = noteLabel(noteBody(body.value), "");
    };
    body.addEventListener("input", () => {
      showDefault();
      body.removeAttribute("aria-invalid");
      error.hidden = true;
    });
    showDefault();

    const error = document.createElement("p");
    error.className = "palette-error";
    error.id = identifier("draw-note-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    body.setAttribute("aria-describedby", error.id);

    const row = actions(t(editing ? "draw.note.save" : "draw.note.add"), () => settle(null));
    form.append(bodyField, labelField, error, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = noteBody(body.value);
      if (!isNoteBody(text)) {
        error.textContent = t("draw.note.empty");
        error.hidden = false;
        body.setAttribute("aria-invalid", "true");
        body.focus();
        return;
      }
      settle({ body: text, label: noteLabel(text, label.value) });
    });
    // Ctrl+Invio conferma anche dal corpo, dove Invio va a capo.
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    frame.box.append(form);
    body.focus();
  });
}
