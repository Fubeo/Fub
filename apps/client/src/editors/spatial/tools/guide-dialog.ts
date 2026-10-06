// La finestra «Guide»: le guide del documento coi numeri, per chi non usa
// il puntatore e per chi vuole una posizione esatta. Una riga per guida, con
// la direzione, la posizione nell'unità del documento, il blocco e
// l'eliminazione; sotto, le guide nuove e «Elimina tutte le guide». Si
// scrive tutto insieme, con la conferma, in un passo di annulla solo.

import { iconEl } from "../../../ui/icons";
import { actions, openFrame } from "../../../ui/dialogs";
import { t as appT } from "../../../i18n/strings";
import { MAX_GUIDES, type LengthUnit, type RulerGuide } from "../scene/rulers";
import { t } from "../strings";
import { fieldText, fromUnit, toUnit, UNIT_PLACES } from "./rulers";

/// Quanto lontano dall'origine sta una guida, al più, in unità della scena:
/// oltre, un numero non si scriverebbe più a due decimali.
export const GUIDE_LIMIT = 1_000_000;

export interface GuideDialogOptions {
  /// Le guide del documento; `null` se quelle scritte non si leggono, e
  /// allora la finestra parte vuota e lo dice.
  readonly guides: readonly RulerGuide[] | null;
  readonly unit: LengthUnit;
  /// Dove va una guida nuova, nella scena: il centro di ciò che si vede.
  readonly center: readonly [number, number];
  /// La guida su cui parte il fuoco; senza, la prima.
  readonly focus?: number | null;
}

/// Una riga della finestra: la guida com'era, se c'era, e i suoi campi.
interface Row {
  readonly before: RulerGuide | null;
  readonly element: HTMLTableRowElement;
  readonly axis: HTMLSelectElement;
  readonly position: HTMLInputElement;
  readonly locked: HTMLInputElement;
  readonly remove: HTMLButtonElement;
  /// La posizione come la finestra l'ha scritta: se resta quella, la guida
  /// resta dov'era, senza arrotondamenti.
  readonly shown: string;
}

/// La sigla dell'unità, accanto al nome di un campo: niente per i pixel,
/// che sono le unità della scena.
export function unitSuffix(label: string, unit: LengthUnit): string {
  return unit === "px" ? label : `${label} (${unit})`;
}

/// Apre «Guide». Torna le guide da scrivere, nell'ordine delle righe, o
/// `null` se chi le scrive rinuncia.
export function guideDialog(options: GuideDialogOptions): Promise<readonly RulerGuide[] | null> {
  const { unit } = options;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: readonly RulerGuide[] | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(t("draw.guides.dialog.title"), () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";

    // Una frase sopra le righe: da dove si misura, o che non ci sono guide, o
    // che quelle scritte non si leggono.
    const message = document.createElement("p");
    message.id = `draw-guides-message-${++dialogs}`;
    message.className = "draw-guides-message";
    frame.overlay.setAttribute("aria-describedby", message.id);

    const table = document.createElement("table");
    table.className = "draw-guides-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const column = (text: string, hidden = false): HTMLTableCellElement => {
      const cell = document.createElement("th");
      cell.scope = "col";
      if (hidden) {
        const span = document.createElement("span");
        span.className = "sr-only";
        span.textContent = text;
        cell.append(span);
      } else {
        cell.textContent = text;
      }
      headRow.append(cell);
      return cell;
    };
    column(t("draw.guides.column.axis"));
    column(unitSuffix(t("draw.guides.column.position"), unit));
    column(t("draw.guides.locked_field"));
    column(t("draw.guide.delete"), true);
    head.append(headRow);
    const body = document.createElement("tbody");
    table.append(head, body);
    // Mille guide non stanno in una finestra: le righe scorrono, i pulsanti
    // restano sotto.
    const scroll = document.createElement("div");
    scroll.className = "draw-guides-scroll";
    scroll.append(table);

    const rows: Row[] = [];
    const min = -roundIn(toUnit(GUIDE_LIMIT, unit), unit);
    const max = roundIn(toUnit(GUIDE_LIMIT, unit), unit);

    /// Il nome di una direzione, minuscolo dentro una frase.
    const axisName = (axis: "x" | "y"): string => t(axis === "x" ? "draw.guides.vertical" : "draw.guides.horizontal").toLocaleLowerCase();

    /// I nomi dei campi seguono il numero e la direzione della riga.
    const relabel = (): void => {
      rows.forEach((row, i) => {
        const index = i + 1;
        const axis = axisName(row.axis.value === "y" ? "y" : "x");
        row.axis.setAttribute("aria-label", t("draw.guides.axis_label", { index }));
        row.position.setAttribute("aria-label", t("draw.guides.position", { index, axis }));
        row.locked.setAttribute("aria-label", t("draw.guides.locked_label", { index, axis }));
        const remove = t("draw.guides.delete_label", { index, axis });
        row.remove.setAttribute("aria-label", remove);
        row.remove.title = remove;
        explain(row, index);
      });
      scroll.hidden = rows.length === 0;
      if (options.guides === null) message.textContent = t("draw.guides.unreadable");
      else message.textContent = t(rows.length === 0 ? "draw.guides.dialog.empty" : "draw.guides.dialog.hint");
      addX.disabled = rows.length >= MAX_GUIDES;
      addY.disabled = rows.length >= MAX_GUIDES;
      clear.disabled = rows.length === 0;
    };

    /// Una posizione che non è un numero si spiega con la frase della riga.
    const explain = (row: Row, index: number): void => {
      const { position } = row;
      position.setCustomValidity(position.validity.badInput || position.value.trim() === "" ? t("draw.guides.invalid", { index }) : "");
    };

    const addRow = (guide: RulerGuide, before: RulerGuide | null): Row => {
      const element = document.createElement("tr");
      const axis = document.createElement("select");
      for (const value of ["x", "y"] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = t(value === "x" ? "draw.guides.vertical" : "draw.guides.horizontal");
        axis.append(option);
      }
      axis.value = guide.axis;
      const position = document.createElement("input");
      position.type = "number";
      position.inputMode = "decimal";
      position.step = "any";
      position.required = true;
      position.min = String(min);
      position.max = String(max);
      const shown = fieldText(guide.at, unit);
      position.value = shown;
      const lockedLabel = document.createElement("label");
      lockedLabel.className = "draw-guides-check";
      const locked = document.createElement("input");
      locked.type = "checkbox";
      locked.checked = guide.locked;
      lockedLabel.append(locked);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "draw-guides-remove";
      const trash = iconEl("trash");
      if (trash !== null) remove.append(trash);
      const cells = [axis, position, lockedLabel, remove].map((control) => {
        const cell = document.createElement("td");
        cell.append(control);
        return cell;
      });
      element.append(...cells);
      body.append(element);
      const row: Row = { before, element, axis, position, locked, remove, shown };
      rows.push(row);
      axis.addEventListener("change", relabel);
      position.addEventListener("input", () => explain(row, rows.indexOf(row) + 1));
      remove.addEventListener("click", () => {
        const at = rows.indexOf(row);
        rows.splice(at, 1);
        element.remove();
        relabel();
        // Il fuoco va alla riga che ha preso il suo posto, o a quella prima;
        // senza righe, alla prima guida nuova.
        const next = rows[at] ?? rows[at - 1];
        (next?.remove ?? addX).focus();
      });
      return row;
    };

    /// Una guida nuova al centro di ciò che si vede, a un numero tondo
    /// dell'unità.
    const addGuide = (axis: "x" | "y"): void => {
      if (rows.length >= MAX_GUIDES) return;
      const center = options.center[axis === "x" ? 0 : 1];
      const at = fromUnit(roundIn(toUnit(center, unit), unit), unit);
      const row = addRow({ axis, at: Math.max(-GUIDE_LIMIT, Math.min(GUIDE_LIMIT, at)), locked: false }, null);
      relabel();
      row.position.focus();
      row.position.select();
    };

    const tools = document.createElement("div");
    tools.className = "draw-guides-tools";
    const tool = (label: string, run: () => void): HTMLButtonElement => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      control.addEventListener("click", run);
      tools.append(control);
      return control;
    };
    const addX = tool(t("draw.guides.add_x"), () => addGuide("x"));
    const addY = tool(t("draw.guides.add_y"), () => addGuide("y"));
    const clear = tool(t("draw.guides.delete_all"), () => {
      rows.splice(0);
      body.replaceChildren();
      relabel();
      addX.focus();
    });
    clear.className = "draw-guides-clear";

    for (const guide of options.guides ?? []) addRow(guide, guide);
    relabel();

    const row = actions(appT("app.ok"), () => settle(null));
    form.append(message, scroll, tools, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      rows.forEach((each, i) => explain(each, i + 1));
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      settle(
        rows.map((each): RulerGuide => {
          const axis = each.axis.value === "y" ? "y" : "x";
          const locked = each.locked.checked;
          // Una posizione non toccata resta esatta.
          const exact = each.before !== null && each.position.value === each.shown;
          const at = exact ? each.before!.at : Math.round(fromUnit(Number(each.position.value), unit) * 100) / 100 || 0;
          return { axis, at, locked };
        }),
      );
    });
    frame.box.append(form);
    const first = rows[options.focus ?? 0] ?? rows[0];
    if (first === undefined) {
      addX.focus();
    } else {
      first.position.focus();
      first.position.select();
    }
  });
}

let dialogs = 0;

/// `value`, nell'unità, ai decimali con cui l'unità si legge.
function roundIn(value: number, unit: LengthUnit): number {
  const factor = 10 ** UNIT_PLACES[unit];
  return Math.round(value * factor) / factor || 0;
}
