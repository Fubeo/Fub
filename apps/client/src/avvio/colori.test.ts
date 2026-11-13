// I colori dello strato d'avvio sono quelli della ricetta.
//
// `public/avvio/avvio.css` vale al primo disegno, prima di ogni JS, e per
// questo scrive i colori di serie a mano. Senza questo test un cambio della
// ricetta (la tinta di serie, un neutro, un segno) lascerebbe l'avvio nei
// colori di prima: il primo disegno in un tema, l'app nell'altro. Qui, per la
// tinta di serie, nelle due luci e nel contrasto alto, ogni variabile
// dell'avvio è uguale al ruolo della ricetta da cui viene.
import { describe, expect, it } from "vitest";
import foglio from "../../public/avvio/avvio.css?raw";
import { DEFAULT_ACCENT_HUE, VARIANTS, palette, type ContrastLevel, type Light } from "../theme/scrittoio/recipe";

/// Ogni variabile dello strato, col ruolo della ricetta da cui si legge. Le
/// prime otto e le ultime cinque, la cartella del logo (D26), sono le stesse
/// di `COLORI` in `consegna.ts`.
const RUOLI: Readonly<Record<string, string>> = {
  sfondo: "bg",
  testo: "text",
  tenue: "muted",
  accento: "accent",
  inchiostro: "accent-contrast",
  bordo: "border",
  guasto: "danger",
  fuoco: "focus-ring",
  velo: "overlay-hover",
  "velo-forte": "overlay-active",
  ombra: "shadow-2",
  cartella: "logo-cartella",
  "cartella-retro": "logo-cartella-retro",
  "cartella-ombra": "logo-cartella-ombra",
  "foglio-1": "logo-foglio-1",
  "foglio-2": "logo-foglio-2",
};

type Dichiarazioni = Record<string, string>;

/// I blocchi `selettore { … }` del foglio, senza commenti e senza `@font-face`;
/// la `@media` della luce chiara di sistema dà il suo blocco interno.
function blocchi(css: string): Map<string, Dichiarazioni> {
  const pulito = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, Dichiarazioni>();
  for (const [, selettore, corpo] of pulito.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const chiave = selettore!.replace(/\s+/g, " ").trim();
    if (chiave.startsWith("@font-face")) continue;
    const dichiarazioni: Dichiarazioni = {};
    for (const riga of corpo!.split(";")) {
      const m = /^\s*--avvio-([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(riga);
      if (m) dichiarazioni[m[1]!] = m[2]!;
    }
    out.set(chiave, dichiarazioni);
  }
  return out;
}

const BLOCCHI = blocchi(foglio);

function blocco(selettore: string): Dichiarazioni {
  const trovato = BLOCCHI.get(selettore);
  if (!trovato) throw new Error(`avvio.css non ha più il blocco ${selettore}`);
  return trovato;
}

/// I colori che una luce e un contrasto vedono davvero: il contrasto alto
/// ridichiara solo ciò che cambia, il resto viene dalla luce.
function colori(luce: Light, contrasto: ContrastLevel): Dichiarazioni {
  const base = blocco(luce === "dark" ? ':root, :root[data-avvio-luce="dark"]' : ':root[data-avvio-luce="light"]');
  if (contrasto === "normal") return base;
  return { ...base, ...blocco(`:root[data-avvio-luce="${luce}"][data-avvio-contrasto="high"]`) };
}

describe("lo strato d'avvio ha i colori della ricetta, per la tinta di serie", () => {
  it.each(VARIANTS)("$light × $contrast", ({ light, contrast }) => {
    const ricetta = palette(light, contrast, DEFAULT_ACCENT_HUE);
    const avvio = colori(light, contrast);
    expect(Object.keys(avvio).sort()).toEqual(Object.keys(RUOLI).sort());
    for (const [variabile, ruolo] of Object.entries(RUOLI)) {
      expect(avvio[variabile], `--avvio-${variabile} viene da --${ruolo}`).toBe(ricetta[ruolo]);
    }
  });

  it("la luce chiara del sistema, senza JS, è la stessa della luce chiara scelta", () => {
    expect(blocco(":root:not([data-avvio-luce])")).toEqual(blocco(':root[data-avvio-luce="light"]'));
  });
});
