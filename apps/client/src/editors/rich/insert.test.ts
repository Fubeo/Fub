// @vitest-environment happy-dom
//
// Ciò che si inserisce nella superficie ricca: link e salti di pagina e di
// colonna.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { linkAt, setLink } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, type Block, type Para, type TextInline } from "./projection";
import { mountStrip } from "./strip";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks }));
  engines.push(made);
  return made;
}

const para = (c: unknown[]): Block => ({ t: "para", role: { kind: "body" }, c }) as Block;

function at(e: RichEngine, needle: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

function texts(e: RichEngine): TextInline[] {
  const first = parseProjection(e.getDoc()).blocks[0] as Para;
  return (first.c ?? []).filter((inline): inline is TextInline => inline.t === "text");
}

describe("i link", () => {
  it("si mettono su una selezione, si cambiano dal cursore e si tolgono", () => {
    const e = engine([para([{ t: "text", x: "vai al sito adesso" }])]);
    const from = at(e, "sito");
    e.select(from, from + "sito".length);
    expect(e.apply(setLink("https://fub.app"))).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "vai al " },
      { t: "text", x: "sito", href: "https://fub.app" },
      { t: "text", x: " adesso" },
    ]);
    // Il cursore dentro il link lo trova tutto, e lo cambia tutto.
    e.select(from + 2);
    expect(e.read(linkAt)).toEqual({ href: "https://fub.app", from, to: from + 4 });
    expect(e.actionState("rich.link").active).toBe(true);
    expect(e.apply(setLink("https://fub.app/doc"))).toBe(true);
    expect(texts(e)[1]).toEqual({ t: "text", x: "sito", href: "https://fub.app/doc" });
    expect(e.run("rich.link.remove")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "vai al sito adesso" }]);
  });

  it("senza selezione scrivono il testo come link; un indirizzo che non è web no", () => {
    const e = engine([para([{ t: "text", x: "fine" }])]);
    e.select(at(e, "fine") + 4);
    expect(e.apply(setLink("javascript:alert(1)", "male"))).toBe(false);
    expect(e.apply(setLink("mailto:a@b.it", " scrivimi"))).toBe(true);
    expect(texts(e)).toEqual([
      { t: "text", x: "fine" },
      { t: "text", x: " scrivimi", href: "mailto:a@b.it" },
    ]);
  });

  it("Mod-k chiede l'indirizzo alla striscia, che lo scrive", () => {
    const e = engine([para([{ t: "text", x: "una parola" }])]);
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const from = at(e, "parola");
    e.select(from, from + "parola".length);
    expect(e.run("rich.link")).toBe(true);
    const address = document.querySelector<HTMLInputElement>(`#${CSS.escape(document.querySelector<HTMLLabelElement>("form label")!.htmlFor)}`)!;
    expect(document.querySelector("form label")?.textContent).toBe(t("rich.link.address"));
    // Un indirizzo sbagliato resta nel modulo e lo dice.
    address.value = "ftp://altrove";
    address.form!.requestSubmit();
    expect(document.querySelector<HTMLElement>("form [role=alert]")!.hidden).toBe(false);
    address.value = "https://fub.app";
    address.form!.requestSubmit();
    expect(texts(e)[1]).toEqual({ t: "text", x: "parola", href: "https://fub.app" });
    expect(document.querySelector("form")).toBeNull();
    strip.destroy();
    // Senza la striscia nessuno chiede: l'accordo non fa niente.
    expect(e.run("rich.link")).toBe(false);
  });
});

describe("i salti", () => {
  it("di pagina e di colonna sono foglie nel testo del paragrafo", () => {
    const e = engine([para([{ t: "text", x: "primadopo" }])]);
    e.select(at(e, "dopo"));
    expect(e.run("rich.break.page")).toBe(true);
    expect(e.run("rich.break.column")).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "prima\u000c\u000edopo" }]);
  });
});
