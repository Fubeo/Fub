// @vitest-environment happy-dom
//
// La Bacheca per Stato (T9): su una proprietà che il registro dei tipi dice
// Selezione o Stato, le corsie sono le opzioni (lo Stato nei tre gruppi, poi
// nell'ordine delle opzioni), anche vuote; i valori fuori dalle opzioni
// restano corsie di testo, segnate. Spostare una scheda, col mouse o da
// tastiera, passa da `mutate` e `note.property.set` con il valore letto come
// confronto; la prova rilegge il valore dal file.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { choiceLanes } from "./data";
import { mountBaseSurface } from "./surface";
import { parsePropertyTypes } from "../text/profiles/markdown/page/properties/kind";

vi.mock("../../ui/notify", () => ({ notify: () => {} }));
vi.mock("../../i18n/strings", async (real) => ({ ...await real<typeof import("../../i18n/strings")>(), resolvedLanguage: () => "it" }));

const REGISTRY = {
  version: 1,
  types: { stato: "status", sala: "select", fase: "status", anno: "number" },
  options: {
    // Nel registro l'ordine è sparso: le corsie lo rimettono nei gruppi.
    stato: [
      { name: "Fatto", color: "green", group: "done" },
      { name: "Da fare", color: "gray", group: "todo" },
      { name: "In corso", color: "blue", group: "doing" },
      { name: "In attesa", color: "orange", group: "doing" },
    ],
    sala: [{ name: "Grande", color: "purple" }, { name: "Piccola", color: "magenta" }, { name: "Grande", color: "red" }],
    fase: [{ name: "Bozza", color: "yellow", group: "todo" }, { name: "Chiusa", color: "green", group: "done" }],
  },
};

describe("le corsie di Selezione e Stato", () => {
  const types = parsePropertyTypes(JSON.stringify(REGISTRY));
  it("lo Stato: i tre gruppi, poi l'ordine delle opzioni, poi i valori fuori dalle opzioni", () => {
    const lanes = choiceLanes(types, "stato", ["In corso", "Rivista", "Fatto", ""]);
    expect(lanes?.kind).toBe("status");
    expect(lanes?.lanes.map((lane) => [lane.name, lane.option?.group ?? null])).toEqual([
      ["Da fare", "todo"], ["In corso", "doing"], ["In attesa", "doing"], ["Fatto", "done"], ["Rivista", null], ["", null],
    ]);
  });
  it("la Selezione: l'ordine delle opzioni, un nome doppio una volta, un colore che non si conosce grigio", () => {
    const lanes = choiceLanes(types, "sala", []);
    expect(lanes?.lanes.map((lane) => [lane.name, lane.option?.color])).toEqual([["Grande", "purple"], ["Piccola", "gray"]]);
  });
  it("un altro tipo, o un registro che non si legge: nessuna corsia dalle opzioni", () => {
    expect(choiceLanes(types, "anno", ["2026"])).toBeNull();
    expect(choiceLanes(types, "nessuna", [])).toBeNull();
    expect(choiceLanes(parsePropertyTypes(JSON.stringify({ version: 9, types: { stato: "status" } })), "stato", [])).toBeNull();
  });
});

// ---- La superficie con un core finto ----------------------------------------

const frontmatter = (text: string): Record<string, string> => Object.fromEntries(
  (text.split("---")[1] ?? "").split("\n").filter((line) => line.includes(":")).map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim().replace(/^"(.*)"$/, "$1")]),
);

interface Options { group?: string; registry?: unknown; readOnly?: boolean }
const mount = (notes: Record<string, string>, { group = "stato", registry = REGISTRY }: Options = {}) => {
  const files = new Map<string, string>(Object.entries(notes));
  let registryNow: unknown = registry;
  const host = document.createElement("div");
  document.body.append(host);
  const docs = () => [...files].map(([doc, text]) => ({ doc, properties: Object.entries(frontmatter(text)).map(([key, value]) => ({ key, value: { kind: "text", value } })) }));
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") { const items = docs(); return { kind: "documents", value: { offset: 0, total: items.length, items } }; }
    const query = request.kind === "custom" ? request.query as { op: string; edits?: { doc: string; key: string; expected: unknown; value: string }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: ["Bacheca"], types: ["kanban"] } };
    if (query.op === "plan") return { kind: "custom", value: {
      view: "Bacheca", view_type: "kanban", columns: [group], column_labels: {}, required_props: [], all_properties: true,
      group, limit: null, map: null, create_defaults: {}, filters: "all", sort: [], order: [],
    } };
    if (query.op === "derive") return { kind: "custom", value: { summaries: {}, rows: docs().map(({ doc, properties }) => ({
      doc, values: Object.fromEntries(properties.map(({ key, value }) => [key, value])),
    })) } };
    if (query.op === "mutate") return { kind: "custom", value: { mutations: query.edits!.map((edit) => ({
      doc: edit.doc, key: edit.key, command: "note.property.set",
      args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), value: edit.value },
    })) } };
    throw new Error(`unexpected Base operation ${query.op}`);
  });
  let failNext: { kind: string; message: string } | null = null;
  // `note.property.set` come il core: confronta il valore letto con quello del
  // file e riscrive solo la riga della proprietà; un errore lascia il file.
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "property.option.set") {
      if (failNext) { const failure = failNext; failNext = null; throw failure; }
      const next = structuredClone(registryNow) as typeof REGISTRY;
      (next.options as Record<string, unknown[]>)[args.key as string]!.push({ name: args.option, color: args.color, ...(args.group ? { group: args.group } : {}) });
      registryNow = next;
      return { notify: "Opzione aggiunta" };
    }
    if (command !== "note.property.set") return {};
    if (failNext) { const failure = failNext; failNext = null; throw failure; }
    const doc = args.doc as string;
    const text = files.get(doc)!;
    const key = args.key as string;
    const current = frontmatter(text)[key];
    const expected = JSON.parse(args.expected as string) as { kind: string; value?: { value?: unknown } };
    if (expected.value?.value !== current) throw { kind: "conflict", message: "La nota è cambiata: riprova." };
    files.set(doc, text.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${args.value as string}`));
    return { notify: "Proprietà scritta" };
  });
  const surface = mountBaseSurface("base", { paneId: "base-bacheca-stato", documentId: "Opere.base", parent: host }, {
    queryIndex, invokeCommand,
    viewState: async () => null as never, setViewState: async () => {},
    onOpenDocument: () => {}, revision: () => "r1",
    // Il registro com'è nelle impostazioni: un testo JSON.
    propertyTypes: async () => registryNow === null ? undefined : JSON.stringify(registryNow),
  });
  surface.buffer.setDoc("views:\n  - name: Bacheca\n    type: kanban\n");
  return {
    host, files, invokeCommand,
    fail: (failure: { kind: string; message: string }) => { failNext = failure; },
    done: () => { surface.destroy(); host.remove(); },
  };
};

const NOTES = {
  "Nebbia.md": "---\nstato: In corso\nfase: Bozza\n---\n# Nebbia\n\nTesto che resta.\n",
  "Campo.md": "---\nstato: Fatto\nfase: Chiusa\n---\n",
  "Vecchia.md": "---\nstato: Rivista\n---\n",
};
const lanes = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".base-kanban-column")];
const heading = (lane: HTMLElement) => lane.querySelector("h3")!.textContent;
const cardsOf = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>(`.base-kanban-column[data-group="${name}"] .base-kanban-card`)].map((card) => card.dataset.doc);
const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-kanban-column[data-option]")).not.toBeNull());
const drag = (from: HTMLElement, to: HTMLElement) => {
  const data = new Map<string, string>();
  const transfer = { setData: (type: string, value: string) => { data.set(type, value); }, getData: (type: string) => data.get(type) ?? "" };
  for (const [target, type] of [[from, "dragstart"], [to, "dragover"], [to, "drop"]] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);
  }
};

afterEach(() => { document.body.replaceChildren(); });

describe("la Bacheca su uno Stato", () => {
  it("le corsie sono le opzioni nei tre gruppi, anche vuote, con la pastiglia e il conto; un valore fuori resta testo, segnato", async () => {
    const { host, done } = mount(NOTES);
    try {
      await ready(host);
      expect(lanes(host).map((lane) => [lane.dataset.group, lane.dataset.statusGroup ?? null, heading(lane)])).toEqual([
        ["Da fare", "todo", "Da fare 0"], ["In corso", "doing", "In corso 1"], ["In attesa", "doing", "In attesa 0"],
        ["Fatto", "done", "Fatto 1"], ["Rivista", null, "Rivista (1)"],
      ]);
      const pill = lanes(host)[1]!.querySelector<HTMLElement>("h3 .cm-fub-prop-opt")!;
      expect([pill.dataset.color, pill.dataset.status]).toEqual(["blue", ""]);
      expect(lanes(host)[4]!.dataset.outside).toBe("");
      // Un'opzione si rinomina nel registro: la sua corsia non ha «Rinomina».
      expect([...lanes(host)[1]!.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Rinomina la colonna");
      expect([...lanes(host)[4]!.querySelectorAll("button")].map((button) => button.textContent)).toContain("Rinomina la colonna");
    } finally { done(); }
  });

  it("trascinare una scheda in un'altra corsia scrive lo stato nella nota con il valore letto, e il resto della nota resta", async () => {
    const { host, files, invokeCommand, done } = mount(NOTES);
    try {
      await ready(host);
      const card = host.querySelector<HTMLElement>('.base-kanban-card[data-doc="Nebbia.md"]')!;
      expect(card.draggable).toBe(true);
      drag(card, host.querySelector<HTMLElement>('.base-kanban-column[data-group="In attesa"]')!);
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("note.property.set", {
        doc: "Nebbia.md", key: "stato", value: JSON.stringify("In attesa"),
        expected: JSON.stringify({ kind: "value", value: { kind: "text", value: "In corso" } }),
      }));
      expect(files.get("Nebbia.md")).toBe('---\nstato: "In attesa"\nfase: Bozza\n---\n# Nebbia\n\nTesto che resta.\n');
      await vi.waitFor(() => expect(cardsOf(host, "In attesa")).toEqual(["Nebbia.md"]));
      expect(cardsOf(host, "In corso")).toEqual([]);
    } finally { done(); }
  });

  it("da tastiera: Alt → e Alt ← spostano la scheda nella corsia accanto", async () => {
    const { host, files, done } = mount(NOTES);
    try {
      await ready(host);
      const opener = () => host.querySelector<HTMLButtonElement>('.base-kanban-card[data-doc="Campo.md"] button')!;
      expect(opener().getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowLeft Alt+ArrowRight");
      opener().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(cardsOf(host, "In attesa")).toEqual(["Campo.md"]));
      expect(files.get("Campo.md")).toBe('---\nstato: "In attesa"\nfase: Chiusa\n---\n');
      // Senza Alt la freccia non sposta niente.
      opener().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(files.get("Campo.md")).toBe('---\nstato: "In attesa"\nfase: Chiusa\n---\n');
    } finally { done(); }
  });

  it("una scrittura che non riesce lascia la nota e la scheda dov'erano, e la barra lo dice", async () => {
    const { host, files, fail, done } = mount(NOTES);
    try {
      await ready(host);
      fail({ kind: "conflict", message: "La nota è cambiata: riprova." });
      drag(host.querySelector<HTMLElement>('.base-kanban-card[data-doc="Nebbia.md"]')!, host.querySelector<HTMLElement>('.base-kanban-column[data-group="Fatto"]')!);
      await vi.waitFor(() => expect(host.textContent).toContain("La nota è cambiata: riprova."));
      expect(files.get("Nebbia.md")).toBe(NOTES["Nebbia.md"]);
      expect(cardsOf(host, "In corso")).toEqual(["Nebbia.md"]);
    } finally { done(); }
  });

  it("due Stato nella stessa Base: la Bacheca prende le corsie della proprietà per cui raggruppa", async () => {
    const { host, files, done } = mount(NOTES, { group: "fase" });
    try {
      await ready(host);
      expect(lanes(host).map((lane) => lane.dataset.group)).toEqual(["Bozza", "Chiusa", ""]);
      drag(host.querySelector<HTMLElement>('.base-kanban-card[data-doc="Nebbia.md"]')!, host.querySelector<HTMLElement>('.base-kanban-column[data-group="Chiusa"]')!);
      await vi.waitFor(() => expect(cardsOf(host, "Chiusa")).toEqual(["Nebbia.md", "Campo.md"]));
      // Lo stato dell'altra proprietà non cambia.
      expect(files.get("Nebbia.md")).toContain("stato: In corso\nfase: \"Chiusa\"\n");
    } finally { done(); }
  });

  it("una corsia nuova è un'opzione nuova del registro, in Da fare con un colore libero; un registro che non si scrive lo dice", async () => {
    const { host, invokeCommand, fail, done } = mount(NOTES);
    try {
      await ready(host);
      const add = host.querySelector<HTMLInputElement>(".base-kanban > input")!;
      fail({ kind: "bad_args", message: "Il registro dei tipi non si legge: le opzioni non si creano." });
      add.value = "Rimandata";
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.waitFor(() => expect(host.textContent).toContain("Il registro dei tipi non si legge"));
      expect(lanes(host).map((lane) => lane.dataset.group)).not.toContain("Rimandata");
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.waitFor(() => expect(lanes(host).map((lane) => lane.dataset.group)).toEqual(["Da fare", "Rimandata", "In corso", "In attesa", "Fatto", "Rivista"]));
      expect(invokeCommand).toHaveBeenLastCalledWith("property.option.set", { key: "stato", option: "Rimandata", color: "purple", group: "todo" });
    } finally { done(); }
  });

  it("senza registro (o con un tipo che non è Selezione né Stato) le corsie restano i valori", async () => {
    const { host, done } = mount(NOTES, { registry: null });
    try {
      await vi.waitFor(() => expect(lanes(host).length).toBe(3));
      expect(lanes(host).map((lane) => [lane.dataset.group, lane.dataset.option ?? null, lane.dataset.outside ?? null])).toEqual([
        ["In corso", null, null], ["Fatto", null, null], ["Rivista", null, null],
      ]);
    } finally { done(); }
  });
});
