// @vitest-environment happy-dom
//
// **Le icone del tema** (PA T40): un tema ridisegna per nome le icone che ci
// sono, con soli tracciati che passano la regola. Il set del tema si guarda
// per primo, poi la serie, poi le registrazioni; un cambio di set ridisegna in
// un passaggio solo gli `<svg data-icon>` già nella pagina.
import { afterEach, describe, expect, it, vi } from "vitest";

import { icon, iconEl, iconNames, registerIcon, replaceThemeIcons, themeIcons, undrawnThemeIcons } from "./icons";

const SQUARE = "M4 4h16v16H4z";
const LINE = "M8 12h8";

function body(name: string): string {
  return icon(name).match(/^<svg[^>]*>([\s\S]*)<\/svg>$/)?.[1] ?? "";
}

afterEach(() => {
  replaceThemeIcons(null);
  document.body.replaceChildren();
});

describe("il set del tema", () => {
  it("si guarda per primo, poi la serie, poi le registrazioni", () => {
    const series = body("search");
    const retire = registerIcon("goccia-di-prova", ["M12 3v18"]);
    try {
      replaceThemeIcons({ search: [SQUARE, LINE], "goccia-di-prova": [LINE] });
      expect(body("search")).toBe(`<path d="${SQUARE}"/><path d="${LINE}"/>`);
      expect(body("goccia-di-prova")).toBe(`<path d="${LINE}"/>`);
      // Il costrutto resta quello del set: griglia, tratto, colore.
      expect(icon("search")).toContain('viewBox="0 0 24 24"');
      expect(icon("search")).toContain('stroke="currentColor"');
      expect(body("bell")).not.toBe("");

      replaceThemeIcons(null);
      expect(body("search")).toBe(series);
      expect(body("goccia-di-prova")).toBe('<path d="M12 3v18"/>');
    } finally {
      retire();
    }
  });

  it("non aggiunge nomi: un nome che nessuno disegna resta nel set e non si vede", () => {
    replaceThemeIcons({ "modulo-spento": [LINE], search: [SQUARE] });
    expect(icon("modulo-spento")).toBe("");
    expect(iconNames()).not.toContain("modulo-spento");
    expect(undrawnThemeIcons()).toEqual(["modulo-spento"]);
    expect(themeIcons()).toEqual({ "modulo-spento": [LINE], search: [SQUARE] });

    // Il modulo si accende dopo: il set del tema non conta come «già
    // disegnato», e da lì la sua icona ha la figura del tema.
    const retire = registerIcon("modulo-spento", ["M12 3v18"]);
    try {
      expect(body("modulo-spento")).toBe(`<path d="${LINE}"/>`);
      expect(undrawnThemeIcons()).toEqual([]);
    } finally {
      retire();
    }
    expect(icon("modulo-spento")).toBe("");
  });

  it("un alias ridisegnato vale per il nome a cui punta, e il nome scritto per sé vince", () => {
    replaceThemeIcons({ folder: [SQUARE] });
    expect(body("vault")).toBe(`<path d="${SQUARE}"/>`);
    expect(body("folder")).toBe(`<path d="${SQUARE}"/>`);

    replaceThemeIcons({ folder: [SQUARE], vault: [LINE] });
    expect(body("vault")).toBe(`<path d="${LINE}"/>`);
    expect(body("folder")).toBe(`<path d="${LINE}"/>`);
  });

  it("accetta soltanto tracciati, e una voce che non regge lascia il set di prima", () => {
    replaceThemeIcons({ search: [SQUARE] });
    for (const bad of <Record<string, string[]>[]>[
      { search: ['M0 0"/><script>alert(1)</script><path d="'] },
      { search: ["M0 0<"] },
      { search: ["M0 0 url(#x)"] },
      { search: [] },
      { Search: [SQUARE] },
      { search: [42] as unknown as string[] },
    ]) {
      expect(() => replaceThemeIcons(bad)).toThrow(/does not hold/);
      expect(body("search")).toBe(`<path d="${SQUARE}"/>`);
    }
  });

  it("una registrazione accetta ancora soltanto tracciati, con la stessa regola", () => {
    expect(() => registerIcon("spazio-strano", ["M0 0h1"])).toThrow(/path data/);
    expect(() => registerIcon("virgolette", ['M0 0"'])).toThrow(/path data/);
  });

  it("ogni svg porta il suo nome in data-icon", () => {
    expect(iconEl("search")?.getAttribute("data-icon")).toBe("search");
    expect(iconEl("folder")?.getAttribute("data-icon")).toBe("folder");
    // I nomi di `Object.prototype` non sono icone.
    expect(icon("constructor")).toBe("");
    expect(icon("__proto__")).toBe("");
  });
});

describe("il ridisegno della pagina", () => {
  it("cambia i figli delle icone che cambiano figura, e lascia il resto", () => {
    const host = document.createElement("div");
    host.innerHTML = `${icon("search")}${icon("folder")}${icon("bell")}${icon("settings")}`;
    document.body.append(host);
    const [search, folder, bell, settings] = [...host.querySelectorAll("svg")];
    const seriesSettings = settings!.innerHTML;
    search!.classList.add("mia-classe");
    const bellChild = bell!.firstChild;
    const seriesSearch = search!.innerHTML;

    // `search` ha già due tracciati (cambiano i `d`); `settings` ha anche dei
    // cerchi (riceve figli nuovi).
    replaceThemeIcons({ search: [SQUARE, LINE], vault: [LINE], settings: [SQUARE] });

    expect(search!.querySelectorAll("path").length).toBe(2);
    expect(search!.querySelector("path")?.getAttribute("d")).toBe(SQUARE);
    expect(search!.classList.contains("mia-classe")).toBe(true);
    expect(search!.firstElementChild?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(folder!.querySelector("path")?.getAttribute("d")).toBe(LINE);
    expect(bell!.firstChild).toBe(bellChild);
    expect([...settings!.children].map((child) => child.localName)).toEqual(["path"]);
    expect(settings!.firstElementChild?.getAttribute("d")).toBe(SQUARE);
    expect(settings!.firstElementChild?.namespaceURI).toBe("http://www.w3.org/2000/svg");

    replaceThemeIcons(null);
    expect(search!.innerHTML).toBe(seriesSearch);
    expect(settings!.innerHTML).toBe(seriesSettings);
  });

  // Il tetto di 16 ms vale nel motore del browser, e lo misura una sonda in
  // Chromium; il DOM finto qui è molto più lento e sotto carico varia, quindi
  // la prova guarda la forma: una ricerca sola nella pagina e un modello solo
  // per nome, qualunque sia il numero di icone.
  it("10.000 icone nella pagina si ridisegnano in un passaggio solo", () => {
    const host = document.createElement("div");
    host.innerHTML = icon("search").repeat(10_000);
    document.body.append(host);

    const searches = vi.spyOn(document, "querySelectorAll");
    const models = vi.spyOn(document, "createElement");
    try {
      replaceThemeIcons({ search: [SQUARE] });
      expect(searches).toHaveBeenCalledTimes(1);
      expect(models.mock.calls.filter(([tag]) => tag === "template")).toHaveLength(1);
    } finally {
      searches.mockRestore();
      models.mockRestore();
    }

    const paths = [...host.querySelectorAll("svg[data-icon] > path")].map((path) => path.getAttribute("d"));
    expect(paths).toHaveLength(10_000);
    expect(new Set(paths)).toEqual(new Set([SQUARE]));

    // Lo stesso set una seconda volta non tocca la pagina.
    const first = host.querySelector("svg path");
    replaceThemeIcons({ search: [SQUARE] });
    expect(host.querySelector("svg path")).toBe(first);
  }, 60_000);
});
