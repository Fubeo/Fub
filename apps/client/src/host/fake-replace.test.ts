// `vault.replace` dell'host finto: letterale, a piano prima e scrittura dopo,
// come il comando vero. Serve al banco e ai test della ricerca.
import { describe, expect, it } from "vitest";
import { createFakeHost } from "./fake";

function host() {
  return createFakeHost({ file: { "a.md": "gatto e Gatto e gattone", "b.md": "niente", "c.md": "il gatto" } }).module.api;
}

describe("vault.replace nell'host finto", () => {
  it("il piano non scrive: dice quante note e quante modifiche", async () => {
    const api = host();
    const plan = await api.invokeCommand("vault.replace", { find: "gatto", replace: "cane" }, "dry_run");
    expect(plan.effect).toMatchObject({ kind: "plan", docs: ["a.md", "c.md"] });
    expect(plan.effect.kind === "plan" && plan.effect.edits.reduce((n, p) => n + p.edit.edits.length, 0)).toBe(3);
    expect(await api.invokeCommand("vault.replace", { find: "gatto", replace: "cane", docs: ["c.md"] }, "dry_run")).toMatchObject({
      effect: { kind: "plan", docs: ["c.md"] },
    });
  });

  it("la parola intera lascia stare «gattone»", async () => {
    const plan = await host().invokeCommand("vault.replace", { find: "gatto", replace: "cane", whole_word: true }, "dry_run");
    expect(plan.effect.kind === "plan" && plan.effect.edits.find((p) => p.doc === "a.md")?.edit.edits.length).toBe(1);
  });

  it("applica solo sulle note nominate", async () => {
    const api = host();
    await api.invokeCommand("vault.replace", { find: "gatto", replace: "cane", docs: ["c.md"] }, "apply");
    expect((await api.readDocument("c.md")).text).toBe("il cane");
    expect((await api.readDocument("a.md")).text).toBe("gatto e Gatto e gattone");
  });

  it("una stringa vuota non si cerca", async () => {
    await expect(host().invokeCommand("vault.replace", { find: "", replace: "x" }, "dry_run")).rejects.toThrow();
  });
});
