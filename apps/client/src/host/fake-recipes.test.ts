// Le ricette dell'host finto: le regole che l'host vero fa vedere da fuori
// (si adotta solo il testo guardato, una ricetta con problemi non si adotta né
// si prova, una nota cambiata smonta la ricetta), con gli errori tipizzati.
import { describe, expect, it } from "vitest";
import type { CommandPlan, RecipeInfo } from "./contract";
import { createFakeHost, type FakeRecipe } from "./fake";

const PRINT = "3f".repeat(32);
const LATER = "a1".repeat(32);

const PLAN: CommandPlan = {
  summary: "Aggiunge un'attività a Diario.md",
  docs: ["Diario.md"],
  edits: [],
};

function recipe(over: Partial<FakeRecipe> = {}): FakeRecipe {
  return {
    id: "revisione",
    title: "Revisione della nota",
    description: "",
    doc: "Ricette/revisione.md",
    status: "proposta",
    fingerprint: PRINT,
    problems: [],
    steps: [],
    command: "recipe.revisione:run",
    keybinding: null,
    surfaces: [],
    mounted: false,
    allowed: false,
    plan: PLAN,
    ...over,
  };
}

const rows = (list: { recipes: RecipeInfo[] }) =>
  list.recipes.map((row) => [row.id, row.status, row.mounted, row.allowed]);

describe("le ricette nell'host finto", () => {
  it("proposta → adottata → la nota cambia → cambiata e smontata → scartata", async () => {
    const fake = createFakeHost({ recipes: [recipe()] });
    const api = fake.module.api;

    expect(rows(await api.recipesList())).toEqual([["revisione", "proposta", false, false]]);
    await api.recipeAdopt("revisione", PRINT);
    expect(rows(await api.recipesList())).toEqual([["revisione", "adottata", true, true]]);

    fake.recipeChangedFromOutside("revisione", LATER);
    const changed = await api.recipesList();
    expect(rows(changed)).toEqual([["revisione", "cambiata", false, false]]);
    expect(changed.recipes[0]!.fingerprint).toBe(LATER);

    await api.recipeDiscard("revisione");
    expect(rows(await api.recipesList())).toEqual([["revisione", "proposta", false, false]]);
    expect(fake.atGate("recipeAdopt").map((call) => call.args)).toEqual([["revisione", PRINT]]);
  });

  it("l'impronta vecchia è un conflitto, e la ricetta resta com'era", async () => {
    const fake = createFakeHost({ recipes: [recipe()] });
    fake.recipeChangedFromOutside("revisione", LATER);

    await expect(fake.module.api.recipeAdopt("revisione", PRINT)).rejects.toMatchObject({
      kind: "conflict",
      message: expect.stringContaining("è cambiata dopo che l'hai guardata"),
    });
    expect(rows(await fake.module.api.recipesList())).toEqual([["revisione", "proposta", false, false]]);
  });

  it("un id che non c'è e nessun vault aperto sono not_found", async () => {
    const api = createFakeHost({ recipes: [recipe()] }).module.api;
    await expect(api.recipeAdopt("altra", PRINT)).rejects.toMatchObject({ kind: "not_found" });
    await expect(api.recipeSimulate("altra")).rejects.toMatchObject({ kind: "not_found" });
    // Scartare una ricetta mai adottata non ha niente da togliere.
    await expect(api.recipeDiscard("revisione")).rejects.toMatchObject({ kind: "not_found" });

    const closed = createFakeHost({ root: null, recipes: [recipe()] }).module.api;
    await expect(closed.recipesList()).rejects.toEqual({ kind: "not_found", message: "Nessun vault aperto." });
  });

  it("una ricetta con problemi non si adotta e non si prova: il primo problema è l'errore", async () => {
    const problem = { code: "comando-sconosciuto", field: "steps[0].run", line: 4, message: "Il comando non c'è." };
    const api = createFakeHost({ recipes: [recipe({ status: "problemi", problems: [problem] })] }).module.api;
    await expect(api.recipeAdopt("revisione", PRINT)).rejects.toEqual({ kind: "bad_args", message: "Il comando non c'è." });
    await expect(api.recipeSimulate("revisione")).rejects.toEqual({ kind: "bad_args", message: "Il comando non c'è." });
  });

  it("la prova dà il piano anche per una ricetta non adottata, e non cambia niente", async () => {
    const fake = createFakeHost({ recipes: [recipe()] });
    const plan = await fake.module.api.recipeSimulate("revisione", { nota: "Diario.md" });
    expect(plan).toEqual(PLAN);
    expect(fake.atGate("recipeSimulate").map((call) => call.args)).toEqual([["revisione", { nota: "Diario.md" }]]);
    // Il piano non esce dall'elenco: `recipesList` dà la riga del contratto.
    const list = await fake.module.api.recipesList();
    expect(Object.keys(list.recipes[0]!)).not.toContain("plan");
    expect(rows(list)).toEqual([["revisione", "proposta", false, false]]);
  });
});
