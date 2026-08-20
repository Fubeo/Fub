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
// [0020](../../../docs/decisions/0020-le-regole-in-un-posto-solo.md): un posto
// in cui scriverlo, due da cui leggerlo.
//
// Il confronto si fa qui e non solo in `tema/genera.mjs --verifica` perché
// questo gira dentro `npm test`, cioè nel cancello che tutti attraversano.
//
// # Gli altri due sono proprietà, non valori
//
// La monotonia e l'additività non guardano *quali* colori sono usciti: guardano
// che la scala salga sempre nello stesso verso e che nessun ruolo abbia cambiato
// nome. Sono le due cose che la generazione **non** può garantire da sola —
// la prima perché un passo negativo si scriverebbe benissimo, la seconda perché
// rinominare un ruolo è un'operazione perfettamente legale che rompe ogni tema
// di terzi già scritto.
import { describe, expect, it } from "vitest";

import { contrast } from "./contrast";
import { fromHex } from "./oklch";
import {
  SHEETS,
  PAPER_BACKGROUNDS,
  LIGHTS,
  STEP,
  SURFACE_SCALE,
  sheet,
  roles,
  palette,
} from "./serie/recipe";
import dark from "./serie/sheet-dark.css?raw";
import light from "./serie/sheet-light.css?raw";

const ON_DISK = { dark, light } as const;

describe("i due fogli sono quelli che la ricetta produce", () => {
  it.each(LIGHTS)("%s: byte per byte", (light) => {
    expect(
      sheet(light),
      `${SHEETS[light]} non è quello che la ricetta produce: «npm run theme:genera». ` +
        "Un esadecimale ritoccato a mano sparisce alla prima rigenerazione, e fino " +
        "ad allora dice il falso sulla ricetta.",
    ).toBe(ON_DISK[light]);
  });

  it("e la generazione è deterministica: due corse, gli stessi byte", () => {
    // La ricerca della chiarezza è una bisezione con un numero **fisso** di
    // giri, e l'abbassamento del croma pure. Sono fissi apposta: «finché
    // converge» darebbe risultati diversi al variare dell'ordine delle
    // operazioni in virgola mobile, e un derivato che cambia da solo non è un
    // derivato — è un file che qualcuno deve ricommittare ogni tanto.
    for (const light of LIGHTS) expect(sheet(light)).toBe(sheet(light));
  });
});

describe("la scala delle superfici sale, e sale sempre", () => {
  // La distanza si misura in **chiarezza percettiva** e non in rapporto di
  // contrasto, e la differenza non è un dettaglio: il rapporto della WCAG ha un
  // `+0,05` al denominatore che vicino al nero domina tutto, quindi due
  // superfici scure ben distinte danno 1,03:1 e due chiare appena diverse danno
  // 1,07:1. Misurare i gradini con quel righello è ciò che ha fatto scrivere,
  // nel conto della seduta, che le superfici stavano «a 1,06:1 dal fondo» — vero
  // e inutile. In OKLab un gradino è un gradino.
  //
  // Il passo lo dichiara la ricetta e da lì si legge; quello che si concede
  // qui è **solo** la quantizzazione. Un passo dichiarato di 0,014 può uscire
  // dal foglio come 0,012 perché fra due chiarezze vicine al bianco non c'è
  // sempre un codice a otto bit che le separi esattamente: si arrotonda, e
  // l'arrotondamento accorcia. Tre millesimi sono il massimo che un
  // arrotondamento possa togliere, misurato; di più vorrebbe dire che il passo
  // non è quello dichiarato, ed è quello che questo presidio vuole sapere.
  const QUANTIZATION = 0.003;

  it.each(LIGHTS)("%s: ogni gradino è più lontano dalla carta del precedente", (light) => {
    const surfacePalette = palette(light);
    const lightnesses = SURFACE_SCALE.map((n) => fromHex(surfacePalette.get(n)!).l);
    const stepDifferences = lightnesses
      .slice(1)
      .map((l, i) => (light === "dark" ? l - lightnesses[i]! : lightnesses[i]! - l));

    const steady = stepDifferences
      .map((d, i) => [`${SURFACE_SCALE[i]} → ${SURFACE_SCALE[i + 1]}`, d] as const)
      .filter(([, d]) => d < STEP[light] - QUANTIZATION);
    expect(
      steady.map(([where, d]) => `${where}: ${d.toFixed(4)}`),
      "due gradini adiacenti stanno più vicini del passo dichiarato: la scala " +
        "smette di essere una scala e diventa un elenco di superfici",
    ).toEqual([]);
  });

  it.each(LIGHTS)("%s: i fondi della carta salgono anche loro", (light) => {
    // Sono tre — la pagina, la riga attiva, la selezione — e la selezione è il
    // fondo più lontano su cui una specie di sintassi possa finire. Se
    // scavalcassero l'ordine, la riga sotto il cursore sarebbe più lontana della
    // selezione e il testo selezionato si vedrebbe meno di quello che non lo è.
    const surfacePalette = palette(light);
    const lightnesses = PAPER_BACKGROUNDS.map((n) => fromHex(surfacePalette.get(n)!).l);
    const increasing = lightnesses.every(
      (l, i) => i === 0 || (light === "dark" ? l > lightnesses[i - 1]! : l < lightnesses[i - 1]!),
    );
    expect(increasing, `i fondi della carta: ${PAPER_BACKGROUNDS.join(", ")}`).toBe(true);
  });

  it("la carta è l'estremo, e il nero OLED è finito lì", () => {
    // È la decisione di prodotto della seduta, scritta come presidio: il nero
    // resta, e resta sotto la nota — che è dove è grande.
    expect(palette("dark").get("doc-bg")).toBe("#000000");
    expect(palette("light").get("doc-bg")).toBe("#ffffff");
    expect(palette("dark").get("bg")).not.toBe("#000000");
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
    const surfacePalette = palette(light);
    const weakColors = SOLID_COLORS.map((p) => {
      const solidColor = surfacePalette.get(p)!;
      const above = surfacePalette.get(`${p}-contrast`)!;
      return [p, contrast(above, solidColor)] as const;
    }).filter(([, v]) => v < 4.5);
    expect(
      weakColors.map(([p, v]) => `--${p}-contrast: ${v.toFixed(2)}:1`),
      "un pieno su cui né il nero né il bianco reggono è un pieno che non può " +
        "portare testo: si abbassa la mira del pieno, non si sceglie un terzo colore",
    ).toEqual([]);
  });
});

describe("il vocabolario cresce solo in modo additivo", () => {
  /// I ruoli che la ricetta dichiarava alla chiusura della §31.2. Non è una
  /// copia da tenere aggiornata: è un **lucchetto sul verso sbagliato**. Un
  /// ruolo nuovo si aggiunge in fondo e il presidio non se ne lamenta; un ruolo
  /// che sparisce o cambia nome diventa rosso, perché è la sola operazione che
  /// rompe ogni tema di terzi già scritto — e l'additività che la
  /// [0002](../../../docs/decisions/0002-additivita-del-contratto.md) impone al
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
