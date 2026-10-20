import { describe, expect, it } from "vitest";
import { looksLikeWebShortcut, webShortcut } from "./web-shortcut";

const WEBLOC = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>URL</key>
\t<string>https://example.org/a?b=1&amp;c=2</string>
</dict>
</plist>
`;

describe("webShortcut", () => {
  it("legge l'indirizzo di un .webloc e ne scioglie le entità", () => {
    expect(webShortcut("Pagina di prova.webloc", WEBLOC)).toEqual({
      title: "Pagina di prova",
      url: "https://example.org/a?b=1&c=2",
    });
  });

  it("legge l'indirizzo di un .url, anche con CRLF", () => {
    expect(webShortcut("Sito.URL", "[InternetShortcut]\r\nURL=https://example.org/x\r\nIconIndex=0\r\n")).toEqual({
      title: "Sito",
      url: "https://example.org/x",
    });
  });

  it("senza un indirizzo leggibile o con uno schema non ammesso non è un link", () => {
    expect(webShortcut("b.webloc", "bplist00\u0000\u0001")).toBeNull();
    expect(webShortcut("c.url", "[InternetShortcut]\nIconIndex=0\n")).toBeNull();
    expect(webShortcut("d.url", "[InternetShortcut]\nURL=javascript:alert(1)\n")).toBeNull();
    expect(webShortcut("e.url", "[InternetShortcut]\nURL=file:///etc/passwd\n")).toBeNull();
    expect(webShortcut("f.txt", "URL=https://example.org")).toBeNull();
  });

  it("riconosce il nome e la taglia di un collegamento", () => {
    expect(looksLikeWebShortcut("a.webloc", 300)).toBe(true);
    expect(looksLikeWebShortcut("a.URL", 300)).toBe(true);
    expect(looksLikeWebShortcut("a.url", 10 * 1024 * 1024)).toBe(false);
    expect(looksLikeWebShortcut("a.md", 10)).toBe(false);
  });
});
