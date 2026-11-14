// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { READER_LINE, excerptIndexes, keysWith, openReader, readerSections, readerTitleSection, splitSections, type ReaderCloseReason, type ReaderPort } from "./reader";

/// La nota delle prove: il titolo, quattro sezioni, una sotto «Calcoli».
const HEADINGS = [
  { level: 1, text: "Relazione" },
  { level: 2, text: "Scopo" },
  { level: 2, text: "Misure" },
  { level: 2, text: "Calcoli" },
  { level: 3, text: "Il periodo" },
  { level: 2, text: "Errori" },
];

/// La resa finta: i titoli e un paragrafo sotto ognuno, uno accanto all'altro
/// come li dà `renderEmbed`, più un paragrafo prima del primo titolo.
function fakeHtml(host: HTMLElement): void {
  const root = document.createElement("div");
  root.className = "markdown-rendered";
  const intro = document.createElement("p");
  intro.textContent = "Prima dei titoli.";
  root.append(intro);
  for (const heading of HEADINGS) {
    const h = document.createElement(`h${heading.level}`);
    h.textContent = heading.text;
    const p = document.createElement("p");
    p.textContent = `Testo di ${heading.text}.`;
    root.append(h, p);
  }
  host.append(root);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("le regole del lettore", () => {
  const sections = readerSections(HEADINGS);
  const byText = (text: string) => sections.find((section) => section.text === text)!;

  it("il titolo della nota non rientra fra i titoli a lato; i sottotitoli sì", () => {
    expect(readerTitleSection(sections)?.text).toBe("Relazione");
    expect(sections.map((section) => [section.text, section.depth])).toEqual([
      ["Relazione", 1], ["Scopo", 1], ["Misure", 1], ["Calcoli", 1], ["Il periodo", 2], ["Errori", 1],
    ]);
    // Senza un titolo solo in testa i livelli restano.
    const flat = readerSections([{ level: 2, text: "A" }, { level: 2, text: "B" }, { level: 3, text: "C" }]);
    expect(readerTitleSection(flat)).toBeNull();
    expect(flat.map((section) => section.depth)).toEqual([1, 1, 2]);
  });

  it("l'estratto segna le sue sezioni e i loro sottotitoli; una chiave col capitolo trova il titolo", () => {
    const inside = excerptIndexes(sections, ["Relazione#Misure", "Calcoli"]);
    expect([...inside].map((index) => sections.find((section) => section.index === index)!.text).sort())
      .toEqual(["Calcoli", "Il periodo", "Misure"]);
    expect(excerptIndexes(sections, ["Non c'è"]).size).toBe(0);
  });

  it("una sezione aggiunta va al suo posto nella nota; le chiavi di prima restano com'erano", () => {
    expect(keysWith(sections, ["Relazione#Misure", "Errori"], byText("Calcoli"))).toEqual(["Relazione#Misure", "Calcoli", "Errori"]);
    expect(keysWith(sections, ["Misure"], byText("Scopo"))).toEqual(["Scopo", "Misure"]);
    expect(keysWith(sections, ["Misure"], byText("Errori"))).toEqual(["Misure", "Errori"]);
    // Una chiave che la nota non ha più resta, in coda.
    expect(keysWith(sections, ["Sparita", "Misure"], byText("Errori"))).toEqual(["Sparita", "Misure", "Errori"]);
    // Già dentro (un sottotitolo di una sezione scelta): niente cambia.
    expect(keysWith(sections, ["Calcoli"], byText("Il periodo"))).toEqual(["Calcoli"]);
  });

  it("la resa si divide in una sezione per titolo, col testo che viene prima in una sezione senza titolo", () => {
    const page = document.createElement("article");
    fakeHtml(page);
    const blocks = splitSections(page, sections);
    expect(blocks.map((block) => block.dataset.section ?? null)).toEqual([null, "Relazione", "Scopo", "Misure", "Calcoli", "Il periodo", "Errori"]);
    expect(blocks[3]!.textContent).toBe("MisureTesto di Misure.");
    expect(page.querySelectorAll(".markdown-rendered > section.canvas-reader-section")).toHaveLength(7);
    // Una resa senza titoli è una sezione sola.
    const plain = document.createElement("article");
    plain.innerHTML = "<p>Solo testo.</p>";
    expect(splitSections(plain, sections)).toHaveLength(1);
  });
});

describe("il lettore", () => {
  interface Made {
    readonly host: HTMLElement;
    readonly reader: ReturnType<typeof openReader>;
    readonly added: (readonly string[])[];
    readonly closes: ReaderCloseReason[];
    readonly port: ReaderPort & { changed: () => void; shows: number };
    readonly lifetime: Lifetime;
  }

  function open(excerpt: readonly string[] = ["Misure", "Calcoli"], writable = true, show?: ReaderPort["show"]): Made {
    const host = document.createElement("div");
    host.className = "canvas-area";
    const viewport = document.createElement("button");
    host.append(viewport);
    document.body.append(host);
    viewport.focus();
    const added: (readonly string[])[] = [];
    const closes: ReaderCloseReason[] = [];
    const port = {
      shows: 0,
      changed: () => {},
      outline: async () => HEADINGS,
      show: show ?? (async (_path: string, heading: string | null, target: HTMLElement) => {
        port.shows++;
        expect(heading).toBeNull();
        fakeHtml(target);
      }),
      watch: (_path: string, changed: () => void) => {
        port.changed = changed;
        return () => {
          port.changed = () => {};
        };
      },
    };
    const lifetime = openLifetime();
    const reader = openReader({
      host,
      path: "Note/Relazione.md",
      excerpt,
      writable,
      port,
      onAdd: (keys) => added.push(keys),
      onClose: (reason) => closes.push(reason),
      lifetime,
    });
    return { host, reader, added, closes, port, lifetime };
  }

  const docOf = (made: Made) => made.reader.element.querySelector<HTMLElement>(".canvas-reader-doc")!;
  const blockOf = (made: Made, key: string) => made.reader.element.querySelector<HTMLElement>(`.canvas-reader-section[data-section="${key}"]`)!;
  const rowOf = (made: Made, text: string) =>
    [...made.reader.element.querySelectorAll<HTMLElement>(".canvas-reader-outline-row")].find((row) => row.textContent === text)!;
  const key = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  /** Mette le sezioni in colonna, alte 100 px, sotto la cima della nota. */
  function laidOut(made: Made, height = 300): void {
    const doc = docOf(made);
    Object.defineProperty(doc, "clientHeight", { configurable: true, value: height });
    Object.defineProperty(doc, "scrollHeight", { configurable: true, value: 2000 });
    vi.spyOn(doc, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 600, height));
    const blocks = [...made.reader.element.querySelectorAll<HTMLElement>(".canvas-reader-section")];
    blocks.forEach((block, at) => {
      vi.spyOn(block, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, at * 100 - doc.scrollTop, 600, 100));
    });
  }

  it("è un dialogo sopra l'area della lavagna, col fuoco dentro, il nome e le parti", async () => {
    const made = open();
    await made.reader.ready;
    const root = made.reader.element;
    expect(root.parentElement).toBe(made.host);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(root.getAttribute("aria-labelledby")!)!.textContent).toBe("Relazione§ Misure · § Calcoli");
    expect(root.contains(document.activeElement)).toBe(true);
    expect(root.querySelector(".canvas-reader-hint")!.textContent).toBe(t("canvas.reader.back"));
    expect(root.querySelector(".canvas-parts-close")!.getAttribute("aria-label")).toBe(t("canvas.reader.close"));
    made.lifetime.close();
    expect(root.isConnected).toBe(false);
    expect(made.closes).toEqual(["closed"]);
  });

  it("le sezioni dell'estratto sono segnate nella nota e a lato, coi loro sottotitoli; il titolo della nota non sta a lato", async () => {
    const made = open(["Misure", "Calcoli"]);
    await made.reader.ready;
    const marked = [...made.reader.element.querySelectorAll<HTMLElement>(".canvas-reader-section[data-in-excerpt]")].map((one) => one.dataset.section);
    expect(marked).toEqual(["Misure", "Calcoli", "Il periodo"]);
    const rows = [...made.reader.element.querySelectorAll<HTMLElement>(".canvas-reader-outline-row")];
    expect(rows.map((row) => row.textContent)).toEqual(["Scopo", "Misure", "Calcoli", "Il periodo", "Errori"]);
    expect(rows.filter((row) => row.hasAttribute("data-in-excerpt")).map((row) => row.textContent)).toEqual(["Misure", "Calcoli", "Il periodo"]);
    expect(rowOf(made, "Il periodo").dataset.depth).toBe("2");
    // La nota è intera: anche ciò che sta fuori dall'estratto.
    expect(docOf(made).textContent).toContain("Testo di Errori.");
    expect(made.port.shows).toBe(1);
    made.reader.close();
  });

  it("la prima sezione dell'estratto è già in vista, ed è quella dove si legge", async () => {
    const made = open(["Calcoli"]);
    // Le misure servono prima della resa: la colonna è lì appena le sezioni nascono.
    const doc = docOf(made);
    vi.spyOn(doc, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 600, 300));
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const at = [...doc.querySelectorAll(".canvas-reader-section")].indexOf(this);
      return new DOMRect(0, at * 100 - doc.scrollTop, 600, 100);
    });
    await made.reader.ready;
    // «Calcoli» è la quinta sezione (dopo il testo di testa): 400 px meno lo spazio sopra.
    expect(doc.scrollTop).toBe(400 - 24);
    expect(blockOf(made, "Calcoli").hasAttribute("data-current")).toBe(true);
    expect(rowOf(made, "Calcoli").getAttribute("aria-current")).toBe("true");
    rects.mockRestore();
    made.reader.close();
  });

  it("le frecce, PgSu e PgGiù scorrono tutta la nota; un titolo a lato porta alla sua sezione", async () => {
    const made = open(["Misure"]);
    await made.reader.ready;
    laidOut(made);
    const doc = docOf(made);
    doc.scrollTop = 0;
    key(doc, { key: "ArrowDown" });
    expect(doc.scrollTop).toBe(READER_LINE);
    key(doc, { key: "ArrowUp" });
    expect(doc.scrollTop).toBe(0);
    key(doc, { key: "PageDown" });
    expect(doc.scrollTop).toBe(270);
    key(doc, { key: "PageUp" });
    expect(doc.scrollTop).toBe(0);
    // Anche dai titoli a lato le frecce scorrono la nota.
    key(rowOf(made, "Scopo"), { key: "ArrowDown" });
    expect(doc.scrollTop).toBe(READER_LINE);
    rowOf(made, "Errori").click();
    expect(doc.scrollTop).toBe(600 - 24);
    expect(blockOf(made, "Errori").hasAttribute("data-current")).toBe(true);
    expect(rowOf(made, "Errori").getAttribute("aria-current")).toBe("true");
    made.reader.close();
  });

  it("una sezione fuori dall'estratto, dove si legge, si aggiunge con Invio o «+ Aggiungi all'estratto»", async () => {
    const made = open(["Misure", "Errori"]);
    await made.reader.ready;
    laidOut(made);
    // Dove si legge una sezione dell'estratto: niente pulsante, e Invio non fa niente.
    rowOf(made, "Misure").click();
    expect(made.reader.element.querySelector(".canvas-reader-add")).toBeNull();
    key(docOf(made), { key: "Enter" });
    expect(made.added).toEqual([]);
    rowOf(made, "Calcoli").click();
    const add = blockOf(made, "Calcoli").querySelector<HTMLButtonElement>(":scope > .canvas-reader-add")!;
    expect(add.textContent).toBe(t("canvas.reader.add"));
    expect(add.getAttribute("aria-keyshortcuts")).toBe("Enter");
    key(docOf(made), { key: "Enter" });
    expect(made.added).toEqual([["Misure", "Calcoli", "Errori"]]);
    add.click();
    expect(made.added).toHaveLength(2);
    // Il puntatore sopra una sezione la fa quella dove si legge.
    blockOf(made, "Scopo").querySelector("p")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(blockOf(made, "Scopo").querySelector(".canvas-reader-add")).not.toBeNull();
    // La tela scrive e il lettore si aggiorna: «Scopo» è nell'estratto, il pulsante se ne va.
    made.reader.update({ excerpt: ["Scopo", "Misure", "Errori"], writable: true });
    expect(blockOf(made, "Scopo").hasAttribute("data-in-excerpt")).toBe(true);
    expect(made.reader.element.querySelector(".canvas-reader-add")).toBeNull();
    expect(made.reader.element.querySelector(".canvas-excerpt-parts")!.textContent).toBe("§ Scopo · § Misure · § Errori");
    made.reader.close();
  });

  it("in sola lettura, o su una nota intera, si legge e basta", async () => {
    const readOnly = open(["Misure"], false);
    await readOnly.reader.ready;
    laidOut(readOnly);
    rowOf(readOnly, "Errori").click();
    key(docOf(readOnly), { key: "Enter" });
    expect(readOnly.reader.element.querySelector(".canvas-reader-add, .canvas-reader-section[data-current]")).toBeNull();
    expect(readOnly.added).toEqual([]);
    readOnly.reader.close();
    const whole = open([], true);
    await whole.reader.ready;
    laidOut(whole);
    rowOf(whole, "Errori").click();
    key(docOf(whole), { key: "Enter" });
    expect(whole.reader.element.querySelector(".canvas-reader-add, .canvas-reader-section[data-in-excerpt], .canvas-reader-section[data-current]")).toBeNull();
    // A lato si vede ancora dove si legge.
    expect(rowOf(whole, "Errori").getAttribute("aria-current")).toBe("true");
    expect(whole.reader.element.querySelector<HTMLElement>(".canvas-excerpt-parts")!.hidden).toBe(true);
    expect(whole.added).toEqual([]);
    whole.reader.close();
  });

  it("Esc o Spazio chiudono; Spazio su un pulsante è il suo clic, una volta sola", async () => {
    const made = open();
    await made.reader.ready;
    const row = rowOf(made, "Scopo");
    row.focus();
    const onRow = key(row, { key: " " });
    expect(onRow.defaultPrevented).toBe(false);
    expect(made.closes).toEqual([]);
    const space = key(docOf(made), { key: " " });
    expect(space.defaultPrevented).toBe(true);
    expect(made.closes).toEqual(["back"]);
    expect(made.reader.element.isConnected).toBe(false);
    const again = open();
    await again.reader.ready;
    key(docOf(again), { key: "Escape" });
    expect(again.closes).toEqual(["back"]);
    const third = open();
    third.reader.element.querySelector<HTMLButtonElement>(".canvas-parts-close")!.click();
    expect(third.closes).toEqual(["back"]);
  });

  it("la nota cambiata da un riquadro si rende di nuovo; tolta dal vault, il lettore si chiude", async () => {
    let gone = false;
    let text = "Testo di Misure.";
    const made = open(["Misure"], true, async (_path, _heading, target) => {
      if (gone) throw { kind: "not_found", message: "manca" };
      fakeHtml(target);
      target.querySelector("h2 + p")!.textContent = text;
    });
    await made.reader.ready;
    expect(docOf(made).textContent).toContain("Testo di Misure.");
    text = "Misure nuove.";
    made.port.changed();
    await vi.waitFor(() => expect(docOf(made).textContent).toContain("Misure nuove."));
    expect(blockOf(made, "Misure").hasAttribute("data-in-excerpt")).toBe(true);
    gone = true;
    made.port.changed();
    await vi.waitFor(() => expect(made.closes).toEqual(["missing"]));
    expect(made.reader.element.isConnected).toBe(false);
  });
});
