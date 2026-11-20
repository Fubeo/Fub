// @vitest-environment happy-dom
//
// La linea del tempo della Base (T34): le regole pure (le colonne della scala,
// dove cade un giorno, la barra spostata o allungata) e la superficie vera con
// un core finto che tiene le note come testo. Il trascinamento passa da
// `mutate` e da una `note.property.set` per data, col valore letto come
// confronto, e la prova rilegge le date dal file.
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMANDS, type IndexQuery, type IndexResult } from "../../host/contract";
import { dayAt, dayPosition, movedSpan, openingStart, spanShape, timelineColumns } from "./timeline";
import { mountBaseSurface } from "./surface";

const notified = vi.hoisted(() => [] as { message: string; tone?: string; action?: { label: string; run: () => void } }[]);
vi.mock("../../ui/notify", () => ({
  notify: (message: string, tone?: string, action?: { label: string; run: () => void }) => { notified.push({ message, tone, action }); },
}));
vi.mock("../../i18n/strings", async (real) => ({ ...await real<typeof import("../../i18n/strings")>(), resolvedLanguage: () => "it" }));

afterEach(() => { notified.length = 0; vi.useRealTimers(); });

describe("le regole della linea del tempo", () => {
  it("le colonne partono dal primo giorno della scala, con oggi nella seconda", () => {
    // Mercoledì 19 agosto 2026, settimana dal lunedì.
    expect(openingStart("2026-08-19", "weeks", 1)).toBe("2026-08-10");
    expect(openingStart("2026-08-19", "weeks", 0)).toBe("2026-08-09");
    expect(openingStart("2026-08-19", "months", 1)).toBe("2026-07-01");
    expect(openingStart("2026-01-05", "months", 1)).toBe("2025-12-01");
    expect(openingStart("2026-08-19", "years", 1)).toBe("2025-01-01");
    expect(timelineColumns("2026-08-10", "weeks").map((column) => column.days)).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    expect(timelineColumns("2026-01-01", "months").map((column) => [column.start, column.days])).toEqual([
      ["2026-01-01", 31], ["2026-02-01", 28], ["2026-03-01", 31], ["2026-04-01", 30], ["2026-05-01", 31], ["2026-06-01", 30],
    ]);
    expect(timelineColumns("2027-01-01", "years").map((column) => column.days)).toEqual([365, 366, 365, 365]);
  });

  it("un giorno cade nella sua colonna, e dal punto si torna al giorno", () => {
    const weeks = timelineColumns("2026-08-10", "weeks");
    expect(dayPosition("2026-08-10", weeks)).toBe(0);
    expect(dayPosition("2026-08-24", weeks)).toBe(0.25);
    expect(dayPosition("2026-10-05", weeks)).toBe(1);
    expect(dayPosition("2026-08-03", weeks)).toBe(-0.125);
    expect(dayAt(0, weeks)).toBe("2026-08-10");
    expect(dayAt(0.2499, weeks)).toBe("2026-08-23");
    expect(dayAt(-0.01, weeks)).toBe("2026-08-09");
    expect(dayAt(1.01, weeks)).toBe("2026-10-05");
    // I mesi hanno colonne uguali: febbraio ha i giorni più larghi.
    const months = timelineColumns("2026-01-01", "months");
    expect(dayPosition("2026-02-15", months)).toBeCloseTo((1 + 14 / 28) / 6);
    expect(dayAt(dayPosition("2026-02-15", months) + 0.001, months)).toBe("2026-02-15");
  });

  it("una barra fuori dai giorni mostrati è tagliata, o diventa la sua data al bordo", () => {
    const weeks = timelineColumns("2026-08-10", "weeks");
    expect(spanShape({ start: "2026-08-12", end: "2026-08-20", inverted: false }, weeks)).toEqual({ kind: "bar", left: 2 / 56, right: 11 / 56, clipStart: false, clipEnd: false });
    expect(spanShape({ start: "2026-08-01", end: "2026-08-12", inverted: false }, weeks)).toMatchObject({ kind: "bar", left: 0, clipStart: true, clipEnd: false });
    expect(spanShape({ start: "2026-12-01", end: "2026-12-05", inverted: false }, weeks)).toEqual({ kind: "after", day: "2026-12-01" });
    expect(spanShape({ start: "2026-07-01", end: "2026-07-05", inverted: false }, weeks)).toEqual({ kind: "before", day: "2026-07-05" });
    // La fine prima dell'inizio: la barra va dalla fine all'inizio.
    expect(spanShape({ start: "2026-08-20", end: "2026-08-12", inverted: true }, weeks)).toMatchObject({ kind: "bar", left: 2 / 56, right: 11 / 56 });
    // Una data sola è un punto, anche se è la fine.
    expect(spanShape({ start: null, end: "2026-08-17", inverted: false }, weeks)).toMatchObject({ kind: "point", left: 7 / 56 });
    expect(spanShape({ start: null, end: null, inverted: false }, weeks)).toBeNull();
  });

  it("spostare la barra muove le due date; un bordo ne muove una e non passa l'altro", () => {
    const span = { start: "2026-08-12", end: "2026-08-20", inverted: false };
    expect(movedSpan(span, "move", 3)).toEqual({ start: "2026-08-15", end: "2026-08-23" });
    expect(movedSpan(span, "low", -2)).toEqual({ start: "2026-08-10" });
    expect(movedSpan(span, "high", 4)).toEqual({ end: "2026-08-24" });
    expect(movedSpan(span, "low", 30)).toEqual({ start: "2026-08-20" });
    expect(movedSpan(span, "high", -30)).toEqual({ end: "2026-08-12" });
    expect(movedSpan(span, "move", 0)).toEqual({});
    // Rovesciata, il bordo sinistro è la fine.
    expect(movedSpan({ start: "2026-08-20", end: "2026-08-12", inverted: true }, "low", 1)).toEqual({ end: "2026-08-13" });
    // Un punto si sposta con la sua data sola.
    expect(movedSpan({ start: "2026-08-25", end: null, inverted: false }, "move", -1)).toEqual({ start: "2026-08-24" });
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
const civil = (value: unknown): string | null => {
  const date = value as { kind: string; value: { year: number; month: number; day: number } } | undefined;
  return date?.kind === "date" ? `${date.value.year}-${String(date.value.month).padStart(2, "0")}-${String(date.value.day).padStart(2, "0")}` : null;
};

const mount = (notes: Record<string, string>, view: { start?: string; end?: string } = { start: "inizio", end: "fine" }, options: { conflictOn?: string } = {}) => {
  const files = new Map<string, Stored>(Object.entries(notes).map(([doc, text]) => [doc, { text }]));
  const host = document.createElement("div");
  document.body.append(host);
  const docs = () => [...files].map(([doc, { text }]) => ({ doc, properties: Object.entries(frontmatter(text)).map(([key, value]) => ({ key, value: typed(value) })) }));
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    if (request.kind === "documents") { const items = docs(); return { kind: "documents", value: { offset: 0, total: items.length, items } }; }
    const query = request.kind === "custom" ? request.query as { op: string; edits?: { doc: string; key: string; expected: unknown; value: string }[] } : null;
    if (!query) throw new Error("unexpected query");
    if (query.op === "parse") return { kind: "custom", value: { views: ["Tempi"], types: ["timeline"] } };
    if (query.op === "plan") return { kind: "custom", value: {
      view: "Tempi", view_type: "timeline", columns: [], column_labels: {}, required_props: [], all_properties: false,
      group: null, limit: null, map: null, create_defaults: {}, date_key: null, start_key: view.start ?? null, end_key: view.end ?? null,
    } };
    if (query.op === "derive") return { kind: "custom", value: { summaries: {}, rows: docs().map(({ doc, properties }) => {
      const start = civil(properties.find((each) => each.key === view.start)?.value);
      const end = civil(properties.find((each) => each.key === view.end)?.value);
      return { doc, values: {}, time: { start, end, inverted: start !== null && end !== null && end < start } };
    }) } };
    if (query.op === "mutate") return { kind: "custom", value: { mutations: query.edits!.map((edit) => ({
      doc: edit.doc, key: edit.key, command: "note.property.set",
      args: { doc: edit.doc, key: edit.key, expected: JSON.stringify(edit.expected), value: edit.value },
    })) } };
    throw new Error(`unexpected Base operation ${query.op}`);
  });
  // `note.property.set` come lo fa il core: confronta il valore letto con
  // quello del file, e riscrive solo la riga della proprietà (in JSON).
  // L'annulla del vault disfa l'ultima scrittura.
  const history: { doc: string; text: string }[] = [];
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === COMMANDS.undo) {
      const last = history.pop();
      if (last) files.get(last.doc)!.text = last.text;
      return { notify: "Annullato" };
    }
    if (command !== "note.property.set") return {};
    const file = files.get(args.doc as string)!;
    const key = args.key as string;
    if (options.conflictOn === key) throw { kind: "conflict", message: "la nota è cambiata" };
    const current = frontmatter(file.text)[key];
    const expected = JSON.parse(args.expected as string) as { kind: string; value?: unknown };
    if (JSON.stringify(expected.value) !== JSON.stringify(current === undefined ? undefined : typed(current))) throw { kind: "conflict", message: "la nota è cambiata" };
    const value = JSON.parse(args.value as string) as string;
    history.push({ doc: args.doc as string, text: file.text });
    file.text = file.text.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${JSON.stringify(value)}`);
    return { notify: "Proprietà scritta", undo: { label: `Annulla «${key}»` } };
  });
  const onOpen = vi.fn();
  const surface = mountBaseSurface("base", { paneId: "base-tempo", documentId: "Tempi.base", parent: host }, {
    queryIndex, invokeCommand,
    viewState: async () => null as never, setViewState: async () => {},
    onOpenDocument: onOpen, revision: () => "r1",
  });
  surface.buffer.setDoc("views:\n  - name: Tempi\n    type: table\n    fub: {view: timeline, start: inizio, end: fine}\n");
  return { host, files, surface, invokeCommand, onOpen, done: () => { surface.destroy(); host.remove(); } };
};

const NOTES = {
  "Mostra.md": "---\ninizio: 2026-08-12\nfine: 2026-08-20\n---\n# Mostra\n",
  "Prestito.md": "---\ninizio: 2026-08-14T09:00\nfine: 2026-08-16T18:30\nsala: due\n---\nTesto\n",
  "Restauro.md": "---\ninizio: 2026-08-25\n---\n",
  "Rovescio.md": "---\ninizio: 2026-09-10\nfine: 2026-09-01\n---\n",
  "Lontana.md": "---\ninizio: 2026-12-01\nfine: 2026-12-05\n---\n",
  "Senza.md": "---\nsala: tre\n---\n",
};
// Otto settimane dal 10 agosto su 560 px: dieci pixel per giorno.
const WIDTH = 560;
const NOW = new Date("2026-08-19T09:30:00+02:00");
const row = (host: HTMLElement, doc: string) => host.querySelector<HTMLElement>(`.base-tl-row[data-doc="${doc}"]`)!;
const track = (host: HTMLElement, doc: string) => row(host, doc).querySelector<HTMLElement>(".base-tl-track")!;
const bar = (host: HTMLElement, doc: string) => row(host, doc).querySelector<HTMLElement>(".base-tl-bar, .base-tl-point")!;
const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector(".base-tl-row")).not.toBeNull());
// Le righe hanno la larghezza di una pagina vera: happy-dom non impagina.
const sized = (host: HTMLElement) => {
  for (const each of host.querySelectorAll<HTMLElement>(".base-tl-track")) {
    each.getBoundingClientRect = () => ({ left: 0, top: 0, right: WIDTH, bottom: 34, width: WIDTH, height: 34, x: 0, y: 0, toJSON: () => ({}) });
  }
};
const pointer = (target: Element, type: string, clientX: number) => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, button: 0, pointerId: 7 }));
};
// Un trascinamento col puntatore, da `from` a `to` pixel nella riga.
const drag = (target: Element, from: number, to: number) => {
  pointer(target, "pointerdown", from);
  pointer(target, "pointermove", (from + to) / 2);
  pointer(target, "pointermove", to);
  pointer(target, "pointerup", to);
};
const key = (target: HTMLElement, name: string, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...modifiers }));

describe("la linea del tempo nella superficie", () => {
  it("mostra le note come barre fra inizio e fine, un punto senza fine, e segna la fine prima dell'inizio", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, done } = mount(NOTES);
    try {
      await ready(host);
      expect(host.querySelector(".base-tl-title")!.textContent).toBe("10 ago – 4 ott 2026");
      expect(host.querySelector(".base-tl-axis-label")!.textContent).toBe("inizio → fine");
      expect([...host.querySelectorAll(".base-tl-tick")].map((each) => each.textContent)).toEqual(["10 ago", "24 ago", "31 ago", "7 set", "14 set", "21 set", "28 set"]);
      // «17 ago» lascia il posto a «oggi», che sta sopra la sua colonna.
      expect(host.querySelector(".base-tl-now")!.textContent).toBe("oggi");
      expect([...host.querySelectorAll<HTMLElement>(".base-tl-row")].map((each) => each.dataset.doc)).toEqual(["Mostra.md", "Prestito.md", "Restauro.md", "Rovescio.md", "Lontana.md"]);
      expect(host.querySelector(".base-tl-undated")!.textContent).toBe("Una nota senza date");
      const mostra = bar(host, "Mostra.md");
      expect(mostra.className).toBe("base-tl-bar");
      expect(mostra.textContent).toBe("12 ago → 20 ago");
      expect(mostra.style.getPropertyValue("--tl-left")).toBe(`${(2 / 56) * 100}%`);
      expect(mostra.querySelectorAll(".base-tl-edge")).toHaveLength(2);
      expect(track(host, "Mostra.md").getAttribute("aria-label")).toBe("Mostra: 12 agosto 2026 – 20 agosto 2026");
      // Senza fine, un punto senza bordi da prendere.
      expect(bar(host, "Restauro.md").className).toBe("base-tl-point");
      expect(bar(host, "Restauro.md").querySelector(".base-tl-edge")).toBeNull();
      expect(track(host, "Restauro.md").getAttribute("aria-label")).toBe("Restauro: 25 agosto 2026, senza fine");
      // La fine prima dell'inizio si mostra e si segna.
      expect(bar(host, "Rovescio.md").dataset.inverted).toBe("true");
      expect(track(host, "Rovescio.md").getAttribute("aria-label")).toContain("la fine viene prima dell'inizio");
      // Tutta dopo i giorni mostrati: la sua data al bordo, che porta lì.
      const off = row(host, "Lontana.md").querySelector<HTMLButtonElement>(".base-tl-off")!;
      expect(off.dataset.side).toBe("after");
      expect(off.textContent).toBe("1 dic ›");
      off.click();
      await vi.waitFor(() => expect(bar(host, "Lontana.md")?.className).toBe("base-tl-bar"));
      expect(host.querySelector(".base-tl-title")!.textContent).toMatch(/^23 nov/);
    } finally { done(); }
  });

  it("trascinare una barra sposta le due date nel file, col valore letto, e una «Annulla» le disfa tutte e due", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, files, invokeCommand, done } = mount(NOTES);
    try {
      await ready(host);
      sized(host);
      // Dal 15 agosto (50 px) al 18 (80 px): tre giorni dopo.
      drag(bar(host, "Mostra.md"), 55, 85);
      await vi.waitFor(() => expect(files.get("Mostra.md")!.text).toBe('---\ninizio: "2026-08-15"\nfine: "2026-08-23"\n---\n# Mostra\n'));
      expect(invokeCommand).toHaveBeenCalledWith("note.property.set", {
        doc: "Mostra.md", key: "inizio", value: JSON.stringify("2026-08-15"),
        expected: JSON.stringify({ kind: "value", value: { kind: "date", value: { year: 2026, month: 8, day: 12, time: null } } }),
      });
      await vi.waitFor(() => expect(bar(host, "Mostra.md").textContent).toBe("15 ago → 23 ago"));
      const said = notified[notified.length - 1]!;
      expect(said).toMatchObject({ message: "«Mostra» spostata: 15 agosto 2026 → 23 agosto 2026.", action: { label: "Annulla" } });
      said.action!.run();
      await vi.waitFor(() => expect(files.get("Mostra.md")!.text).toBe("---\ninizio: 2026-08-12\nfine: 2026-08-20\n---\n# Mostra\n"));
      expect(invokeCommand.mock.calls.filter(([command]) => command === COMMANDS.undo)).toHaveLength(2);
    } finally { done(); }
  });

  it("trascinare un bordo cambia una data sola, e l'ora resta", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, files, done } = mount(NOTES);
    try {
      await ready(host);
      sized(host);
      // La fine del 16 agosto (60–70 px) portata al 19 (90–100 px).
      const edge = bar(host, "Prestito.md").querySelector<HTMLElement>('.base-tl-edge[data-grip="high"]')!;
      drag(edge, 65, 95);
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toBe('---\ninizio: 2026-08-14T09:00\nfine: "2026-08-19T18:30"\nsala: due\n---\nTesto\n'));
      expect(notified[notified.length - 1]!.message).toBe("Nuova fine di «Prestito»: 19 agosto 2026.");
      // Il bordo sinistro, oltre la fine, si ferma sulla fine.
      sized(host);
      const low = bar(host, "Prestito.md").querySelector<HTMLElement>('.base-tl-edge[data-grip="low"]')!;
      drag(low, 45, 255);
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toContain('inizio: "2026-08-19T09:00"'));
    } finally { done(); }
  });

  it("se la seconda data non si scrive, la prima si disfa e la barra resta dov'era", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, files, done } = mount(NOTES, undefined, { conflictOn: "fine" });
    try {
      await ready(host);
      sized(host);
      drag(bar(host, "Mostra.md"), 55, 85);
      await vi.waitFor(() => expect(host.querySelector(".base-status")!.textContent).toContain("è cambiata mentre la spostavi"));
      expect(files.get("Mostra.md")!.text).toBe("---\ninizio: 2026-08-12\nfine: 2026-08-20\n---\n# Mostra\n");
      expect(bar(host, "Mostra.md").textContent).toBe("12 ago → 20 ago");
    } finally { done(); }
  });

  it("una nota cambiata durante il trascinamento non si sovrascrive", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, files, done } = mount(NOTES);
    try {
      await ready(host);
      sized(host);
      files.get("Restauro.md")!.text = "---\ninizio: 2026-08-27\n---\n";
      drag(bar(host, "Restauro.md"), 155, 185);
      await vi.waitFor(() => expect(bar(host, "Restauro.md").textContent).toBe("27 ago"));
      expect(files.get("Restauro.md")!.text).toBe("---\ninizio: 2026-08-27\n---\n");
    } finally { done(); }
  });

  it("in sola lettura le barre non si prendono e il trascinamento non scrive, ma il clic apre la nota", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, surface, invokeCommand, onOpen, done } = mount(NOTES);
    try {
      await ready(host);
      surface.setReadOnly?.(true);
      await vi.waitFor(() => expect(bar(host, "Mostra.md").dataset.grip).toBeUndefined());
      expect(bar(host, "Mostra.md").querySelector(".base-tl-edge")).toBeNull();
      sized(host);
      drag(bar(host, "Mostra.md"), 55, 85);
      bar(host, "Mostra.md").click();
      expect(onOpen).toHaveBeenCalledWith("Mostra.md");
      await Promise.resolve();
      expect(invokeCommand.mock.calls.filter(([command]) => command === "note.property.set")).toHaveLength(0);
    } finally { done(); }
  });

  it("dalla tastiera: su e giù fra le note, Invio apre, Maiusc sposta la barra, Alt e Maiusc la fine, meno cambia la scala", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, files, onOpen, done } = mount(NOTES);
    try {
      await ready(host);
      expect(track(host, "Mostra.md").tabIndex).toBe(0);
      expect(track(host, "Prestito.md").tabIndex).toBe(-1);
      track(host, "Mostra.md").focus();
      key(track(host, "Mostra.md"), "ArrowDown");
      expect(document.activeElement).toBe(track(host, "Prestito.md"));
      key(track(host, "Prestito.md"), "Enter");
      expect(onOpen).toHaveBeenCalledWith("Prestito.md");
      key(track(host, "Prestito.md"), "ArrowRight", { shiftKey: true });
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toContain('inizio: "2026-08-15T09:00"\nfine: "2026-08-17T18:30"'));
      // Il fuoco resta sulla riga dopo il ridisegno.
      await vi.waitFor(() => expect(document.activeElement).toBe(track(host, "Prestito.md")));
      key(track(host, "Prestito.md"), "ArrowRight", { shiftKey: true, altKey: true });
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toContain('inizio: "2026-08-15T09:00"\nfine: "2026-08-18T18:30"'));
      await vi.waitFor(() => expect(document.activeElement).toBe(track(host, "Prestito.md")));
      key(track(host, "Prestito.md"), "ArrowLeft", { altKey: true });
      await vi.waitFor(() => expect(files.get("Prestito.md")!.text).toContain('inizio: "2026-08-14T09:00"'));
      await vi.waitFor(() => expect(document.activeElement).toBe(track(host, "Prestito.md")));
      // «-» allontana: dalle settimane ai mesi.
      key(track(host, "Prestito.md"), "-");
      await vi.waitFor(() => expect(host.querySelector('.base-tl-zoom-option[aria-pressed="true"]')!.textContent).toBe("Mesi"));
      expect(host.querySelector<HTMLElement>(".base-tl")!.style.getPropertyValue("--tl-columns")).toBe("6");
      // Le frecce da sole scorrono di una colonna.
      const before = host.querySelector(".base-tl-tick")!.textContent;
      key(track(host, "Prestito.md"), "ArrowRight");
      await vi.waitFor(() => expect(host.querySelector(".base-tl-tick")!.textContent).not.toBe(before));
    } finally { done(); }
  });

  it("i pulsanti della scala, i passi e «Oggi»", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const { host, done } = mount(NOTES);
    try {
      await ready(host);
      const option = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".base-tl-zoom-option")].find((each) => each.textContent === label)!;
      option("Anni").click();
      expect(host.querySelector(".base-tl-title")!.textContent).toBe("2024 – 2027");
      expect([...host.querySelectorAll(".base-tl-tick")].map((each) => each.textContent)).toEqual(["2024", "2025", "2027"]);
      host.querySelector<HTMLButtonElement>(".base-tl-next")!.click();
      expect(host.querySelector(".base-tl-tick")!.textContent).toBe("2028");
      host.querySelector<HTMLButtonElement>(".base-tl-today")!.click();
      expect(host.querySelector(".base-tl-tick")!.textContent).toBe("2025");
      option("Settimane").click();
      expect(option("Settimane").getAttribute("aria-pressed")).toBe("true");
    } finally { done(); }
  });

  it("mille note: cento righe per volta, e «Mostra altri» le altre", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const many = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`N${String(index).padStart(4, "0")}.md`, `---\ninizio: 2026-08-${String(10 + (index % 20)).padStart(2, "0")}\n---\n`]));
    const { host, done } = mount(many);
    try {
      await ready(host);
      expect(host.querySelectorAll(".base-tl-row")).toHaveLength(100);
      const more = [...host.querySelectorAll<HTMLButtonElement>(".base-body > button")].find((each) => each.textContent?.includes("1000"))!;
      more.click();
      expect(host.querySelectorAll(".base-tl-row")).toHaveLength(200);
    } finally { done(); }
  });

  it("senza la proprietà d'inizio lo dice, e offre le proprietà data delle note", async () => {
    const { host, done } = mount(NOTES, {});
    try {
      await vi.waitFor(() => expect(host.querySelector(".base-tl-empty")).not.toBeNull());
      expect(host.querySelector(".base-tl-empty p")!.textContent).toBe("Questa linea del tempo non sa ancora quale proprietà è il suo inizio.");
      expect([...host.querySelectorAll(".base-tl-start-key option:not([disabled])")].map((each) => each.textContent)).toEqual(["inizio", "fine"]);
    } finally { done(); }
  });
});
