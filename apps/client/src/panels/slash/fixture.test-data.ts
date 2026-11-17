// Le voci del «/» come le dà `fub.formatting`, coi titoli italiani: la base
// dei test delle voci e della tabella delle sessanta query.
import type { CommandSpec } from "../../host/contract";

export const FORMATTING: readonly (readonly [string, string])[] = [
  ["markdown.paragraph", "Testo normale"],
  ["markdown.heading.1", "Titolo 1"],
  ["markdown.heading.2", "Titolo 2"],
  ["markdown.heading.3", "Titolo 3"],
  ["markdown.heading.4", "Titolo 4"],
  ["markdown.heading.5", "Titolo 5"],
  ["markdown.heading.6", "Titolo 6"],
  ["markdown.quote", "Citazione"],
  ["markdown.callout", "Riquadro"],
  ["markdown.details", "Ripiegabile"],
  ["markdown.columns", "Colonne"],
  ["markdown.list.bullet", "Elenco puntato"],
  ["markdown.list.ordered", "Elenco numerato"],
  ["markdown.list.task", "Elenco di attività"],
  ["markdown.table", "Tabella"],
  ["markdown.rule", "Linea di separazione"],
  ["markdown.toc", "Indice"],
  ["markdown.mention", "Persona"],
  ["markdown.date", "Data"],
  ["markdown.linkcard", "Pagina web"],
  ["markdown.codeblock", "Blocco di codice"],
  ["markdown.mathblock", "Blocco di formula"],
  ["markdown.diagram", "Diagramma"],
  ["markdown.image", "Immagine"],
  ["markdown.link", "Link"],
  ["markdown.wikilink", "Link a una nota"],
  ["markdown.embed", "Incorpora una nota"],
  ["markdown.footnote", "Nota a piè di pagina"],
  ["markdown.property.add", "Aggiungi proprietà"],
  ["markdown.comment", "Commento"],
  ["markdown.underline", "Sottolineato"],
  ...["default:predefinito", "gray:grigio", "brown:marrone", "orange:arancione", "yellow:giallo", "green:verde", "blue:blu", "purple:viola", "pink:rosa", "red:rosso"]
    .flatMap((pair) => {
      const [color, name] = pair.split(":") as [string, string];
      return [[`markdown.color.${color}`, `Testo ${name}`], [`markdown.background.${color}`, `Fondo ${name}`]] as const;
    }),
];

/// Le descrizioni italiane di `fub.formatting` (`crates/fub-features/src/formatting.rs`):
/// il disegno in fondo al «/» le mostra, e il banco le fotografa.
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  "markdown.paragraph": "markdown.heading.2",
  "markdown.heading.1": "Fa delle righe selezionate un titolo di primo livello.",
  "markdown.heading.2": "Fa delle righe selezionate un titolo di secondo livello.",
  "markdown.heading.3": "Fa delle righe selezionate un titolo di terzo livello.",
  "markdown.heading.4": "Fa delle righe selezionate un titolo di quarto livello.",
  "markdown.heading.5": "Fa delle righe selezionate un titolo di quinto livello.",
  "markdown.heading.6": "Fa delle righe selezionate un titolo di sesto livello.",
  "markdown.quote": "Fa delle righe selezionate una citazione, o toglie un livello di citazione.",
  "markdown.callout": "Racchiude le righe selezionate in un riquadro `> [!note]`.",
  "markdown.details": "Racchiude le righe selezionate in un blocco che si apre e si chiude, col sommario in cima.",
  "markdown.columns": "Mette i blocchi selezionati uno accanto all'altro, da due a quattro colonne.",
  "markdown.list.bullet": "Fa delle righe selezionate un elenco puntato, o lo toglie.",
  "markdown.list.ordered": "Fa delle righe selezionate un elenco numerato, o lo toglie.",
  "markdown.list.task": "Fa delle righe selezionate attività da spuntare, o le riporta a voci.",
  "markdown.table": "Inserisce una tabella, o fa una tabella delle righe separate da tabulazioni.",
  "markdown.rule": "Inserisce una linea orizzontale dopo la riga corrente.",
  "markdown.toc": "Inserisce l'indice dei titoli della nota, che si aggiorna da solo.",
  "markdown.mention": "Scrive `@` e propone le persone del vault, o ne crea una.",
  "markdown.date": "Scrive `@` e propone i giorni, col link alla loro giornaliera.",
  "markdown.linkcard": "Apre un paragrafo per un indirizzo web, che si vede come una scheda.",
  "markdown.codeblock": "Racchiude le righe selezionate in un blocco di codice, o lo toglie.",
  "markdown.mathblock": "Racchiude le righe selezionate fra `$$`, o toglie il blocco.",
  "markdown.diagram": "Inserisce un blocco `mermaid` e ne propone i modelli.",
  "markdown.image": "Inserisce un'immagine, con la selezione come testo alternativo.",
  "markdown.link": "Fa della selezione un link, o toglie il link lasciandone il testo.",
  "markdown.wikilink": "Fa della selezione un collegamento `[[…]]` a un'altra nota.",
  "markdown.embed": "Incorpora nel testo un'altra nota, o un suo file, con `![[…]]`.",
  "markdown.footnote": "Inserisce un richiamo numerato e ne scrive la nota in fondo.",
  "markdown.property.add": "Apre una riga per una proprietà nuova nel frontmatter, o lo crea in cima alla nota.",
  "markdown.comment": "Nasconde la selezione dalla resa con `%%`, o la rende di nuovo visibile.",
  "markdown.underline": "Sottolinea la selezione con `<u>`, o toglie la sottolineatura.",
};

export function spec(id: string, title: string, surfaces: CommandSpec["surfaces"] = ["toolbar", "slash"]): CommandSpec {
  return {
    id, title, description: DESCRIPTIONS[id] ?? "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces,
  };
}

/// I colori non sono più offerti al «/»: restano pulsanti della barra.
export const SPECS: readonly CommandSpec[] = FORMATTING.map(([id, title]) =>
  spec(id, title, id.startsWith("markdown.color.") || id.startsWith("markdown.background.") ? ["toolbar"] : ["toolbar", "slash"]));

export const ALL = (id: string) => id.startsWith("markdown.");
