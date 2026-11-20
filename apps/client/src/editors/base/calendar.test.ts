// @vitest-environment happy-dom
//
// Il calendario della Base (T17): le regole pure (le settimane del mese, il
// primo giorno della lingua, la data spostata che tiene la sua forma) e la
// superficie vera con un core finto che tiene le note come testo. Il
// trascinamento passa da `mutate` e `note.property.set` con il valore letto
// come confronto, e la prova rilegge la data dal file.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult } from "../../host/contract";
import { addDays, BASE_DOC_MIME, firstWeekday, monthWeeks, movedDateValue } from "./calendar";
import { mountBaseSurface } from "./surface";

const notified = vi.hoisted(() => [] as { message: string; tone?: string; action?: { label: string; run: () => void } }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string, action?: { label: string; run: () => void }) => { notified.push({ message, tone, action }); },
}));
vi.mock("../../i18n/strings", async (real) => ({ ...await real<typeof import("../../i18n/strings")>(), resolvedLanguage: () => "it" }));

afterEach(() => { notified.length = 0; vi.useRealTimers(); });

describe("le regole del calendario", () => {
  it("il mese comincia dal primo giorno della settimana e si chiude coi giorni del mese dopo", () => {
    // Agosto 2026 comincia di sabato.
    const monday = monthWeeks(2026, 8, 1);
    expect(monday).toHaveLength(6);
    expect(monday[0]![0]).toEqual({ day: "2026-07-27", date: 27, inMonth: false });
    expect(monday[0]![5]).toEqual({ day: "2026-08-01", date: 1, inMonth: true });
    expect(monday[monday.length - 1]![6]).toEqual({ day: "2026-09-06", date: 6, inMonth: false });
    const sunday = monthWeeks(2026, 8, 0);
    expect(sunday[0]![0]!.day).toBe("2026-07-26");
    expect(sunday).toHaveLength(6);
    // Febbraio 2027 da lunedì: quattro settimane giuste.
    expect(monthWeeks(2027, 2, 1)).toHaveLength(4);
  });

  it("il primo giorno della settimana segue la lingua", () => {
    expect(firstWeekday("it")).toBe(1);
    expect(firstWeekday("en-US")).toBe(0);
    expect(firstWeekday("en-GB")).toBe(1);
    expect(firstWeekday("non-una-lingua-vera-!!")).toBe(1);
  });

  it("i giorni si contano in UTC, anche sopra il cambio dell'ora e dell'anno", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("la data spostata tiene la sua forma: l'ora, i secondi e il fuso restano", () => {
    const date = (time: unknown) => ({ kind: "date", value: { year: 2026, month: 8, day: 3, time } });
    expect(movedDateValue(date(null), "2026-08-10")).toBe("2026-08-10");
    expect(movedDateValue(date({ hour: 14, minute: 30, second: 0, offset_minutes: null }), "2026-08-10")).toBe("2026-08-10T14:30");
    expect(movedDateValue(date({ hour: 9, minute: 5, second: 7, offset_minutes: 120 }), "2026-08-10")).toBe("2026-08-10T09:05:07+02:00");
    expect(movedDateValue(date({ hour: 23, minute: 0, second: 0, offset_minutes: 0 }), "2026-08-10")).toBe("2026-08-10T23:00Z");
    expect(movedDateValue(date({ hour: 8, minute: 0, second: 0, offset_minutes: -330 }), "2026-08-10")).toBe("2026-08-10T08:00-05:30");
    // Ciò che non è una data non si sposta.
    expect(movedDateValue({ kind: "text", value: "domani" }, "2026-08-10")).toBeNull();
    expect(movedDateValue(undefined, "2026-08-10")).toBeNull();
    expect(movedDateValue(date({ hour: 25, minute: 0, second: 0, offset_minutes: null }), "2026-08-10")).toBeNull();
  });
});

// ---- La superficie con un core finto ----------------------------------------

interface Stored { text: string }
const DATE = /^"?(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?"?$/;
// La proprietà letta come la legge il core: una data con o senza l'ora.
const typed = (raw: string): unknown => {
  const match = DATE.exec(raw.trim());
  if (!match) return { kind: "text", value: raw.trim() };
  const [, y, m, d, hh, mm, ss, zone] = match;
  const offset = zone === undefined ? null : zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  return { kind: "date", value: { year: Number(y), month: Number(m), day: Number(d), time: hh === undefined ? null : { hour: Number(hh), minute: Number(mm), second: Number(ss ?? 0), offset_minutes: offset } } };
};
const frontmatter = (text: string): Record<string, string> => Object.fromEntries(
  (text.split("---")[1] ?? "").split("\n").filter((line) => line.includes(":")).map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
);

const mount = (notes: Record<string, string>, view: { date?: string } = { date: "quando" }) => {
  const files = new Map<string, Stored>(Object.entries(notes).map(([doc, text]) => [doc, { text }]));
  const host = document.createElement("div");
  document.body.append(host);
  const docs = () => [...files].map(([doc, { text }]) => ({ doc, properties: Object.entries(frontmatter(text)).map(([key, value]) => ({ key, value: typed(value) })) }));
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") { const items = docs(); return { kind: "documents", value: { offset: 0, total: items.length, items } }; }
    const query = request.kind === "custom" ? request.query as { op: string; edits?: { doc: string; key: string; expected: unknown; value: string }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: ["Agenda"], types: ["calendar"] } };
    if (query.op === "plan") return { kind: "custom", value: {
      view: "Agenda", view_type: "calendar", columns: [], column_labels: {}, required_props: [], all_properties: false,
      group: null, limit: null, map: null, create_defaults: {}, date_key: view.date ?? null, start_key: null, end_key: null,
    } };
    if (query.op === "derive") return { kind: "custom", value: { summaries: {}, rows: docs().map(({ doc, properties }) => {
      const date = properties.find((each) => each.key === view.date)?.value as { kind: string; value: { year: number; month: number; day: number } } | undefined;
      const day = date?.kind === "date" ? `${date.value.year}-${String(date.value.month).padStart(2, "0")}-${String(date.value.day).padStart(2, "0")}` : null;
      return { doc, values: {}, time: { day } };
    }) } };
    if (query.op === "mutate") return { kind: "custom", value: { mutations: query.edits!.map((edit) => ({
      doc: edit.doc, key: edit.key, command: "note.property.set",
      args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), value: edit.value },
    })) } };
    throw new Error(`unexpected Base operation ${query.op}`);
  });
  // `note.property.set` come lo fa il core: confronta il valore letto con
  // quello del file, e riscrive solo la riga della proprietà (in JSON).
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command !== "note.property.set") return {};
    const file = files.get(args.doc as string)!;
    const key = args.key as string;
    const current = frontmatter(file.text)[key];
    const expected = JSON.parse(args.expected as string) as { kind: string; value?: unknown };
    if (JSON.stringify(expected.value) !== JSON.stringify(current === undefined ? undefined : typed(current))) throw { kind: "conflict", message: "la nota è cambiata" };
    const value = JSON.parse(args.value as string) as string;
    file.text = file.text.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${JSON.stringify(value)}`);
    return { notify: "Proprietà scritta", undo: { label: `Annulla «${key}»` } };
  });
  const onOpen = vi.fn();
  const surface = mountBaseSurface("base", { paneId: "base-calendario", documentId: "Agenda.base", parent: host }, {
    queryIndex, invokeCommand,
    viewState: async () => null as never, setViewState: async () => {},
    onOpenDocument: onOpen, revision: () => "r1",
  });
  surface.buffer.setDoc("views:\n  - name: Agenda\n    type: table\n    fub: {view: calendar, date: quando}\n");
  return { host, files, surface, invokeCommand, onOpen, done: () => { surface.destroy(); host.remove(); } };
};

const NOTES = {
  "Mostra.md": "---\nquando: 2026-08-03\n---\n# Mostra\n",
  "Prestito.md": "---\nquando: 2026-08-03T14:30\nsala: due\n---\nTesto\n",
  "Restauro.md": "---\nquando: 2026-09-02\n---\n",
  "Senza.md": "---\nsala: tre\n---\n",
};
const day = (host: HTMLElement, iso: string) => host.querySelector<HTMLElement>(`.base-cal-day[data-day="${iso}"]`)!;
const docsIn = (host: HTMLElement, iso: string) => [...day(host, iso).querySelectorAll<HTMLElement>(".base-cal-event")].map((each) => each.dataset.doc);
const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-cal-event")).not.toBeNull());
// Un trascinamento del browser: gli eventi con lo stesso `dataTransfer`.
const drag = (from: HTMLElement, to: HTMLElement) => {
  const data = new Map<string, string>();
  const transfer = {
    setData: (type: string, value: string) => { data.set(type, value); },
    getData: (type: string) => data.get(type) ?? "",
    get types() { return [...data.keys()]; },
    effectAllowed: "all", dropEffect: "none",
  };
  const fire = (target: HTMLElement, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);
    return event;
  };
  fire(from, "dragstart");
  if (from.draggable && data.get(BASE_DOC_MIME) !== from.dataset.doc) throw new Error("la nota non porta il suo documento");
  const over = fire(to, "dragover");
  const lit = to.dataset.over;
  fire(to, "drop");
  fire(from, "dragend");
  return { accepted: over.defaultPrevented, lit };
};

describe("il calendario nella superficie", () => {
  it("mostra il mese di oggi con le note nei loro giorni, anche nei giorni del mese dopo", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const { host, done } = mount(NOTES);
    try {
      await ready(host);
      expect(host.querySelector(".base-cal-title")!.textContent).toBe("Agosto 2026");
      expect(host.querySelector(".base-cal-dow")!.textContent).toMatch(/^lun/i);
      expect(docsIn(host, "2026-08-03")).toEqual(["Mostra.md", "Prestito.md"]);
      // Il 2 settembre è nell'ultima settimana di agosto, fra i giorni fuori.
      expect(day(host, "2026-09-02").dataset.out).toBe("true");
      expect(docsIn(host, "2026-09-02")).toEqual(["Restauro.md"]);
      expect(day(host, "2026-08-19").dataset.today).toBe("true");
      expect(host.querySelector(".base-cal-undated")!.textContent).toBe("Una nota senza data");
    } finally { done(); }
  });

  it("trascinare una nota su un altro giorno scrive la data nel file con la revisione letta, e l'ora resta", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const { host, files, invokeCommand, done } = mount(NOTES);
    try {
      await ready(host);
      const note = day(host, "2026-08-03").querySelector<HTMLElement>('[data-doc="Prestito.md"]')!;
      expect(note.draggable).toBe(true);
      const { accepted, lit } = drag(note, day(host, "2026-08-10"));
      expect(accepted).toBe(true);
      expect(lit).toBe("true");
      await vi.waitFor(() => expect(invokeCommand).toHaveBeenCalledWith("note.property.set", {
        doc: "Prestito.md", key: "quando", value: JSON.stringify("2026-08-10T14:30"),
        expected: JSON.stringify({ kind: "value", value: { kind: "date", value: { year: 2026, month: 8, day: 3, time: { hour: 14, minute: 30, second: 0, offset_minutes: null } } } }),
      }));
      // Il file riletto: la data è cambiata, l'ora no, il resto è com'era.
      expect(files.get("Prestito.md")!.text).toBe('---\nquando: "2026-08-10T14:30"\nsala: due\n---\nTesto\n');
      await vi.waitFor(() => expect(docsIn(host, "2026-08-10")).toEqual(["Prestito.md"]));
      expect(docsIn(host, "2026-08-03")).toEqual(["Mostra.md"]);
      expect(host.querySelector("[data-over]")).toBeNull();
      // L'avviso dice dove è andata, e offre l'annulla del vault.
      expect(notified[notified.length - 1]).toMatchObject({ message: "«Prestito» ora è al 10 agosto 2026.", action: { label: "Annulla" } });
    } finally { done(); }
  });

  it("una nota cambiata durante il trascinamento non si sovrascrive: il calendario la rilegge", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const { host, files, done } = mount(NOTES);
    try {
      await ready(host);
      const note = day(host, "2026-08-03").querySelector<HTMLElement>('[data-doc="Mostra.md"]')!;
      // Un'altra finestra sposta la nota mentre la si trascina.
      files.get("Mostra.md")!.text = "---\nquando: 2026-08-05\n---\n# Mostra\n";
      drag(note, day(host, "2026-08-12"));
      await vi.waitFor(() => expect(docsIn(host, "2026-08-05")).toEqual(["Mostra.md"]));
      expect(files.get("Mostra.md")!.text).toBe("---\nquando: 2026-08-05\n---\n# Mostra\n");
      expect(docsIn(host, "2026-08-12")).toEqual([]);
      expect(host.querySelector(".base-status")!.textContent).toContain("è cambiata mentre la spostavi");
    } finally { done(); }
  });

  it("in sola lettura le note non si trascinano e il rilascio non scrive", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const { host, surface, invokeCommand, done } = mount(NOTES);
    try {
      await ready(host);
      surface.setReadOnly?.(true);
      await vi.waitFor(() => expect(host.querySelector<HTMLElement>('[data-doc="Mostra.md"]')!.draggable).toBe(false));
      const { accepted } = drag(host.querySelector<HTMLElement>('[data-doc="Mostra.md"]')!, day(host, "2026-08-12"));
      // Una nota che non si trascina non porta niente: nessun giorno la accetta.
      expect(accepted).toBe(false);
      await Promise.resolve();
      expect(invokeCommand).not.toHaveBeenCalled();
    } finally { done(); }
  });

  it("più di tre note in un giorno diventano «+N», che apre il giorno", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const many = Object.fromEntries(["A", "B", "C", "D", "E"].map((name) => [`${name}.md`, "---\nquando: 2026-08-14\n---\n"]));
    const { host, done } = mount(many);
    try {
      await ready(host);
      expect(docsIn(host, "2026-08-14")).toEqual(["A.md", "B.md", "C.md"]);
      const more = day(host, "2026-08-14").querySelector<HTMLButtonElement>(".base-cal-more")!;
      expect(more.textContent).toBe("+2");
      expect(more.getAttribute("aria-label")).toBe("Mostra altre 2 note");
      more.click();
      expect(docsIn(host, "2026-08-14")).toHaveLength(5);
      expect(day(host, "2026-08-14").querySelector(".base-cal-more")!.textContent).toBe("Meno");
    } finally { done(); }
  });

  it("le frecce vanno fra i giorni (anche nel mese dopo), Invio apre, Maiusc con le frecce sposta la nota", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-19T09:30:00+02:00") });
    const { host, files, onOpen, done } = mount(NOTES);
    try {
      await ready(host);
      const key = (target: HTMLElement, name: string, shift = false) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey: shift, bubbles: true, cancelable: true }));
      // Il fuoco parte da oggi; un clic sul 3 lo porta lì.
      expect(day(host, "2026-08-19").tabIndex).toBe(0);
      day(host, "2026-08-03").click();
      expect(document.activeElement).toBe(day(host, "2026-08-03"));
      key(day(host, "2026-08-03"), "ArrowDown");
      expect(document.activeElement).toBe(day(host, "2026-08-10"));
      key(day(host, "2026-08-10"), "ArrowUp");
      // Invio apre la prima nota del giorno.
      key(day(host, "2026-08-03"), "Enter");
      expect(onOpen).toHaveBeenCalledWith("Mostra.md");
      // Maiusc+freccia a destra sposta la nota col fuoco al giorno dopo.
      const note = day(host, "2026-08-03").querySelector<HTMLElement>('[data-doc="Prestito.md"]')!;
      note.focus();
      key(note, "ArrowRight", true);
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toContain('quando: "2026-08-04T14:30"'));
      await vi.waitFor(() => expect(docsIn(host, "2026-08-04")).toEqual(["Prestito.md"]));
      // Il fuoco segue la nota nel giorno nuovo.
      await vi.waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.doc).toBe("Prestito.md"));
      // Dall'ultimo giorno del mese la freccia passa a settembre.
      day(host, "2026-08-31").click();
      key(day(host, "2026-08-31"), "ArrowRight");
      expect(host.querySelector(".base-cal-title")!.textContent).toBe("Settembre 2026");
      await vi.waitFor(() => expect(document.activeElement).toBe(day(host, "2026-09-01")));
    } finally { done(); }
  });

  it("senza la proprietà data il calendario lo dice, e offre le proprietà data delle note", async () => {
    const { host, done } = mount(NOTES, {});
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-cal-empty")).not.toBeNull());
      expect(host.querySelector(".base-cal-empty p")!.textContent).toBe("Questo calendario non sa ancora quale proprietà è la sua data.");
      expect([...host.querySelectorAll(".base-cal-date-key option:not([disabled])")].map((each) => each.textContent)).toEqual(["quando"]);
    } finally { done(); }
  });
});
