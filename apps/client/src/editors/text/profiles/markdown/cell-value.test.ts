// @vitest-environment happy-dom
// Il valore di una cella nel testo (E23, T53): `![[Conti.xlsx#Budget!C7]]` in
// mezzo a una frase è il valore della cella, col formato del foglio, e segue il
// file per eventi. Qui con un lettore finto che conta le letture, un ascolto
// finto che si fa scattare a mano e la Live vera in un editor vero.
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { computeDecorations, livePreview } from "./livepreview";
import { embedRangeAtLine, showEmbedAt } from "./live-cards";
import { openLifetime } from "../../../../ui/lifetime";
import {
  CellValues,
  cellShownAsValue,
  cellValueLook,
  cellValueRef,
  hostCellSlot,
  onlyCellValues,
  type CellReading,
  type CellValuePort,
} from "./cell-value";

/// Un lettore e un vault finti: `cells` dice il valore di ogni parte per file.
function fakePort(cells: Record<string, Record<string, CellReading>>, options: { reader?: boolean } = {}) {
  const reads: { path: string; parts: readonly string[] }[] = [];
  const watchers = new Map<string, Set<() => void>>();
  const opened: { path: string; subpath: string | null }[] = [];
  const port: CellValuePort = {
    load: async () => options.reader === false ? null : {
      read: async (path, parts) => {
        reads.push({ path, parts: [...parts] });
        const file = cells[path] ?? {};
        return new Map(parts.map((part) => [part, file[part] ?? { state: "lost" } as CellReading]));
      },
    },
    resolve: async (page) => (page in cells ? page : null),
    watch: (path, changed) => {
      const set = watchers.get(path) ?? new Set();
      set.add(changed);
      watchers.set(path, set);
      return () => set.delete(changed);
    },
    open: (path, subpath) => opened.push({ path, subpath }),
  };
  const fire = (path: string): void => {
    for (const changed of [...(watchers.get(path) ?? [])]) changed();
  };
  const watching = (path: string): number => watchers.get(path)?.size ?? 0;
  return { port, reads, opened, fire, watching };
}

const value = (text: string, extra: Partial<{ error: boolean; stale: boolean }> = {}): CellReading =>
  ({ state: "value", text, error: extra.error ?? false, stale: extra.stale ?? false });

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("quali embed sono una cella", () => {
  it("una cella sola di un foglio, col foglio o senza, in maiuscolo e senza $", () => {
    expect(cellValueRef("Conti.xlsx", "Budget!C7")).toEqual({ page: "Conti.xlsx", part: "Budget!C7", sheet: "Budget", cell: "C7" });
    expect(cellValueRef("Conti.xlsx", "'Conti 2025'!$b$2")).toMatchObject({ sheet: "Conti 2025", cell: "B2" });
    expect(cellValueRef("Conti.xlsx", "'L''anno'!A1")).toMatchObject({ sheet: "L'anno" });
    expect(cellValueRef("Conti.xlsx", "C7")).toMatchObject({ sheet: null, cell: "C7" });
    expect(cellValueRef("cartella/Conti.xlsm", "Foglio1!A1")).not.toBeNull();
  });

  it("non un intervallo, un nome, un foglio intero, un file che non è un foglio", () => {
    expect(cellValueRef("Conti.xlsx", "Budget!A1:C7")).toBeNull();
    expect(cellValueRef("Conti.xlsx", "Budget")).toBeNull();
    expect(cellValueRef("Conti.xlsx", "Totale")).toBeNull();
    expect(cellValueRef("Conti.xlsx", null)).toBeNull();
    expect(cellValueRef("Nota.md", "C7")).toBeNull();
    expect(cellValueRef("Contratto.pdf", "C7")).toBeNull();
  });

  it("oltre l'ultima colonna o l'ultima riga di Excel non è una cella", () => {
    expect(cellValueRef("Conti.xlsx", "XFD1048576")).not.toBeNull();
    expect(cellValueRef("Conti.xlsx", "XFE1")).toBeNull();
    expect(cellValueRef("Conti.xlsx", "A1048577")).toBeNull();
    expect(cellValueRef("Conti.xlsx", "A0")).toBeNull();
  });

  it("`|value` chiede il valore; un paragrafo di soli valori resta testo", () => {
    expect(cellShownAsValue("value")).toBe(true);
    expect(cellShownAsValue(" Value ")).toBe(true);
    expect(cellShownAsValue("row")).toBe(false);
    expect(cellShownAsValue(null)).toBe(false);
    expect(onlyCellValues("![[Conti.xlsx#Budget!C7|value]]")).toBe(true);
    expect(onlyCellValues("![[Conti.xlsx#Budget!C7]] ![[Conti.xlsx#Budget!B7]]")).toBe(true);
    // Da solo, senza `|value`, è la scheda di foglio (T43).
    expect(onlyCellValues("![[Conti.xlsx#Budget!C7]]")).toBe(false);
    expect(onlyCellValues("![[Conti.xlsx#Budget!C7]] ![[foto.png]]")).toBe(false);
  });
});

describe("ciò che si vede", () => {
  const ref = cellValueRef("cartella/Conti.xlsx", "Budget!C7")!;

  it("il valore col formato del foglio e da dove viene, col clic", () => {
    const look = cellValueLook(ref, value("2.520 €"));
    expect(look).toMatchObject({ text: "2.520 €", state: "value" });
    expect(look.title).toBe("Il valore viene da «Conti.xlsx», foglio Budget, cella C7: cambia quando cambia il foglio. Un clic apre il foglio su quella cella.");
    // In Lettura niente clic.
    expect(cellValueLook(ref, value("2.520 €"), false).title).not.toContain("clic");
    expect(cellValueLook(ref, value("2.520 €", { stale: true })).title).toContain("non l'ha ricalcolato");
  });

  it("l'errore di formula col suo segno, la cella vuota, il file mancante, la cella persa", () => {
    expect(cellValueLook(ref, value("#DIV/0!", { error: true }))).toMatchObject({ text: "#DIV/0!", state: "error" });
    expect(cellValueLook(ref, value("#DIV/0!", { error: true })).title).toContain("#DIV/0!");
    expect(cellValueLook(ref, { state: "empty" })).toMatchObject({ text: "—", state: "empty" });
    expect(cellValueLook(ref, { state: "missing" })).toMatchObject({ text: "Conti.xlsx › Budget!C7", state: "missing" });
    expect(cellValueLook(ref, { state: "missing" }).title).toContain("File mancante: Conti.xlsx");
    expect(cellValueLook(ref, { state: "lost" })).toMatchObject({ state: "lost" });
    expect(cellValueLook(ref, null)).toMatchObject({ text: "…", state: "loading" });
  });
});

describe("i valori seguono il file", () => {
  function store(cells: Record<string, Record<string, CellReading>>, options: { reader?: boolean } = {}) {
    const fake = fakePort(cells, options);
    const values = new CellValues({ port: fake.port, hostDoc: () => "Note.md" });
    cleanups.push(() => values.destroy());
    return { ...fake, values };
  }

  it("le celle di un file nello stesso giro vanno in una lettura; la stessa cella una volta", async () => {
    const { values, reads } = store({ "Conti.xlsx": { "Budget!C7": value("2.520 €"), "Budget!B7": value("4.000 €") } });
    const seen: (CellReading | null)[] = [];
    values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, (r) => seen.push(r));
    values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    const b7 = values.watch(cellValueRef("Conti.xlsx", "Budget!B7")!, () => {});
    await settle();
    expect(reads).toEqual([{ path: "Conti.xlsx", parts: ["Budget!C7", "Budget!B7"] }]);
    expect(seen).toEqual([value("2.520 €")]);
    expect(b7.current()).toEqual(value("4.000 €"));
  });

  it("cento valori in una nota: una lettura e un ascolto", async () => {
    const file: Record<string, CellReading> = {};
    for (let row = 1; row <= 100; row += 1) file[`Budget!C${row}`] = value(`${row} €`);
    const { values, reads, watching } = store({ "Conti.xlsx": file });
    for (let row = 1; row <= 100; row += 1) values.watch(cellValueRef("Conti.xlsx", `Budget!C${row}`)!, () => {});
    await settle();
    expect(reads).toHaveLength(1);
    expect(reads[0]!.parts).toHaveLength(100);
    expect(watching("Conti.xlsx")).toBe(1);
  });

  it("il valore cambia quando la cella cambia, per l'evento del file e mai a tempo", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
    try {
      const cells = { "Conti.xlsx": { "Budget!C7": value("2.520 €") } };
      const { values, reads, fire } = store(cells);
      const seen: (CellReading | null)[] = [];
      values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, (r) => seen.push(r));
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(reads).toHaveLength(1);
      // Il tempo passa: nessuna lettura in più.
      vi.advanceTimersByTime(60_000);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(reads).toHaveLength(1);
      cells["Conti.xlsx"]["Budget!C7"] = value("2.900 €");
      fire("Conti.xlsx");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(reads).toHaveLength(2);
      expect(seen).toEqual([value("2.520 €"), value("2.900 €")]);
      // Lo stesso valore riletto non avvisa di nuovo.
      fire("Conti.xlsx");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("il file mancante e il lettore che non c'è", async () => {
    const missing = store({});
    const a = missing.values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    await settle();
    expect(a.current()).toEqual({ state: "missing" });
    expect(missing.reads).toHaveLength(0);
    const none = store({ "Conti.xlsx": {} }, { reader: false });
    const b = none.values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    await settle();
    expect(b.current()).toEqual({ state: "unavailable" });
  });

  it("una lettura che fallisce è «non si legge», non un valore", async () => {
    const fake = fakePort({ "Conti.xlsx": {} });
    const port: CellValuePort = { ...fake.port, load: async () => ({ read: async () => { throw new Error("guasto"); } }) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const values = new CellValues({ port, hostDoc: () => "Note.md" });
    cleanups.push(() => values.destroy());
    const watch = values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    await settle();
    expect(watch.current()).toEqual({ state: "unavailable" });
    warn.mockRestore();
  });

  it("l'ultimo che smette spegne l'ascolto del file; una risposta vecchia non vale", async () => {
    const { values, watching, reads } = store({ "Conti.xlsx": { "Budget!C7": value("1") } });
    const one = values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    const two = values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, () => {});
    await settle();
    expect(watching("Conti.xlsx")).toBe(1);
    one.stop();
    expect(watching("Conti.xlsx")).toBe(1);
    two.stop();
    expect(watching("Conti.xlsx")).toBe(0);
    // Smesso prima della risposta: niente avviso.
    const listener = vi.fn();
    const late = values.watch(cellValueRef("Conti.xlsx", "Budget!C7")!, listener);
    late.stop();
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(reads).toHaveLength(1);
  });

  it("il clic apre il file risolto alla parte", async () => {
    const { values, opened } = store({ "Conti.xlsx": {} });
    values.open(cellValueRef("Conti.xlsx", "Budget!C7")!);
    values.open(cellValueRef("Altro.xlsx", "C7")!);
    await settle();
    expect(opened).toEqual([{ path: "Conti.xlsx", subpath: "#Budget!C7" }]);
  });
});

describe("nella Scrittura", () => {
  const NOTE = "Finora abbiamo speso ![[Conti.xlsx#Budget!C7]] su ![[Conti.xlsx#Budget!B7]] previsti.\n\nAltro.\n";

  function stateOf(doc: string, cursor = doc.length): EditorState {
    return EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownGrammar })] });
  }

  it("in mezzo alla frase è un valore; senza la porta e col cursore dentro resta l'embed", () => {
    const state = stateOf(NOTE);
    const kinds = (cells: boolean, active: Set<number>) => computeDecorations(state, active, 0, state.doc.length, undefined, cells)
      .filter((d) => d.kind === "cell-value").map((d) => d.data);
    expect(kinds(true, new Set())).toEqual(["Conti.xlsx#Budget!C7", "Conti.xlsx#Budget!B7"]);
    expect(kinds(false, new Set())).toEqual([]);
    expect(kinds(true, new Set([1]))).toEqual([]);
  });

  it("da solo nel paragrafo è la scheda, a meno di `|value`; un intervallo non è un valore", () => {
    const decorate = (doc: string) => computeDecorations(stateOf(doc), new Set(), 0, doc.length, undefined, true)
      .filter((d) => d.kind === "cell-value");
    expect(decorate("![[Conti.xlsx#Budget!C7]]\n\nAltro.\n")).toHaveLength(0);
    expect(decorate("![[Conti.xlsx#Budget!C7|value]]\n\nAltro.\n")).toHaveLength(1);
    expect(decorate("Totale ![[Conti.xlsx#Budget!A1:C7]] qui.\n")).toHaveLength(0);
  });

  it("il valore si vede nel testo, cambia col file e il clic apre il foglio sulla cella", async () => {
    const cells = { "Conti.xlsx": { "Budget!C7": value("2.520 €"), "Budget!B7": value("4.000 €") } };
    const fake = fakePort(cells);
    const values = new CellValues({ port: fake.port, hostDoc: () => "Note.md" });
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {}, cellValues: values })],
    });
    cleanups.push(() => {
      engine.destroy();
      values.destroy();
      parent.remove();
    });
    engine.setDoc(NOTE);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await settle();
    const shown = () => [...parent.querySelectorAll<HTMLElement>(".cm-fub-cell-value")];
    expect(shown().map((el) => el.textContent)).toEqual(["2.520 €", "4.000 €"]);
    expect(shown()[0]!.dataset.cellState).toBe("value");
    expect(shown()[0]!.title).toContain("foglio Budget, cella C7");
    expect(parent.textContent).not.toContain("![[");
    cells["Conti.xlsx"]["Budget!C7"] = value("#DIV/0!", { error: true });
    fake.fire("Conti.xlsx");
    await settle();
    expect(shown()[0]!.textContent).toBe("#DIV/0!");
    expect(shown()[0]!.dataset.cellState).toBe("error");
    shown()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await settle();
    expect(fake.opened).toEqual([{ path: "Conti.xlsx", subpath: "#Budget!C7" }]);
    // Il documento non è cambiato.
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("«Mostra come» → «Valore nel testo» scrive `|value`, e «Scheda» lo toglie", () => {
    const doc = "![[Conti.xlsx#Budget!C7]]\n";
    const state = stateOf(doc, 0);
    const range = embedRangeAtLine(state, 0)!;
    const asValue = state.update(showEmbedAt(state, range, "value")!).state;
    expect(asValue.doc.toString()).toBe("![[Conti.xlsx#Budget!C7|value]]\n");
    const back = asValue.update(showEmbedAt(asValue, embedRangeAtLine(asValue, 0)!, "card")!).state;
    expect(back.doc.toString()).toBe(doc);
    const link = asValue.update(showEmbedAt(asValue, embedRangeAtLine(asValue, 0)!, "link")!).state;
    expect(link.doc.toString()).toBe("[[Conti.xlsx#Budget!C7]]\n");
    // Un intervallo non si mostra come valore.
    const range2 = stateOf("![[Conti.xlsx#Budget!A1:C7]]\n", 0);
    expect(showEmbedAt(range2, embedRangeAtLine(range2, 0)!, "value")).toBeNull();
  });
});

describe("in Lettura", () => {
  it("l'embed reso di una cella è testo come il resto, e segue il file", async () => {
    const cells = { "Conti.xlsx": { "Budget!C7": value("2.520 €") } };
    const fake = fakePort(cells);
    const values = new CellValues({ port: fake.port, hostDoc: () => "Note.md" });
    cleanups.push(() => values.destroy());
    const slot = document.createElement("span");
    slot.className = "embed";
    slot.dataset.embedPage = "Conti.xlsx";
    slot.dataset.embedHeading = "Budget!C7";
    const life = openLifetime();
    expect(hostCellSlot(slot, life, values)).toBe(true);
    await settle();
    expect(slot.textContent).toBe("2.520 €");
    expect(slot.classList.contains("fub-cell-value")).toBe(true);
    expect(slot.title).not.toContain("clic");
    life.close();
    expect(fake.watching("Conti.xlsx")).toBe(0);
    const other = document.createElement("span");
    other.dataset.embedPage = "Nota.md";
    other.dataset.embedHeading = "Titolo";
    expect(hostCellSlot(other, openLifetime(), values)).toBe(false);
  });
});
