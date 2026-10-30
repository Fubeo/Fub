// I passi che si scrivono: la nota da collegare o da incorporare, e il
// linguaggio del codice. Ciò che si scrive filtra l'elenco; per
// l'incorporazione, «#» dopo la nota passa ai suoi titoli, cioè alla sezione.
import { CODE_LANGUAGES, headingLinkText } from "../../../editors/text/profiles/markdown/kinds";
import { t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { fold } from "../rank";
import type { SlashStep, StepContext } from "./index";

/// Quante righe mostra l'elenco.
const SHOWN = 8;

interface Row {
  readonly label: string;
  readonly detail: string;
  readonly icon: string | null;
  readonly params: Readonly<Record<string, unknown>>;
}

interface SearchSpec {
  readonly className: string;
  readonly label: string;
  /// Le righe per ciò che si è scritto: subito o quando arrivano.
  readonly rows: (typed: string) => readonly Row[] | Promise<readonly Row[]>;
  readonly empty: (typed: string) => string;
  readonly hint: (typed: string) => string;
  /// Chiamato prima di filtrare: il passo può cambiare ciò che si cerca
  /// (l'incorporazione con «#»).
  readonly typed?: (typed: string, selected: Row | null) => void;
}

function searchStep(context: StepContext, spec: SearchSpec): SlashStep {
  const { host, life } = context;
  const dom = document.createElement("div");
  dom.className = `slash-step is-search ${spec.className}`;
  const field = document.createElement("div");
  field.className = "slash-step-field";
  field.setAttribute("aria-hidden", "true");
  const list = document.createElement("div");
  list.className = "slash-step-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", spec.label);
  dom.append(field, list);

  let typed = "";
  let rows: readonly Row[] = [];
  let cells: HTMLElement[] = [];
  let selected = 0;
  /// L'ultima ricerca chiesta: una risposta più vecchia non scrive sopra.
  let asked = 0;

  const paint = (): void => {
    cells.forEach((cell, index) => {
      cell.classList.toggle("is-selected", index === selected);
      cell.setAttribute("aria-selected", String(index === selected));
    });
    host.changed();
  };
  const show = (found: readonly Row[]): void => {
    rows = found.slice(0, SHOWN);
    selected = 0;
    cells = rows.map((row, index) => {
      const cell = document.createElement("div");
      cell.className = "slash-step-row";
      cell.id = identifier("slash-step");
      cell.setAttribute("role", "option");
      cell.dataset["index"] = String(index);
      const figure = row.icon ? iconEl(row.icon) : null;
      if (figure) cell.append(figure);
      const text = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = row.label;
      text.append(name);
      if (row.detail) {
        const detail = document.createElement("span");
        detail.textContent = row.detail;
        text.append(detail);
      }
      cell.append(text);
      return cell;
    });
    if (cells.length === 0) {
      const empty = document.createElement("div");
      empty.className = "slash-step-empty";
      empty.textContent = spec.empty(typed);
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...cells);
    }
    paint();
  };
  const refresh = (): void => {
    field.textContent = typed;
    field.classList.toggle("is-empty", typed === "");
    spec.typed?.(typed, rows[selected] ?? null);
    const ask = ++asked;
    const found = spec.rows(typed);
    if (Array.isArray(found)) {
      show(found);
      return;
    }
    void Promise.resolve(found).then((answer) => {
      if (ask === asked && !life.closed) show(answer);
    }, () => {
      if (ask === asked && !life.closed) show([]);
    });
  };
  const done = (): void => {
    const row = rows[selected];
    if (row) host.done({ params: row.params });
  };
  refresh();

  life.listen(list, "mouseover", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".slash-step-row");
    if (cell && Number(cell.dataset["index"]) !== selected) {
      selected = Number(cell.dataset["index"]);
      paint();
    }
  });
  life.listen(list, "click", (event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".slash-step-row");
    if (!cell) return;
    selected = Number(cell.dataset["index"]);
    done();
  });

  return {
    dom,
    hint: () => spec.hint(typed),
    active: () => cells[selected]?.id ?? null,
    key(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      switch (event.key) {
        case "ArrowDown":
          if (rows.length > 0) selected = (selected + 1) % rows.length;
          paint();
          return true;
        case "ArrowUp":
          if (rows.length > 0) selected = (selected - 1 + rows.length) % rows.length;
          paint();
          return true;
        case "Enter":
        case "Tab":
          done();
          return true;
        case "Backspace":
          if (typed === "") return false;
          typed = typed.slice(0, -1);
          refresh();
          return true;
      }
      if (event.key.length === 1) {
        typed += event.key;
        refresh();
        return true;
      }
      return false;
    },
    typing: () => typed !== "",
    dispose: () => {
      asked++;
    },
  };
}

/// La nota da collegare (`[[…]]`) o da incorporare (`![[…]]`); per
/// l'incorporazione, «#» passa ai titoli della nota scelta.
export function noteStep(context: StepContext, embed: boolean): SlashStep {
  const { deps } = context;
  /// La nota scelta prima del «#», finché il «#» resta.
  let note: { label: string; target: string } | null = null;
  return searchStep(context, {
    className: embed ? "is-embed" : "is-note",
    label: context.entry.label,
    typed: (typed, selected) => {
      const hash = typed.indexOf("#");
      if (!embed || hash < 0) {
        note = null;
        return;
      }
      if (!note && selected && typeof selected.params["target"] === "string") {
        note = { label: selected.label, target: selected.params["target"] };
      }
    },
    rows: (typed) => {
      const hash = typed.indexOf("#");
      if (embed && hash >= 0 && note) {
        const chosen = note;
        const wanted = fold(typed.slice(hash + 1).trim());
        return deps.headings(chosen.target).then((headings) => headings
          .map((heading) => ({ heading, text: headingLinkText(heading.text) }))
          .filter(({ text }) => text !== "" && fold(text).includes(wanted))
          .map(({ heading, text }) => ({
            label: heading.text,
            detail: `${chosen.label} · H${heading.level}`,
            icon: "fmt-h2",
            params: { target: `${chosen.target}#${text}` },
          })));
      }
      return deps.notes(typed.trim()).then((notes) => notes.map((choice) => ({
        label: choice.label,
        detail: choice.detail,
        icon: "fmt-wikilink",
        params: { target: choice.target },
      })));
    },
    empty: (typed) => (typed === "" ? t("slash.step.note.search") : t("slash.step.note.none", { query: typed })),
    hint: (typed) => (embed && !typed.includes("#") ? t("slash.step.embed.hint") : t("slash.step.note.hint")),
  });
}

/// Il linguaggio del codice: i più comuni, filtrati da ciò che si scrive. Un
/// nome che l'elenco non ha si usa così com'è.
export function codeStep(context: StepContext): SlashStep {
  const plain: Row = { label: t("slash.step.code.plain"), detail: "", icon: null, params: { language: "" } };
  return searchStep(context, {
    className: "is-code",
    label: context.entry.label,
    rows: (typed) => {
      const wanted = fold(typed.trim());
      if (wanted === "") return [plain, ...CODE_LANGUAGES.map((language) => ({ label: language, detail: "", icon: null, params: { language } }))];
      const found = CODE_LANGUAGES.filter((language) => language.startsWith(wanted))
        .concat(CODE_LANGUAGES.filter((language) => !language.startsWith(wanted) && language.includes(wanted)));
      const rows: Row[] = found.map((language) => ({ label: language, detail: "", icon: null, params: { language } }));
      if (!found.includes(wanted as (typeof CODE_LANGUAGES)[number]) && /^[a-z0-9+#-]+$/.test(wanted)) {
        rows.push({ label: wanted, detail: t("slash.step.code.other"), icon: null, params: { language: wanted } });
      }
      return rows;
    },
    empty: () => t("slash.step.code.none"),
    hint: () => t("slash.step.code.hint"),
  });
}
