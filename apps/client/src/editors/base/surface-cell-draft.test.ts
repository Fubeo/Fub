// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import { mountBaseSurface } from "./surface";

// Il testo che si sta scrivendo in una cella, non ancora confermato, non si
// perde in silenzio quando la nota cambia da fuori (IMP-137): il campo tiene
// testo e fuoco, la conferma scrive con la CAS o chiede quale testo tenere, Esc
// torna al valore del disco.

const notified = vi.hoisted(() => [] as { message: string; tone?: string }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string) => { notified.push({ message, tone }); },
}));

interface Note { doc: string; stato: string; voto: string }

// Il core finto: righe e piano della vista, `note.property.set` con la CAS sul
// valore letto, come il core. Un filtro opzionale toglie dalla vista le note
// con uno stato.
function mount(options: { hide?: string } = {}) {
  const notes: Note[] = [
    { doc: "Opere/Nebbia.md", stato: "Arrivata", voto: "alto" },
    { doc: "Opere/Campo.md", stato: "In prestito", voto: "basso" },
  ];
  const visible = () => notes.filter((note) => note.stato !== options.hide);
  const host = document.createElement("div");
  document.body.append(host);
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") return { kind: "documents", value: { offset: 0, total: notes.length, items: notes.map((note) => ({ doc: note.doc, properties: [{ key: "stato", value: { kind: "text", value: note.stato } }, { key: "voto", value: { kind: "text", value: note.voto } }] })) } };
    const query = request.kind === "custom" ? request.query as { op: string; edits?: { doc: string; key: string; expected: unknown; value?: string | null }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: ["Vista"], types: ["table"] } };
    if (query.op === "plan") return { kind: "custom", value: {
      view: "Vista", view_type: "table", columns: ["stato", "voto"], column_labels: {}, required_props: [], all_properties: true,
      group: null, limit: null, map: null, create_defaults: {}, filters: "all", sort: [], order: [],
    } };
    if (query.op === "derive") return { kind: "custom", value: { summaries: {}, rows: visible().map((note) => ({ doc: note.doc, values: { stato: { kind: "text", value: note.stato }, voto: { kind: "text", value: note.voto } } })) } };
    if (query.op === "mutate") return { kind: "custom", value: { mutations: query.edits!.map((edit) => ({
      doc: edit.doc, key: edit.key, command: edit.value == null ? "note.property.remove" : "note.property.set",
      args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), ...(edit.value == null ? {} : { value: edit.value }) },
    })) } };
    throw new Error(`unexpected Base operation ${query.op}`);
  });
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command !== "note.property.set") return {};
    const note = notes.find((each) => each.doc === args.doc)!;
    const key = args.key as "stato" | "voto";
    const expected = JSON.parse(args.expected as string) as { value?: unknown };
    if (JSON.stringify(expected.value) !== JSON.stringify({ kind: "text", value: note[key] })) throw { kind: "conflict", message: "La nota è cambiata: riprova." };
    note[key] = JSON.parse(args.value as string) as string;
    return { undo: { label: "Annulla la proprietà" } };
  });
  const surface = mountBaseSurface("base", { paneId: "base-cella", documentId: "Opere.base", parent: host }, {
    queryIndex, invokeCommand, viewState: async () => null, setViewState: async () => {},
    onOpenDocument: () => {}, revision: () => "r1",
  });
  surface.buffer.setDoc("views:\n  - {name: Vista, type: table}\n");
  let closed = false;
  const close = () => { if (closed) return; closed = true; surface.destroy(); host.remove(); };
  return { host, notes, invokeCommand, queryIndex, close };
}

const derives = (queryIndex: ReturnType<typeof mount>["queryIndex"]) => queryIndex.mock.calls.filter(([request]) => request.kind === "custom" && (request.query as { op: string }).op === "derive").length;
const cell = (host: HTMLElement, doc: string, column = 1) => host.querySelector<HTMLInputElement>(`tr[data-doc="${doc}"] td[data-cell="${column}"] input`)!;
const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const type = (field: HTMLInputElement, text: string) => {
  field.focus();
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
// La nota cambia da fuori: il file riscritto, l'evento del vault.
const changedOutside = (doc: string) => forwardNotice({ event: { type: "document_changed", id: doc, changes: { aspects: ["frontmatter"], properties: ["stato"], tags_added: [], tags_removed: [] } }, origin: { actor: { kind: "kernel" }, batch: null } });
// Invio chiude la modifica: il fuoco passa alla griglia, e la scrittura parte
// col `blur` (o col `change`, se il browser vede il testo cambiato).
const confirm = (field: HTMLInputElement) => { press(field, "Enter"); field.blur(); };

async function opened(options?: { hide?: string }) {
  const mounted = mount(options);
  await vi.waitFor(() => expect(mounted.host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
  return mounted;
}

describe("la cella in modifica e la nota cambiata da fuori (IMP-137)", () => {
  it("la cella in modifica tiene testo e fuoco quando la sua nota cambia da fuori", async () => {
    const { host, notes, queryIndex, close } = await opened();
    try {
      const typed = cell(host, "Opere/Nebbia.md");
      type(typed, "Testo digitato");
      const before = derives(queryIndex);
      notes[0]!.stato = "Scaduta";
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      // Il ridisegno toglie il campo di prima: quello nuovo lo sostituisce.
      await vi.waitFor(() => expect(cell(host, "Opere/Nebbia.md")).not.toBe(typed));
      const field = cell(host, "Opere/Nebbia.md");
      expect(field.value).toBe("Testo digitato");
      expect(document.activeElement).toBe(field);
      expect(host.querySelector(".conflict-banner")).toBeNull();
    } finally { close(); }
  });

  it("Invio dopo il cambio non scrive in silenzio: chiede quale testo tenere, e «Mantieni» scrive con la CAS", async () => {
    const { host, notes, invokeCommand, queryIndex, close } = await opened();
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      const before = derives(queryIndex);
      notes[0]!.stato = "Scaduta";
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(cell(host, "Opere/Nebbia.md").value).toBe("Testo digitato"));
      confirm(cell(host, "Opere/Nebbia.md"));
      const banner = await vi.waitFor(() => { const found = host.querySelector<HTMLElement>(".conflict-banner"); expect(found).not.toBeNull(); return found!; });
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.textContent).toContain("«Nebbia» è cambiata mentre scrivevi in «stato»");
      // Niente sopra la nota cambiata, e il testo resta nella cella, segnato.
      expect(notes[0]!.stato).toBe("Scaduta");
      expect(invokeCommand).not.toHaveBeenCalledWith("note.property.set", expect.anything());
      expect(cell(host, "Opere/Nebbia.md").value).toBe("Testo digitato");
      expect(cell(host, "Opere/Nebbia.md").getAttribute("aria-invalid")).toBe("true");
      banner.querySelector<HTMLButtonElement>('[data-choice="mine"]')!.click();
      await vi.waitFor(() => expect(notes[0]!.stato).toBe("Testo digitato"));
      await vi.waitFor(() => expect(host.querySelector(".conflict-banner")).toBeNull());
      expect(cell(host, "Opere/Nebbia.md").hasAttribute("aria-invalid")).toBe(false);
    } finally { close(); }
  });

  it("un conflitto che solo la CAS vede (la riga non ancora riletta) si dice, e «Usa la versione su disco» lo chiude", async () => {
    const { host, notes, invokeCommand, close } = await opened();
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      // Il file cambia, l'evento non è ancora arrivato.
      notes[0]!.stato = "Scaduta";
      confirm(cell(host, "Opere/Nebbia.md"));
      await vi.waitFor(() => expect(host.querySelector(".conflict-banner")).not.toBeNull());
      expect(invokeCommand).toHaveBeenCalledWith("note.property.set", expect.objectContaining({ doc: "Opere/Nebbia.md", key: "stato" }));
      expect(notes[0]!.stato).toBe("Scaduta");
      host.querySelector<HTMLButtonElement>('.conflict-banner [data-choice="theirs"]')!.click();
      await vi.waitFor(() => expect(host.querySelector(".conflict-banner")).toBeNull());
      await vi.waitFor(() => expect(cell(host, "Opere/Nebbia.md").value).toBe("Scaduta"));
      expect(notes[0]!.stato).toBe("Scaduta");
    } finally { close(); }
  });

  it("Esc lascia il testo scritto e mostra il valore del disco", async () => {
    const { host, notes, invokeCommand, queryIndex, close } = await opened();
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      const before = derives(queryIndex);
      notes[0]!.stato = "Scaduta";
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(cell(host, "Opere/Nebbia.md").value).toBe("Testo digitato"));
      const field = cell(host, "Opere/Nebbia.md");
      press(field, "Escape");
      expect(field.value).toBe("Scaduta");
      field.blur();
      // Né una scrittura né una scelta dopo Esc, e il ridisegno non lo riporta.
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before + 1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(cell(host, "Opere/Nebbia.md").value).toBe("Scaduta");
      expect(host.querySelector(".conflict-banner")).toBeNull();
      expect(invokeCommand).not.toHaveBeenCalledWith("note.property.set", expect.anything());
    } finally { close(); }
  });

  it("un evento su un'altra nota non tocca la cella in modifica, e Invio la scrive", async () => {
    const { host, notes, queryIndex, close } = await opened();
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      const before = derives(queryIndex);
      notes[1]!.stato = "Rientrata";
      changedOutside("Opere/Campo.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(cell(host, "Opere/Campo.md").value).toBe("Rientrata"));
      const field = cell(host, "Opere/Nebbia.md");
      expect(field.value).toBe("Testo digitato");
      expect(document.activeElement).toBe(field);
      confirm(field);
      await vi.waitFor(() => expect(notes[0]!.stato).toBe("Testo digitato"));
      expect(host.querySelector(".conflict-banner")).toBeNull();
    } finally { close(); }
  });

  it("un cambio da fuori su un'altra proprietà della stessa nota non è un conflitto", async () => {
    const { host, notes, queryIndex, close } = await opened();
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      const before = derives(queryIndex);
      notes[0]!.voto = "medio";
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(cell(host, "Opere/Nebbia.md", 2).value).toBe("medio"));
      confirm(cell(host, "Opere/Nebbia.md"));
      await vi.waitFor(() => expect(notes[0]!.stato).toBe("Testo digitato"));
      expect(notes[0]!.voto).toBe("medio");
    } finally { close(); }
  });

  it("la nota uscita dalla vista per il cambio non perde il testo: l'avviso lo riporta", async () => {
    const { host, notes, invokeCommand, queryIndex, close } = await opened({ hide: "Scaduta" });
    try {
      type(cell(host, "Opere/Nebbia.md"), "Testo digitato");
      const before = derives(queryIndex);
      notes[0]!.stato = "Scaduta";
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(1));
      // Il campo se n'è andato con la riga: chiudere la Base non scrive sopra
      // la nota cambiata e dice il testo.
      notified.length = 0;
      close();
      await vi.waitFor(() => expect(notified.filter((each) => each.tone === "guasto")).toHaveLength(1));
      expect(notified[0]!.message).toContain("«Testo digitato»");
      expect(notes[0]!.stato).toBe("Scaduta");
      expect(invokeCommand).toHaveBeenCalledWith("note.property.set", expect.anything());
    } finally { close(); }
  });

  it("la nota uscita dalla vista: Invio dà la scelta con il testo da copiare", async () => {
    const { host, notes, invokeCommand, queryIndex, close } = await opened({ hide: "Scaduta" });
    try {
      const field = cell(host, "Opere/Nebbia.md");
      type(field, "Testo digitato");
      notes[0]!.stato = "Scaduta";
      // La conferma parte prima che l'evento arrivi: la CAS rifiuta, e la riga
      // riletta non c'è più.
      confirm(field);
      await vi.waitFor(() => expect(host.querySelector(".conflict-banner")).not.toBeNull());
      const before = derives(queryIndex);
      changedOutside("Opere/Nebbia.md");
      await vi.waitFor(() => expect(derives(queryIndex)).toBeGreaterThan(before));
      await vi.waitFor(() => expect(host.querySelector(".conflict-banner")?.textContent).toContain("non è più in questa vista"));
      expect(host.querySelector(".conflict-banner")?.textContent).toContain("«Testo digitato»");
      expect(host.querySelector('.conflict-banner [data-choice="mine"]')?.textContent).toBe("Copia il mio testo");
      expect(notes[0]!.stato).toBe("Scaduta");
      void invokeCommand;
    } finally { close(); }
  });
});
