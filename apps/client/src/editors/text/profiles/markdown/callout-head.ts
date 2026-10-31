// La testata di un callout, `[!tipo]±titolo`: una sola espressione per la
// Lettura (`render.ts`) e la Live (`callout.ts`, `livepreview.ts`).

/// La testata di un callout, sulla prima riga senza i `>`.
export const CALLOUT_HEAD = /^\[!([^\]]+)\]([+-])?[ \t]*(.*)$/;

/// La testata nella riga `text` (con i `>`): dove stanno tipo, ripiegatura e
/// titolo, in colonne della riga.
export interface CalloutHead {
  readonly type: string;
  /// `[!tipo]` e, se c'è, il segno di ripiegatura.
  readonly mark: { from: number; to: number };
  readonly typeText: { from: number; to: number };
  readonly fold: "+" | "-" | null;
  readonly title: { from: number; to: number };
}

export function calloutHead(text: string): CalloutHead | null {
  const prefix = /^\s*(?:>\s?)+/.exec(text);
  if (!prefix) return null;
  let at = prefix[0].length;
  while (text[at] === " " || text[at] === "\t") at++;
  const found = CALLOUT_HEAD.exec(text.slice(at));
  if (!found) return null;
  const fold = (found[2] ?? null) as "+" | "-" | null;
  const markTo = at + 2 + found[1]!.length + 1 + (fold ? 1 : 0);
  let titleFrom = markTo;
  while (text[titleFrom] === " " || text[titleFrom] === "\t") titleFrom++;
  return {
    type: found[1]!.trim().toLowerCase(),
    mark: { from: at, to: markTo },
    typeText: { from: at + 2, to: at + 2 + found[1]!.length },
    fold,
    title: { from: titleFrom, to: text.trimEnd().length },
  };
}
