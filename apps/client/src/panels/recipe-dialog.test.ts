// @vitest-environment happy-dom
//
// La finestra di una ricetta contro l'host finto: che cosa mostra (le parole
// di chi l'ha scritta, i passi letti da Fub, i fatti), da dove parte il fuoco,
// la prova sulla nota aperta, e l'impronta che «Accendi» manda — quella che la
// finestra ha mostrato, mai un testo cambiato dopo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, RecipeStepInfo } from "../host/contract";
import type { FakeHost, FakeRecipe } from "../host/fake";
import { press } from "../kit/testing";

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
const { openLayers } = await import("../kit/layers");
const { openRecipeDialog, valueInWords } = await import("./recipe-dialog");

const PRINT = "3f".repeat(32);
const LATER = "a1".repeat(32);

const SPECS: CommandSpec[] = [
  {
    id: "note.property.set",
    title: "Imposta proprietà",
    description: "",
    keybinding: null,
    params: [
      { name: "doc", title: "Nota", description: "", kind: { kind: "document" }, required: true },
      { name: "key", title: "Proprietà", description: "", kind: { kind: "text" }, required: true },
      { name: "value", title: "Valore", description: "", kind: { kind: "text" }, required: true },
    ],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  },
  {
    id: "note.rename",
    title: "Rinomina nota",
    description: "",
    keybinding: null,
    params: [
      { name: "doc", title: "Nota", description: "", kind: { kind: "document" }, required: true },
      { name: "to", title: "Nuovo percorso", description: "", kind: { kind: "text" }, required: true },
    ],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  },
];

function step(run: string, title: string, args: Record<string, unknown>): RecipeStepInfo {
  return { run, title, args, writes: true, reach: "document", reversible: true };
}

function archivia(over: Partial<FakeRecipe> = {}): FakeRecipe {
  return {
    id: "archivia",
    title: "Archivia la nota",
    description: "Segna la data di oggi e sposta la nota in Archivio.",
    doc: "Recipes/Archivia.md",
    status: "proposta",
    fingerprint: PRINT,
    problems: [],
    steps: [
      step("note.property.set", "Imposta proprietà", { doc: "{{doc}}", key: "archiviata", value: "{{date}}" }),
      step("note.rename", "Rinomina nota", { doc: "{{doc}}", to: "Archivio/{{title}}.md" }),
    ],
    command: "recipe.archivia:run",
    keybinding: "Mod-Alt-a",
    surfaces: ["slash"],
    mounted: false,
    allowed: false,
    plan: { summary: "«Archivia la nota»: archiviata = 2026-11-03; Verbale.md → Archivio/Verbale.md", docs: ["Verbale.md"], edits: [] },
    ...over,
  };
}

let stopRouter: (() => void) | null = null;
let lifetime = openLifetime();

async function mount(recipe: FakeRecipe, openNote: string | null = "Diario/Verbale.md") {
  box.host = createFakeHost({ recipes: [recipe] });
  stopRouter = await startKernelRouter();
  setCommandSpecs(SPECS);
  lifetime = openLifetime();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const dialog = openRecipeDialog({ recipe: structuredClone(recipe), lifetime, openNote });
  return dialog;
}

const action = (root: ParentNode, id: string) => root.querySelector<HTMLButtonElement>(`[data-action="${id}"]`);
const texts = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((node) => node.textContent);

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  lifetime.close();
  stopRouter?.();
  stopRouter = null;
  box.host = null;
  setCommandSpecs([]);
  expect(openLayers()).toBe(0);
  document.body.replaceChildren();
});

describe("che cosa mostra", () => {
  it("le parole di chi l'ha scritta, la nota d'origine, e tutti i passi letti da Fub", async () => {
    const { element } = await mount(archivia());
    expect(element.classList.contains("recipe-dialog")).toBe(true);
    expect(element.querySelector(".kit-dialog-title")!.textContent).toBe("Archivia la nota");
    expect(element.querySelector(".kit-dialog-description")!.textContent).toBe("Segna la data di oggi e sposta la nota in Archivio.");
    const origin = element.querySelector(".recipe-origin")!;
    expect(origin.querySelector(".recipe-where")!.textContent).toBe("Recipes/Archivia.md");
    expect(origin.textContent).toContain("li ha scritti chi ha fatto la ricetta");
    expect(texts(element, ".recipe-step-n")).toEqual(["1", "2"]);
    expect(texts(element, ".recipe-step-title")).toEqual(["Imposta proprietà", "Rinomina nota"]);
    expect(texts(element, ".recipe-step-args")).toEqual([
      "Nota: la nota su cui la usi; Proprietà: «archiviata»; Valore: la data di oggi",
      "Nota: la nota su cui la usi; Nuovo percorso: «Archivio/‹il nome della nota su cui la usi›.md»",
    ]);
  });

  it("i fatti: tocca solo la nota su cui la usi, i comandi del permesso, dove la trovi", async () => {
    const { element } = await mount(archivia());
    const facts = [...element.querySelectorAll<HTMLElement>(".recipe-fact")];
    expect(facts.map((fact) => fact.querySelector(".recipe-fact-label")!.textContent)).toEqual([
      "Tocca", "Può usare", "Si annulla", "La trovi", "Vale",
    ]);
    expect(facts[0]!.textContent).toContain("Solo la nota su cui la usi.");
    expect(facts[0]!.dataset.reach).toBeUndefined();
    expect(facts[1]!.textContent).toContain("Imposta proprietà, Rinomina nota. Nessun altro comando.");
    expect(facts[3]!.textContent).toContain("Nella palette e nel menu «/» · ");
  });

  it("venti passi tutti visibili, e una nota fissa nominata con data-reach=\"altre\"", async () => {
    const steps = Array.from({ length: 19 }, (_, i) =>
      step("note.property.set", "Imposta proprietà", { doc: "{{doc}}", key: `campo-${i}`, value: "sì" }));
    steps.push(step("note.property.set", "Imposta proprietà", {
      doc: "Progetti/Indice dei progetti.md", key: "ultimo-chiuso", value: "{{title}}",
    }));
    const { element } = await mount(archivia({ steps }));
    expect(element.querySelectorAll(".recipe-step")).toHaveLength(20);
    expect(element.querySelector("details")).toBeNull();
    expect(texts(element, ".recipe-step-args")[19]).toContain("Nota: la nota «Progetti/Indice dei progetti»");
    const reach = element.querySelector<HTMLElement>(".recipe-fact")!;
    expect(reach.dataset.reach).toBe("altre");
    expect(reach.textContent).toContain("«Progetti/Indice dei progetti»");
  });

  it("un titolo lunghissimo resta tutto, senza tagli", async () => {
    const title = "Prepara il resoconto settimanale ".repeat(8).trim();
    const { element } = await mount(archivia({ title }));
    expect(element.querySelector(".kit-dialog-title")!.textContent).toBe(title);
  });

  it("i valori in parole: segnaposto, testo fisso, nota fissa, sì e no", () => {
    expect(valueInWords("{{param.cartella}}", undefined)).toBe("il valore «cartella» che scegli quando la usi");
    expect(valueInWords(true, undefined)).toBe("sì");
    expect(valueInWords("Diario/segreto.md", { name: "doc", title: "Nota", description: "", kind: { kind: "document" }, required: true }))
      .toBe("la nota «Diario/segreto»");
    expect(valueInWords("", undefined)).toBe("niente");
  });
});

describe("il fuoco e le azioni", () => {
  it("il fuoco parte da «Non ora», ed Escape chiude come «Non ora»", async () => {
    const { element, result } = await mount(archivia());
    expect(document.activeElement).toBe(action(element, "later"));
    expect(action(element, "later")!.textContent).toBe("Non ora");
    expect(action(element, "adopt")!.textContent).toBe("Accendi la ricetta");
    press(document.activeElement!, "Escape");
    await expect(result).resolves.toBe("later");
    expect(box.host!.atGate("recipeAdopt")).toEqual([]);
  });

  it("«Accendi» manda l'impronta che la finestra ha mostrato", async () => {
    const { element, result } = await mount(archivia());
    action(element, "adopt")!.click();
    await expect(result).resolves.toBe("adopted");
    expect(box.host!.atGate("recipeAdopt").map((call) => call.args)).toEqual([["archivia", PRINT]]);
  });

  it("una ricetta già accesa si chiude soltanto", async () => {
    const { element } = await mount(archivia({ status: "adottata", mounted: true, allowed: true }));
    expect(action(element, "adopt")).toBeNull();
    expect(action(element, "later")!.textContent).toBe("Chiudi");
  });
});

describe("la ricetta cambiata mentre la si guarda", () => {
  it("l'evento del kernel ferma «Accendi»; «Rileggi» mostra il testo nuovo e manda la sua impronta", async () => {
    const { element, result } = await mount(archivia());
    const stale = element.querySelector<HTMLElement>(".recipe-stale")!;
    expect(stale.hidden).toBe(true);
    box.host!.recipeChangedFromOutside("archivia", LATER);
    box.host!.writeFromOutside("Recipes/Archivia.md", "testo nuovo");
    await vi.waitFor(() => expect(stale.hidden).toBe(false));
    expect(stale.getAttribute("role")).toBe("alert");
    expect(action(element, "adopt")!.disabled).toBe(true);
    action(element, "adopt")!.click();
    expect(box.host!.atGate("recipeAdopt")).toEqual([]);

    stale.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(stale.hidden).toBe(true));
    expect(action(element, "adopt")!.disabled).toBe(false);
    action(element, "adopt")!.click();
    await expect(result).resolves.toBe("adopted");
    expect(box.host!.atGate("recipeAdopt").map((call) => call.args)).toEqual([["archivia", LATER]]);
  });

  it("l'impronta vecchia rifiutata dall'host mostra lo stesso avviso, e la finestra resta aperta", async () => {
    const { element } = await mount(archivia());
    // Nessun evento: lo dice soltanto l'host, alla richiesta.
    box.host!.recipeChangedFromOutside("archivia", LATER);
    action(element, "adopt")!.click();
    const stale = element.querySelector<HTMLElement>(".recipe-stale")!;
    await vi.waitFor(() => expect(stale.hidden).toBe(false));
    expect(element.isConnected).toBe(true);
    expect(action(element, "adopt")!.disabled).toBe(true);
  });
});

describe("la prova sulla nota aperta", () => {
  it("parte da sola con la nota aperta, e con più passi dice che è approssimata", async () => {
    const { element } = await mount(archivia());
    const zone = element.querySelector<HTMLElement>('[aria-live="polite"]')!;
    await vi.waitFor(() => expect(zone.querySelector(".recipe-try-item")).not.toBeNull());
    expect(box.host!.atGate("recipeSimulate").map((call) => call.args)).toEqual([["archivia", { doc: "Diario/Verbale.md" }]]);
    expect(zone.querySelector(".recipe-try-note")!.textContent).toBe("Su «Verbale», senza cambiare niente, succederebbe questo:");
    expect(zone.querySelector(".recipe-try-item")!.textContent).toContain("Archivio/Verbale.md");
    expect(zone.textContent).toContain("approssimata");
  });

  it("senza una nota aperta chiede di aprirne una, e non prova niente", async () => {
    const { element } = await mount(archivia(), null);
    expect(element.querySelector(".recipe-try-note")!.textContent).toBe(
      "Apri una nota per vedere che cosa le farebbe. La prova non cambia niente.",
    );
    expect(box.host!.atGate("recipeSimulate")).toEqual([]);
    // La prova non è obbligatoria per accendere.
    expect(action(element, "adopt")!.disabled).toBe(false);
  });

  it("in errore dice perché, e «Riprova» la rifà", async () => {
    box.host = createFakeHost({ recipes: [archivia()] });
    const heal = box.host.fault("recipeSimulate", { kind: "bad_args", message: "«Archivio/Verbale.md» esiste già." });
    const host = box.host;
    stopRouter = await startKernelRouter();
    setCommandSpecs(SPECS);
    lifetime = openLifetime();
    const { element } = openRecipeDialog({ recipe: archivia(), lifetime, openNote: "Diario/Verbale.md" });
    await vi.waitFor(() => expect(element.querySelector(".setting-error-message")).not.toBeNull());
    expect(element.querySelector(".recipe-block .setting-error")!.textContent).toContain("esiste già");
    heal();
    const again = [...element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Riprova")!;
    again.click();
    await vi.waitFor(() => expect(element.querySelector(".recipe-try-item")).not.toBeNull());
    expect(host.atGate("recipeSimulate")).toHaveLength(2);
  });
});
