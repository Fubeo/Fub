// @vitest-environment happy-dom
//
// «+», il menu della colonna e il piede nella superficie vera, con un core
// finto che tiene le viste del file come le tiene `fub-features`: ogni gesto
// passa dai comandi che esistono (`base.view.set`, `base.view.add`,
// `base.view.remove`, `property.key.rename`) con la revisione, e il piede
// mostra i riepiloghi che dà `derive`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { closeContextMenu } from "../../ui/menu";
import { mountBaseSurface } from "./surface";

type BaseSurfaceOptions = NonNullable<Parameters<typeof mountBaseSurface>[3]>;

const notified = vi.hoisted(() => [] as { message: string; tone?: string; action?: { label: string; run: () => void } }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string, action?: { label: string; run: () => void }) => { notified.push({ message, tone, action }); },
}));

interface View { name: string; type: string; keys: Record<string, unknown> }
const NOTES = [
  { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: "Arrivata" }, { key: "valore", value: 1200 }] },
  { doc: "Opere/Campo.md", properties: [{ key: "stato", value: "In prestito" }, { key: "valore", value: 800.5 }] },
];

const mount = (views: View[], options: BaseSurfaceOptions = {}) => {
  let revision = 1;
  let notes = NOTES.map((note) => ({ ...note, properties: note.properties.map((each) => ({ ...each })) }));
  const stored = new Map<string, unknown>();
  const host = document.createElement("div");
  document.body.append(host);
  const text = () => ["views:", ...views.flatMap((view) => [`  - name: ${view.name}`, `    type: ${view.type}`, ...Object.entries(view.keys).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)]), ""].join("\n");
  const viewOf = (name: unknown) => views.find((view) => view.name === name) ?? views[0]!;
  const queryIndex = async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") return { kind: "documents", value: { offset: 0, total: notes.length, items: notes } };
    const query = request.kind === "custom" ? request.query as { op: string; view?: string | null } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: views.map((view) => view.name), types: views.map((view) => view.type) } };
    if (query.op === "plan") {
      const view = viewOf(query.view);
      const columns = (view.keys.order as string[] | undefined) ?? ["stato", "valore"];
      const summaries = ((view.keys.summaries as { key: string; aggregate: string }[] | undefined) ?? [])
        .map((each) => ({ key: each.key, aggregate: each.aggregate, expression: null, name: null, label: `${each.key}:${each.aggregate.replace(/_/g, "")}` }));
      return { kind: "custom", value: {
        view: view.name, view_type: view.type, columns, column_labels: {}, required_props: [], all_properties: true,
        group: (view.keys.group as { key: string } | undefined)?.key ?? null, limit: null, map: null, create_defaults: {},
        filters: view.keys.filters ?? "all", sort: view.keys.sort ?? [], order: view.keys.order ?? [], summaries,
      } };
    }
    if (query.op === "derive") {
      const view = viewOf(query.view);
      // I riepiloghi come li calcola il core: qui solo la somma, per la prova.
      const sums = Object.fromEntries(((view.keys.summaries as { key: string; aggregate: string }[] | undefined) ?? []).map((each) => [
        `${each.key}:${each.aggregate.replace(/_/g, "")}`,
        { kind: "number", value: notes.reduce((total, note) => total + Number(note.properties.find(({ key }) => key === each.key)?.value ?? 0), 0) },
      ]));
      return { kind: "custom", value: { summaries: sums, rows: notes.map(({ doc, properties }) => ({
        doc, values: Object.fromEntries(properties.map(({ key, value }) => [key, typeof value === "number" ? { kind: "number", value } : { kind: "text", value: String(value) }])),
      })) } };
    }
    throw new Error("unexpected Base operation");
  };
  const written = () => {
    revision++;
    // L'host rimanda il testo del file dopo il comando, come la sessione.
    setTimeout(() => surface.buffer.syncDoc(text()), 0);
    return { effect: { kind: "custom", ns: "fub.base", payload: { revision: `r${revision}` } }, undo: { label: "Rimetti" } };
  };
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "base.view.set") {
      const view = viewOf(args.view);
      if (args.value === undefined) delete view.keys[args.key as string];
      else view.keys[args.key as string] = JSON.parse(args.value as string);
      return { notify: `${String(args.key)} scritto`, ...written() };
    }
    if (command === "base.view.add") { views.push({ name: args.name as string, type: args.type as string, keys: {} }); return { notify: "Vista aggiunta", ...written() }; }
    if (command === "base.view.remove") { views.splice(views.findIndex((view) => view.name === args.view), 1); return { notify: "Vista tolta", ...written() }; }
    if (command === "property.key.rename") {
      notes = notes.map((note) => ({ ...note, properties: note.properties.map((each) => each.key === args.old_key ? { ...each, key: args.new_key as string } : each) }));
      return { notify: "Proprietà rinominata" };
    }
    return {};
  });
  const surface = mountBaseSurface("base", { paneId: "base-colonne", documentId: "Opere.base", parent: host }, {
    queryIndex, invokeCommand,
    viewState: async (key: string) => (stored.get(key) ?? null) as never,
    setViewState: async (key: string, value: unknown) => { if (value === null) stored.delete(key); else stored.set(key, value); },
    onOpenDocument: () => {}, revision: () => `r${revision}`,
  }, options);
  surface.buffer.setDoc(text());
  return {
    host, surface, invokeCommand, stored, views,
    // Il file cambiato da un'altra finestra.
    changeElsewhere: (change: () => void) => { change(); revision++; surface.buffer.syncDoc(text()); },
    done: () => { surface.destroy(); host.remove(); },
  };
};

const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
const settled = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-bar")!.getAttribute("aria-busy")).toBe("false"));
// Una voce del menu aperto, per nome.
const pick = (label: string): void => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((each) => each.querySelector(".menu-label")?.textContent === label);
  if (!button) throw new Error(`nessuna voce «${label}»: ${[...document.querySelectorAll("#context-menu .menu-label")].map((each) => each.textContent).join(", ")}`);
  button.click();
};
const sets = (invokeCommand: ReturnType<typeof vi.fn>) => invokeCommand.mock.calls.filter(([command]) => command !== "property.type.set").map(([command, args]) => [command, args]);

afterEach(() => { closeContextMenu(); notified.length = 0; });

describe("il menu della colonna nella superficie", () => {
  it("il clic sull'intestazione apre il menu col nome della colonna, e «Ordina decrescente» scrive `sort` con la revisione", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }]);
    try {
      await ready(host);
      const head = host.querySelector<HTMLButtonElement>('th[data-column="valore"] .base-head')!;
      expect(head.getAttribute("aria-haspopup")).toBe("menu");
      head.click();
      expect(head.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector("#context-menu .menu-head-name")!.textContent).toBe("valore");
      pick("Ordina decrescente");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalled());
      expect(invokeCommand).toHaveBeenCalledWith("base.view.set", { doc: "Opere.base", view: "Tabella", key: "sort", value: JSON.stringify([{ key: "valore", descending: true }]), base: "r1" });
      await settled(host);
      // L'intestazione dice il verso.
      await vi.waitFor(() => expect(host.querySelector('th[data-column="valore"] .base-head-sort')?.textContent).toBe("↓"));
    } finally { done(); }
  });

  it("«Nascondi» scrive `order` senza la colonna", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Nascondi");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ key: "order", value: JSON.stringify(["valore"]) })));
      await vi.waitFor(() => expect(host.querySelector('th[data-column="stato"]')).toBeNull());
    } finally { done(); }
  });

  it("«Raggruppa» scrive `group` e toglie prima la scelta di questa finestra", async () => {
    const { host, invokeCommand, stored, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    stored.set("base.group:Opere.base:Tabella", "valore");
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Raggruppa");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ key: "group", value: JSON.stringify({ key: "stato" }) })));
      expect(stored.has("base.group:Opere.base:Tabella")).toBe(false);
      await settled(host);
      // Le righe si raggruppano per stato, non più per valore.
      await vi.waitFor(() => expect([...host.querySelectorAll("tr.base-group-row")].map((row) => row.textContent)).toEqual([expect.stringContaining("Arrivata"), expect.stringContaining("In prestito")]));
    } finally { done(); }
  });

  it("«Rinomina la proprietà» cambia le note col comando che esiste e poi le viste del file che la nominano", async () => {
    const { host, invokeCommand, views, done } = mount([
      { name: "Tabella", type: "table", keys: { order: ["stato", "valore"], sort: [{ key: "stato", descending: false }] } },
      { name: "Schede", type: "cards", keys: { order: ["valore"] } },
    ]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Rinomina la proprietà…");
      const field = document.querySelector<HTMLInputElement>(".base-rename-field")!;
      expect(field.value).toBe("stato");
      field.value = "fase";
      field.dispatchEvent(new Event("input"));
      document.querySelector<HTMLFormElement>(".base-rename")!.requestSubmit();
      await vi.waitFor(() => expect(views[0]!.keys.sort).toEqual([{ key: "fase", descending: false }]));
      await settled(host);
      expect(sets(invokeCommand)).toEqual([
        ["property.key.rename", { old_key: "stato", new_key: "fase" }],
        ["base.view.set", { doc: "Opere.base", view: "Tabella", key: "sort", value: JSON.stringify([{ key: "fase", descending: false }]), base: "r1" }],
        ["base.view.set", { doc: "Opere.base", view: "Tabella", key: "order", value: JSON.stringify(["fase", "valore"]), base: "r2" }],
      ]);
      // La vista che non la nomina resta com'era.
      expect(views[1]!.keys).toEqual({ order: ["valore"] });
      await vi.waitFor(() => expect(host.querySelector('th[data-column="fase"]')).not.toBeNull());
    } finally { done(); }
  });
});

describe("il piede coi riepiloghi del core", () => {
  it("mostra il riepilogo scritto nel file sotto la sua colonna, nel formato della lingua", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"], summaries: [{ key: "valore", aggregate: "sum" }] } }]);
    try {
      await ready(host);
      const foot = host.querySelector(".base-table tfoot.base-foot")!;
      expect(foot.querySelector(".base-foot-count")!.textContent).toBe("2 note");
      const cell = foot.querySelector('td[data-column="valore"]')!;
      expect(cell.querySelector(".base-foot-name")!.textContent).toBe("Somma");
      expect(cell.querySelector(".base-foot-value")!.textContent).toBe("2.000,5");
      expect(foot.querySelector('td[data-column="stato"]')!.textContent).toBe("");
    } finally { done(); }
  });

  it("le schede hanno il piede in fila", async () => {
    const { host, done } = mount([{ name: "Schede", type: "cards", keys: { summaries: [{ key: "valore", aggregate: "sum" }] } }]);
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-summaries")).not.toBeNull());
      expect(host.querySelector(".base-summaries")!.textContent).toBe("2 notevalore · Somma2.000,5");
    } finally { done(); }
  });
});

describe("«+»: una vista nuova", () => {
  it("aggiunge la vista, le scrive filtro e colonne di quella aperta, la apre, e «Annulla» la toglie", async () => {
    const filter = { condition: { property: "valore", op: "greater_than", value: 1000 } };
    const { host, invokeCommand, views, done } = mount([{ name: "Tabella", type: "table", keys: { filters: filter, order: ["valore", "stato"] } }]);
    try {
      await ready(host);
      const plus = host.querySelector<HTMLButtonElement>(".base-tool-new-view")!;
      expect(plus.disabled).toBe(false);
      plus.click();
      expect(document.querySelector("#context-menu .menu-head-kind")!.textContent).toBe("Nuova vista");
      expect([...document.querySelectorAll("#context-menu .menu-label")].map((each) => each.textContent)).toEqual(["Tabella", "Schede", "Elenco", "Bacheca", "Mappa"]);
      pick("Bacheca");
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Bacheca"));
      await settled(host);
      expect(sets(invokeCommand)).toEqual([
        ["base.view.add", { doc: "Opere.base", name: "Bacheca", type: "kanban", base: "r1" }],
        ["base.view.set", { doc: "Opere.base", view: "Bacheca", key: "filters", value: JSON.stringify(filter), base: "r2" }],
        ["base.view.set", { doc: "Opere.base", view: "Bacheca", key: "order", value: JSON.stringify(["valore", "stato"]), base: "r3" }],
        ["base.view.set", { doc: "Opere.base", view: "Bacheca", key: "group", value: JSON.stringify({ key: "valore" }), base: "r4" }],
      ]);
      // Una frase sola per il gesto, con l'annulla che toglie la vista.
      expect(notified.map((each) => each.message)).toEqual(["Vista aggiunta"]);
      notified[0]!.action!.run();
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenLastCalledWith("base.view.remove", { doc: "Opere.base", view: "Bacheca", base: "r5" }));
      await vi.waitFor(() => expect(views.map((view) => view.name)).toEqual(["Tabella"]));
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Tabella"));
    } finally { done(); }
  });

  it("un nome già preso diventa «Tabella 2»; la mappa senza coordinate è spenta col perché", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      const map = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((each) => each.querySelector(".menu-label")?.textContent === "Mappa")!;
      expect(map.getAttribute("aria-disabled") === "true" || map.disabled).toBe(true);
      expect(map.querySelector(".menu-description")!.textContent).toContain("lat");
      pick("Tabella");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.add", expect.objectContaining({ name: "Tabella 2", type: "table" })));
      await settled(host);
    } finally { done(); }
  });

  it("in una Base dentro una nota «+» è spento col perché", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: {} }], { sourceInNote: true });
    try {
      await ready(host);
      const plus = host.querySelector<HTMLButtonElement>(".base-tool-new-view")!;
      expect(plus.disabled).toBe(true);
      expect(plus.title).toContain("blocco dentro la nota");
    } finally { done(); }
  });

  it("una vista tolta da un'altra finestra mentre è aperta lascia il posto alla prima", async () => {
    const { host, surface, views, changeElsewhere, done } = mount([{ name: "Tabella", type: "table", keys: {} }, { name: "Schede", type: "cards", keys: {} }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('.base-tab[data-view="Schede"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Schede"));
      changeElsewhere(() => views.splice(1, 1));
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Tabella"));
      expect(host.querySelector(".base-error")).toBeNull();
      void surface;
    } finally { done(); }
  });
});

describe("venti viste", () => {
  it("le linguette che non stanno restano figure, poi le ultime vanno in «Altre N viste»; la scelta resta in barra", async () => {
    // happy-dom non misura: la barra dice di essere stretta finché le
    // linguette mostrano il nome, e da figure ne entrano sei (cinque viste e
    // «Altre N viste»).
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get(this: HTMLElement) {
      if (!this.classList.contains("base-tabs")) return 0;
      if (!this.classList.contains("compact")) return 2000;
      return [...this.querySelectorAll<HTMLElement>(".base-tab")].filter((tab) => !tab.hidden).length > 6 ? 2000 : 0;
    } });
    const views = Array.from({ length: 20 }, (_, index) => ({ name: `Vista ${index + 1}`, type: index % 2 ? "cards" : "table", keys: {} }));
    const { host, done } = mount(views);
    try {
      await ready(host);
      const tabs = host.querySelector(".base-tabs")!;
      expect(tabs.querySelectorAll(".base-tab[data-view]")).toHaveLength(20);
      await vi.waitFor(() => expect(tabs.classList.contains("compact")).toBe(true));
      for (const tab of tabs.querySelectorAll<HTMLElement>(".base-tab[data-view]")) expect(tab.title).toMatch(/^Vista \d+$/);
      const shown = () => [...tabs.querySelectorAll<HTMLElement>(".base-tab[data-view]")].filter((tab) => !tab.hidden).map((tab) => tab.dataset.view);
      expect(shown()).toEqual(["Vista 1", "Vista 2", "Vista 3", "Vista 4", "Vista 5"]);
      const more = tabs.querySelector<HTMLButtonElement>(".base-tab-more")!;
      expect(tabs.lastElementChild).toBe(more);
      expect(more.hidden).toBe(false);
      expect(more.getAttribute("aria-label")).toBe("Altre 15 viste");
      more.click();
      expect([...document.querySelectorAll("#context-menu .menu-label")].map((each) => each.textContent)).toEqual(Array.from({ length: 15 }, (_, index) => `Vista ${index + 6}`));
      pick("Vista 12");
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Vista 12"));
      // La vista scelta resta nella barra, anche se viene dopo le altre.
      await vi.waitFor(() => expect(shown()).toContain("Vista 12"));
      expect(shown()).toHaveLength(5);
      expect(host.querySelector(".base-tool-new-view")).not.toBeNull();
    } finally {
      done();
      if (width) Object.defineProperty(HTMLElement.prototype, "scrollWidth", width);
      else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });
});

describe("i casi della revisione", () => {
  // Il comando `base.view.set` di una chiave che il core rifiuta.
  const refusing = (invokeCommand: ReturnType<typeof mount>["invokeCommand"], refuse: (args: Record<string, unknown>) => boolean) => {
    const real = invokeCommand.getMockImplementation()!;
    invokeCommand.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "base.view.set" && refuse(args)) throw new Error("chiave rifiutata");
      return real(command, args);
    });
  };

  it("«+» copia com'è un filtro che la Base non sa ridire", async () => {
    const filter = { condition: { property: "stato", op: "is", value: ["Arrivata", "In prestito"] } };
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { filters: filter } }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      pick("Schede");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ view: "Schede", key: "filters", value: JSON.stringify(filter) })));
      await settled(host);
    } finally { done(); }
  });

  it("un passo di «+» rifiutato: la vista resta aperta com'era, il motivo resta e l'avviso lo dice con «Annulla»", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["valore", "stato"] } }]);
    refusing(invokeCommand, (args) => args.key === "order");
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      pick("Schede");
      await vi.waitFor(() => expect(notified[notified.length - 1]?.tone).toBe("guasto"));
      await settled(host);
      const last = notified[notified.length - 1]!;
      expect(last.message).toBe("Vista «Schede» aggiunta, ma non con tutto: il motivo è sotto la barra.");
      expect(last.action?.label).toBe("Annulla");
      expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Tabella");
      expect(host.querySelector(".base-status")!.textContent).toContain("chiave rifiutata");
    } finally { done(); }
  });

  it("una rinomina che non arriva a una vista lo dice, con la vista e il motivo", async () => {
    const { host, invokeCommand, done } = mount([
      { name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } },
      { name: "Schede", type: "cards", keys: { order: ["stato"] } },
    ]);
    refusing(invokeCommand, (args) => args.view === "Schede");
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Rinomina la proprietà…");
      const field = document.querySelector<HTMLInputElement>(".base-rename-field")!;
      field.value = "fase";
      field.dispatchEvent(new Event("input"));
      document.querySelector<HTMLFormElement>(".base-rename")!.requestSubmit();
      await vi.waitFor(() => expect(notified[notified.length - 1]?.tone).toBe("guasto"));
      await settled(host);
      expect(notified[notified.length - 1]!.message).toBe("«stato» ora si chiama «fase» nelle note, ma non in tutte le viste");
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toBe("Queste viste hanno ancora il nome vecchio: Schede. Niente è stato scritto nel file .base: chiave rifiutata"));
    } finally { done(); }
  });

  it("cambiare vista chiude il menu di «+»", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }, { name: "Schede", type: "cards", keys: {} }]);
    try {
      await ready(host);
      const plus = host.querySelector<HTMLButtonElement>(".base-tool-new-view")!;
      plus.click();
      expect(plus.getAttribute("aria-expanded")).toBe("true");
      host.querySelector<HTMLButtonElement>('.base-tab[data-view="Schede"]')!.click();
      expect(plus.getAttribute("aria-expanded")).toBe("false");
    } finally { done(); }
  });

  it("tornati alla vista, il menu della colonna si riapre", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }, { name: "Schede", type: "cards", keys: {} }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      host.querySelector<HTMLButtonElement>('.base-tab[data-view="Schede"]')!.click();
      await vi.waitFor(() => expect(host.querySelector(".base-cards, .base-list")).not.toBeNull());
      host.querySelector<HTMLButtonElement>('.base-tab[data-view="Tabella"]')!.click();
      await ready(host);
      await settled(host);
      const head = host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!;
      head.click();
      expect(head.getAttribute("aria-expanded"), String(head.isConnected)).toBe("true");
      expect([...document.querySelectorAll("#context-menu .menu-label")].map((each) => each.textContent)).toContain("Nascondi");
    } finally { done(); }
  });

  it("cambiare vista chiude il menu della colonna, e una voce rimasta non scrive", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }, { name: "Schede", type: "cards", keys: {} }]);
    try {
      await ready(host);
      await settled(host);
      const head = host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!;
      head.click();
      expect(head.getAttribute("aria-expanded")).toBe("true");
      const hide = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((each) => each.querySelector(".menu-label")?.textContent === "Nascondi")!;
      host.querySelector<HTMLButtonElement>('.base-tab[data-view="Schede"]')!.click();
      expect(head.getAttribute("aria-expanded")).toBe("false");
      hide.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(invokeCommand.mock.calls.filter(([command]) => command === "base.view.set")).toEqual([]);
    } finally { done(); }
  });

  it("«+» è spento mentre un gesto scrive il file", async () => {
    const { host, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }]);
    const real = invokeCommand.getMockImplementation()!;
    const gate = { release: () => {} };
    invokeCommand.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "base.view.set") await new Promise<void>((resolve) => { gate.release = resolve; });
      return real(command, args);
    });
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="valore"] .base-head')!.click();
      pick("Ordina crescente");
      const plus = host.querySelector<HTMLButtonElement>(".base-tool-new-view")!;
      await vi.waitFor(() => expect(plus.disabled).toBe(true));
      expect(plus.title).toBe("Il file si sta scrivendo: un momento.");
      gate.release();
      await settled(host);
      await vi.waitFor(() => expect(plus.disabled).toBe(false));
    } finally { done(); }
  });

  it("togliere un gruppo scelto solo in questa finestra toglie la scelta e non scrive il file", async () => {
    const { host, invokeCommand, stored, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    stored.set("base.group:Opere.base:Tabella", "stato");
    try {
      await ready(host);
      await vi.waitFor(() => expect(host.querySelectorAll("tr.base-group-row").length).toBe(2));
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Raggruppa");
      await vi.waitFor(() => expect(host.querySelectorAll("tr.base-group-row").length).toBe(0));
      expect(stored.has("base.group:Opere.base:Tabella")).toBe(false);
      expect(invokeCommand.mock.calls.filter(([command]) => command === "base.view.set")).toEqual([]);
    } finally { done(); }
  });

  it("un gruppo che il file rifiuta lascia la scelta di questa finestra", async () => {
    const { host, invokeCommand, stored, done } = mount([{ name: "Tabella", type: "table", keys: {} }]);
    stored.set("base.group:Opere.base:Tabella", "valore");
    refusing(invokeCommand, (args) => args.key === "group");
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>('th[data-column="stato"] .base-head')!.click();
      pick("Raggruppa");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("base.view.set", expect.objectContaining({ key: "group" })));
      await settled(host);
      await vi.waitFor(() => expect(stored.get("base.group:Opere.base:Tabella")).toBe("valore"));
    } finally { done(); }
  });

  it("con la ricerca il piede dice «1 di 2 note» e i riepiloghi restano su tutte, attenuati", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"], summaries: [{ key: "valore", aggregate: "sum" }] } }]);
    try {
      await ready(host);
      host.querySelector<HTMLButtonElement>(".base-tool-search")!.click();
      const search = host.querySelector<HTMLInputElement>(".base-search")!;
      search.value = "Nebbia";
      search.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(1));
      const foot = host.querySelector(".base-table tfoot")!;
      expect(foot.querySelector(".base-foot-count")!.textContent).toBe("1 di 2 note");
      const summary = foot.querySelector('td[data-column="valore"] .base-foot-summary')!;
      expect(summary.classList.contains("base-foot-dimmed")).toBe(true);
      expect(summary.querySelector(".base-foot-value")!.textContent).toBe("2.000,5");
      expect(summary.querySelector<HTMLElement>(".base-foot-value")!.title).toBe("su tutte le 2 note della vista");
      expect(summary.querySelector(".sr-only")!.textContent).toContain("su tutte le 2 note della vista");
    } finally { done(); }
  });
});

describe("la tabella come nel prototipo", () => {
  it("la prima colonna è il titolo della nota (anche per `file.name`), in grassetto, col percorso nel suggerimento", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["file.name", "stato", "valore"] } }]);
    try {
      await ready(host);
      expect([...host.querySelectorAll(".base-table thead th")].map((th) => th.getAttribute("data-column"))).toEqual(["\u0000file", "stato", "valore"]);
      const title = host.querySelector<HTMLButtonElement>('tr[data-doc="Opere/Nebbia.md"] td[data-cell="0"] .base-title')!;
      expect(title.textContent).toBe("Nebbia");
      expect(title.title).toBe("Opere/Nebbia.md");
    } finally { done(); }
  });

  it("il titolo prende più spazio, le colonne corte restano strette, il testo divide il resto", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"], summaries: [{ key: "valore", aggregate: "sum" }] } }]);
    try {
      await ready(host);
      const cols = [...host.querySelectorAll<HTMLTableColElement>(".base-table colgroup col")];
      expect(cols.map((col) => col.dataset.column)).toEqual(["\u0000file", "stato", "valore"]);
      expect(cols[0]!.style.width).toBe("30%");
      // Il testo non ha larghezza: si divide quello che resta.
      expect(cols[1]!.style.width).toBe("");
      // Il numero è largo quanto la sua intestazione o il piede («Somma 2.000,5»).
      expect(parseInt(cols[2]!.style.width, 10)).toBeGreaterThanOrEqual(88);
      expect(host.querySelector<HTMLTableElement>(".base-table")!.style.minWidth).toBe(`${160 + 90 + parseInt(cols[2]!.style.width, 10)}px`);
    } finally { done(); }
  });

  it("l'intestazione ha la figura della specie dei valori, e i numeri si leggono nel formato della lingua", async () => {
    const { host, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }]);
    try {
      await ready(host);
      expect(host.querySelector<HTMLElement>('th[data-column="valore"] .base-head')!.dataset.shape).toBe("number");
      expect(host.querySelector<HTMLElement>('th[data-column="stato"] .base-head')!.dataset.shape).toBe("text");
      const field = host.querySelector<HTMLInputElement>('tr[data-doc="Opere/Nebbia.md"] .base-cell[data-column="valore"] input')!;
      expect(field.value).toBe("1.200");
      // Col fuoco il campo torna al valore com'è, quello che si scrive.
      field.dispatchEvent(new Event("focus"));
      expect(field.value).toBe("1200");
      field.dispatchEvent(new Event("blur"));
      expect(field.value).toBe("1.200");
    } finally { done(); }
  });

  it("«Nuova nota» in fondo alle righe crea una nota come «Nuova», e non c'è in sola lettura", async () => {
    const { host, surface, invokeCommand, done } = mount([{ name: "Tabella", type: "table", keys: { order: ["stato", "valore"] } }]);
    try {
      await ready(host);
      const add = host.querySelector<HTMLButtonElement>(".base-table tbody .base-add-row-button")!;
      expect(add.textContent).toBe("Nuova nota");
      expect(host.querySelector(".base-table tbody")!.lastElementChild!.classList.contains("base-add-row")).toBe(true);
      add.click();
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("note.create", {}));
      surface.setReadOnly!(true);
      await vi.waitFor(() => expect(host.querySelector(".base-add-row")).toBeNull());
    } finally { done(); }
  });
});
