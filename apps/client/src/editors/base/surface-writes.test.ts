// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import { mountBaseSurface } from "./surface";
import { addDays, localDay } from "./calendar";

// Una scrittura che l'utente ha chiesto va fino in fondo, oppure l'utente sa
// che non è passata (#484): un evento del vault, una vista ridisegnata o la
// Base chiusa non la fermano in silenzio.

const notified = vi.hoisted(() => [] as { message: string; tone?: string }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string) => { notified.push({ message, tone }); },
}));

type Kind = "table" | "kanban" | "calendar" | "timeline";
interface Note { doc: string; stato: string; inizio: string; fine: string }

// Una data del core: `{ year, month, day, time }`, senza ora.
const dateValue = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return { kind: "date", value: { year, month, day: date, time: null } };
};

// Il core finto: `plan` e `derive` per la vista chiesta, `mutate` che si può
// tenere ferma finché la prova non la lascia rispondere, e `note.property.set`
// con la CAS sul valore letto, come il core.
function mount(kind: Kind) {
  const today = localDay();
  const notes: Note[] = [
    { doc: "Opere/Nebbia.md", stato: "Arrivata", inizio: today, fine: addDays(today, 2) },
    { doc: "Opere/Campo.md", stato: "In prestito", inizio: addDays(today, 3), fine: addDays(today, 4) },
  ];
  const props = (note: Note) => [
    { key: "stato", value: { kind: "text", value: note.stato } },
    { key: "inizio", value: dateValue(note.inizio) },
    { key: "fine", value: dateValue(note.fine) },
  ];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = () => resolve(); });
  let announce: () => void = () => {};
  const mutating = new Promise<void>((resolve) => { announce = () => resolve(); });
  const host = document.createElement("div");
  document.body.append(host);
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") return { kind: "documents", value: { offset: 0, total: notes.length, items: notes.map((note) => ({ doc: note.doc, properties: props(note) })) } };
    const query = request.kind === "custom" ? request.query as { op: string; edits?: { doc: string; key: string; expected: unknown; value?: string | null }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: ["Vista"], types: [kind] } };
    if (query.op === "plan") return { kind: "custom", value: {
      view: "Vista", view_type: kind, columns: ["stato"], column_labels: {}, required_props: [], all_properties: true,
      group: kind === "kanban" ? "stato" : null, limit: null, map: null, create_defaults: {}, filters: "all", sort: [], order: [],
      ...(kind === "calendar" ? { date_key: "inizio" } : {}),
      ...(kind === "timeline" ? { start_key: "inizio", end_key: "fine" } : {}),
    } };
    if (query.op === "derive") return { kind: "custom", value: { summaries: {}, rows: notes.map((note) => ({
      doc: note.doc, values: { stato: { kind: "text", value: note.stato } },
      ...(kind === "calendar" ? { time: { day: note.inizio } } : {}),
      ...(kind === "timeline" ? { time: { start: note.inizio, end: note.fine, inverted: false } } : {}),
    })) } };
    if (query.op === "mutate") {
      announce();
      await held;
      return { kind: "custom", value: { mutations: query.edits!.map((edit) => ({
        doc: edit.doc, key: edit.key, command: edit.value == null ? "note.property.remove" : "note.property.set",
        args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), ...(edit.value == null ? {} : { value: edit.value }) },
      })) } };
    }
    throw new Error(`unexpected Base operation ${query.op}`);
  });
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command !== "note.property.set") return {};
    const note = notes.find((each) => each.doc === args.doc)!;
    const key = args.key as "stato" | "inizio" | "fine";
    const expected = JSON.parse(args.expected as string) as { value?: unknown };
    const current = key === "stato" ? { kind: "text", value: note.stato } : dateValue(note[key]);
    if (JSON.stringify(expected.value) !== JSON.stringify(current)) throw { kind: "conflict", message: "La nota è cambiata: riprova." };
    note[key] = JSON.parse(args.value as string) as string;
    return { undo: { label: "Annulla la proprietà" } };
  });
  const surface = mountBaseSurface("base", { paneId: "base-scritture", documentId: "Opere.base", parent: host }, {
    queryIndex, invokeCommand, viewState: async () => null, setViewState: async () => {},
    onOpenDocument: () => {}, revision: () => "r1",
  });
  surface.buffer.setDoc(`views:\n  - {name: Vista, type: ${kind}}\n`);
  let closed = false;
  const close = () => { if (closed) return; closed = true; surface.destroy(); host.remove(); };
  return { host, notes, today, surface, invokeCommand, release, mutating, close };
}

const press = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const failures = () => notified.filter((each) => each.tone === "guasto");

describe("una scrittura chiesta nella Base va fino in fondo o si dice (#484)", () => {
  it("la cella si scrive anche se un evento del vault arriva mentre la scrittura si prepara", async () => {
    notified.length = 0;
    const { host, notes, release, mutating, close } = mount("table");
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
      const stato = host.querySelector<HTMLInputElement>('tr[data-doc="Opere/Nebbia.md"] td[data-cell="1"] input')!;
      stato.focus();
      stato.value = "Confermata";
      stato.dispatchEvent(new Event("input", { bubbles: true }));
      stato.dispatchEvent(new Event("change"));
      await mutating;
      // Un'altra nota salvata e l'indice aggiornato, fra la preparazione e l'invio.
      forwardNotice({ event: { type: "document_changed", id: "Altro.md", changes: { aspects: ["frontmatter"], properties: ["stato"], tags_added: [], tags_removed: [] } }, origin: { actor: { kind: "kernel" }, batch: null } });
      forwardNotice({ event: { type: "index_updated" }, origin: { actor: { kind: "kernel" }, batch: null } } as never);
      release();
      await vi.waitFor(() => expect(notes[0]!.stato).toBe("Confermata"));
      expect(failures()).toEqual([]);
    } finally { close(); }
  });

  it("la cella non si scrive se la Base diventa in sola lettura, e la riga di stato lo dice", async () => {
    notified.length = 0;
    const { host, notes, surface, invokeCommand, release, mutating, close } = mount("table");
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".base-table tbody tr[data-doc]").length).toBe(2));
      const stato = host.querySelector<HTMLInputElement>('tr[data-doc="Opere/Nebbia.md"] td[data-cell="1"] input')!;
      stato.focus();
      stato.value = "Confermata";
      stato.dispatchEvent(new Event("input", { bubbles: true }));
      stato.dispatchEvent(new Event("change"));
      await mutating;
      surface.setReadOnly?.(true);
      release();
      await vi.waitFor(() => expect(host.querySelector(".base-status")?.textContent).toBe("«Nebbia»: la modifica non è stata scritta. La Base ora è in sola lettura."));
      expect(notes[0]!.stato).toBe("Arrivata");
      expect(invokeCommand).not.toHaveBeenCalledWith("note.property.set", expect.anything());
    } finally { close(); }
  });

  it("la colonna rinominata nella Bacheca si scrive anche se la Base si chiude nel frattempo", async () => {
    notified.length = 0;
    const { host, notes, release, mutating, close } = mount("kanban");
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".base-kanban .base-kanban-card[data-doc]").length).toBe(2));
      const rename = [...host.querySelectorAll<HTMLButtonElement>(".base-kanban button")].find((each) => each.textContent === "Rinomina la colonna")!;
      rename.click();
      const input = host.querySelector<HTMLInputElement>('.base-kanban input[aria-label="Rinomina Arrivata"]')!;
      input.value = "Esposta";
      press(input, { key: "Enter" });
      await mutating;
      close();
      release();
      await vi.waitFor(() => expect(notes[0]!.stato).toBe("Esposta"));
      expect(notes[1]!.stato).toBe("In prestito");
      expect(failures()).toEqual([]);
    } finally { close(); }
  });

  it("la colonna che non si rinomina a Base chiusa lo dice con un avviso", async () => {
    notified.length = 0;
    const { host, notes, release, mutating, close } = mount("kanban");
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".base-kanban .base-kanban-card[data-doc]").length).toBe(2));
      [...host.querySelectorAll<HTMLButtonElement>(".base-kanban button")].find((each) => each.textContent === "Rinomina la colonna")!.click();
      const input = host.querySelector<HTMLInputElement>('.base-kanban input[aria-label="Rinomina Arrivata"]')!;
      input.value = "Esposta";
      press(input, { key: "Enter" });
      await mutating;
      // La nota cambia altrove: la CAS del comando la rifiuta.
      notes[0]!.stato = "Altrove";
      close();
      release();
      await vi.waitFor(() => expect(failures()).toHaveLength(1));
      expect(failures()[0]!.message).toBe("La colonna «Arrivata» non è diventata «Esposta» per tutte le note: La nota è cambiata: riprova.");
    } finally { close(); }
  });

  it("la nota spostata nel calendario si scrive anche se la Base si chiude nel frattempo", async () => {
    notified.length = 0;
    const { host, notes, today, release, mutating, close } = mount("calendar");
    try {
      await vi.waitFor(() => expect(host.querySelector('.base-cal-event[data-doc="Opere/Nebbia.md"]')).not.toBeNull());
      press(host.querySelector('.base-cal-event[data-doc="Opere/Nebbia.md"]')!, { key: "ArrowRight", shiftKey: true });
      await mutating;
      close();
      release();
      await vi.waitFor(() => expect(notes[0]!.inizio).toBe(addDays(today, 1)));
      expect(failures()).toEqual([]);
      // Lo spostamento si dice anche a Base chiusa, col suo annulla.
      await vi.waitFor(() => expect(notified.some((each) => each.tone === "info" && each.message.startsWith("«Nebbia» ora è al"))).toBe(true));
    } finally { close(); }
  });

  it("la nota che non si sposta nel calendario a Base chiusa lo dice con un avviso", async () => {
    notified.length = 0;
    const { host, notes, today, release, mutating, close } = mount("calendar");
    try {
      await vi.waitFor(() => expect(host.querySelector('.base-cal-event[data-doc="Opere/Nebbia.md"]')).not.toBeNull());
      press(host.querySelector('.base-cal-event[data-doc="Opere/Nebbia.md"]')!, { key: "ArrowRight", shiftKey: true });
      await mutating;
      notes[0]!.inizio = addDays(today, 5);
      close();
      release();
      await vi.waitFor(() => expect(failures()).toHaveLength(1));
      expect(failures()[0]!.message).toBe("«Nebbia» non si è spostata: La nota è cambiata: riprova.");
    } finally { close(); }
  });

  it("la barra spostata nella linea del tempo si scrive anche se la Base si chiude nel frattempo", async () => {
    notified.length = 0;
    const { host, notes, today, release, mutating, close } = mount("timeline");
    try {
      await vi.waitFor(() => expect(host.querySelector('.base-tl-row[data-doc="Opere/Nebbia.md"] .base-tl-track')).not.toBeNull());
      press(host.querySelector('.base-tl-row[data-doc="Opere/Nebbia.md"] .base-tl-track')!, { key: "ArrowRight", shiftKey: true });
      await mutating;
      close();
      release();
      await vi.waitFor(() => expect([notes[0]!.inizio, notes[0]!.fine]).toEqual([addDays(today, 1), addDays(today, 3)]));
      expect(failures()).toEqual([]);
    } finally { close(); }
  });

  it("la barra che non si sposta a Base chiusa si disfa e lo dice con un avviso", async () => {
    notified.length = 0;
    const { host, notes, today, invokeCommand, release, mutating, close } = mount("timeline");
    try {
      await vi.waitFor(() => expect(host.querySelector('.base-tl-row[data-doc="Opere/Nebbia.md"] .base-tl-track')).not.toBeNull());
      press(host.querySelector('.base-tl-row[data-doc="Opere/Nebbia.md"] .base-tl-track')!, { key: "ArrowRight", shiftKey: true });
      await mutating;
      // La fine cambia altrove: l'inizio passa, la fine no, e l'inizio si disfa.
      notes[0]!.fine = addDays(today, 9);
      close();
      release();
      await vi.waitFor(() => expect(failures()).toHaveLength(1));
      expect(failures()[0]!.message).toBe("«Nebbia» non si è spostata: La nota è cambiata: riprova.");
      expect(invokeCommand).toHaveBeenCalledWith("vault.undo");
    } finally { close(); }
  });
});
