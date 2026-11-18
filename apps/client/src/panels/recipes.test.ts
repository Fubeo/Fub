// @vitest-environment happy-dom
//
// La sezione «Ricette» e l'avviso delle ricette contro l'host finto: gli
// stati della sezione (caricamento, vuota, piena, con problemi, in errore,
// oltre il limite), i gesti (Guarda, Spegni, Apri la nota, Nuova ricetta) e
// l'avviso che nomina le ricette da guardare, al massimo una volta ciascuna.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, RecipeProblem } from "../host/contract";
import type { FakeHost, FakeRecipe } from "../host/fake";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("host finto non montato");
        const method = box.host.module.api[name as keyof typeof box.host.module.api] as (
          ...values: unknown[]
        ) => unknown;
        return method(...args);
      },
    },
  ),
  onKernelEvent: (handler: never) => box.host!.module.onKernelEvent(handler),
}));

const { createFakeHost } = await import("../host/fake");
const { startKernelRouter } = await import("../state/kernel");
const { setCommandSpecs } = await import("../state/store");
const { openLifetime } = await import("../ui/lifetime");
const { registerCommandStarter } = await import("../ui/commands");
const {
  mountRecipesSection,
  recipesFolder,
  registerRecipesOpener,
  sectionMeta,
  watchRecipeNotices,
  RECIPES_SECTION_ID,
} = await import("./recipes");

const PRINT = "3f".repeat(32);
const LATER = "a1".repeat(32);

const NEW_RECIPE_SPEC: CommandSpec = {
  id: "recipes.new",
  title: "Nuova ricetta",
  description: "",
  keybinding: null,
  params: [{ name: "title", title: "Titolo", description: "", kind: { kind: "text" }, required: false }],
  scope: { writes: true, reach: "vault", reversible: true },
  surfaces: [],
};

function recipe(id: string, over: Partial<FakeRecipe> = {}): FakeRecipe {
  return {
    id,
    title: `Ricetta ${id}`,
    description: `Fa la cosa ${id}.`,
    doc: `Recipes/${id}.md`,
    status: "proposta",
    fingerprint: PRINT,
    problems: [],
    steps: [{ run: "note.property.set", title: "Imposta proprietà", args: { doc: "{{doc}}" }, writes: true, reach: "document", reversible: true }],
    command: `recipe.${id}:run`,
    keybinding: null,
    surfaces: [],
    mounted: false,
    allowed: false,
    plan: { summary: "niente", docs: [], edits: [] },
    ...over,
  };
}

const UNKNOWN: RecipeProblem = {
  code: "comando-sconosciuto",
  field: "steps[2].run",
  line: 14,
  message: "Il comando «note.archive» non c'è in questo Fub.",
};

let stopRouter: (() => void) | null = null;
let lifetime = openLifetime();
const hooks = {
  visible: vi.fn(() => true),
  closeSettings: vi.fn(),
  openNote: vi.fn((): string | null => null),
  showDocument: vi.fn(async (_doc: string) => {}),
  notify: vi.fn(),
};

async function start(recipes: FakeRecipe[], specs: CommandSpec[] = [NEW_RECIPE_SPEC]) {
  box.host = createFakeHost({ recipes });
  stopRouter = await startKernelRouter();
  setCommandSpecs(specs);
  lifetime = openLifetime();
  return box.host;
}

async function section(recipes: FakeRecipe[], specs?: CommandSpec[]) {
  const host = await start(recipes, specs);
  const view = mountRecipesSection(lifetime, hooks);
  document.body.replaceChildren(view.element);
  view.setFolder("Recipes");
  await view.show();
  return { host, view, root: view.element };
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;
const buttons = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === label);

beforeEach(() => {
  for (const hook of Object.values(hooks)) hook.mockClear();
  document.body.replaceChildren();
});

afterEach(() => {
  lifetime.close();
  stopRouter?.();
  stopRouter = null;
  box.host = null;
  setCommandSpecs([]);
  document.body.replaceChildren();
});

describe("gli stati della sezione", () => {
  it("in caricamento mostra le righe vuote, poi l'elenco", async () => {
    const host = await start([recipe("archivia")]);
    const release = host.throttle("recipesList");
    const view = mountRecipesSection(lifetime, hooks);
    const shown = view.show();
    const busy = view.element.querySelector<HTMLElement>('[aria-busy="true"]')!;
    expect(busy.getAttribute("aria-label")).toBe("Le ricette si stanno leggendo");
    expect(busy.querySelectorAll(".skeleton-line")).toHaveLength(6);
    release();
    await shown;
    expect(view.element.querySelector('[aria-busy="true"]')).toBeNull();
    expect(view.element.querySelectorAll(".recipe-list > .setting-row")).toHaveLength(1);
  });

  it("vuota: due righe che spiegano, l'esempio da chiedere a un'AI e «Nuova ricetta»", async () => {
    const { root } = await section([]);
    expect(root.id).toBe(RECIPES_SECTION_ID);
    expect($(root, ".settings-section-meta").textContent).toBe("nessuna ricetta");
    expect($(root, ".settings-empty-text").textContent).toBe("Ancora nessuna ricetta in questo vault.");
    expect($(root, ".recipe-ask").textContent).toContain("archivia la nota aperta");
    expect($(root, ".settings-section-hint").textContent).toContain("«Recipes»");
    const fresh = buttons(root, "Nuova ricetta");
    expect(fresh).toHaveLength(2);
    expect(fresh[0]!.classList.contains("recipe-new")).toBe(true);
    const started: string[] = [];
    const stop = registerCommandStarter((entry) => started.push(entry.id));
    fresh[1]!.click();
    stop();
    expect(hooks.closeSettings).toHaveBeenCalledTimes(1);
    expect(started).toEqual(["recipes.new"]);
  });

  it("senza la feature delle ricette la sezione non c'è", async () => {
    const { root } = await section([], []);
    expect(root.hidden).toBe(true);
  });

  it("piena: una riga per ricetta con lo stato, la nota e i passi, e in cima quelle da guardare", async () => {
    const { root } = await section([
      recipe("archivia"),
      recipe("riunione", { status: "adottata", mounted: true, allowed: true, keybinding: "Mod-Alt-r" }),
      recipe("letta", { status: "cambiata" }),
    ]);
    expect($(root, ".settings-section-meta").textContent).toBe("3 ricette · 2 da guardare");
    const rows = [...root.querySelectorAll<HTMLElement>(".recipe-list > .setting-row")];
    expect(rows.map((row) => row.dataset.recipe)).toEqual(["archivia", "riunione", "letta"]);
    expect(rows.map((row) => $(row, ".recipe-status").dataset.status)).toEqual(["proposta", "adottata", "cambiata"]);
    expect($(rows[0]!, ".recipe-status").textContent).toBe("Da guardare");
    expect($(rows[0]!, ".setting-meta").textContent).toContain("Recipes/archivia.md");
    expect($(rows[0]!, ".setting-meta").textContent).toContain("1 passo");
    expect(buttons(rows[0]!, "Spegni")).toHaveLength(0);
    expect(buttons(rows[1]!, "Spegni")).toHaveLength(1);
    expect(buttons(rows[1]!, "Spegni")[0]!.classList.contains("settings-btn--danger")).toBe(true);
    const banner = $(root, ".settings-banner");
    expect(banner.getAttribute("role")).toBe("region");
    expect(document.getElementById(banner.getAttribute("aria-labelledby")!)!.textContent)
      .toBe("Il vault propone 2 ricette da guardare");
    expect([...banner.querySelectorAll(".recipe-name")].map((n) => n.textContent)).toEqual(["Ricetta archivia", "Ricetta letta"]);
    expect(buttons(banner, "Guarda")).toHaveLength(2);
    // Il pulsante di ogni riga dice di quale ricetta è.
    const look = buttons(rows[0]!, "Guarda")[0]!;
    expect(document.getElementById(look.getAttribute("aria-describedby")!)!.textContent).toBe("Ricetta archivia");
  });

  it("con problemi: il codice, la riga, il messaggio, e «Apri la nota»", async () => {
    const { root } = await section([recipe("attivita", { status: "problemi", problems: [UNKNOWN] })]);
    expect($(root, ".settings-section-meta").textContent).toBe("1 ricetta · 1 da correggere");
    const problem = $(root, ".recipe-problem");
    expect($(problem, ".recipe-problem-code").textContent).toBe("comando-sconosciuto");
    expect($(problem, ".recipe-where").textContent).toBe("riga 14 · steps[2].run");
    expect($(problem, ".recipe-problem-message").textContent).toContain("note.archive");
    expect(buttons(root, "Guarda")).toHaveLength(0);
    buttons(root, "Apri la nota")[0]!.click();
    expect(hooks.closeSettings).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(hooks.showDocument).toHaveBeenCalledWith("Recipes/attivita.md"));
  });

  it("in errore lo dice, e «Riprova» rilegge", async () => {
    const host = await start([recipe("archivia")]);
    const heal = host.fault("recipesList", { kind: "io", message: "La cartella «Recipes» non si apre: permesso negato." });
    const view = mountRecipesSection(lifetime, hooks);
    document.body.replaceChildren(view.element);
    await view.show();
    const alert = $(view.element, '[role="alert"]');
    expect(alert.textContent).toContain("Le ricette non si leggono.");
    expect(alert.textContent).toContain("permesso negato");
    heal();
    buttons(view.element, "Riprova")[0]!.click();
    await vi.waitFor(() => expect(view.element.querySelectorAll(".recipe-list > .setting-row")).toHaveLength(1));
  });

  it("oltre il limite: la riga del limite, detta dall'host", async () => {
    const many = Array.from({ length: 200 }, (_, i) => recipe(`r-${String(i).padStart(3, "0")}`, { status: "adottata", mounted: true, allowed: true }));
    const host = await start(many);
    const original = host.module.api.recipesList;
    // Il messaggio dell'host (`recipes.problem.troppe` di fub-features): l'host smette
    // di leggere alla duecentunesima, e sa soltanto che sono «più di 200».
    const limit: RecipeProblem = {
      code: "troppe",
      field: "",
      line: null,
      message: "Il vault ha più di 200 ricette: Fub legge soltanto le prime 200, in ordine di percorso.",
    };
    host.module.api.recipesList = async (vault) => ({ ...(await original(vault)), problems: [limit] });
    const view = mountRecipesSection(lifetime, hooks);
    await view.show();
    const line = $(view.element, ".recipe-limit");
    expect(line.getAttribute("role")).toBe("status");
    expect(line.textContent).toBe(limit.message);
    expect(view.element.querySelectorAll(".recipe-list > .setting-row")).toHaveLength(200);
  });

  it("il banner con tante ricette da guardare ne mostra cinque e dice quante restano", async () => {
    const waiting = Array.from({ length: 80 }, (_, i) => recipe(`r-${String(i + 1).padStart(2, "0")}`));
    const { root } = await section(waiting);
    const banner = $(root, ".settings-banner");
    expect($(banner, ".setting-label").textContent).toBe("Il vault propone 80 ricette da guardare");
    const rows = banner.querySelectorAll(".setting-row");
    expect(rows).toHaveLength(5);
    expect(rows[4]!.querySelector(".recipe-name")!.textContent).toBe("Ricetta r-05");
    expect(banner.lastElementChild!.textContent).toBe("E altre 75 da guardare: le trovi nell'elenco qui sotto.");
    // Le altre restano raggiungibili: ognuna ha il suo «Guarda» nell'elenco.
    expect(buttons($(root, ".recipe-list"), "Guarda")).toHaveLength(80);
  });

  it("il banner con sei ricette da guardare le mostra tutte", async () => {
    const { root } = await section(Array.from({ length: 6 }, (_, i) => recipe(`r-${i + 1}`)));
    const banner = $(root, ".settings-banner");
    expect(banner.querySelectorAll(".setting-row")).toHaveLength(6);
    expect(banner.textContent).not.toContain("E altre");
  });

  it("il permesso spento a mano si dice sulla riga", async () => {
    const { root } = await section([recipe("archivia", { status: "adottata", mounted: true, allowed: false })]);
    expect($(root, ".recipe-status").textContent).toBe("Accesa");
    expect($(root, ".setting-meta").textContent).toContain("Il permesso è spento: i suoi passi vengono rifiutati");
    expect(sectionMeta([recipe("x", { status: "adottata" })])).toBe("1 ricetta");
  });
});

describe("i gesti", () => {
  it("«Spegni» scarta la ricetta, rilegge, e il fuoco va su «Guarda»", async () => {
    const { host, root } = await section([recipe("riunione", { status: "adottata", mounted: true, allowed: true })]);
    const off = buttons(root, "Spegni")[0]!;
    off.focus();
    off.click();
    await vi.waitFor(() => expect($(root, ".recipe-status").dataset.status).toBe("proposta"));
    expect(host.atGate("recipeDiscard").map((call) => call.args)).toEqual([["riunione"]]);
    expect(document.activeElement).toBe(buttons($(root, ".recipe-list"), "Guarda")[0]);
  });

  it("«Guarda» apre la finestra; accesa, la riga si rilegge e lo si dice", async () => {
    const { host, root } = await section([recipe("archivia")]);
    buttons($(root, ".recipe-list"), "Guarda")[0]!.click();
    const dialog = document.querySelector<HTMLElement>(".recipe-dialog")!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement!.textContent).toBe("Non ora");
    dialog.querySelector<HTMLButtonElement>('[data-action="adopt"]')!.click();
    await vi.waitFor(() => expect($(root, ".recipe-status").dataset.status).toBe("adottata"));
    expect(host.atGate("recipeAdopt").map((call) => call.args)).toEqual([["archivia", PRINT]]);
    expect(hooks.notify).toHaveBeenCalledWith("«Ricetta archivia» è accesa: la trovi nella palette.", "info");
    expect(root.querySelector(".settings-banner")).toBeNull();
  });

  it("una nota della cartella cambiata rilegge la sezione a schermo", async () => {
    const { host, root } = await section([recipe("archivia", { status: "adottata", mounted: true, allowed: true })]);
    const reads = host.atGate("recipesList").length;
    host.writeFromOutside("Altrove/nota.md", "x");
    host.recipeChangedFromOutside("archivia", LATER);
    host.writeFromOutside("Recipes/archivia.md", "testo nuovo");
    await vi.waitFor(() => expect($(root, ".recipe-status").dataset.status).toBe("cambiata"));
    expect(host.atGate("recipesList").length).toBe(reads + 1);
  });
});

describe("l'avviso", () => {
  it("all'apertura nomina le ricette da guardare, con la sola azione «Guarda»", async () => {
    await start([recipe("archivia"), recipe("letta", { status: "cambiata" }), recipe("ok", { status: "adottata", mounted: true, allowed: true })]);
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    lifetime.add(notices.stop);
    await notices.atOpen();
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, tone, action] = notify.mock.calls[0]!;
    expect(message).toBe("Il vault propone 2 ricette da guardare: Ricetta archivia, Ricetta letta.");
    expect(tone).toBe("info");
    expect(action.label).toBe("Guarda");
    const opened = vi.fn();
    const stop = registerRecipesOpener(opened);
    action.run();
    stop();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("con tante ricette da guardare ne nomina tre e conta le altre", async () => {
    const waiting = Array.from({ length: 80 }, (_, i) => recipe(`r-${String(i + 1).padStart(2, "0")}`));
    await start(waiting);
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    lifetime.add(notices.stop);
    await notices.atOpen();
    expect(notify.mock.calls[0]![0]).toBe(
      "Il vault propone 80 ricette da guardare: Ricetta r-01, Ricetta r-02, Ricetta r-03 e altre 77.",
    );
  });

  it("con una sola ricetta oltre le tre la nomina, invece di dire «e altre 1»", async () => {
    await start(Array.from({ length: 4 }, (_, i) => recipe(`r-${i + 1}`)));
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    lifetime.add(notices.stop);
    await notices.atOpen();
    expect(notify.mock.calls[0]![0]).toBe(
      "Il vault propone 4 ricette da guardare: Ricetta r-1, Ricetta r-2, Ricetta r-3, Ricetta r-4.",
    );
  });

  it("un titolo lunghissimo nell'avviso si accorcia, col suo «…»", async () => {
    const long = "Archivia ".repeat(30).trim();
    await start([recipe("lunga", { title: long })]);
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    lifetime.add(notices.stop);
    await notices.atOpen();
    const message: string = notify.mock.calls[0]![0];
    expect(message.length).toBeLessThan(120);
    expect(message).toMatch(/^Il vault propone una ricetta da guardare: Archivia .*…\.$/u);
  });

  it("una nota della cartella che cambia fa l'avviso una volta sola per ricetta", async () => {
    const host = await start([recipe("archivia", { status: "adottata", mounted: true, allowed: true })]);
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    lifetime.add(notices.stop);
    await notices.atOpen();
    expect(notify).not.toHaveBeenCalled();
    const reads = host.atGate("recipesList").length;
    // Fuori dalla cartella: niente da rileggere.
    host.writeFromOutside("Diario/oggi.md", "x");
    host.recipeChangedFromOutside("archivia", LATER);
    host.writeFromOutside("Recipes/archivia.md", "nuovo");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(host.atGate("recipesList").length).toBe(reads + 1);
    expect(notify.mock.calls[0]![0]).toBe("Il vault propone una ricetta da guardare: Ricetta archivia.");
    host.writeFromOutside("Recipes/archivia.md", "ancora");
    await vi.waitFor(() => expect(host.atGate("recipesList").length).toBe(reads + 2));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("chiuso il vault, gli ascoltatori se ne vanno", async () => {
    const host = await start([recipe("archivia", { status: "adottata", mounted: true, allowed: true })]);
    const notify = vi.fn();
    const notices = watchRecipeNotices(notify);
    await notices.atOpen();
    const reads = host.atGate("recipesList").length;
    notices.stop();
    host.recipeChangedFromOutside("archivia", LATER);
    host.writeFromOutside("Recipes/archivia.md", "nuovo");
    await new Promise((done) => setTimeout(done, 600));
    expect(host.atGate("recipesList").length).toBe(reads);
    expect(notify).not.toHaveBeenCalled();
  });

  it("la cartella viene dall'impostazione, o è quella di serie", () => {
    expect(recipesFolder([])).toBe("Recipes");
  });
});
