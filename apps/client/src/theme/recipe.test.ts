// **Il presidio della ricetta** (§31.2): i fogli sono quelli che la ricetta
// produce, la scala è monotona, e il vocabolario non si rinomina.
//
// # Il primo presidio è il solo che conti davvero
//
// «Rigenerare dà gli stessi byte» è ciò che rende la ricetta la **sorgente** e i
// due fogli un derivato. Senza, sarebbero tre file che si somigliano: qualcuno
// ritoccherebbe un esadecimale a mano — con ragione, magari — e da quel momento
// la ricetta racconterebbe un tema che non esiste, senza che niente lo dica. È
// lo stesso schema dei `*.generated.ts` e la stessa ragione della
// [0020](../../../docs/decisions/README.md): un posto
// in cui scriverlo, due da cui leggerlo.
//
// Il confronto si fa qui e non solo in `tema/genera.mjs --verifica` perché
// questo gira dentro `npm test`, cioè nel cancello che tutti attraversano.
//
// # Gli altri sono proprietà, non valori
//
// La gerarchia dei piani e l'additività non guardano *quali* colori sono
// usciti: guardano che il foglio resti sopra la scrivania in ogni luce e che
// nessun ruolo abbia cambiato nome. Sono le cose che la generazione **non** può
// garantire da sola — la prima perché un foglio più scuro del piano si
// scriverebbe benissimo, la seconda perché rinominare un ruolo è un'operazione
// perfettamente legale che rompe ogni tema di terzi già scritto.
import { describe, expect, it } from "vitest";

import { contrast } from "./contrast";
import { fromHex } from "./oklch";
import { CONTRASTS, LIGHTS, SHEETS, VARIANTS, palette, roles, sheet } from "./scrittoio/recipe";
import darkHigh from "./scrittoio/sheet-dark-high.css?raw";
import dark from "./scrittoio/sheet-dark.css?raw";
import lightHigh from "./scrittoio/sheet-light-high.css?raw";
import light from "./scrittoio/sheet-light.css?raw";

const ON_DISK = {
  dark: { normal: dark, high: darkHigh },
  light: { normal: light, high: lightHigh },
} as const;

describe("i quattro fogli sono quelli che la ricetta produce", () => {
  it.each(VARIANTS)("$light × $contrast: byte per byte", ({ light, contrast }) => {
    expect(
      sheet(light, contrast),
      `${SHEETS[light][contrast]} non è quello che la ricetta produce: «npm run theme:generate».`,
    ).toBe(ON_DISK[light][contrast]);
  });

  it("e la generazione è deterministica: due corse, gli stessi byte", () => {
    for (const { light, contrast } of VARIANTS) {
      expect(sheet(light, contrast)).toBe(sheet(light, contrast));
    }
  });
});

describe("il foglio sta sopra la scrivania, in ogni luce", () => {
  // È il primo principio dello Scrittoio: il contenuto è l'elemento più chiaro
  // e più rialzato, e al buio la gerarchia non si inverte. Si misura in
  // chiarezza percettiva (OKLab) e non in rapporto di contrasto: vicino al nero
  // il `+0,05` della WCAG schiaccia ogni gradino.
  const ORDER = ["bg", "bg-hover", "sheet-2", "sheet", "bg-elev"] as const;

  it.each(LIGHTS.flatMap((l) => CONTRASTS.map((c) => [l, c] as const)))(
    "%s × %s: scrivania, foglio, rialzo",
    (light, level) => {
      const values = palette(light, level);
      const l = (role: string): number => fromHex(values[role]!).l;
      expect(l("sheet"), "il foglio è più chiaro della scrivania").toBeGreaterThan(l("bg"));
      expect(l("bg-elev"), "ciò che galleggia non è più scuro del foglio").toBeGreaterThanOrEqual(l("sheet"));
      for (const role of ORDER) expect(values[role], role).toMatch(/^#[0-9a-f]{6}$/);
    },
  );

  it.each(LIGHTS)("%s: la carta del documento è il foglio, e non il nero o il bianco puri", (light) => {
    const values = palette(light, "normal");
    expect(values["doc-bg"]).toBe(values["sheet"]);
    expect(values["doc-bg"]).not.toBe(light === "dark" ? "#000000" : "#ffffff");
  });
});

describe("ogni pieno porta un controcolore che regge", () => {
  // I `--*-contrast` non sono scelti: la ricetta prende il nero o il bianco,
  // quello dei due che regge di più. Qui si verifica che il vincitore stia
  // sopra la soglia del **testo**, perché è testo — e che quindi la scelta
  // automatica non abbia lasciato passare un pieno su cui nessuno dei due
  // candidati funziona. È l'unico esito che quel conto non può evitare da solo.
  const SOLID_COLORS = ["accent", "danger", "warning", "success", "info"] as const;

  it.each(LIGHTS)("%s: il nero o il bianco reggono su ognuno dei cinque pieni", (light) => {
    const surfacePalette = palette(light, "normal");
    const weakColors = SOLID_COLORS.map((p) => {
      const solidColor = surfacePalette[p]!;
      const above = surfacePalette[`${p}-contrast`]!;
      return [p, contrast(above, solidColor)] as const;
    }).filter(([, v]) => v < 4.5);
    expect(
      weakColors.map(([p, v]) => `--${p}-contrast: ${v.toFixed(2)}:1`),
      "un pieno su cui né il nero né il bianco reggono è un pieno che non può " +
        "portare testo: si abbassa la mira del pieno, non si sceglie un terzo colore",
    ).toEqual([]);
  });
});

describe("i cinque livelli di elevazione", () => {
  const LEVELS = ["paper", "base", "chrome", "floating", "dialog"] as const;

  it.each(LIGHTS)("%s: ogni livello deriva superficie, filetto e ombra", (light) => {
    const values = palette(light, "normal");
    for (const level of LEVELS) {
      expect(values[`elevation-${level}-surface`], level).toBeDefined();
      expect(values[`elevation-${level}-border`], level).toBeDefined();
      expect(values[`elevation-${level}-shadow`], level).toBeDefined();
    }
  });

  it.each(LIGHTS)("%s: il flottante e il dialogo hanno ognuno la sua ombra", (light) => {
    // Un menu e una modale non stanno alla stessa altezza; il piano non ne ha.
    const values = palette(light, "normal");
    expect(values["elevation-base-shadow"]).toBe("none");
    expect(values["elevation-floating-shadow"]).not.toBe("none");
    expect(values["elevation-dialog-shadow"]).not.toBe("none");
    expect(values["elevation-floating-shadow"]).not.toBe(values["elevation-dialog-shadow"]);
  });
});

describe("il vocabolario cresce solo in modo additivo", () => {
  /// I ruoli che la ricetta dichiarava alla chiusura della §31.2. Non è una
  /// copia da tenere aggiornata: è un **lucchetto sul verso sbagliato**. Un
  /// ruolo nuovo si aggiunge in fondo e il presidio non se ne lamenta; un ruolo
  /// che sparisce o cambia nome diventa rosso, perché è la sola operazione che
  /// rompe ogni tema di terzi già scritto — e l'additività che la
  /// [0002](../../../docs/decisions/0180-compatibilita-wit-additiva.md) impone al
  /// contratto varrebbe meno di quella che ci si impone da soli.
  const ROLES_31_2 = [
    "space-1", "space-2", "space-3", "space-4", "space-5",
    "space-6", "space-7", "space-8", "space-9", "space-10",
    "radius-xs", "radius-sm", "radius-md", "radius-lg", "radius-pill",
    "font-ui", "font-mono",
    "text-xs", "text-sm", "text-base", "text-md", "text-lg", "text-xl",
    "weight-medium", "weight-bold", "leading-tight", "tracking-caps",
    "duration-fast", "duration-med", "duration-slow", "ease", "ease-out", "ease-in",
    "bg", "bg-chrome", "bg-elev", "bg-panel", "bg-input", "bg-hover", "bg-active",
    "overlay-hover", "border",
    "text", "muted",
    "accent", "accent-soft", "accent-contrast",
    "danger", "danger-wash", "danger-contrast",
    "warning", "warning-wash", "warning-contrast",
    "success", "success-wash", "success-contrast",
    "info", "info-wash", "info-contrast",
    "focus-ring", "focus-ring-width", "focus-ring-offset",
    "scrim", "shadow-sm", "shadow-md", "shadow-lg",
    "graph-node", "graph-node-active", "graph-node-hover",
    "doc-bg", "doc-active-line", "doc-selection", "doc-tooltip-bg",
    "doc-fill", "doc-fill-soft", "doc-rule", "doc-rule-soft", "doc-highlight",
    "doc-fg", "doc-link", "doc-heading", "doc-danger", "doc-gutter-fg", "doc-caret",
    "syn-keyword", "syn-name", "syn-function", "syn-literal", "syn-type",
    "syn-operator", "syn-comment", "syn-string", "syn-heading", "syn-invalid",
  ];

  it("nessun ruolo di allora è sparito o ha cambiato nome", () => {
    const currentRoles = new Set(roles());
    expect(
      ROLES_31_2.filter((r) => !currentRoles.has(r)),
      "un ruolo rinominato rompe ogni tema di terzi già scritto: si aggiunge il " +
        "nome nuovo e si tiene il vecchio, o si aspetta un freeze",
    ).toEqual([]);
  });

  it("e i nomi sono unici: nessun ruolo dichiarato due volte", () => {
    // Due voci con lo stesso nome darebbero un foglio in cui la seconda vince e
    // la prima è invisibile — e la ricetta direbbe una cosa che il CSS non fa.
    const roleNames = roles();
    const duplicates = roleNames.filter((n, i) => roleNames.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });
});
