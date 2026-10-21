// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { decodeDestination, escapeLinkLabel, linkDestination, normalizeLabel, routeHref } from "./link-syntax";
import { renderMarkdown } from "./render";

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
