// La scheda Proprietà del documento, nel pannello di destra (`side.ts`).
//
// Pagina: carta coi nomi italiani, orientamento, margini (in centimetri) con
// l'anteprima del foglio, colonne. È la pagina della sezione del cursore, e
// ogni scelta si applica subito; i campi si rileggono da ciò che il documento
// ha preso. La barra tiene le gallerie veloci, e la loro voce «…» porta qui.
//
// Poi il file (formato e lingua che dice per il testo) e il conteggio, del
// documento e, se c'è, della selezione: si rifà quando cambia l'uno o l'altra.
import type { Command } from "prosemirror-state";
import { textField } from "../../kit";
import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import type { RichEngine } from "./engine";
import { choice, labelled, remark } from "./form";
import {
  columns,
  DEFAULT_PAGE,
  formatLength,
  landscape,
  MARGIN_PRESETS,
  PAPER_SIZES,
  pageAt,
  paperLabel,
  paperName,
  parseLength,
  previewVariables,
  setColumns,
  setLandscape,
  setMargins,
  setPaper,
} from "./page";
import { countText, type TextCount } from "./review";

/// I nomi dei formati che la superficie apre.
const FORMAT_NAMES: Readonly<Record<string, Key>> = {
  docx: "rich.prop.format.docx",
  odt: "rich.prop.format.odt",
  rtf: "rich.prop.format.rtf",
  doc: "rich.prop.format.doc",
};

/// Il nome di una lingua (`it-IT`) nella lingua della shell; il codice se il
/// browser non lo conosce.
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([resolvedLanguage()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface Properties {
  focus(target: "count" | undefined): void;
  close(): void;
}

/// Una parte della scheda, col suo titolo.
function section(into: HTMLElement, title: string): HTMLElement {
  const part = document.createElement("section");
  part.className = "rich-side-section";
  const heading = document.createElement("h3");
  heading.className = "rich-side-section-title";
  heading.textContent = title;
  part.append(heading);
  part.setAttribute("aria-label", title);
  into.append(part);
  return part;
}

export function mountProperties(engine: RichEngine, format: string | undefined, host: HTMLElement): Properties {
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = "rich-side rich-side-properties";
  host.append(root);
  const language = resolvedLanguage();

  // ── Pagina ───────────────────────────────────────────────────────────
  const pagePart = section(root, t("rich.page"));
  const preview = document.createElement("div");
  preview.className = "rich-side-preview";
  preview.setAttribute("role", "img");
  const sheet = document.createElement("div");
  sheet.className = "rich-side-preview-sheet";
  const text = document.createElement("div");
  text.className = "rich-side-preview-text";
  sheet.append(text);
  preview.append(sheet);
  const fields = document.createElement("div");
  fields.className = "rich-strip-panel-pairs";
  pagePart.append(preview, fields);

  // Una pagina che il codec rifiuterebbe non si prende: i campi tornano a
  // ciò che c'è, e l'avviso dice perché.
  const apply = (command: Command) => {
    const applied = engine.apply(command, false);
    fill(true);
    problem.hidden = applied;
  };
  const paper = labelled(fields, choice([...PAPER_SIZES.map((s): [string, string] => [s.name, paperLabel(s.name)]), ["", t("rich.page.custom")]]), t("rich.page.size"));
  life.listen(paper, "change", () => {
    const size = PAPER_SIZES.find((s) => s.name === paper.value);
    if (size) apply(setPaper(size.w, size.h));
  });
  const turn = labelled(
    fields,
    choice([
      ["portrait", t("rich.page.portrait")],
      ["landscape", t("rich.page.landscape")],
    ]),
    t("rich.page.orientation"),
  );
  life.listen(turn, "change", () => apply(setLandscape(turn.value === "landscape")));
  const preset = labelled(fields, choice([...MARGIN_PRESETS.map((m): [string, string] => [m.id, t(`rich.page.margins.${m.id}` as Key)]), ["", t("rich.page.custom")]]), t("rich.page.margins"));
  life.listen(preset, "change", () => {
    const margins = MARGIN_PRESETS.find((m) => m.id === preset.value);
    if (margins) apply(setMargins(margins));
  });
  const sides = (["top", "bottom", "left", "right"] as const).map((side) => {
    const field = textField({ label: t(`rich.page.${side}` as Key), lifetime: life });
    fields.append(field.element);
    const input = field.input;
    input.inputMode = "decimal";
    life.listen(input, "change", () => {
      const points = parseLength(input.value, "cm");
      const page = engine.read(pageAt)?.page;
      // Il margine lasciato com'era non si riscrive arrotondato.
      if (points === null || points === undefined || points < 0 || !page || input.value.trim() === formatLength(page[side], "cm", language)) return fill(true);
      apply(setMargins({ top: page.top, bottom: page.bottom, left: page.left, right: page.right, [side]: points }));
    });
    return { side, input };
  });
  const cols = labelled(fields, choice([1, 2, 3].map((n): [string, string] => [String(n), String(n)])), t("rich.page.columns"));
  life.listen(cols, "change", () => apply(setColumns(Number(cols.value))));
  const problem = remark(pagePart, "alert");
  problem.textContent = t("rich.page.too_large");
  problem.hidden = true;
  const fixedNote = remark(pagePart);
  fixedNote.textContent = t("rich.page.default");
  const controls = [paper, turn, preset, cols, ...sides.map(({ input }) => input)];

  // Un formato che non porta la sua pagina (l'ODT) sta su quella di
  // `DEFAULT_PAGE`: la scheda la dice com'è, e non la cambia. Mentre si
  // registra, o in sola lettura, la pagina si legge e basta.
  let shownPage: unknown = undefined;
  let shownFree: boolean | null = null;
  /// `again` riscrive i campi anche se la pagina è la stessa: una scelta
  /// rifiutata torna a ciò che c'è.
  function fill(again = false): void {
    const at = engine.read(pageAt);
    const page = at?.page ?? DEFAULT_PAGE;
    const free = at !== null && engine.editable() && !engine.tracking();
    if (!again && page === shownPage && free === shownFree) return;
    shownPage = page;
    shownFree = free;
    fixedNote.hidden = at !== null;
    for (const control of controls) control.disabled = !free;
    const name = paperName(page, PAPER_SIZES);
    paper.value = name ?? "";
    turn.value = landscape(page) ? "landscape" : "portrait";
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    preset.value = MARGIN_PRESETS.find((m) => near(m.top, page.top) && near(m.bottom, page.bottom) && near(m.left, page.left) && near(m.right, page.right))?.id ?? "";
    // Il campo in cui si sta scrivendo non si riscrive sotto le dita, se la
    // pagina è cambiata altrove.
    for (const { side, input } of sides) if (again || document.activeElement !== input) input.value = formatLength(page[side], "cm", language);
    const n = columns(page);
    if (![...cols.options].some((o) => o.value === String(n))) cols.append(choice([[String(n), String(n)]]).options[0]!);
    cols.value = String(n);
    for (const [key, value] of Object.entries(previewVariables(page))) preview.style.setProperty(key, value);
    if (text.childElementCount !== n) {
      text.replaceChildren(
        ...Array.from({ length: n }, () => {
          const column = document.createElement("div");
          column.className = "rich-side-preview-column";
          return column;
        }),
      );
    }
    preview.setAttribute(
      "aria-label",
      t("rich.prop.preview", {
        paper: name ? paperLabel(name) : t("rich.page.custom"),
        orientation: t(landscape(page) ? "rich.page.landscape" : "rich.page.portrait"),
        columns: String(n),
      }),
    );
  }

  // ── Il file ──────────────────────────────────────────────────────────
  const filePart = section(root, t("rich.prop.document"));
  const facts = document.createElement("dl");
  facts.className = "rich-side-facts";
  const fact = (label: string, value: string) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const said = document.createElement("dd");
    said.textContent = value;
    facts.append(term, said);
  };
  if (format) fact(t("rich.prop.format"), FORMAT_NAMES[format] ? t(FORMAT_NAMES[format]) : format.toUpperCase());
  const lang = engine.language();
  fact(t("rich.prop.language"), lang ? languageName(lang) : t("rich.prop.language.none"));
  filePart.append(facts);

  // ── Il conteggio ─────────────────────────────────────────────────────
  const countPart = section(root, t("rich.count"));
  countPart.tabIndex = -1;
  const table = document.createElement("table");
  table.className = "rich-strip-count";
  countPart.append(table);
  const numbers = new Intl.NumberFormat(document.documentElement.lang || undefined);
  const cell = (tag: "th" | "td", content: string, scope?: string) => {
    const el = document.createElement(tag);
    el.textContent = content;
    if (scope) el.scope = scope;
    return el;
  };
  let countedDoc: unknown = null;
  let countedSelection: unknown = null;
  function count(): void {
    const { doc, selection } = engine.read((state) => ({ doc: state.doc, selection: state.selection }));
    if (doc === countedDoc && (selection === countedSelection || (selection.empty && countedSelection === null))) return;
    countedDoc = doc;
    countedSelection = selection.empty ? null : selection;
    const columns: { label: Key; count: TextCount }[] = [
      ...(selection.empty ? [] : [{ label: "rich.count.selection" as Key, count: countText(doc, selection.from, selection.to) }]),
      { label: "rich.count.document", count: countText(doc) },
    ];
    const rows: HTMLTableRowElement[] = [];
    if (!selection.empty) {
      const head = document.createElement("tr");
      head.append(cell("td", ""), ...columns.map((column) => cell("th", t(column.label), "col")));
      rows.push(head);
    }
    for (const key of ["words", "characters", "visible", "paragraphs"] as const) {
      const row = document.createElement("tr");
      row.append(cell("th", t(`rich.count.${key}` as Key), "row"), ...columns.map((column) => cell("td", numbers.format(column.count[key]))));
      rows.push(row);
    }
    table.replaceChildren(...rows);
  }

  const draw = () => {
    fill(false);
    count();
  };
  draw();
  life.add(engine.subscribe(draw));
  return {
    focus(target) {
      if (target === "count") return countPart.focus();
      (controls.find((control) => !control.disabled) ?? countPart).focus();
    },
    close() {
      life.close();
      root.remove();
    },
  };
}
