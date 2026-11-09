// @vitest-environment happy-dom
//
// `public/avvio/luce.js` decide la luce prima di ogni modulo, con le regole di
// `theme.ts` ricopiate in uno script classico. Qui lo si esegue com'è, su una
// tabella di cache e di sistemi, e si confronta ciò che scrive con
// `effectiveTheme` ed `effectiveContrast`: una regola cambiata da una parte
// sola è il lampo della luce sbagliata al primo disegno.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import codice from "../../public/avvio/luce.js?raw";
import { effectiveContrast, effectiveTheme } from "../theme/theme";

interface Sistema {
  dark?: boolean;
  high?: boolean;
  reduced?: boolean;
}

const root = document.documentElement;
let ascoltatori: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];

function sistema(s: Sistema | null): void {
  if (s === null) {
    vi.stubGlobal("matchMedia", undefined);
    return;
  }
  vi.stubGlobal("matchMedia", (domanda: string) => ({
    matches:
      domanda === "(prefers-color-scheme: dark)" ? !!s.dark
        : domanda === "(prefers-contrast: more)" ? !!s.high
        : domanda === "(prefers-reduced-motion: reduce)" ? !!s.reduced
        : false,
    media: domanda,
  }));
}

function esegui(): void {
  new Function(codice)();
}

beforeEach(() => {
  localStorage.clear();
  for (const nome of root.getAttributeNames()) if (nome.startsWith("data-avvio")) root.removeAttribute(nome);
  root.removeAttribute("style");
  // Gli ascoltatori `error` che lo script lascia: si tolgono a ogni caso.
  const aggiungi = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((tipo, fn, opzioni) => {
    ascoltatori.push([tipo, fn!, opzioni]);
    aggiungi(tipo, fn, opzioni);
  });
  // happy-dom risponde sempre sì (e dà un `CSS` nuovo a ogni lettura): qui un
  // colore è un esadecimale, un nome o un rgb().
  vi.spyOn(Object.getPrototypeOf(window.CSS) as { supports: typeof CSS.supports }, "supports").mockImplementation((proprieta: string, valore?: string) =>
    proprieta === "color" && /^(#[0-9a-f]{3,8}|[a-z]+|rgb\([\d\s.,/%]+\))$/i.test(valore ?? ""));
});

afterEach(() => {
  for (const [tipo, fn, opzioni] of ascoltatori) window.removeEventListener(tipo, fn, opzioni);
  ascoltatori = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/// I casi: la cache com'è nel `localStorage`, il sistema, e la scelta che
/// `theme.ts` ne ricaverebbe (`loadCache`).
const CASI: Array<{
  nome: string;
  cache: Record<string, string>;
  sistema: Sistema | null;
  luce: unknown;
  contrasto: unknown;
  ridotto: boolean;
}> = [
  { nome: "cache assente, sistema scuro", cache: {}, sistema: { dark: true }, luce: "", contrasto: "", ridotto: false },
  { nome: "cache assente, sistema chiaro", cache: {}, sistema: { dark: false }, luce: "", contrasto: "", ridotto: false },
  { nome: "cache assente, niente matchMedia", cache: {}, sistema: null, luce: "", contrasto: "", ridotto: false },
  { nome: "cache del tema rotta", cache: { "fub.appearance.theme": "{rotta" }, sistema: { dark: false }, luce: "", contrasto: "", ridotto: false },
  { nome: "cache del tema di prima: la sola luce", cache: { "fub.appearance.theme": "light" }, sistema: { dark: true }, luce: "light", contrasto: "", ridotto: false },
  { nome: "cache del tema di prima: lime è scuro", cache: { "fub.appearance.theme": "lime" }, sistema: { dark: false }, luce: "dark", contrasto: "", ridotto: false },
  {
    nome: "cache del tema: chiaro, alto contrasto scelto",
    cache: {
      "fub.appearance.theme": JSON.stringify({ id: "fub.serie", light: "light" }),
      "fub.appearance.preferences": JSON.stringify({ contrast: "high" }),
    },
    sistema: { dark: true },
    luce: "light",
    contrasto: "high",
    ridotto: false,
  },
  {
    nome: "preferenze rotte: theme.ts butta tutto",
    cache: {
      "fub.appearance.theme": JSON.stringify({ id: "fub.serie", light: "light" }),
      "fub.appearance.preferences": "{rotta",
    },
    sistema: { dark: true },
    luce: "",
    contrasto: "",
    ridotto: false,
  },
  { nome: "alto contrasto del sistema", cache: {}, sistema: { dark: true, high: true }, luce: "", contrasto: "", ridotto: false },
  { nome: "moto ridotto del sistema", cache: {}, sistema: { dark: true, reduced: true }, luce: "", contrasto: "", ridotto: true },
  {
    nome: "fub.avvio: scelta «system» con sistema chiaro",
    cache: { "fub.avvio": JSON.stringify({ v: 1, luce: "system", contrasto: "system", moto: "system" }) },
    sistema: { dark: false },
    luce: "system",
    contrasto: "system",
    ridotto: false,
  },
  {
    nome: "fub.avvio: scelta «system» con sistema scuro e alto contrasto",
    cache: { "fub.avvio": JSON.stringify({ v: 1, luce: "system", contrasto: "system", moto: "calm" }) },
    sistema: { dark: true, high: true },
    luce: "system",
    contrasto: "system",
    ridotto: false,
  },
  {
    nome: "fub.avvio vince sulle cache del tema, moto ridotto di Fub",
    cache: {
      "fub.avvio": JSON.stringify({ v: 1, luce: "light", contrasto: "high", moto: "reduced" }),
      "fub.appearance.theme": JSON.stringify({ id: "fub.serie", light: "dark" }),
    },
    sistema: { dark: true },
    luce: "light",
    contrasto: "high",
    ridotto: true,
  },
  {
    nome: "fub.avvio con v: 2 vale come assente",
    cache: {
      "fub.avvio": JSON.stringify({ v: 2, luce: "light", contrasto: "high" }),
      "fub.appearance.theme": JSON.stringify({ id: "fub.serie", light: "dark" }),
    },
    sistema: { dark: false },
    luce: "dark",
    contrasto: "",
    ridotto: false,
  },
  {
    nome: "fub.avvio rotta vale come assente",
    cache: { "fub.avvio": "{rotta" },
    sistema: { dark: false },
    luce: "",
    contrasto: "",
    ridotto: false,
  },
];

describe("luce.js", () => {
  it.each(CASI)("$nome", (caso) => {
    for (const [chiave, valore] of Object.entries(caso.cache)) localStorage.setItem(chiave, valore);
    sistema(caso.sistema);
    esegui();
    const scuro = caso.sistema === null ? true : !!caso.sistema.dark;
    const alto = caso.sistema === null ? false : !!caso.sistema.high;
    expect(root.dataset.avvioLuce).toBe(effectiveTheme(caso.luce, scuro));
    expect(root.dataset.avvioContrasto).toBe(effectiveContrast(caso.contrasto, alto));
    expect(root.dataset.avvioMoto).toBe(caso.ridotto ? "ridotto" : undefined);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("con localStorage che lancia va avanti col sistema", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("negato", "SecurityError");
    });
    sistema({ dark: false, high: true });
    expect(esegui).not.toThrow();
    expect(root.dataset.avvioLuce).toBe("light");
    expect(root.dataset.avvioContrasto).toBe("high");
  });

  it("applica i colori validi della luce risolta, e scarta gli altri", () => {
    localStorage.setItem("fub.avvio", JSON.stringify({
      v: 1,
      luce: "dark",
      contrasto: "normal",
      moto: "system",
      colori: {
        dark: { sfondo: "#101418", testo: "red;}", tenue: "nonsense!", accento: "rgb(1, 2, 3)", bordo: "<b>", guasto: 4 },
        light: { sfondo: "#ffffff" },
      },
    }));
    sistema({ dark: false });
    esegui();
    expect(root.style.getPropertyValue("--avvio-sfondo")).toBe("#101418");
    expect(root.style.getPropertyValue("--avvio-accento")).toBe("rgb(1, 2, 3)");
    for (const scartato of ["testo", "tenue", "bordo", "guasto", "inchiostro", "fuoco"]) {
      expect(root.style.getPropertyValue(`--avvio-${scartato}`), scartato).toBe("");
    }
  });

  it("i colori dell'alto contrasto stanno nella loro voce", () => {
    localStorage.setItem("fub.avvio", JSON.stringify({
      v: 1,
      luce: "light",
      contrasto: "high",
      colori: { light: { sfondo: "#eeeeee" }, "light-high": { sfondo: "#ffffff" } },
    }));
    sistema({});
    esegui();
    expect(root.style.getPropertyValue("--avvio-sfondo")).toBe("#ffffff");
  });

  it("uno script che non arriva scrive il suo percorso su <html>", () => {
    sistema({});
    esegui();
    document.body.innerHTML = '<div class="avvio"></div>';
    const script = document.createElement("script");
    // Un tipo che happy-dom non prova a caricare: l'errore lo manda il test.
    script.type = "text/x-prova";
    script.setAttribute("src", "/assets/desktop-shell-3f9a2c.js");
    document.body.appendChild(script);
    script.dispatchEvent(new Event("error"));
    expect(root.getAttribute("data-avvio-script")).toBe("/assets/desktop-shell-3f9a2c.js");
    // Il primo guasto resta: è quello che spiega gli altri.
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.setAttribute("href", "/assets/altro.js");
    document.body.appendChild(link);
    link.dispatchEvent(new Event("error"));
    expect(root.getAttribute("data-avvio-script")).toBe("/assets/desktop-shell-3f9a2c.js");
  });

  it("un modulepreload che non arriva vale come uno script; un'immagine no", () => {
    sistema({});
    esegui();
    document.body.innerHTML = '<div class="avvio"></div>';
    const img = document.createElement("img");
    document.body.appendChild(img);
    img.dispatchEvent(new Event("error"));
    expect(root.hasAttribute("data-avvio-script")).toBe(false);
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.setAttribute("href", "/assets/vendor.js");
    document.body.appendChild(link);
    link.dispatchEvent(new Event("error"));
    expect(root.getAttribute("data-avvio-script")).toBe("/assets/vendor.js");
  });

  it("a strato tolto non scrive più niente", () => {
    sistema({});
    esegui();
    document.body.innerHTML = "";
    const script = document.createElement("script");
    // Un tipo che happy-dom non prova a caricare: l'errore lo manda il test.
    script.type = "text/x-prova";
    script.setAttribute("src", "/assets/tardi.js");
    document.body.appendChild(script);
    script.dispatchEvent(new Event("error"));
    expect(root.hasAttribute("data-avvio-script")).toBe(false);
  });
});
