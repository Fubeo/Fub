// Gli indirizzi dei PDF e la riga «Pagina N di M»: ciò che il controllo dei
// documenti, il registro degli editor e il visore leggono senza il visore. Sta
// fuori da `pdf-view.ts` perché il visore arriva con un `import()` soltanto
// quando si apre un PDF; `pdf-view.ts` li riesporta.
import { t } from "../../i18n/strings";

/** Il frammento `#page=3` / `?page=3` di un DocId: 1-based, come i lettori. */
export function pdfPageFromFragment(id: string): number | null {
  const hash = id.indexOf("#");
  const query = id.indexOf("?");
  let fragment = "";
  if (hash >= 0) fragment = id.slice(hash + 1);
  else if (query >= 0) fragment = id.slice(query + 1);
  if (!fragment) return null;
  const match = /(?:^|&)page=(\d+)/.exec(fragment);
  if (!match) return null;
  const page = Number(match[1]);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return page;
}

/** L'id senza frammento: `doc/manuale.pdf#page=3` nomina il PDF. */
export function pdfIdWithoutFragment(id: string): string {
  const hash = id.indexOf("#");
  const query = id.indexOf("?");
  const cut = hash >= 0 ? hash : query;
  return cut >= 0 ? id.slice(0, cut) : id;
}

/** Dove si legge: la pagina davanti, la compagna nella vista a due pagine, quante sono. */
export interface PdfWhere {
  readonly first: number;
  /// La seconda pagina affiancata, o `null` con una pagina sola davanti.
  readonly last: number | null;
  readonly count: number;
}

/** «Pagina N di M», o «Pagine N–N+1 di M» con due pagine affiancate. */
export function pdfWhereText(where: PdfWhere): string {
  return where.last === null
    ? t("media.pdf.page", { page: where.first, count: where.count })
    : t("media.pdf.pages", { first: where.first, last: where.last, count: where.count });
}
