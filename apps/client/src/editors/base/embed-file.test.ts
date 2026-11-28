// @vitest-environment happy-dom
//
// Una Base incorporata in una nota: da un file `.base` (`![[Opere.base]]`) ha
// gli stessi gesti di un `.base` aperto e li scrive nel file; da un blocco
// ```` ```base ```` scritto nella nota resta da leggere (DECISIONS T15). Il
// kernel manda il testo in tutti e due i casi; il file lo dice `base`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import { NO_RENDER_CONTEXT } from "../../ui/custom";
import { closeContextMenu } from "../../ui/menu";
import { mountBaseEmbed } from "./surface";

const notified = vi.hoisted(() => [] as { message: string; tone?: string }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string) => { notified.push({ message, tone }); },
}));

interface View { name: string; type: string; keys: Record<string, unknown> }

// Il disco e il core finti: i file del vault con la loro revisione, i comandi
// della Base che riscrivono il `.base` con la CAS sulla revisione, come
// `fub-features`, e l'evento `document_changed` dopo ogni scrittura.
const vault = vi.hoisted(() => ({
  files: new Map<string, string>(),
  revisions: new Map<string, number>(),
  views: [] as { name: string; type: string; keys: Record<string, unknown> }[],
  deny: null as { kind: string; message: string } | null,
  commands: [] as [string, Record<string, unknown>][],
}));
const BASE = "Opere.base";
const NOTE = "Nota.md";
const NOTE_TEXT = "# Opere in prestito\n\n![[Opere.base]]\n\nDopo la Base.\n";
const NOTES = [
  { doc: "Opere/Nebbia.md", properties: [{ key: "stato", value: "Arrivata" }] },
  { doc: "Opere/Campo.md", properties: [{ key: "stato", value: "In prestito" }] },
];

const text = (): string => ["views:", ...vault.views.flatMap((view) => [`  - name: ${view.name}`, `    type: ${view.type}`, ...Object.entries(view.keys).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)]), ""].join("\n");
const revisionOf = (doc: string): string => `r${vault.revisions.get(doc) ?? 0}`;
const writeFile = (doc: string, body: string): void => {
  vault.files.set(doc, body);
  vault.revisions.set(doc, (vault.revisions.get(doc) ?? 0) + 1);
  setTimeout(() => forwardNotice({ event: { type: "document_changed", id: doc }, origin: { actor: { kind: "user" }, batch: null } }), 0);
};

const viewOf = (name: unknown): View => vault.views.find((view) => view.name === name) ?? vault.views[0]!;
async function queryIndex(request: IndexQuery): Promise<IndexResult> {
  if (request.kind === "documents") return { kind: "documents", value: { offset: 0, total: NOTES.length, items: NOTES } } as IndexResult;
  const query = request.kind === "custom" ? request.query as { op: string; view?: string | null } : null;
  if (!query) throw new Error("unexpected query");
  if (query.op === "parse") return { kind: "custom", value: { views: vault.views.map((view) => view.name), types: vault.views.map((view) => view.type) } } as IndexResult;
  if (query.op === "plan") {
    const view = viewOf(query.view);
    return { kind: "custom", value: {
      view: view.name, view_type: view.type, columns: ["stato"], column_labels: {}, required_props: [], all_properties: true,
      group: (view.keys.group as { key: string } | undefined)?.key ?? null, limit: null, map: null, create_defaults: {},
      filters: view.keys.filters ?? "all", sort: view.keys.sort ?? [], order: view.keys.order ?? [], summaries: [],
    } } as IndexResult;
  }
  if (query.op === "derive") {
    return { kind: "custom", value: { summaries: {}, rows: NOTES.map(({ doc, properties }) => ({
      doc, values: Object.fromEntries(properties.map(({ key, value }) => [key, { kind: "text", value }])),
    })) } } as IndexResult;
  }
  throw new Error(`unexpected Base operation ${query.op}`);
}
async function invokeCommand(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  vault.commands.push([command, args]);
  if (!command.startsWith("base.view.")) return {};
  if (vault.deny) throw vault.deny;
  const doc = args.doc as string;
  if (!vault.files.has(doc)) throw { kind: "not_found", message: `«${doc}» non c'è più` };
  if (typeof args.base === "string" && args.base !== revisionOf(doc)) throw { kind: "conflict", message: "cambiato sotto" };
  if (command === "base.view.add") vault.views.push({ name: args.name as string, type: args.type as string, keys: {} });
  else if (command === "base.view.set") {
    const view = viewOf(args.view);
    if (args.value === undefined) delete view.keys[args.key as string];
    else view.keys[args.key as string] = JSON.parse(args.value as string);
  } else if (command === "base.view.remove") vault.views.splice(vault.views.findIndex((view) => view.name === args.view), 1);
  writeFile(doc, text());
  return { notify: "Scritto", effect: { kind: "custom", ns: "fub.base", payload: { revision: revisionOf(doc) } }, undo: null };
}

vi.mock("../../host/ipc", () => ({
  api: {
    queryIndex: (request: IndexQuery) => queryIndex(request),
    invokeCommand: (command: string, args: Record<string, unknown>) => invokeCommand(command, args),
    readDocument: async (id: string) => {
      const body = vault.files.get(id);
      if (body === undefined) throw { kind: "not_found", message: `«${id}» non c'è più` };
      return { text: body, revision: revisionOf(id), format_id: null, source_kind: "text", text_kind: "plain" };
    },
    viewState: async () => null,
    setViewState: async () => {},
    mapTile: async () => { throw new Error("niente tessere nella prova"); },
  },
}));
vi.mock("../../host/query", () => ({ settings: async () => [] }));

function reset(): void {
  vault.files.clear();
  vault.revisions.clear();
  vault.views = [{ name: "Tabella", type: "table", keys: {} }];
  vault.deny = null;
  vault.commands = [];
  vault.files.set(NOTE, NOTE_TEXT);
  vault.revisions.set(NOTE, 1);
  writeFile(BASE, text());
}

// Monta la Base come la monta la resa `fub:base` dentro la nota.
function embed(payload: Record<string, unknown>, container: string | null) {
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = mountBaseEmbed(host, payload, container === null ? NO_RENDER_CONTEXT : { container }, undefined, () => {});
  return { host, done: () => { unmount?.(); host.remove(); } };
}
// Il payload che il kernel manda per `![[Opere.base]]`: il testo del file e,
// accanto, il suo path.
const fromFile = () => ({ source: text(), base: BASE, view: "Tabella", container: BASE });
// Quello di un blocco ```base``` scritto nella nota: il testo, niente file.
const fromBlock = () => ({ source: text(), view: "Tabella", container: NOTE });

const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
const settled = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-bar")!.getAttribute("aria-busy")).toBe("false"));
const pick = (label: string): void => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((each) => each.querySelector(".menu-label")?.textContent === label);
  if (!button) throw new Error(`nessuna voce «${label}»`);
  button.click();
};

afterEach(() => { closeContextMenu(); notified.length = 0; });

describe("una Base incorporata: file o blocco", () => {
  it("da un file `.base` ha «+» acceso e la barra non dice «blocco dentro la nota»", async () => {
    reset();
    const { host, done } = embed(fromFile(), BASE);
    try {
      await ready(host);
      await settled(host);
      expect(host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.disabled).toBe(false);
      expect(host.querySelector<HTMLElement>(".base-note")!.hidden).toBe(true);
      // Nessun «Apri come file»: è già il file.
      expect([...host.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Apri come file" && !button.hidden)).toEqual([]);
    } finally { done(); }
  });

  it("da un blocco ```base``` della nota resta da leggere, e la barra dice perché", async () => {
    reset();
    const { host, done } = embed(fromBlock(), NOTE);
    try {
      await ready(host);
      await settled(host);
      expect(host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.disabled).toBe(true);
      const note = host.querySelector<HTMLElement>(".base-note")!;
      expect(note.hidden).toBe(false);
      expect(note.textContent).toContain("blocco dentro la nota");
    } finally { done(); }
  });
});

describe("una Base incorporata da file scrive nel file", () => {
  it("una vista nuova finisce nel `.base` con la revisione letta, e la nota resta identica byte per byte", async () => {
    reset();
    const { host, done } = embed(fromFile(), BASE);
    try {
      await ready(host);
      await settled(host);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      pick("Elenco");
      await vi.waitFor(() => expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Elenco"));
      await settled(host);
      expect(vault.commands[0]).toEqual(["base.view.add", { doc: BASE, name: "Elenco", type: "list", base: "r1" }]);
      // Ogni comando ha scritto il `.base`, nessuno la nota.
      expect(vault.commands.every(([, args]) => args.doc === BASE)).toBe(true);
      expect(vault.files.get(BASE)).toContain("name: Elenco");
      expect(vault.files.get(NOTE)).toBe(NOTE_TEXT);
      expect(vault.revisions.get(NOTE)).toBe(1);
    } finally { done(); }
  });

  it("una scrittura negata lascia il file com'era e lo dice", async () => {
    reset();
    const before = vault.files.get(BASE);
    const { host, done } = embed(fromFile(), BASE);
    try {
      await ready(host);
      await settled(host);
      vault.deny = { kind: "permission_denied", message: "Il vault è in sola lettura." };
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      pick("Elenco");
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toBe("Niente è stato scritto nel file .base: Il vault è in sola lettura."));
      await settled(host);
      expect(vault.files.get(BASE)).toBe(before);
      expect(vault.files.get(NOTE)).toBe(NOTE_TEXT);
      expect(host.querySelector('.base-tab[aria-pressed="true"]')?.getAttribute("data-view")).toBe("Tabella");
    } finally { done(); }
  });

  it("un file sparito dopo la lettura: il gesto non scrive niente, né il file né la nota, e lo dice", async () => {
    reset();
    const { host, done } = embed(fromFile(), BASE);
    try {
      await ready(host);
      await settled(host);
      vault.files.delete(BASE);
      host.querySelector<HTMLButtonElement>(".base-tool-new-view")!.click();
      pick("Elenco");
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toBe("Niente è stato scritto nel file .base: «Opere.base» non c'è più"));
      expect(vault.files.has(BASE)).toBe(false);
      expect(vault.files.get(NOTE)).toBe(NOTE_TEXT);
    } finally { done(); }
  });

  it("un file che non c'è già all'apertura: la Base dice perché al posto della tabella", async () => {
    reset();
    vault.files.delete(BASE);
    const { host, done } = embed(fromFile(), BASE);
    try {
      await vi.waitFor(() => expect(host.textContent).toBe("«Opere.base» non c'è più"));
      expect(host.querySelector(".base-surface")).toBeNull();
      expect(vault.commands).toEqual([]);
    } finally { done(); }
  });
});
