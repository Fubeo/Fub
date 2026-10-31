import { beforeEach, describe, expect, it, vi } from "vitest";

// Le persone (K5): la cartella letta dalle impostazioni del vault, rifatta
// quando cambia, e un segnale soltanto se cambia davvero.

const world = vi.hoisted(() => ({
  value: "Persone" as unknown,
  asked: [] as { folder: string; text: string }[],
  created: [] as { name: string; folder: string | undefined }[],
  events: new Map<string, ((event: { key?: string }) => void)[]>(),
}));

vi.mock("../host/query", () => ({
  settings: async () => [{ spec: { key: "files.people-folder" }, value: world.value }],
  notesInFolder: async (folder: string, text: string) => {
    world.asked.push({ folder, text });
    return [`${folder}/Anna.md`];
  },
}));
vi.mock("./vault", () => ({
  createNote: async (name: string, folder?: string) => {
    world.created.push({ name, folder });
    return `${folder}/${name}.md`;
  },
}));
vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: (event: { key?: string }) => void) => {
    world.events.set(type, [...(world.events.get(type) ?? []), handler]);
    return () => world.events.set(type, (world.events.get(type) ?? []).filter((each) => each !== handler));
  },
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  openVaultRoot: () => "/vault",
}));

import { createPerson, isPersonTarget, mountPeople, normalizedFolder, peopleFolder, searchPeople } from "./people";
import { on } from "./store";
import { Lifetime } from "../ui/lifetime";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  world.value = "Persone";
  world.asked.length = 0;
  world.created.length = 0;
  world.events.clear();
});

describe("normalizedFolder", () => {
  it("toglie spazi e barre ai bordi, e torna a Persone se non è testo", () => {
    expect(normalizedFolder(" /Gente/Amici/ ")).toBe("Gente/Amici");
    expect(normalizedFolder("")).toBe("");
    expect(normalizedFolder(42)).toBe("Persone");
  });
});

describe("isPersonTarget", () => {
  it("riconosce le note dentro la cartella, maiuscole a parte", () => {
    expect(isPersonTarget("Persone/Anna", "Persone")).toBe(true);
    expect(isPersonTarget("persone/Anna", "Persone")).toBe(true);
    expect(isPersonTarget("Persone/", "Persone")).toBe(false);
    expect(isPersonTarget("Personale/Anna", "Persone")).toBe(false);
    expect(isPersonTarget("Anna", "Persone")).toBe(false);
    expect(isPersonTarget("Persone/Anna", "")).toBe(false);
  });
});

describe("mountPeople", () => {
  it("legge la cartella del vault e la rilegge quando l'impostazione cambia", async () => {
    world.value = "Gente";
    const lifetime = new Lifetime();
    const signals: number[] = [];
    lifetime.add(on("people", () => signals.push(1)));
    mountPeople(lifetime);
    await settle();
    expect(peopleFolder()).toBe("Gente");
    expect(signals).toHaveLength(1);
    expect(await searchPeople("An")).toEqual(["Gente/Anna.md"]);
    expect(await createPerson("Lia")).toBe("Gente/Lia.md");
    expect(world.created).toEqual([{ name: "Lia", folder: "Gente" }]);

    for (const handler of world.events.get("setting_changed") ?? []) handler({ key: "altro" });
    await settle();
    expect(signals).toHaveLength(1);

    world.value = "";
    for (const handler of world.events.get("setting_changed") ?? []) handler({ key: "files.people-folder" });
    await settle();
    expect(peopleFolder()).toBe("");
    expect(signals).toHaveLength(2);
    expect(await searchPeople("An")).toEqual([]);
    expect(await createPerson("Lia")).toBeNull();

    lifetime.close();
    expect(peopleFolder()).toBe("Persone");
    expect(world.events.get("setting_changed")).toEqual([]);
  });
});
