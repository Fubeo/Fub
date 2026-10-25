// @vitest-environment happy-dom
//
// Le tinte del file sulla carta adattata: ogni colore del documento passa
// dalla funzione comune della shell (`theme/adapt.ts`), come decorazione, e il
// documento resta com'è.
import { afterEach, describe, expect, it } from "vitest";
import { undoDepth } from "prosemirror-history";
import { adapter, type Paper } from "../../theme/adapt";
import { RichEngine } from "./engine";
import type { Block } from "./projection";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

/// La carta adattata della prova in 09.
const NIGHT: Paper = { bg: "#1c2129", ink: "#e3e6eb" };

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, f: { font: "Calibri", size: 11 }, blocks }));
  engines.push(made);
  return made;
}

const para = (c: unknown[], f?: object, role: object = { kind: "body" }): Block =>
  ({ t: "para", role, ...(f ? { f } : {}), c }) as Block;

function tintOf(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".rich-tint")].find((span) => span.textContent === text);
}

const DOC: readonly Block[] = [
  para([
    { t: "text", x: "collegamento", f: { color: "#467886" } },
    { t: "text", x: " automatico " },
    { t: "text", x: "evidenziato", m: ["h"], f: { hl: "#00ff00" } },
  ]),
  para([{ t: "text", x: "Titolo rosso" }], { size: 20, color: "#ff0000" }, { kind: "heading", level: 1 }),
];

describe("le tinte della carta adattata", () => {
  it("senza carta non c'è niente: i colori restano quelli del file", () => {
    engine(DOC);
    expect(document.querySelector(".rich-tint, .rich-tinted")).toBeNull();
  });

  it("ogni colore del file passa dalla funzione comune, con la soglia del suo testo", () => {
    const e = engine(DOC);
    e.setPaper(NIGHT);
    const paint = adapter(NIGHT);
    const link = tintOf("collegamento")!;
    expect(link.style.getPropertyValue("--file-color-a")).toBe(paint.color("#467886", "text"));
    expect(link.hasAttribute("data-tint-color")).toBe(true);
    // Il testo automatico è l'inchiostro della carta: non si adatta.
    expect(tintOf(" automatico ")).toBeUndefined();
    // L'evidenziato: prima il fondo rispetto alla carta, poi il testo
    // (automatico, cioè nero sul bianco) rispetto al fondo nuovo.
    const marked = tintOf("evidenziato")!;
    const pair = paint.pair("#00ff00", "#000000", "text");
    expect(marked.style.getPropertyValue("--file-hl-a")).toBe(pair.fill);
    expect(marked.style.getPropertyValue("--file-color-a")).toBe(pair.text);
    // Il colore di un paragrafo sta sul paragrafo, e un titolo da 20 pt è
    // testo grande: la soglia è 3:1.
    const heading = document.querySelector<HTMLElement>(".rich-heading")!;
    expect(heading.classList.contains("rich-tinted")).toBe(true);
    expect(heading.style.getPropertyValue("--file-color-a")).toBe(paint.color("#ff0000", "large"));
    // Il documento non cambia: i valori del file restano accanto.
    expect(e.getDoc()).not.toContain("file-color-a");
    expect(link.closest<HTMLElement>("[data-rich-color]")!.style.getPropertyValue("--file-color")).toBe("#467886");
  });

  it("si ridipinge ciò che cambia, e tolta la carta le tinte se ne vanno", () => {
    const e = engine(DOC);
    e.setPaper(NIGHT);
    const before = e.state;
    // Una carta uguale non rifà niente.
    e.setPaper({ ...NIGHT });
    expect(e.state).toBe(before);
    const end = e.state.doc.child(0).nodeSize - 1;
    e.apply((state, dispatch) => {
      dispatch?.(state.tr.insertText("!", end));
      return true;
    });
    expect(tintOf("collegamento")).toBeDefined();
    expect(tintOf("evidenziato!")).toBeDefined();
    e.setPaper(null);
    expect(document.querySelector(".rich-tint, .rich-tinted")).toBeNull();
  });

  it("cambiare carta non entra nella cronologia", () => {
    const e = engine(DOC);
    e.setPaper(NIGHT);
    e.setPaper({ bg: "#ffffff", ink: "#14161a" });
    expect(undoDepth(e.state)).toBe(0);
  });
});
