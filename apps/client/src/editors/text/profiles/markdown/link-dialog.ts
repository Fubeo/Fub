// Il riquadro «Collegamento», come in Word: Mod-k in Live e in Blocchi.
//
// Chi scrive dice il testo da mostrare e una nota o un indirizzo; la sintassi
// la sceglie il riquadro, e la mostra prima di applicarla: una nota del vault
// diventa un wikilink, un indirizzo un link Markdown. Col cursore in un
// collegamento il riquadro lo modifica o lo toglie, lasciando il testo. In
// Sorgente Mod-k resta il wikilink di sempre (`toggleWikilink`).
import { EditorSelection, type EditorState, type Extension, Facet, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { openDialog, textField } from "../../../../kit";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { wikilink } from "../../../../rules/syntax";
import type { CompletionSources } from "./completions";
import { liveStrings } from "./strings";

/// Il collegamento che contiene una posizione.
export interface FoundLink {
  from: number;
  to: number;
  kind: "markdown" | "wikilink";
  text: string;
  target: string;
}

/// Il collegamento sotto `range`: un link Markdown con la sua destinazione o un
/// wikilink, non un'immagine né un incorporato.
export function linkAt(state: EditorState, range: { from: number; to: number }): FoundLink | null {
  const line = state.doc.lineAt(range.from);
  if (range.to > line.to) return null;
  for (const w of wikilink(line.text)) {
    const from = line.from + w.from;
    const to = line.from + w.to;
    if (w.embed || range.from < from || range.to > to) continue;
    if (range.from === to && range.to === to) continue;
    return { from, to, kind: "wikilink", text: w.alias ?? w.target, target: w.target };
  }
  for (let node = syntaxTree(state).resolveInner(range.from, 1); node; node = node.parent!) {
    if (node.name === "Link" && node.from <= range.from && range.to <= node.to) {
      const marks = node.getChildren("LinkMark");
      const url = node.getChild("URL");
      if (marks.length < 2 || !url || node.from === range.to && range.from === range.to) return null;
      const href = state.sliceDoc(url.from, url.to);
      return {
        from: node.from,
        to: node.to,
        kind: "markdown",
        text: state.sliceDoc(marks[0]!.to, marks[1]!.from),
        target: href.startsWith("<") && href.endsWith(">") ? href.slice(1, -1) : href,
      };
    }
    if (!node.parent) break;
  }
  return null;
}

/// Un indirizzo e non il nome di una nota: ha uno schema (`https:`, `mailto:`)
/// o comincia con `www.`.
export function isAddress(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || /^www\./i.test(target);
}

/// Ciò che il riquadro scrive per un testo e una destinazione.
export function linkSyntax(text: string, target: string): string {
  const goal = target.trim();
  if (isAddress(goal)) {
    const href = /^www\./i.test(goal) ? `https://${goal}` : goal;
    const destination = /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, "")}>` : href;
    const label = (text || goal).replace(/([\\[\]])/g, "\\$1");
    return `[${label}](${destination})`;
  }
  const page = goal.replace(/[[\]|]/g, "");
  const label = text.replace(/[[\]|]/g, "").trim();
  return label && label !== page ? `[[${page}|${label}]]` : `[[${page}]]`;
}

type Answer = "apply" | "remove" | null;

/// Apre il riquadro sulla selezione principale della vista.
export function openLinkDialog(view: EditorView, searchNotes: CompletionSources["searchNotes"], owner: Lifetime): void {
  const { state } = view;
  const selection = state.selection.main;
  const found = linkAt(state, selection);
  const replaceFrom = found ? found.from : selection.from;
  const replaceTo = found ? found.to : selection.to;
  const t = liveStrings.t;

  const own = openLifetime();
  owner.add(() => own.close());
  const body = document.createElement("div");
  body.className = "md-link-dialog";
  const preview = document.createElement("p");
  preview.className = "md-link-dialog-preview";
  const code = document.createElement("code");
  const suggestions = document.createElement("ul");
  suggestions.className = "md-link-dialog-notes";
  suggestions.setAttribute("aria-label", t("live.link.notes"));
  // L'elenco sta nel riquadro soltanto quando propone qualcosa.
  const showNotes = (items: HTMLElement[]): void => {
    suggestions.replaceChildren(...items);
    if (items.length) preview.before(suggestions);
    else suggestions.remove();
  };
  const update = (): void => {
    const target = targetField.value().trim();
    code.textContent = target ? linkSyntax(textField_.value(), target) : "";
    preview.hidden = !target;
  };
  const textField_ = textField({
    label: t("live.link.text"),
    value: found ? found.text : state.sliceDoc(selection.from, selection.to),
    lifetime: own,
    onInput: update,
  });
  let asked = 0;
  const targetField = textField({
    label: t("live.link.target"),
    placeholder: t("live.link.target.placeholder"),
    value: found?.target ?? "",
    lifetime: own,
    onInput(value) {
      update();
      const question = ++asked;
      showNotes([]);
      if (!value.trim() || isAddress(value.trim())) return;
      void searchNotes(value.trim()).then((names) => {
        if (question !== asked || own.closed) return;
        showNotes(names.slice(0, 6).map((name) => {
          const item = document.createElement("li");
          const choose = document.createElement("button");
          choose.type = "button";
          choose.className = "md-link-dialog-note";
          choose.textContent = name;
          own.listen(choose, "click", () => {
            targetField.setValue(name);
            showNotes([]);
            update();
            targetField.focus();
          });
          item.append(choose);
          return item;
        }));
      }, () => {});
    },
  });
  preview.append(t("live.link.preview"), " ", code);
  body.append(textField_.element, targetField.element, preview);
  update();

  const dialog = openDialog<Answer>({
    title: found ? t("live.link.edit") : t("live.link.title"),
    body,
    actions: [
      { id: "cancel", label: t("live.link.cancel"), value: null },
      ...(found ? [{ id: "remove", label: t("live.link.remove"), value: "remove" as const }] : []),
      { id: "apply", label: t("live.link.apply"), kind: "primary" as const, value: "apply" as const },
    ],
    dismissValue: null,
    lifetime: own,
    submit: "apply",
    confirm: (answer) => answer !== "apply" || targetField.value().trim() !== "",
    className: "md-link-dialog-surface",
  });
  void dialog.result.then((answer) => {
    const text = textField_.value();
    const target = targetField.value();
    own.close();
    if (!answer || view.state.doc !== state.doc) {
      view.focus();
      return;
    }
    const insert = answer === "remove" ? found!.text : linkSyntax(text, target);
    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert },
      selection: EditorSelection.cursor(replaceFrom + insert.length),
      userEvent: "input",
      scrollIntoView: true,
    });
    view.focus();
  });
  // Il fuoco va al campo che manca: la destinazione, se il testo c'è già.
  (textField_.value() ? targetField : textField_).focus();
}

/// Chi apre il riquadro sulla vista: la pastiglia di un collegamento lo chiede
/// da qui, senza sapere da dove arrivano le note.
export const linkDialogOpener = Facet.define<(view: EditorView) => void, ((view: EditorView) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/// Mod-k in Live: il riquadro, sopra il wikilink del profilo. Il riquadro
/// aperto si chiude con la vista.
export function linkDialog(searchNotes: CompletionSources["searchNotes"]): Extension {
  const owner = ViewPlugin.fromClass(class {
    readonly lifetime = openLifetime();
    destroy() { this.lifetime.close(); }
  });
  const open = (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const lifetime = view.plugin(owner)?.lifetime;
    if (!lifetime) return false;
    openLinkDialog(view, searchNotes, lifetime);
    return true;
  };
  return [
    owner,
    linkDialogOpener.of((view) => { open(view); }),
    Prec.highest(keymap.of([{ key: "Mod-k", run: open }])),
  ];
}
