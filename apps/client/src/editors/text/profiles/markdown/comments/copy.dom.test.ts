// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { carriedMarkdown, FUB_MARKDOWN_TYPE, rememberCut } from "./copy";

const CUT = { plain: "passo", markdown: "{==passo==}{>>@Anna 2026-11-08: va riscritto<<}" };

/// Gli appunti di un incolla, coi tipi dati.
function clipboard(types: Record<string, string>): DataTransfer {
  return { getData: (type: string) => types[type] ?? "" } as unknown as DataTransfer;
}

/// Gli appunti che il Taglia del menu scrive: testo semplice e HTML, senza il
/// tipo di Fub.
const fromMenu = (plain = CUT.plain) => clipboard({ "text/plain": plain, "text/html": `<p>${plain}</p>` });

describe("il taglio ricordato per l'incolla dal menu", () => {
  afterEach(() => rememberCut(null));

  it("riporta il commento se gli appunti hanno proprio il testo tagliato", () => {
    rememberCut(CUT);
    expect(carriedMarkdown(fromMenu())).toBe(CUT.markdown);
    expect(carriedMarkdown(fromMenu())).toBe(CUT.markdown);
    // «Incolla come testo» non ha l'HTML: il testo semplice e basta.
    expect(carriedMarkdown(clipboard({ "text/plain": CUT.plain }))).toBeNull();
  });

  it("si dimentica quando la finestra perde il focus", () => {
    rememberCut(CUT);
    window.dispatchEvent(new Event("blur"));
    expect(carriedMarkdown(fromMenu())).toBeNull();
  });

  it("si dimentica quando la pagina si nasconde, non quando torna a vista", () => {
    rememberCut(CUT);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(carriedMarkdown(fromMenu())).toBe(CUT.markdown);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(document.visibilityState).not.toBe("hidden");
    expect(carriedMarkdown(fromMenu())).toBeNull();
  });

  it("un incolla con un altro testo lo dimentica: lo stesso testo copiato dopo da un'altra app resta testo", () => {
    rememberCut(CUT);
    expect(carriedMarkdown(fromMenu("altro"))).toBeNull();
    expect(carriedMarkdown(fromMenu())).toBeNull();
  });

  it("il tipo di Fub vale sempre, anche senza un taglio ricordato", () => {
    expect(carriedMarkdown(clipboard({ [FUB_MARKDOWN_TYPE]: CUT.markdown, "text/plain": CUT.plain }))).toBe(CUT.markdown);
  });
});
