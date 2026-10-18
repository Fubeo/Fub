// La finestra di «Rendi modificabile»: il disegno prima e dopo, uno accanto
// all'altro, con ciò che resta com'è sbiadito nel dopo; a parole quante parti
// diventano modificabili e quante restano, quanti elementi riscrive ogni
// traduzione, e per ogni parte che resta il perché. Si conferma o si
// rinuncia, col fuoco sulla conferma; se niente cambierebbe c'è soltanto
// «Chiudi». Le due anteprime si guardano: la frase e gli elenchi dicono
// tutto anche a chi non le vede.

import { actions, openFrame } from "../../../ui/dialogs";
import { t as shellT } from "../../../i18n/strings";
import { SourceText } from "../scene/text";
import { NS_NONE, parseXml, type NodeId, type XmlDocument } from "../scene/xml";
import { plural, t, type DrawKey } from "../strings";
import type { EditablePlan, Leftover, Reason, Translation } from "./make-editable";

export interface EditableDialogOptions {
  readonly plan: EditablePlan;
  /// Su tutto il disegno, o su una parte.
  readonly all: boolean;
  /// Il documento non è ancora del formato: lo stesso passo lo adotta.
  readonly adopts: boolean;
  /// Le anteprime, come URL: prima e dopo; `null` dove non si fanno.
  readonly before: string | null;
  readonly after: string | null;
}

/// L'opacità di ciò che resta com'è, nell'anteprima di dopo.
export const FADED_OPACITY = 0.25;

/// Quante parti che restano l'elenco nomina; delle altre dice quante sono.
export const LISTED_LEFTOVERS = 100;

/// Quanti caratteri di un selettore o di una regola si citano.
const QUOTED = 60;

/// Le traduzioni nell'ordine dell'elenco, con le loro parole.
const CHANGES: ReadonlyArray<readonly [Translation, DrawKey]> = [
  ["style", "draw.editable.change.style"],
  ["sheet", "draw.editable.change.sheet"],
  ["color", "draw.editable.change.color"],
  ["unit", "draw.editable.change.unit"],
  ["data", "draw.editable.change.data"],
  ["text", "draw.editable.change.text"],
  ["resource", "draw.editable.change.resource"],
  ["svg", "draw.editable.change.svg"],
  ["use", "draw.editable.change.use"],
];

let dialogs = 0;

/// Il testo di `text` con ciò che sta ai percorsi `paths` (gli indici dei
/// figli elemento dalla radice) sbiadito: un `opacity` con `!important` in
/// coda al suo `style`, che vince sui fogli e sugli attributi senza cambiare
/// la struttura che i fogli scelgono. Un percorso che non porta a niente
/// non conta; un testo che non si legge torna com'è.
export function fadedMarkup(text: string, paths: readonly (readonly number[])[], opacity = FADED_OPACITY): string {
  if (paths.length === 0) return text;
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(text), false);
  } catch {
    return text;
  }
  if (doc.element(doc.root) === null) return text;
  const declaration = `opacity:${opacity}!important`;
  const edits = new Map<number, string>();
  for (const path of paths) {
    let at: NodeId | undefined = doc.root;
    for (const index of path) {
      at = doc.children(at).filter((id) => doc.element(id) !== null)[index];
      if (at === undefined) break;
    }
    if (at === undefined || at === doc.root) continue;
    const node = doc.element(at)!;
    const style = node.attrs.find((attr) => attr.ns === NS_NONE && attr.local === "style");
    if (style !== undefined) edits.set(style.raw[1], `;${declaration}`);
    else {
      // Prima di `>`, o di `/>` in un tag autochiuso.
      const end = node.openEnd - (node.closeStart === null && text[node.openEnd - 2] === "/" ? 2 : 1);
      edits.set(end, ` style="${declaration}"`);
    }
  }
  let out = text;
  for (const offset of [...edits.keys()].sort((a, b) => b - a)) out = out.slice(0, offset) + edits.get(offset)! + out.slice(offset);
  return out;
}

/// Un selettore o una regola, al più [`QUOTED`] caratteri.
function quoted(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= QUOTED ? flat : `${flat.slice(0, QUOTED - 1)}…`;
}

/// Il perché di una parte che resta, a parole.
export function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case "element":
      return t("draw.editable.reason.element", { tag: reason.tag });
    case "use":
      return t("draw.editable.reason.use");
    case "place":
      return t("draw.editable.reason.place", { tag: reason.tag });
    case "attribute":
      return t("draw.editable.reason.attribute", { name: reason.name });
    case "missing":
      return t("draw.editable.reason.missing", { name: reason.name });
    case "property":
      return t("draw.editable.reason.property", { name: reason.name, value: quoted(reason.value) });
    case "condition":
      return t("draw.editable.reason.condition", { text: quoted(reason.text) });
    case "selector":
      return t("draw.editable.reason.selector", { text: quoted(reason.text) });
    case "shared":
      return t("draw.editable.reason.shared", { text: quoted(reason.text) });
    case "structure":
      return t("draw.editable.reason.structure");
    case "import":
      return t("draw.editable.reason.import");
    case "unit":
      return t("draw.editable.reason.unit", { value: quoted(reason.value) });
    case "resource":
      return t("draw.editable.reason.resource", { id: reason.id });
    case "copy":
      return t("draw.editable.reason.copy");
    case "linked":
      return t("draw.editable.reason.linked", { id: reason.id });
    case "locked":
      return t("draw.editable.reason.locked");
    case "text":
      return t("draw.editable.reason.text");
    case "child":
      return t("draw.editable.reason.child", { tag: reason.tag });
    case "unknown":
      return t("draw.editable.reason.unknown");
  }
}

/// Una parte che resta, a parole: il nome, o il tag, e il perché.
export function leftoverText(leftover: Leftover): string {
  return t("draw.editable.left.item", { name: t("draw.editable.named", { name: leftover.name ?? leftover.tag }), reason: reasonText(leftover.reason) });
}

/// La frase della finestra: quante parti diventano modificabili e quante
/// restano, ciò che non si vede e resta, e l'adozione.
export function editableMessage(options: Pick<EditableDialogOptions, "plan" | "adopts">): string {
  const { plan } = options;
  const parts = [plan.converted === 0 ? t("draw.editable.nothing") : plural(plan.converted, "draw.editable.converted.one", "draw.editable.converted.other")];
  // Sul disegno intero i fogli si puliscono anche se niente diventa
  // modificabile.
  if (plan.converted === 0 && plan.rules + plan.sheets > 0) parts.push(t("draw.editable.tidy"));
  if (plan.leftovers.length > 0) parts.push(plural(plan.leftovers.length, "draw.editable.left.one", "draw.editable.left.other"));
  if (plan.invisible > 0) parts.push(plural(plan.invisible, "draw.editable.invisible.one", "draw.editable.invisible.other"));
  if (options.adopts && plan.ops.length > 0) parts.push(t("draw.editable.adopt"));
  return parts.join(" ");
}

/// Le righe dell'elenco delle traduzioni: quanti elementi ne ha avuta
/// ognuna, e quante regole e quanti fogli se ne vanno.
export function changeLines(plan: EditablePlan): string[] {
  const lines: string[] = [];
  for (const [kind, label] of CHANGES) {
    const count = plan.translations.get(kind) ?? 0;
    if (count > 0) lines.push(t("draw.editable.change", { label: t(label), count }));
  }
  if (plan.rules > 0) lines.push(t("draw.editable.change", { label: t("draw.editable.change.rules"), count: plan.rules }));
  if (plan.sheets > 0) lines.push(t("draw.editable.change", { label: t("draw.editable.change.sheets"), count: plan.sheets }));
  return lines;
}

/// Apre la finestra: vero se chi disegna conferma. Senza niente da fare si
/// chiude soltanto, e rende falso.
export function editableDialog(options: EditableDialogOptions): Promise<boolean> {
  const { plan } = options;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(t(options.all ? "draw.editable.title.all" : "draw.editable.title"), () => settle(false));
    const form = document.createElement("form");
    form.className = "palette-form draw-editable-form";
    const message = document.createElement("p");
    message.id = `draw-editable-${++dialogs}`;
    message.className = "draw-editable-message";
    message.textContent = editableMessage(options);
    frame.overlay.setAttribute("aria-describedby", message.id);

    const side = (label: string, url: string | null): HTMLElement => {
      const figure = document.createElement("figure");
      figure.className = "draw-editable-side";
      const holder = document.createElement("span");
      holder.className = "draw-editable-frame";
      if (url !== null) {
        const image = document.createElement("img");
        image.className = "draw-editable-preview";
        image.alt = "";
        image.draggable = false;
        image.src = url;
        holder.append(image);
      }
      const caption = document.createElement("figcaption");
      caption.className = "draw-editable-caption";
      caption.textContent = label;
      figure.append(holder, caption);
      return figure;
    };
    const pair = document.createElement("div");
    pair.className = "draw-editable-pair";
    pair.setAttribute("aria-hidden", "true");
    const afterLabel = t(plan.leftovers.length > 0 && plan.ops.length > 0 ? "draw.editable.after.faded" : "draw.editable.after");
    pair.append(side(t("draw.editable.before"), options.before), side(afterLabel, options.after));
    form.append(message);
    if (plan.ops.length > 0) form.append(pair);

    // Gli elenchi stanno in una zona che scorre: la frase e i pulsanti
    // restano in vista.
    const details = document.createElement("div");
    details.className = "draw-editable-details";
    const section = (heading: DrawKey, lines: readonly string[], more: string | null): void => {
      if (lines.length === 0) return;
      const title = document.createElement("h3");
      title.className = "draw-editable-heading";
      title.id = `draw-editable-${++dialogs}`;
      title.textContent = t(heading);
      const list = document.createElement("ul");
      list.className = "draw-editable-list";
      list.setAttribute("aria-labelledby", title.id);
      for (const line of lines) {
        const item = document.createElement("li");
        item.textContent = line;
        list.append(item);
      }
      if (more !== null) {
        const item = document.createElement("li");
        item.className = "draw-editable-more";
        item.textContent = more;
        list.append(item);
      }
      details.append(title, list);
    };
    section("draw.editable.changes", changeLines(plan), null);
    const listed = plan.leftovers.slice(0, LISTED_LEFTOVERS);
    const rest = plan.leftovers.length - listed.length;
    section("draw.editable.left.heading", listed.map(leftoverText), rest > 0 ? plural(rest, "draw.editable.left.more.one", "draw.editable.left.more.other") : null);
    if (details.childElementCount > 0) form.append(details);

    let row: HTMLElement;
    if (plan.ops.length > 0) {
      row = actions(t("draw.editable.ok"), () => settle(false));
    } else {
      row = document.createElement("div");
      row.className = "palette-actions";
      const close = document.createElement("button");
      close.type = "submit";
      close.className = "primary";
      close.textContent = shellT("app.close");
      row.append(close);
    }
    form.append(row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle(plan.ops.length > 0);
    });
    frame.box.append(form);
    row.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  });
}
