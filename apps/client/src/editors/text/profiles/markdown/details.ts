// Il ripiegabile (K2): `<details>` con il suo `<summary>` intorno a contenuto
// Markdown. Le righe vuote dopo il sommario e prima di `</details>` tengono il
// contenuto Markdown, che senza si leggerebbe come HTML: l'apertura e la
// chiusura sono due blocchi HTML di primo livello, e il contenuto sta fra loro.
// Qui c'è la regola che li accoppia, una sola per la Lettura (`render.ts`), la
// Live e i Blocchi (`details-live.ts`, `blocks/model.ts`); la stampa e
// l'export hanno la gemella in `render.rs`.

/// L'apertura riconosciuta: `<details>` o `<details open>`, poi facoltativo il
/// sommario `<summary>testo</summary>`, sulla stessa riga o sulla seguente, e
/// nient'altro. Un sommario con altri tag dentro, o del testo dopo, resta HTML.
const HEAD = /^[ \t]{0,3}<details(?:[ \t]+(open)(?:[ \t]*=[ \t]*(?:""|''|"open"|'open'))?)?[ \t]*>[ \t]*(?:\r?\n[ \t]*)?(?:<summary>([^<\r\n]*)<\/summary>[ \t]*)?(?:\r?\n)?$/i;
const CLOSE = /^[ \t]{0,3}<\/details[ \t]*>[ \t]*(?:\r?\n)?$/i;

/// L'apertura nel testo di un blocco HTML: se è aperta di norma e dove sta il
/// testo del sommario, in posizioni del testo dato.
export interface DetailsHead {
  readonly open: boolean;
  readonly summary: { readonly from: number; readonly to: number } | null;
}

export function detailsHead(text: string): DetailsHead | null {
  const found = HEAD.exec(text);
  if (!found) return null;
  if (found[2] === undefined) return { open: found[1] !== undefined, summary: null };
  const from = text.toLowerCase().lastIndexOf("<summary>") + "<summary>".length;
  return { open: found[1] !== undefined, summary: { from, to: from + found[2].length } };
}

export function isDetailsClose(text: string): boolean {
  return CLOSE.test(text);
}

/// Un blocco di primo livello, per l'accoppiamento.
export interface TopBlock {
  readonly from: number;
  readonly to: number;
  /// Il testo del blocco, se è un blocco HTML; `null` per ogni altro.
  readonly html: string | null;
}

/// Un ripiegabile accoppiato: l'apertura, la chiusura, quanti ne ha intorno.
export interface DetailsPair {
  readonly open: { readonly from: number; readonly to: number };
  readonly close: { readonly from: number; readonly to: number };
  readonly head: DetailsHead;
  readonly depth: number;
}

/// Le aperture accoppiate alla loro chiusura, in ordine d'apertura, e quelle
/// rimaste senza: il ripiegabile annidato chiude prima di quello che lo
/// contiene. Una chiusura senza apertura resta HTML.
export function pairDetails(blocks: readonly TopBlock[]): { pairs: DetailsPair[]; unclosed: { from: number; to: number }[] } {
  const pairs: (DetailsPair | null)[] = [];
  const stack: { index: number; block: TopBlock; head: DetailsHead }[] = [];
  for (const block of blocks) {
    if (block.html === null) continue;
    const head = detailsHead(block.html);
    if (head) {
      stack.push({ index: pairs.length, block, head });
      pairs.push(null);
    } else if (isDetailsClose(block.html)) {
      const opened = stack.pop();
      if (!opened) continue;
      pairs[opened.index] = {
        open: { from: opened.block.from, to: opened.block.to },
        close: { from: block.from, to: block.to },
        head: opened.head,
        depth: stack.length,
      };
    }
  }
  return {
    pairs: pairs.filter((pair): pair is DetailsPair => pair !== null),
    unclosed: stack.map(({ block }) => ({ from: block.from, to: block.to })),
  };
}
