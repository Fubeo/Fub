// **Le ricette del vault nelle impostazioni, e l'avviso che le propone**
// (piano A1, T12; prototipo `PLAN-ui/ricette.html`).
//
// Una ricetta è una nota della cartella delle ricette che compone comandi che
// ci sono già (`docs/reference/ricette.md`). La regola è dell'host: legge la
// cartella, controlla ogni ricetta contro il registro vivo e monta soltanto
// quelle che questa macchina ha adottato con l'impronta del testo di adesso.
// Qui si mostra ciò che l'host risponde e si offrono i due gesti della
// persona, guardare (e poi accendere) e spegnere.
//
// # Due superfici, una regola
//
// - La **sezione** «Ricette» della scheda «Componenti»: una riga per ricetta
//   con lo stato, la nota e i problemi; in cima un `.settings-banner` con le
//   ricette da guardare. Vive quanto il pannello, come la pagina dei
//   componenti, e rilegge l'elenco quando la scheda si mostra, dopo un gesto e
//   quando una nota della cartella cambia.
// - L'**avviso**, sul modello delle scorciatoie che un vault propone
//   (`warnIfVaultProvidesKeys`): all'apertura del vault, e poi quando una nota
//   della cartella cambia, nomina le ricette da guardare con una sola azione,
//   «Guarda», che porta alla sezione. Nessun pulsante per accendere
//   dall'avviso: si decide guardando.
//
// `recipesList` rilegge tutta la cartella (è anche la riconciliazione):
// nessuna delle due superfici lo chiama a ogni evento, ma una volta dopo una
// raffica di cambi sotto la cartella.
import { api } from "../host/ipc";
import type { RecipeInfo, RecipeList, RecipeProblem, RecipeStatus, SettingEntry } from "../host/contract";
import { errorText } from "../host/errors";
import { plural, t, type Key } from "../i18n/strings";
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { displayBinding, hasKernelCommand, keyboardPlatform, launchCommand } from "../ui/commands";
import type { Lifetime, Teardown } from "../ui/lifetime";
import type { NoticeAction, Tone } from "../ui/notify";
import { openRecipeDialog } from "./recipe-dialog";

/// L'impostazione con la cartella delle ricette, e la cartella di serie (D9):
/// le stesse di `fub-features/src/recipes.rs`.
export const RECIPES_FOLDER_KEY = "recipes.folder";
export const RECIPES_FOLDER_DEFAULT = "Recipes";

/// Il comando che scrive una ricetta d'esempio e la apre.
export const NEW_RECIPE = "recipes.new";

/// L'id della sezione nelle impostazioni: l'indice e l'avviso la raggiungono.
export const RECIPES_SECTION_ID = "settings-recipes";

/// Quanto si aspetta, dopo un cambio sotto la cartella, che la raffica finisca
/// prima di rileggere l'elenco.
const SETTLE_MS = 400;

/// La cartella delle ricette di questo vault, dalle impostazioni lette.
export function recipesFolder(entries: readonly SettingEntry[]): string {
  const value = entries.find((entry) => entry.spec.key === RECIPES_FOLDER_KEY)?.value;
  const folder = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
  return folder || RECIPES_FOLDER_DEFAULT;
}

/// Una nota sta sotto la cartella delle ricette, sottocartelle comprese.
function underFolder(doc: string, folder: string): boolean {
  return doc.startsWith(`${folder}/`);
}

/// Le ricette che aspettano la persona: nuove, o cambiate dopo l'adozione.
export function toLookAt(list: readonly RecipeInfo[]): RecipeInfo[] {
  return list.filter((recipe) => recipe.status === "proposta" || recipe.status === "cambiata");
}

/// L'identità di una ricetta per l'avviso: l'id, o la nota se il blocco non si
/// legge (e allora la ricetta ha problemi, e non si propone).
function recipeKey(recipe: RecipeInfo): string {
  return recipe.id ?? `doc:${recipe.doc}`;
}

// --- la porta verso la sezione ------------------------------------------------
//
// L'avviso nasce nell'apertura del vault, la sezione nel pannello delle
// impostazioni: il pannello dice qui come portarci, come fa
// `registerComponentRow` per la pagina dei componenti.

type RecipesOpener = () => void;
let opener: RecipesOpener | null = null;

/// Dice come aprire le impostazioni sulla sezione; restituisce chi lo toglie.
export function registerRecipesOpener(open: RecipesOpener): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
}

/// Apre le impostazioni sulla sezione «Ricette»; falso se nessuno sa farlo.
export function showRecipes(): boolean {
  if (opener === null) return false;
  opener();
  return true;
}

// --- l'avviso -----------------------------------------------------------------

/// Come l'avviso parla alla persona: la porta `notify` della sessione.
export type RecipeNotify = (message: string, tone?: Tone, action?: NoticeAction) => void;

/// L'avviso che nomina le ricette `fresh`, con «Guarda».
function noticeFor(fresh: readonly RecipeInfo[], notify: RecipeNotify): void {
  const names = fresh.map((recipe) => recipe.title).join(", ");
  notify(plural(fresh.length, "recipes.notice.one", "recipes.notice", { names }), "info", {
    label: t("recipes.action.look"),
    hint: t("recipes.notice.look.hint"),
    run: () => void showRecipes(),
  });
}

export interface RecipeNotices {
  /// L'avviso dell'apertura: legge l'elenco una volta e nomina le ricette da
  /// guardare. Non rifiuta: un vault che non sa dire le sue ricette si apre lo
  /// stesso.
  atOpen(): Promise<void>;
  /// Toglie gli ascoltatori. Vale una volta.
  stop: Teardown;
}

/// Gli avvisi delle ricette di un vault aperto: uno all'apertura, poi uno
/// quando una nota della cartella è creata o cambiata e porta una ricetta da
/// guardare. Al massimo un avviso per ricetta in tutta la sessione del vault;
/// gli ascoltatori se ne vanno con `stop` o alla chiusura del vault.
export function watchRecipeNotices(notify: RecipeNotify): RecipeNotices {
  const told = new Set<string>();
  let folder = RECIPES_FOLDER_DEFAULT;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reads = 0;
  const stops: Teardown[] = [];

  const readFolder = async (): Promise<void> => {
    let entries: SettingEntry[] = [];
    try {
      entries = await settings();
    } catch {
      // Impostazioni che non si leggono: vale la cartella di serie.
    }
    if (!stopped) folder = recipesFolder(entries);
  };

  const tell = (list: RecipeList): void => {
    const fresh = toLookAt(list.recipes).filter((recipe) => !told.has(recipeKey(recipe)));
    if (fresh.length === 0) return;
    for (const recipe of fresh) told.add(recipeKey(recipe));
    noticeFor(fresh, notify);
  };

  const read = async (): Promise<void> => {
    const turn = ++reads;
    try {
      const list = await api.recipesList();
      if (!stopped && turn === reads) tell(list);
    } catch {
      // Come per le scorciatoie proposte: ciò che si perde è la domanda, non
      // il presidio. Una ricetta non adottata non gira comunque.
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void read();
    }, SETTLE_MS);
  };
  const touch = (doc: string): void => {
    if (underFolder(doc, folder)) schedule();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const dispose of stops.splice(0)) dispose();
  };

  stops.push(
    onEvent("document_changed", (event) => touch(event.id)),
    onEvent("document_renamed", (event) => touch(event.to)),
    onEvent("batch_ended", (event) => event.changed.forEach(touch)),
    onEvent("setting_changed", (event) => {
      if (event.key === RECIPES_FOLDER_KEY) void readFolder();
    }),
    onEvent("vault_closed", () => stop()),
  );

  return {
    async atOpen() {
      await readFolder();
      if (!stopped) await read();
    },
    stop,
  };
}

// --- la sezione -----------------------------------------------------------------

export interface RecipesSectionHooks {
  /// Se la sezione è a schermo: un cambio sotto la cartella la rilegge
  /// soltanto allora.
  visible(): boolean;
  /// Chiude le impostazioni prima di un gesto che porta altrove (aprire una
  /// nota, la palette di «Nuova ricetta»).
  closeSettings(): void;
  /// La nota aperta adesso, su cui la finestra prova la ricetta.
  openNote(): string | null;
  /// Apre una nota del vault.
  openDocument(doc: string): Promise<void>;
  /// Un avviso del gesto.
  notify(message: string, tone?: Tone): void;
}

export interface RecipesSection {
  /// La radice della sezione: sempre la stessa, così sopravvive ai ridisegni
  /// della scheda.
  readonly element: HTMLElement;
  /// La sezione sta per comparire: rilegge l'elenco. Mostra il caricamento
  /// solo la prima volta; dopo, l'elenco di prima resta finché arriva il nuovo.
  show(): Promise<void>;
  /// La cartella delle ricette del vault, dalle impostazioni lette: la dice
  /// la riga sotto il titolo, e i cambi sotto di lei rileggono la sezione.
  setFolder(folder: string): void;
  /// Le impostazioni si sono chiuse: alla prossima apertura si ricomincia dal
  /// caricamento.
  reset(): void;
}

type SectionState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready"; list: RecipeList };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onPress: () => void, focusKey?: string): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  if (focusKey) node.dataset.focusKey = focusKey;
  node.addEventListener("click", onPress);
  return node;
}

/// La parola dello stato, come la dice la riga.
const STATUS_WORDS: Readonly<Record<RecipeStatus, Key>> = {
  proposta: "recipes.status.proposta",
  adottata: "recipes.status.adottata",
  cambiata: "recipes.status.cambiata",
  problemi: "recipes.status.problemi",
};

/// Il conto accanto al titolo: quante, quante da guardare, quante da correggere.
export function sectionMeta(list: readonly RecipeInfo[]): string {
  if (list.length === 0) return t("recipes.section.meta.none");
  const parts = [plural(list.length, "recipes.section.meta.count.one", "recipes.section.meta.count")];
  const look = toLookAt(list).length;
  const fix = list.filter((recipe) => recipe.status === "problemi").length;
  if (look > 0) parts.push(t("recipes.section.meta.look", { count: look }));
  if (fix > 0) parts.push(t("recipes.section.meta.fix", { count: fix }));
  return parts.join(" · ");
}

/// Dove sta un problema: la riga e il campo, quando ci sono.
function problemWhere(problem: RecipeProblem): string {
  const field = problem.field || t("recipes.problem.block");
  if (problem.line === null) return field;
  return problem.field ? t("recipes.problem.where", { line: problem.line, field }) : t("recipes.problem.line", { line: problem.line });
}

export function mountRecipesSection(lifetime: Lifetime, hooks: RecipesSectionHooks): RecipesSection {
  let current: SectionState = { kind: "loading" };
  let folder = RECIPES_FOLDER_DEFAULT;
  let reads = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /// Un gesto alla volta: mentre «Spegni» è in volo le righe non rispondono.
  let busy = false;

  const root = el("section", "settings-section");
  root.id = RECIPES_SECTION_ID;
  const head = el("div", "settings-section-head");
  const title = el("h3", "settings-section-title", t("recipes.section.title"));
  title.id = `${RECIPES_SECTION_ID}-title`;
  title.tabIndex = -1;
  root.setAttribute("aria-labelledby", title.id);
  const meta = el("span", "settings-section-meta");
  const newRecipe = button("settings-btn recipe-new", t("recipes.new"), () => startNewRecipe(), "new");
  head.append(title, meta, newRecipe);
  const hint = el("p", "settings-section-hint");
  const body = el("div", "settings-section-body");
  root.append(head, hint, body);

  function startNewRecipe(): void {
    hooks.closeSettings();
    launchCommand(NEW_RECIPE);
  }

  function openNote(doc: string): void {
    hooks.closeSettings();
    hooks.openDocument(doc).catch((error: unknown) => {
      hooks.notify(t("recipes.open_note.failed", { doc, reason: errorText(error) }), "guasto");
    });
  }

  function look(recipe: RecipeInfo): void {
    if (busy) return;
    const dialog = openRecipeDialog({ recipe, lifetime, openNote: hooks.openNote() });
    void dialog.result.then((answer) => {
      if (lifetime.closed) return;
      if (answer === "adopted") hooks.notify(t("recipes.dialog.adopted", { title: recipe.title }), "info");
      void refresh();
    });
  }

  async function turnOff(recipe: RecipeInfo): Promise<void> {
    if (busy || recipe.id === null) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await api.recipeDiscard(recipe.id);
    } catch (error) {
      if (!lifetime.closed) hooks.notify(t("recipes.off.failed", { title: recipe.title, reason: errorText(error) }), "guasto");
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
    if (!lifetime.closed) await refresh(`look:${recipeKey(recipe)}`);
  }

  function statusLine(recipe: RecipeInfo): HTMLElement {
    const line = el("div", "setting-meta");
    const status = el("span", "recipe-status", t(STATUS_WORDS[recipe.status]));
    status.dataset.status = recipe.status;
    line.append(status, el("span", "recipe-where", recipe.doc));
    if (recipe.steps.length > 0) {
      line.append(el("span", undefined, plural(recipe.steps.length, "recipes.steps.count.one", "recipes.steps.count")));
    }
    if (recipe.keybinding) {
      line.append(el("span", undefined, displayBinding(recipe.keybinding, keyboardPlatform(navigator.platform))));
    }
    // Montata col permesso spento a mano: c'è, ma i suoi passi sono rifiutati.
    if (recipe.mounted && !recipe.allowed) line.append(el("span", undefined, t("recipes.permission_off")));
    return line;
  }

  function recipeRow(recipe: RecipeInfo, index: number): HTMLLIElement {
    const key = recipeKey(recipe);
    const row = el("li", "setting-row");
    if (recipe.id !== null) row.dataset.recipe = recipe.id;
    const text = el("div", "setting-text");
    const name = el("span", "setting-label recipe-name", recipe.title);
    name.id = `${RECIPES_SECTION_ID}-row-${index}`;
    text.append(name);
    if (recipe.description) text.append(el("span", "setting-description", recipe.description));
    text.append(statusLine(recipe));
    if (recipe.problems.length > 0) {
      const problems = el("ul", "recipe-problems");
      problems.setAttribute("aria-label", t("recipes.problems.label", { title: recipe.title }));
      for (const problem of recipe.problems) {
        const item = el("li", "recipe-problem");
        item.append(
          el("code", "recipe-problem-code", problem.code),
          el("span", "recipe-where", problemWhere(problem)),
          el("span", "recipe-problem-message", problem.message),
        );
        problems.append(item);
      }
      text.append(problems);
    }
    const control = el("div", "setting-control");
    const describe = (node: HTMLButtonElement) => {
      node.setAttribute("aria-describedby", name.id);
      return node;
    };
    if (recipe.status === "problemi") {
      control.append(describe(button("settings-btn", t("recipes.action.open_note"), () => openNote(recipe.doc), `open:${key}`)));
    } else {
      control.append(describe(button("settings-btn", t("recipes.action.look"), () => look(recipe), `look:${key}`)));
      if (recipe.status === "adottata") {
        control.append(describe(button("settings-btn settings-btn--danger", t("recipes.action.off"), () => void turnOff(recipe), `off:${key}`)));
      }
    }
    row.append(text, control);
    return row;
  }

  function banner(waiting: readonly RecipeInfo[]): HTMLElement {
    const box = el("div", "settings-banner");
    box.setAttribute("role", "region");
    const heading = el("span", "setting-label", plural(waiting.length, "recipes.banner.title.one", "recipes.banner.title"));
    heading.id = `${RECIPES_SECTION_ID}-banner`;
    box.setAttribute("aria-labelledby", heading.id);
    box.append(heading, el("span", "muted", t("recipes.banner.hint")));
    for (const recipe of waiting) {
      const row = el("div", "setting-row");
      const text = el("div", "setting-text");
      text.append(
        el("span", "setting-label recipe-name", recipe.title),
        el("span", "setting-description", recipe.status === "cambiata"
          ? t("recipes.banner.changed")
          : t("recipes.banner.new", { doc: recipe.doc })),
      );
      const control = el("div", "setting-control");
      control.append(button("settings-btn", t("recipes.action.look"), () => look(recipe), `banner:${recipeKey(recipe)}`));
      row.append(text, control);
      box.append(row);
    }
    return box;
  }

  function empty(): HTMLElement {
    const card = el("div", "settings-card");
    const box = el("div", "settings-empty");
    box.append(
      el("p", "settings-empty-text", t("recipes.empty.title")),
      el("p", "settings-section-hint", t("recipes.empty.text")),
      el("p", "recipe-ask", t("recipes.empty.ask")),
    );
    if (hasKernelCommand(NEW_RECIPE)) box.append(button("settings-btn", t("recipes.new"), () => startNewRecipe(), "new-empty"));
    card.append(box);
    return card;
  }

  function loading(): HTMLElement {
    const card = el("div", "settings-card");
    card.setAttribute("aria-busy", "true");
    card.setAttribute("aria-label", t("recipes.loading"));
    const rows = el("div", "skeleton-rows");
    for (let i = 0; i < 6; i++) rows.append(el("span", "skeleton-line"));
    card.append(rows);
    return card;
  }

  function failed(reason: string): HTMLElement {
    const card = el("div", "settings-card");
    const box = el("div", "settings-empty");
    box.setAttribute("role", "alert");
    const line = el("p", "setting-error");
    line.append(el("span", "setting-error-message", t("recipes.error.title")), " ", el("span", undefined, reason));
    box.append(line, button("settings-btn", t("recipes.error.retry"), () => void refresh("retry"), "retry"));
    card.append(box);
    return card;
  }

  function draw(focusKey?: string): void {
    // Il fuoco resta sul controllo della stessa ricetta, se c'è ancora; sennò
    // su quello indicato dal gesto (dopo «Spegni», il suo «Guarda»).
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
    hint.textContent = t("recipes.section.hint", { folder });
    newRecipe.hidden = !hasKernelCommand(NEW_RECIPE);
    const nodes: HTMLElement[] = [];
    root.hidden = false;
    if (current.kind === "loading") {
      meta.hidden = true;
      nodes.push(loading());
    } else if (current.kind === "error") {
      meta.hidden = true;
      nodes.push(failed(current.reason));
    } else {
      const { recipes, problems } = current.list;
      // Spenta la feature delle ricette l'host non ne elenca e il comando che
      // ne scrive una non c'è: la sezione non ha niente da offrire.
      root.hidden = recipes.length === 0 && problems.length === 0 && !hasKernelCommand(NEW_RECIPE);
      meta.hidden = false;
      meta.textContent = sectionMeta(recipes);
      for (const problem of problems) {
        const limit = el("p", "recipe-limit", problem.message);
        limit.setAttribute("role", "status");
        nodes.push(limit);
      }
      const waiting = toLookAt(recipes);
      if (waiting.length > 0) nodes.push(banner(waiting));
      if (recipes.length === 0) nodes.push(empty());
      else {
        const list = el("ul", "settings-card recipe-list");
        list.setAttribute("aria-label", t("recipes.list.label"));
        recipes.forEach((recipe, index) => list.append(recipeRow(recipe, index)));
        nodes.push(list);
      }
    }
    body.replaceChildren(...nodes);
    for (const wanted of [focused, focusKey]) {
      if (!wanted) continue;
      const target = root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(wanted)}"]`);
      if (target) {
        target.focus({ preventScroll: true });
        break;
      }
    }
  }

  async function refresh(focusKey?: string): Promise<void> {
    const turn = ++reads;
    let next: SectionState;
    try {
      next = { kind: "ready", list: await api.recipesList() };
    } catch (error) {
      next = { kind: "error", reason: errorText(error) };
    }
    if (lifetime.closed || turn !== reads) return;
    current = next;
    draw(focusKey);
  }

  // Una nota della cartella creata, cambiata o spostata: la sezione a schermo
  // si rilegge, una volta dopo la raffica.
  const schedule = (doc: string): void => {
    if (!underFolder(doc, folder) || !hooks.visible()) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!lifetime.closed && hooks.visible()) void refresh();
    }, SETTLE_MS);
  };
  lifetime.add(onEvent("document_changed", (event) => schedule(event.id)));
  lifetime.add(onEvent("document_renamed", (event) => {
    schedule(event.from);
    schedule(event.to);
  }));
  lifetime.add(onEvent("document_removed", (event) => schedule(event.id)));
  lifetime.add(onEvent("batch_ended", (event) => event.changed.forEach(schedule)));
  lifetime.add(() => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });

  draw();
  return {
    element: root,
    show() {
      if (current.kind !== "ready") {
        current = { kind: "loading" };
        draw();
      }
      return refresh();
    },
    setFolder(next) {
      folder = next;
      hint.textContent = t("recipes.section.hint", { folder });
    },
    reset() {
      reads++;
      current = { kind: "loading" };
      draw();
    },
  };
}
