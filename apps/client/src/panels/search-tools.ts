// Gli strumenti sotto la casella di ricerca: le opzioni, «Sostituisci» e
// «Salva ricerca».
//
// **Le opzioni cambiano la domanda, non la lingua.** La casella resta la sintassi
// di sempre; maiuscole, parola intera, espressione regolare e tolleranza sono
// interruttori che `rules/search-options.ts` applica alla query già letta. Sono
// quattro e non di più: sono quanto la porta di ricerca sa fare.
//
// **Sostituire è un comando come gli altri** (`vault.replace`): si chiede prima
// il piano (`dry_run`), lo si legge, e solo allora lo si applica. Dopo, l'esito
// porta il suo «Annulla» (`outcome.undo`), la stessa strada della palette. Si
// sostituisce un testo semplice: una query con operatori o un modello non ha una
// stringa sola da sostituire, e il pulsante lo dice invece di indovinare.
import type { CommandOutcome, CommandPlan } from "../host/contract";
import { COMMANDS } from "../host/contract";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { NO_OPTIONS, type SearchOptionName, type SearchOptions } from "../rules/search-options";
import { deliverOutcome, planLines } from "../ui/palette";
import { paletteHost } from "../state/palette-host";
import { addBookmark } from "../state/bookmarks";
import { promptText } from "../ui/dialogs";
import { notify } from "../ui/notify";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

/// Che cosa la ricerca sa dire a chi sostituisce: la stringa da cercare e le
/// note fra cui, oppure perché non si può.
export type Replacement =
  | { readonly find: string; readonly docs: readonly string[]; readonly wholeWord: boolean }
  | { readonly reason: "empty" | "not_text" | "too_many" };

export interface SearchToolsHost {
  readonly input: HTMLInputElement;
  /// La ricerca va rifatta: un'opzione è cambiata o una sostituzione è avvenuta.
  rerun(): void;
  /// Ciò che si sostituirebbe adesso.
  replacement(): Promise<Replacement>;
}

export interface SearchTools {
  options(): SearchOptions;
  /// La query è cambiata: un piano letto per quella di prima non vale più.
  invalidate(): void;
  /// Disattiva gli strumenti (cambio vault): opzioni spente, piano scartato.
  reset(): void;
}

const OPTION_BUTTONS: readonly { name: SearchOptionName; glyph: string; label: Parameters<typeof t>[0] }[] = [
  { name: "caseSensitive", glyph: "Aa", label: "search.option.case" },
  { name: "wholeWord", glyph: "ab|", label: "search.option.word" },
  { name: "regex", glyph: ".*", label: "search.option.regex" },
  { name: "typos", glyph: "~", label: "search.option.typos" },
];

type Prepared = { readonly note: string } | { readonly args: Record<string, unknown>; readonly plan: CommandPlan };

const NOT_REPLACEABLE = {
  empty: "search.replace.empty",
  not_text: "search.replace.not_text",
  too_many: "search.replace.too_many",
} as const;

export function mountSearchTools(lifetime: Lifetime, host: SearchToolsHost): SearchTools {
  let options: SearchOptions = NO_OPTIONS;
  const race = new Race();
  /// Il piano che l'utente sta guardando, con gli argomenti che lo hanno dato:
  /// «Applica» riusa **quelli**, non quello che la casella dice adesso.
  let pending: { args: Record<string, unknown>; plan: CommandPlan } | null = null;

  const bar = document.createElement("div");
  bar.className = "search-options";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", t("search.options"));
  const toggles = new Map<SearchOptionName, HTMLButtonElement>();
  for (const spec of OPTION_BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-action search-option";
    button.textContent = spec.glyph;
    button.setAttribute("aria-label", t(spec.label));
    button.setAttribute("aria-pressed", "false");
    setTooltip(button, t(spec.label));
    lifetime.listen(button, "click", () => {
      options = { ...options, [spec.name]: !options[spec.name] };
      sync();
      invalidate();
      host.rerun();
    });
    toggles.set(spec.name, button);
    bar.append(button);
  }
  const replaceToggle = document.createElement("button");
  replaceToggle.type = "button";
  replaceToggle.className = "search-action";
  replaceToggle.textContent = t("search.replace.toggle");
  replaceToggle.setAttribute("aria-expanded", "false");
  const save = document.createElement("button");
  save.type = "button";
  save.className = "search-action";
  save.textContent = t("search.save");
  setTooltip(save, t("search.save.hint"));
  bar.append(replaceToggle, save);

  const region = document.createElement("div");
  region.className = "search-replace";
  region.hidden = true;
  const field = document.createElement("input");
  field.type = "text";
  field.id = "search-replace-input";
  field.className = "search-input";
  field.setAttribute("autocomplete", "off");
  field.setAttribute("spellcheck", "false");
  field.placeholder = t("search.replace.placeholder");
  const label = document.createElement("label");
  label.className = "sr-only";
  label.htmlFor = field.id;
  label.textContent = t("search.replace.label");
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "search-action";
  preview.textContent = t("palette.preview");
  const plan = document.createElement("div");
  plan.className = "search-replace-plan";
  plan.setAttribute("role", "status");
  plan.setAttribute("aria-live", "polite");
  const entry = document.createElement("div");
  entry.className = "search-replace-entry";
  entry.append(field, preview);
  region.append(label, entry, plan);
  host.input.after(bar, region);
  lifetime.add(() => {
    race.cancel();
    bar.remove();
    region.remove();
  });

  function sync(): void {
    for (const [name, button] of toggles) button.setAttribute("aria-pressed", String(options[name]));
  }

  function invalidate(): void {
    race.cancel();
    pending = null;
    plan.replaceChildren();
  }

  function say(text: string): void {
    pending = null;
    plan.replaceChildren();
    const line = document.createElement("p");
    line.className = "search-replace-note";
    line.textContent = text;
    plan.append(line);
  }

  function showPlan(args: Record<string, unknown>, found: CommandPlan): void {
    plan.replaceChildren();
    if (found.docs.length === 0) {
      say(t("search.replace.nothing"));
      return;
    }
    pending = { args, plan: found };
    const summary = document.createElement("p");
    summary.className = "search-replace-note";
    summary.textContent = found.summary;
    const list = document.createElement("ul");
    list.className = "plain-list search-replace-docs";
    for (const text of planLines(found)) {
      const row = document.createElement("li");
      row.textContent = text;
      list.append(row);
    }
    const actions = document.createElement("div");
    actions.className = "search-replace-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "search-action search-replace-apply";
    apply.textContent = t("palette.apply");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "search-action";
    cancel.textContent = t("app.cancel");
    apply.addEventListener("click", () => void commit());
    cancel.addEventListener("click", () => {
      invalidate();
      preview.focus();
    });
    actions.append(apply, cancel);
    plan.append(summary, list, actions);
    apply.focus();
  }

  /// Chiede il piano. Prima i buffer sporchi: sostituire in un file che ha
  /// modifiche non salvate le perderebbe o le taglierebbe a metà.
  ///
  /// L'errore diventa un valore **prima** del cancello di `Race`: un `catch`
  /// dentro il corpo ingoierebbe anche la scadenza.
  async function prepare(): Promise<Prepared> {
    const target = await host.replacement();
    if ("reason" in target) return { note: t(NOT_REPLACEABLE[target.reason]) };
    const unsaved = await paletteHost.flushPendingSave();
    if (unsaved.length > 0) return { note: t("document.unsaved_blocks", { doc: unsaved.join(", ") }) };
    const args: Record<string, unknown> = {
      find: target.find,
      replace: field.value,
      docs: [...target.docs],
      ...(target.wholeWord ? { whole_word: true } : {}),
    };
    const outcome = await api.invokeCommand(COMMANDS.replace, args, "dry_run");
    if (outcome.effect.kind !== "plan") return { note: outcome.notify ?? t("search.replace.nothing") };
    return { args, plan: outcome.effect };
  }

  async function ask(): Promise<void> {
    invalidate();
    await race.last(async (expected) => {
      const step = await expected(prepare().catch((error: unknown): Prepared => ({ note: errorText(error) })));
      if ("note" in step) say(step.note);
      else showPlan(step.args, step.plan);
    });
  }

  async function commit(): Promise<void> {
    const approved = pending;
    if (!approved) return;
    invalidate();
    try {
      // Il piano è stato letto con certi buffer salvati: se nel frattempo ne è
      // sporcato uno, si chiede di nuovo invece di scrivere su un file mutato.
      const unsaved = await paletteHost.flushPendingSave();
      if (unsaved.length > 0) {
        say(t("document.unsaved_blocks", { doc: unsaved.join(", ") }));
        return;
      }
      const outcome: CommandOutcome = await api.invokeCommand(COMMANDS.replace, approved.args, "apply");
      await deliverOutcome(outcome, paletteHost, COMMANDS.replace);
      host.rerun();
    } catch (error) {
      say(errorText(error));
    }
  }

  lifetime.listen(replaceToggle, "click", () => {
    const open = region.hidden;
    region.hidden = !open;
    replaceToggle.setAttribute("aria-expanded", String(open));
    if (open) field.focus();
    else invalidate();
  });
  lifetime.listen(preview, "click", () => void ask());
  lifetime.listen(field, "input", invalidate);
  lifetime.listen(field, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void ask();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      replaceToggle.click();
      replaceToggle.focus();
    }
  });
  lifetime.listen(save, "click", () => {
    void saveSearch(host.input.value.trim());
  });

  return {
    options: () => options,
    invalidate,
    reset() {
      options = NO_OPTIONS;
      sync();
      field.value = "";
      region.hidden = true;
      replaceToggle.setAttribute("aria-expanded", "false");
      invalidate();
    },
  };
}

/// Salva la ricerca fra i segnalibri, con un nome scelto. Una casella vuota non
/// ha niente da salvare.
async function saveSearch(query: string): Promise<void> {
  if (query === "") {
    notify(t("search.save.empty"), "info");
    return;
  }
  const title = await promptText({ title: t("search.save"), label: t("bookmarks.name_title"), value: query });
  if (title === null) return;
  if (addBookmark(title, { k: "search", query })) notify(t("search.save.done"), "info");
  else notify(t("bookmarks.save_failed"), "guasto");
}
