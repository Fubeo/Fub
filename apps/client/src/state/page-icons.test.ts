import { beforeEach, describe, expect, it, vi } from "vitest";

// L'icona della pagina fuori dalla pagina (K9): una domanda all'indice per
// vault, rifatta quando l'indice cambia, e un segnale solo se cambia qualcosa.

const world = vi.hoisted(() => ({
  queries: [] as unknown[],
  answer: [] as { doc: string; properties?: { key: string; value: unknown }[] }[],
  events: new Map<string, (() => void)[]>(),
}));

vi.mock("../host/ipc", () => ({
  api: {
    queryIndex: async (query: unknown) => {
      world.queries.push(query);
      return { kind: "documents", value: { items: world.answer, offset: 0, total: world.answer.length } };
    },
  },
}));
vi.mock("./kernel", () => ({
  onEvent: (type: string, handler: () => void) => {
    world.events.set(type, [...(world.events.get(type) ?? []), handler]);
    return () => world.events.set(type, (world.events.get(type) ?? []).filter((each) => each !== handler));
  },
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  openVaultRoot: () => "/vault",
}));

import { openLifetime } from "../ui/lifetime";
import { on } from "./store";
import { iconsFrom, iconValue, linkedPageIcon, mountPageIcons, pageIcon } from "./page-icons";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (type: string) => { for (const handler of world.events.get(type) ?? []) handler(); };
const withIcon = (doc: string, icon: unknown) => ({ doc, properties: [{ key: "icon", value: icon }] });

beforeEach(() => {
  world.queries = [];
  world.answer = [];
  world.events = new Map();
});

describe("che cosa è un'icona", () => {
  it("un testo breve, non un path o un indirizzo", () => {
    expect(iconValue(" 🌱 ")).toBe("🌱");
    expect(iconValue("A")).toBe("A");
    expect(iconValue("img/foglia.png")).toBeNull();
    expect(iconValue("https://notion.so/icon.png")).toBeNull();
    expect(iconValue("")).toBeNull();
    expect(iconValue(3)).toBeNull();
    expect(iconValue(["🌱"])).toBeNull();
  });

  it("due omonime con icone diverse non danno l'icona al nome", () => {
    const { byDoc, byName } = iconsFrom([
      withIcon("Viaggio/_index.md", "🧳"),
      withIcon("Archivio/Viaggio.md", "📦"),
      withIcon("Roma.md", "🏛"),
      withIcon("Altro/Roma.md", "🏛"),
      { doc: "Senza.md" },
    ]);
    expect(byDoc.get("Viaggio/_index.md")).toBe("🧳");
    expect(byDoc.has("Senza.md")).toBe(false);
    expect(byName.get("viaggio")).toBeNull();
    expect(byName.get("roma")).toBe("🏛");
  });
});

describe("le icone del vault", () => {
  it("chiede le note con `icon:` e ne legge solo quella chiave", async () => {
    world.answer = [withIcon("Viaggio/_index.md", "🧳"), withIcon("Note/Treno.md", "🚆")];
    const life = openLifetime();
    const signals: number[] = [];
    life.add(on("page-icons", () => void signals.push(1)));
    mountPageIcons(life);
    await settle();
    expect(world.queries).toHaveLength(1);
    expect(world.queries[0]).toMatchObject({
      kind: "documents",
      matching: { any: [{ all: [{ negated: false, predicate: { kind: "property", filter: { key: "icon", test: { op: "exists" } } } }] }] },
      select: { kind: "keys", keys: ["icon"] },
    });
    expect(signals).toHaveLength(1);
    expect(pageIcon("Note/Treno.md")).toBe("🚆");
    // Un wikilink la trova per nome, anche per la pagina di una cartella, o
    // per il path scritto.
    expect(linkedPageIcon("Viaggio")).toBe("🧳");
    expect(linkedPageIcon("treno")).toBe("🚆");
    expect(linkedPageIcon("Note/Treno")).toBe("🚆");
    expect(linkedPageIcon("Altra")).toBeNull();

    // L'indice che cambia senza toccare le icone non ridisegna niente.
    fire("index_updated");
    await settle();
    expect(world.queries).toHaveLength(2);
    expect(signals).toHaveLength(1);

    world.answer = [withIcon("Note/Treno.md", "🚄")];
    fire("batch_ended");
    await settle();
    expect(signals).toHaveLength(2);
    expect(pageIcon("Note/Treno.md")).toBe("🚄");
    expect(pageIcon("Viaggio/_index.md")).toBeNull();

    // Chiusa la vita, le icone se ne vanno e non si richiedono più.
    life.close();
    expect(pageIcon("Note/Treno.md")).toBeNull();
    fire("index_updated");
    await settle();
    expect(world.queries).toHaveLength(3);
  });
});
