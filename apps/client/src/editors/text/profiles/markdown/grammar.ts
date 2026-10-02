import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Language } from "@codemirror/language";

/// La definizione di una nota a piè di pagina, con la regola di comrak:
/// `[^etichetta]:` in testa al blocco, un'etichetta senza spazi e gli spazi
/// che seguono i due punti.
export const FOOTNOTE_DEFINITION = /^\[\^([^\] \t\r\n]+)\]:[ \t]*/;

type MarkdownConfig = Exclude<
  NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>,
  readonly unknown[]
>;
type BlockParser = NonNullable<MarkdownConfig["parseBlock"]>[number];
type LeafBlock = Parameters<NonNullable<BlockParser["leaf"]>>[1];

/// La sottolineatura di un titolo setext fatta di `-`.
const DASHES = /^-+[ \t]*$/;

/// Si prende la foglia di una definizione di nota, che resta un paragrafo.
///
/// comrak legge la definizione come un blocco suo, con un paragrafo dentro.
/// Lezer non conosce le note: quando il contenuto è una parola sola
/// (`[^1]: $x$`) ne fa un riferimento di link, non ne legge gli inline e la
/// chiude a fine riga, così la riga seguente diventa un altro blocco. Con più
/// parole ne faceva già un paragrafo, ma una riga di `-` sotto ne faceva un
/// titolo e una di pipe una tabella. Il paragrafo è la forma che la shell
/// legge già come definizione.
class FootnoteDefinitionParser {
  nextLine(_cx: unknown, _line: unknown, leaf: LeafBlock): boolean {
    return this.own(leaf);
  }

  finish(_cx: unknown, leaf: LeafBlock): boolean {
    return this.own(leaf);
  }

  /// Toglie gli altri parser alla foglia. Questo è il primo, e Lezer li
  /// interroga in ordine sullo stesso array: chi viene dopo non la reclama.
  private own(leaf: LeafBlock): false {
    leaf.parsers.splice(0, leaf.parsers.length, this);
    return false;
  }
}

/// La riga chiude la foglia, e comincia un blocco suo, dove la chiude comrak.
function endsLeaf(text: string, leaf: LeafBlock): boolean {
  // Una definizione interrompe un paragrafo, una tabella, la riga pigra di una
  // citazione o di una voce, e la definizione che la precede.
  if (FOOTNOTE_DEFINITION.test(text)) return true;
  if (!leaf.parsers.some((parser) => parser instanceof FootnoteDefinitionParser)) return false;
  // Una riga di `-` sotto la definizione non sta dentro la nota: la chiude e
  // traccia una riga orizzontale.
  if (DASHES.test(text)) return true;
  // Una definizione senza corpo non ha un paragrafo che la riga continui: le
  // resta soltanto una riga rientrata, che Lezer non chiede qui.
  return FOOTNOTE_DEFINITION.exec(leaf.content)![0].length === leaf.content.length;
}

const footnoteDefinitions: MarkdownConfig = {
  parseBlock: [{
    name: "FootnoteDefinition",
    before: "LinkReference",
    leaf: (_cx, leaf) => FOOTNOTE_DEFINITION.test(leaf.content) ? new FootnoteDefinitionParser() : null,
    endLeaf: (_cx, line, leaf) => endsLeaf(line.text.slice(line.pos), leaf),
  }],
};

/// La grammatica Markdown della shell: quella di CodeMirror con le
/// definizioni di nota. Editor, Lettura e widget leggono lo stesso albero.
export const markdownGrammar: Language = markdown({ base: markdownLanguage, extensions: footnoteDefinitions }).language;
