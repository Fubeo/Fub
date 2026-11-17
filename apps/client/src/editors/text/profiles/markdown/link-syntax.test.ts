// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { decodeDestination, decodeEntities, decodeNamedEntity, escapeLinkLabel, linkDestination, normalizeLabel, routeHref } from "./link-syntax";
import { renderMarkdown } from "./render";

describe("le entità", () => {
  it("le nominate si risolvono dalla tabella, senza mai toccare il DOM", () => {
    const created = vi.spyOn(document, "createElement");
    try {
      for (const text of ["&amp;&lt;", "&rarr;<b>x</b>", "<img src=x onerror=alert(1)>", "&rarr", "rarr;", " &rarr;"]) {
        expect(decodeNamedEntity(text)).toBe(text);
      }
      expect(decodeNamedEntity("&amp;")).toBe("&");
      expect(decodeNamedEntity("&rarr;")).toBe("→");
      expect(decodeNamedEntity("&NotNestedGreaterGreater;")).toBe("⪢̸");
      expect(decodeNamedEntity("&CounterClockwiseContourIntegral;")).toBe("∳");
      expect(created).not.toHaveBeenCalled();
    } finally {
      created.mockRestore();
    }
  });

  it("comuni, rare e a due caratteri", () => {
    expect(decodeEntities("&copy; &eacute; &nbsp; &hellip; &mdash; &euro; &Auml;")).toBe("© é   … — € Ä");
    expect(decodeEntities("&ngE; &fjlig; &bne; &Fopf; &ThickSpace;")).toBe("≧̸ fj =⃥ 𝔽   ");
    expect(decodeEntities("&Tab;&NewLine;&quot;&apos;&bsol;")).toBe("\t\n\"'\\");
  });

  it("le numeriche, con U+FFFD per lo zero e per ciò che non è un carattere", () => {
    expect(decodeEntities("&#x41;&#66;&#X1F600;&#128512;")).toBe("AB\u{1F600}\u{1F600}");
    expect(decodeEntities("&#0; &#xD800; &#x110000; &#1114112;")).toBe("� � � �");
    // Oltre 7 cifre decimali o 6 esadecimali non è un riferimento (CommonMark).
    expect(decodeEntities("&#12345678; &#x1234567;")).toBe("&#12345678; &#x1234567;");
  });

  it("le non valide restano testo: senza `;`, nomi ignoti, prototipo, maiuscole sbagliate", () => {
    for (const text of ["&amp", "&copy", "&ignota;", "&constructor;", "&__proto__;", "&toString;", "&hasOwnProperty;", "&AMp;", "&RARR;", "& amp;", "&#;", "&#x;", "&;"]) {
      expect(decodeEntities(text)).toBe(text);
    }
    expect(decodeEntities("a&amp;b &rarr; &#x41;&#66; &ignota; &#0;")).toBe("a&b → AB &ignota; �");
  });

  it("una destinazione scioglie anche le rare", () => {
    expect(decodeDestination("<https://e.it/?a=1&NotNestedGreaterGreater;b>")).toBe("https://e.it/?a=1⪢̸b");
  });

  it("il modulo non passa più dal DOM per le entità", async () => {
    const source = (await import("./link-syntax.ts?raw")).default;
    expect(source).not.toMatch(/innerHTML|createElement|DOMParser|textarea/);
  });
});

/// Il testo e l'indirizzo del primo link della resa.
function rendered(markdown: string): { text: string; href: string | null } | null {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(markdown).html;
  const link = root.querySelector("a");
  return link ? { text: link.textContent ?? "", href: link.getAttribute("href") } : null;
}

describe("le etichette dei link", () => {
  it("tutta la selezione diventa l'etichetta, parentesi comprese (D02)", () => {
    for (const text of ["a[b", "a]b", "[a]", "a\\", "a\\b", "a\\[b"]) {
      const visible = text === "a\\[b" ? "a[b" : text;
      expect(rendered(`[${escapeLinkLabel(text)}](https://example.com)`)).toEqual({ text: visible, href: "https://example.com" });
    }
  });

  it("lascia com'è il codice inline e la formattazione già scritta", () => {
    expect(escapeLinkLabel("`a[b` e **c]**")).toBe("`a[b` e **c\\]**");
    expect(rendered(`[${escapeLinkLabel("`a]b` **c**")}](/x)`)).toEqual({ text: "a]b c", href: "/x" });
  });
});

describe("le destinazioni dei link", () => {
  it("una parentesi nell'indirizzo resta nell'indirizzo (D25)", () => {
    for (const url of ["https://example.com/a)", "https://it.wikipedia.org/wiki/F_(x)", "mailto:a@b.it?subject=(x)", "https://x.it/a%29"]) {
      const href = rendered(`[a](${linkDestination(url)})`)?.href;
      expect(href).not.toBeNull();
      expect(decodeURI(href!.replace(/%28/g, "(").replace(/%29/g, ")"))).toBe(decodeURI(url.replace(/%29/g, ")")));
    }
    expect(linkDestination("https://x.it/a%29")).toBe("https://x.it/a%29");
  });

  it("si rilegge senza parentesi angolari, escape ed entità", () => {
    expect(decodeDestination("<La mia nota.md>")).toBe("La mia nota.md");
    expect(decodeDestination("a\\(b\\)&amp;c")).toBe("a(b)&c");
    expect(decodeDestination("a\\b")).toBe("a\\b");
  });
});

describe("le etichette dei riferimenti", () => {
  it("si confrontano col case folding di CommonMark (D16)", () => {
    expect(normalizeLabel("ẞ")).toBe(normalizeLabel("SS"));
    expect(normalizeLabel("Straße")).toBe(normalizeLabel("STRASSE"));
    expect(normalizeLabel("  a \t b ")).toBe(normalizeLabel("A B"));
    expect(rendered("[ẞ]\n\n[SS]: /url\n")).toEqual({ text: "ẞ", href: "/url" });
    expect(rendered("[x][Straße]\n\n[STRASSE]: /a\n")).toEqual({ text: "x", href: "/a" });
  });
});

describe("dove porta un href", () => {
  it("separa ancore, pagine web, altri schemi e percorsi del vault (D15)", () => {
    expect(routeHref("#sezione")).toEqual({ kind: "fragment", id: "sezione" });
    expect(routeHref("https://a.it")).toEqual({ kind: "web" });
    expect(routeHref("mailto:a@b.it")).toEqual({ kind: "system" });
    expect(routeHref("capitolo.md")).toEqual({ kind: "path", path: "capitolo.md" });
    expect(routeHref("../Su%20di%20me.md#x")).toEqual({ kind: "path", path: "../Su di me.md#x" });
  });
});

describe("i link della resa", () => {
  it("una destinazione inline vuota è un href vuoto, anche con una definizione omonima (D22)", () => {
    expect(rendered("[x]()")).toEqual({ text: "x", href: "" });
    expect(rendered("[x]()\n\n[x]: /ref\n")).toEqual({ text: "x", href: "" });
    expect(rendered("[x](<>)")).toEqual({ text: "x", href: "" });
    expect(rendered("[x]\n\n[x]: /ref\n")).toEqual({ text: "x", href: "/ref" });
  });

  it("l'ancora di un titolo nasce dal testo che mostra (D03)", () => {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown("[Vai](#guida)\n\n# [Guida](https://example.com)\n\n## *Uno* `due` &amp; [[Nota|tre]]\n\n# Guida\n").html;
    expect(Array.from(root.querySelectorAll("h1, h2"), (heading) => heading.id.replace(/^.*?(?=guida|uno)/, ""))).toEqual(["guida", "uno-due-tre", "guida-1"]);
  });
});
