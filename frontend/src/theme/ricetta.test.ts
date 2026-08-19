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

import { contrasto } from "./contrasto";
import { daEsa } from "./oklch";
import {
  FOGLI,
  FONDI_CARTA,
  LUCI,
  PASSO,
  SCALA_SUPERFICI,
  foglio,
  ruoli,
  tavolozza,
} from "./serie/ricetta";
import scuro from "./serie/foglio-scuro.css?raw";
import chiaro from "./serie/foglio-chiaro.css?raw";

const SU_DISCO = { scuro, chiaro } as const;

describe("i due fogli sono quelli che la ricetta produce", () => {
  it.each(LUCI)("%s: byte per byte", (luce) => {
    expect(
      foglio(luce),
      `${FOGLI[luce]} non è quello che la ricetta produce: «npm run tema:genera». ` +
        "Un esadecimale ritoccato a mano sparisce alla prima rigenerazione, e fino " +
        "ad allora dice il falso sulla ricetta.",
    ).toBe(SU_DISCO[luce]);
  });

  it("e la generazione è deterministica: due corse, gli stessi byte", () => {
    // La ricerca della chiarezza è una bisezione con un numero **fisso** di
    // giri, e l'abbassamento del croma pure. Sono fissi apposta: «finché
    // converge» darebbe risultati diversi al variare dell'ordine delle
    // operazioni in virgola mobile, e un derivato che cambia da solo non è un
    // derivato — è un file che qualcuno deve ricommittare ogni tanto.
    for (const luce of LUCI) expect(foglio(luce)).toBe(foglio(luce));
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
  const QUANTIZZAZIONE = 0.003;

  it.each(LUCI)("%s: ogni gradino è più lontano dalla carta del precedente", (luce) => {
    const palette = tavolozza(luce);
    const chiarezze = SCALA_SUPERFICI.map((n) => daEsa(palette.get(n)!).l);
    const salti = chiarezze
      .slice(1)
      .map((l, i) => (luce === "scuro" ? l - chiarezze[i]! : chiarezze[i]! - l));

    const fermi = salti
      .map((d, i) => [`${SCALA_SUPERFICI[i]} → ${SCALA_SUPERFICI[i + 1]}`, d] as const)
      .filter(([, d]) => d < PASSO[luce] - QUANTIZZAZIONE);
    expect(
      fermi.map(([dove, d]) => `${dove}: ${d.toFixed(4)}`),
      "due gradini adiacenti stanno più vicini del passo dichiarato: la scala " +
        "smette di essere una scala e diventa un elenco di superfici",
    ).toEqual([]);
  });

  it.each(LUCI)("%s: i fondi della carta salgono anche loro", (luce) => {
    // Sono tre — la pagina, la riga attiva, la selezione — e la selezione è il
    // fondo più lontano su cui una specie di sintassi possa finire. Se
    // scavalcassero l'ordine, la riga sotto il cursore sarebbe più lontana della
    // selezione e il testo selezionato si vedrebbe meno di quello che non lo è.
    const palette = tavolozza(luce);
    const chiarezze = FONDI_CARTA.map((n) => daEsa(palette.get(n)!).l);
    const cresce = chiarezze.every(
      (l, i) => i === 0 || (luce === "scuro" ? l > chiarezze[i - 1]! : l < chiarezze[i - 1]!),
    );
    expect(cresce, `i fondi della carta: ${FONDI_CARTA.join(", ")}`).toBe(true);
  });

  it("la carta è l'estremo, e il nero OLED è finito lì", () => {
    // È la decisione di prodotto della seduta, scritta come presidio: il nero
    // resta, e resta sotto la nota — che è dove è grande.
    expect(tavolozza("scuro").get("doc-bg")).toBe("#000000");
    expect(tavolozza("chiaro").get("doc-bg")).toBe("#ffffff");
    expect(tavolozza("scuro").get("bg")).not.toBe("#000000");
  });
});

describe("ogni pieno porta un controcolore che regge", () => {
  // I `--*-contrast` non sono scelti: la ricetta prende il nero o il bianco,
  // quello dei due che regge di più. Qui si verifica che il vincitore stia
  // sopra la soglia del **testo**, perché è testo — e che quindi la scelta
  // automatica non abbia lasciato passare un pieno su cui nessuno dei due
  // candidati funziona. È l'unico esito che quel conto non può evitare da solo.
  const PIENI = ["accent", "danger", "warning", "success", "info"] as const;

  it.each(LUCI)("%s: il nero o il bianco reggono su ognuno dei cinque pieni", (luce) => {
    const palette = tavolozza(luce);
    const deboli = PIENI.map((p) => {
      const pieno = palette.get(p)!;
      const sopra = palette.get(`${p}-contrast`)!;
      return [p, contrasto(sopra, pieno)] as const;
    }).filter(([, v]) => v < 4.5);
    expect(
      deboli.map(([p, v]) => `--${p}-contrast: ${v.toFixed(2)}:1`),
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
  const RUOLI_31_2 = [
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
    const oggi = new Set(ruoli());
    expect(
      RUOLI_31_2.filter((r) => !oggi.has(r)),
      "un ruolo rinominato rompe ogni tema di terzi già scritto: si aggiunge il " +
        "nome nuovo e si tiene il vecchio, o si aspetta un freeze",
    ).toEqual([]);
  });

  it("e i nomi sono unici: nessun ruolo dichiarato due volte", () => {
    // Due voci con lo stesso nome darebbero un foglio in cui la seconda vince e
    // la prima è invisibile — e la ricetta direbbe una cosa che il CSS non fa.
    const tutti = ruoli();
    const doppi = tutti.filter((n, i) => tutti.indexOf(n) !== i);
    expect(doppi).toEqual([]);
  });
});
