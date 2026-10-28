// L'intestazione e il piè di un foglio, scritti sul posto.
//
// Un doppio clic nel margine di un foglio (o Intestazione e Piè di pagina
// nella barra) apre sopra il margine un campo con l'etichetta «Intestazione ·
// Sezione 1». Si scrive testo, una riga per paragrafo; i numeri di pagina sono
// gettoni «Pagina» e «Pagine», non codici fra graffe, e si mettono con i due
// bottoni accanto all'etichetta. Esc o un clic fuori chiudono e scrivono; il
// testo scritto diventa l'intestazione della sezione con un passo solo, che si
// annulla con Ctrl+Z.

import { textButton } from "../../kit/button";
import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { PAGE_FIELDS, writeRunning, type PageField, type Piece, type RunningText } from "./projection";

export interface RunningEditorOptions {
  /// Dove posare il campo: la scrivania.
  readonly host: HTMLElement;
  readonly kind: "header" | "footer";
  /// Il numero della sezione, da 1.
  readonly section: number;
  /// L'intestazione che il foglio mostra, sua o della sezione prima.
  readonly running: RunningText | null;
  /// La posizione del campo sulla scrivania, come stile in linea.
  readonly place: string;
  /// Il testo scritto, se è cambiato: `null` toglie l'intestazione.
  readonly commit: (running: RunningText | null) => void;
  /// Il campo si è chiuso; con `back` (Esc) il cursore torna al documento.
  readonly closed: (back: boolean) => void;
}

export interface RunningEditor {
  readonly element: HTMLElement;
  /// Chiude; con `write` scrive prima ciò che è cambiato.
  close(write: boolean): void;
}

const FIELD_KEYS = { page: "rich.running.page", pages: "rich.running.pages" } as const;

/// Un gettone di un numero: non si scrive dentro, si toglie intero.
export function fieldToken(field: PageField): HTMLElement {
  const token = document.createElement("span");
  token.className = "rich-token";
  token.dataset.field = field;
  token.contentEditable = "false";
  token.textContent = t(FIELD_KEYS[field]);
  return token;
}

/// Le righe di un'intestazione nel campo: il testo, e i numeri come gettoni.
export function fillRunning(area: HTMLElement, running: RunningText | null): void {
  const parts: (string | Node)[] = [];
  for (const [i, line] of (running?.lines ?? []).entries()) {
    if (i > 0) parts.push("\n");
    for (const piece of line) parts.push(typeof piece === "string" ? piece : fieldToken(piece.field));
  }
  area.replaceChildren(...parts);
}

/// Le righe scritte nel campo. Un campo vuoto non ha intestazione.
export function readRunning(area: HTMLElement): RunningText | null {
  const lines: Piece[][] = [[]];
  const text = (value: string) => {
    for (const [i, part] of value.split("\n").entries()) {
      if (i > 0) lines.push([]);
      if (part === "") continue;
      const line = lines[lines.length - 1]!;
      const last = line[line.length - 1];
      if (typeof last === "string") line[line.length - 1] = last + part;
      else line.push(part);
    }
  };
  const walk = (node: Node, first: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) return text(node.textContent ?? "");
    if (!(node instanceof HTMLElement)) return;
    const field = node.dataset.field;
    if (field && (PAGE_FIELDS as readonly string[]).includes(field)) {
      lines[lines.length - 1]!.push({ field: field as PageField });
      return;
    }
    if (node.tagName === "BR") return text("\n");
    // Un a capo che il browser scrive come blocco.
    if (!first && (node.tagName === "DIV" || node.tagName === "P")) text("\n");
    node.childNodes.forEach((child, i) => walk(child, first && i === 0));
  };
  area.childNodes.forEach((child, i) => walk(child, i === 0));
  // Il browser lascia un a capo in fondo per tenere il cursore sull'ultima riga.
  while (lines.length > 0 && lines[lines.length - 1]!.length === 0) lines.pop();
  return lines.length === 0 ? null : { lines };
}

export function openRunningEditor(options: RunningEditorOptions): RunningEditor {
  const life = openLifetime();
  const name = t("rich.running.label", { kind: t(`rich.hf.${options.kind}`), n: options.section });
  const root = document.createElement("div");
  root.className = "rich-running";
  root.dataset.kind = options.kind;
  root.style.cssText = options.place;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", name);
  const bar = document.createElement("div");
  bar.className = "rich-running-bar";
  const label = document.createElement("span");
  label.className = "rich-running-label";
  label.textContent = name;
  bar.append(label);
  const area = document.createElement("div");
  area.className = "rich-running-area";
  area.contentEditable = "plaintext-only";
  area.setAttribute("role", "textbox");
  area.setAttribute("aria-multiline", "true");
  area.setAttribute("aria-label", name);
  area.spellcheck = false;
  fillRunning(area, options.running);
  const said = options.running ? writeRunning(options.running) : "";
  for (const field of PAGE_FIELDS) {
    const add = textButton({
      label: t(`rich.hf.${field}`),
      lifetime: life,
      onPress: () => {
        insertToken(area, field);
        area.focus();
      },
    });
    // Il gettone va dove si scriveva: il bottone non prende il fuoco.
    life.listen(add, "mousedown", (event) => event.preventDefault());
    bar.append(add);
  }
  root.append(bar, area);
  options.host.append(root);

  let open = true;
  const close = (write: boolean, back = false) => {
    if (!open) return;
    open = false;
    if (write) {
      const running = readRunning(area);
      if ((running ? writeRunning(running) : "") !== said) options.commit(running);
    }
    life.close();
    root.remove();
    options.closed(back);
  };
  life.listen(area, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true, true);
  });
  life.listen(root, "focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    close(true);
  });
  area.focus();
  placeCaretAtEnd(area);
  return { element: root, close };
}

/// Mette un gettone dove sta il cursore del campo, o in fondo.
function insertToken(area: HTMLElement, field: PageField): void {
  const token = fieldToken(field);
  const selection = area.ownerDocument.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || !area.contains(range.commonAncestorContainer)) {
    area.append(token);
  } else {
    range.deleteContents();
    range.insertNode(token);
  }
  const after = area.ownerDocument.createRange();
  after.setStartAfter(token);
  after.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(after);
}

function placeCaretAtEnd(area: HTMLElement): void {
  const selection = area.ownerDocument.getSelection();
  if (!selection) return;
  const range = area.ownerDocument.createRange();
  range.selectNodeContents(area);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
