// **La finestra in cui si guarda una ricetta prima di accenderla** (piano A1,
// T12; prototipo `PLAN-ui/ricette.html`).
//
// Accendere una ricetta è un consenso: vale per il testo che la persona ha
// davanti, e l'impronta che `recipeAdopt` riceve è quella che questa finestra
// ha mostrato. Per questo:
//
// - titolo e descrizione sono parole di chi ha scritto la ricetta, e la riga
//   d'origine lo dice; i passi, la portata e la prova li scrive Fub, dal
//   registro vivo (il titolo vero di ogni comando, gli argomenti in parole, i
//   valori fissi in chiaro);
// - tutti i passi sono sempre visibili, mai piegati: un passo nascosto sarebbe
//   un passo accettato senza vederlo. Con venti passi scorre la finestra;
// - il fuoco parte da «Non ora», così un Invio distratto non accende niente, ed
//   Escape vale «Non ora»;
// - se la nota della ricetta cambia mentre la finestra è aperta (l'evento del
//   kernel, o il `conflict` dell'host per l'impronta vecchia), «Accendi» si
//   ferma finché la persona non rilegge.
//
// La finestra è un `openDialog` del kit con la classe `recipe-dialog`: la
// trappola del fuoco, il velo e la pila sono i suoi.
import { api } from "../host/ipc";
import type { CommandPlan, CommandReach, ParamSpec, RecipeInfo, RecipeStepInfo } from "../host/contract";
import { errorText, isErrorKind } from "../host/errors";
import { t, type Key } from "../i18n/strings";
import { openDialog, type DialogAction } from "../kit/dialog";
import { textButton } from "../kit/button";
import { onEvent } from "../state/kernel";
import { identifier } from "../ui/a11y";
import { allCommands, displayBinding, keyboardPlatform } from "../ui/commands";
import { openLifetime, type Lifetime } from "../ui/lifetime";

/// Come si chiude la finestra: accesa, o lasciata com'era.
export type RecipeDialogAnswer = "adopted" | "later";

export interface RecipeDialogOptions {
  recipe: RecipeInfo;
  /// Chiuderla chiude la finestra come «Non ora».
  lifetime: Lifetime;
  /// La nota aperta su cui provarla; `null` se non ce n'è una.
  openNote: string | null;
}

export interface RecipeDialog {
  readonly element: HTMLElement;
  readonly result: Promise<RecipeDialogAnswer>;
}

// --- gli argomenti in parole --------------------------------------------------

/// I segnaposto del contratto delle ricette (`docs/reference/ricette.md`), con
/// le parole che li dicono a chi guarda. `{{param.<nome>}}` ha la sua frase.
const PLACEHOLDER_WORDS: Readonly<Record<string, Key>> = {
  doc: "recipes.arg.doc",
  title: "recipes.arg.title",
  folder: "recipes.arg.folder",
  selection: "recipes.arg.selection",
  date: "recipes.arg.date",
  time: "recipes.arg.time",
  datetime: "recipes.arg.datetime",
  year: "recipes.arg.year",
  month: "recipes.arg.month",
  day: "recipes.arg.day",
  hour: "recipes.arg.hour",
  minute: "recipes.arg.minute",
};

/// I segnaposto che fanno nascere il parametro `doc` della ricetta: la prova
/// li riempie con la nota aperta.
const DOC_PLACEHOLDERS = new Set(["doc", "title", "folder"]);

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function placeholderWord(name: string): string {
  if (name.startsWith("param.")) return t("recipes.arg.param", { name: name.slice("param.".length) });
  const key = PLACEHOLDER_WORDS[name];
  // Un segnaposto sconosciuto è un problema della ricetta (che allora non si
  // accende): qui lo si mostra com'è scritto, non lo si indovina.
  return key ? t(key) : `{{${name}}}`;
}

/// Il nome di una nota senza l'estensione Markdown: «Progetti/Indice», non
/// «Progetti/Indice.md».
function noteName(doc: string): string {
  return doc.replace(/\.md$/i, "");
}

/// Il nome del file, senza cartella né estensione: com'è scritto in una
/// linguetta.
function stem(doc: string): string {
  return noteName(doc.split("/").pop() ?? doc);
}

/// I segnaposto nominati da un valore, anche dentro elenchi e oggetti.
function placeholdersIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER)) into.add(match[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) placeholdersIn(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) placeholdersIn(item, into);
  }
  return into;
}

/// Un valore in parole. Una stringa che è esattamente un segnaposto è la sua
/// frase; una che ne contiene è il testo fra virgolette, con i segnaposto
/// detti al loro posto; un valore fisso si dice com'è, e una nota fissa per
/// nome («la nota «Diario/segreto»»), perché è una nota che la ricetta tocca
/// sempre.
export function valueInWords(value: unknown, param: ParamSpec | undefined): string {
  if (value === null || value === undefined || value === "") return t("recipes.arg.empty");
  if (typeof value === "boolean") return t(value ? "recipes.arg.yes" : "recipes.arg.no");
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => valueInWords(item, param)).join(", ");
  if (typeof value !== "string") return JSON.stringify(value);
  const whole = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(value);
  if (whole) return placeholderWord(whole[1]!);
  if (placeholdersIn(value).size > 0) {
    const said = value.replace(PLACEHOLDER, (_all, name: string) => t("recipes.arg.inline", { word: placeholderWord(name) }));
    return t("recipes.arg.quoted", { value: said });
  }
  const kind = param?.kind.kind;
  if (kind === "document" || kind === "documents") return t("recipes.arg.note", { doc: noteName(value) });
  return t("recipes.arg.quoted", { value });
}

function paramsOf(step: RecipeStepInfo): ParamSpec[] {
  return allCommands().find((command) => command.id === step.run)?.spec?.params ?? [];
}

/// Gli argomenti di un passo in una riga: il nome che il comando dà a ogni
/// campo, e il valore in parole.
export function stepArgsInWords(step: RecipeStepInfo): string {
  const params = paramsOf(step);
  const entries = Object.entries(step.args);
  if (entries.length === 0) return t("recipes.arg.none");
  return entries
    .map(([name, value]) => {
      const param = params.find((candidate) => candidate.name === name);
      return t("recipes.arg.pair", { name: param?.title || name, value: valueInWords(value, param) });
    })
    .join("; ");
}

/// Le note che la ricetta tocca **sempre**, qualunque sia quella aperta: i
/// valori fissi dei campi di tipo nota.
export function fixedNotes(recipe: RecipeInfo): string[] {
  const found: string[] = [];
  for (const step of recipe.steps) {
    const params = paramsOf(step);
    for (const [name, value] of Object.entries(step.args)) {
      const kind = params.find((param) => param.name === name)?.kind.kind;
      if (kind !== "document" && kind !== "documents") continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item !== "string" || item === "" || placeholdersIn(item).size > 0) continue;
        if (!found.includes(item)) found.push(item);
      }
    }
  }
  return found;
}

/// La ricetta usa la nota su cui la si lancia (`{{doc}}`, `{{title}}`,
/// `{{folder}}`): è la regola con cui nasce il suo parametro `doc`.
export function usesDoc(recipe: RecipeInfo): boolean {
  return recipe.steps.some((step) => [...placeholdersIn(step.args)].some((name) => DOC_PLACEHOLDERS.has(name)));
}

const REACH_ORDER: readonly CommandReach[] = ["session", "document", "documents", "vault", "settings"];

/// La riga «Tocca», e se dice altre note oltre a quella su cui la si usa.
export function reachInWords(recipe: RecipeInfo): { text: string; others: boolean } {
  const fixed = fixedNotes(recipe);
  const onDoc = usesDoc(recipe);
  const docs = fixed.map((doc) => t("recipes.arg.quoted", { value: noteName(doc) })).join(", ");
  if (fixed.length > 0) {
    return { text: t(onDoc ? "recipes.dialog.reach.others" : "recipes.dialog.reach.fixed", { docs }), others: true };
  }
  const widest = Math.max(-1, ...recipe.steps.map((step) => (step.reach ? REACH_ORDER.indexOf(step.reach) : -1)));
  if (widest >= REACH_ORDER.indexOf("documents")) return { text: t("recipes.dialog.reach.vault"), others: true };
  if (onDoc || widest === REACH_ORDER.indexOf("document")) return { text: t("recipes.dialog.reach.one"), others: false };
  return { text: t("recipes.dialog.reach.none"), others: false };
}

/// Il titolo vero del comando di un passo, o la frase che dice che questo Fub
/// non lo conosce.
function stepTitle(step: RecipeStepInfo): string {
  return step.title ?? t("recipes.dialog.unknown_command", { command: step.run });
}

/// Dove la si trova, accesa: la palette sempre, il menu «/» se la ricetta lo
/// dichiara, e la scorciatoia se ne ha una.
export function whereInWords(recipe: RecipeInfo): string {
  const slash = recipe.surfaces.some((surface) => surface === "slash" || surface === "slash_selection");
  const where = t(slash ? "recipes.dialog.where.slash" : "recipes.dialog.where.palette");
  if (!recipe.keybinding) return where;
  return t("recipes.dialog.where.key", {
    where,
    key: displayBinding(recipe.keybinding, keyboardPlatform(navigator.platform)),
  });
}

// --- il disegno -------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(label: Key, text: string): HTMLLIElement {
  const item = el("li", "recipe-fact");
  item.append(el("span", "recipe-fact-label", t(label)), el("span", undefined, text));
  return item;
}

function originLine(doc: string): HTMLParagraphElement {
  const line = el("p", "recipe-origin");
  // Il modello è uno solo, con la nota al suo posto: la si scrive in un suo
  // elemento senza spezzare la frase in due chiavi.
  const marker = "\u0000";
  const [before = "", after = ""] = t("recipes.dialog.origin", { doc: marker }).split(marker);
  line.append(before, el("span", "recipe-where", doc), after);
  return line;
}

function stepsList(recipe: RecipeInfo): HTMLOListElement {
  const list = el("ol", "recipe-steps");
  recipe.steps.forEach((step, index) => {
    const item = el("li", "recipe-step");
    const number = el("span", "recipe-step-n", String(index + 1));
    number.setAttribute("aria-hidden", "true");
    item.append(number, el("span", "recipe-step-title", stepTitle(step)), el("span", "recipe-step-args", stepArgsInWords(step)));
    list.append(item);
  });
  return list;
}

function factsList(recipe: RecipeInfo): HTMLUListElement {
  const list = el("ul", "recipe-facts");
  list.setAttribute("aria-label", t("recipes.dialog.facts"));
  const reach = reachInWords(recipe);
  const touches = fact("recipes.dialog.reach", reach.text);
  if (reach.others) touches.dataset.reach = "altre";
  const commands = [...new Set(recipe.steps.map(stepTitle))].join(", ");
  list.append(
    touches,
    fact("recipes.dialog.commands", t("recipes.dialog.commands.list", { commands })),
    fact("recipes.dialog.undo", t("recipes.dialog.undo.all")),
    fact("recipes.dialog.where", whereInWords(recipe)),
    fact("recipes.dialog.scope", t("recipes.dialog.scope.text")),
  );
  return list;
}

/// Apre la finestra su `recipe`. La risposta arriva sempre: «adopted» soltanto
/// se l'host ha accettato l'impronta mostrata.
export function openRecipeDialog(options: RecipeDialogOptions): RecipeDialog {
  let recipe = options.recipe;
  const adopted = recipe.status === "adottata";
  // Vive quanto la finestra: gli ascoltatori del kernel e le risposte in volo.
  const own = openLifetime();
  options.lifetime.add(() => own.close());

  const body = document.createDocumentFragment();
  let origin = originLine(recipe.doc);

  const stale = el("div", "recipe-stale");
  stale.setAttribute("role", "alert");
  stale.hidden = true;
  const staleText = el("p", "recipe-stale-text", t("recipes.dialog.stale"));
  const reload = textButton({ label: t("recipes.dialog.reload"), onPress: () => void reread(), lifetime: own });
  stale.append(staleText, reload);

  const stepsBlock = el("section", "recipe-block");
  const stepsTitle = el("h3", "recipe-block-title", t("recipes.dialog.steps"));
  stepsTitle.id = identifier("recipe-steps");
  stepsBlock.setAttribute("aria-labelledby", stepsTitle.id);
  let steps = stepsList(recipe);
  stepsBlock.append(stepsTitle, steps);

  let facts = factsList(recipe);

  const tryBlock = el("section", "recipe-block");
  const tryTitle = el("h3", "recipe-block-title", t("recipes.dialog.try"));
  tryTitle.id = identifier("recipe-try");
  tryBlock.setAttribute("aria-labelledby", tryTitle.id);
  tryBlock.setAttribute("aria-live", "polite");
  const tryBody = el("div", "recipe-block");
  tryBlock.append(tryTitle, tryBody);

  // L'esito di «Accendi» quando l'host rifiuta per un'altra ragione.
  const failure = el("p", "setting-error");
  failure.setAttribute("role", "alert");
  failure.hidden = true;

  body.append(origin, stale, stepsBlock, facts, tryBlock, failure);

  const actions: DialogAction<RecipeDialogAnswer>[] = adopted
    ? [{ id: "later", label: t("recipes.dialog.close"), value: "later", autofocus: true }]
    : [
        { id: "later", label: t("recipes.dialog.later"), value: "later", autofocus: true },
        { id: "adopt", label: t("recipes.dialog.adopt"), kind: "primary", value: "adopted" },
      ];

  let isStale = false;
  const handle = openDialog<RecipeDialogAnswer>({
    title: recipe.title,
    description: recipe.description || undefined,
    body,
    actions,
    dismissValue: "later",
    lifetime: own,
    className: "recipe-dialog",
    confirm: (value) => (value === "adopted" ? adopt() : true),
  });
  void handle.result.then(() => own.close());
  const adoptButton = handle.element.querySelector<HTMLButtonElement>('[data-action="adopt"]');

  function markStale(text: Key = "recipes.dialog.stale"): void {
    isStale = true;
    staleText.textContent = t(text);
    stale.hidden = false;
    if (adoptButton) adoptButton.disabled = true;
  }

  async function adopt(): Promise<boolean> {
    failure.hidden = true;
    if (isStale || recipe.id === null || recipe.fingerprint === null) return false;
    try {
      await api.recipeAdopt(recipe.id, recipe.fingerprint);
      return true;
    } catch (error) {
      if (own.closed) return false;
      // L'impronta vecchia: la nota è cambiata dopo che la persona l'ha vista.
      if (isErrorKind(error, "conflict")) markStale();
      else {
        failure.textContent = t("recipes.dialog.adopt.failed", { reason: errorText(error) });
        failure.hidden = false;
      }
      return false;
    }
  }

  /// Rilegge la ricetta dall'host: se c'è ancora e non ha problemi, la
  /// finestra mostra il testo di adesso e «Accendi» torna disponibile.
  let rereads = 0;
  async function reread(): Promise<void> {
    const turn = ++rereads;
    let list;
    try {
      list = await api.recipesList();
    } catch (error) {
      if (own.closed || turn !== rereads) return;
      staleText.textContent = t("recipes.dialog.reload.failed", { reason: errorText(error) });
      return;
    }
    if (own.closed || turn !== rereads) return;
    const fresh = list.recipes.find((candidate) => candidate.id !== null && candidate.id === recipe.id);
    if (!fresh) return markStale("recipes.dialog.gone");
    if (fresh.problems.length > 0) return markStale("recipes.dialog.now_problems");
    recipe = fresh;
    handle.element.querySelector(".kit-dialog-title")!.textContent = fresh.title;
    const description = handle.element.querySelector(".kit-dialog-description");
    if (description) description.textContent = fresh.description;
    const nextOrigin = originLine(fresh.doc);
    origin.replaceWith(nextOrigin);
    origin = nextOrigin;
    const nextSteps = stepsList(fresh);
    steps.replaceWith(nextSteps);
    steps = nextSteps;
    const nextFacts = factsList(fresh);
    facts.replaceWith(nextFacts);
    facts = nextFacts;
    isStale = false;
    stale.hidden = true;
    if (adoptButton) adoptButton.disabled = false;
    void runTry();
  }

  /// La prova sulla nota aperta: non scrive niente, e un esito vecchio non
  /// copre quello di una prova chiesta dopo.
  let tries = 0;
  async function runTry(): Promise<void> {
    const turn = ++tries;
    const note = options.openNote;
    if (note === null || recipe.id === null) {
      tryBody.replaceChildren(el("p", "recipe-try-note", t("recipes.dialog.try.none")));
      return;
    }
    const loading = el("div", "skeleton-rows");
    loading.setAttribute("aria-busy", "true");
    loading.setAttribute("aria-label", t("recipes.dialog.try.loading"));
    loading.append(el("span", "skeleton-line"), el("span", "skeleton-line"));
    tryBody.replaceChildren(loading);
    let plan: CommandPlan;
    try {
      plan = await api.recipeSimulate(recipe.id, usesDoc(recipe) ? { doc: note } : {});
    } catch (error) {
      if (own.closed || turn !== tries) return;
      const message = el("p", "setting-error");
      message.append(el("span", "setting-error-message", t("recipes.dialog.try.failed")), ` ${errorText(error)}`);
      const again = el("div");
      again.append(textButton({ label: t("recipes.dialog.try.again"), onPress: () => void runTry(), lifetime: own }));
      tryBody.replaceChildren(message, again);
      return;
    }
    if (own.closed || turn !== tries) return;
    const list = el("ul", "recipe-try-list");
    list.append(el("li", "recipe-try-item", plan.summary));
    const parts: HTMLElement[] = [el("p", "recipe-try-note", t("recipes.dialog.try.on", { note: stem(note) })), list];
    if (recipe.steps.length > 1) parts.push(el("p", "recipe-try-note", t("recipes.dialog.try.approx")));
    tryBody.replaceChildren(...parts);
  }

  // La nota della ricetta cambiata, spostata o tolta mentre la si guarda.
  const touches = (doc: string) => doc === recipe.doc;
  own.add(onEvent("document_changed", (event) => {
    if (touches(event.id)) markStale();
  }));
  own.add(onEvent("document_renamed", (event) => {
    if (touches(event.from)) markStale();
  }));
  own.add(onEvent("document_removed", (event) => {
    if (touches(event.id)) markStale();
  }));
  own.add(onEvent("batch_ended", (event) => {
    if (event.changed.some(touches)) markStale();
  }));

  void runTry();
  return { element: handle.element, result: handle.result };
}
