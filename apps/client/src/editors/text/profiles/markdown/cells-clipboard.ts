// Da dove vengono le celle copiate da un foglio di Fub (T52): il foglio lo
// scrive negli appunti con un tipo suo, e la nota lo legge all'incolla per
// offrire «Incolla come scheda». Un modulo piccolo e senza dipendenze, perché
// lo importa anche la superficie del foglio.

/// Da dove vengono le celle copiate da un foglio del vault: il file, il
/// foglio e l'intervallo.
export interface CellsOrigin {
  readonly doc: string;
  readonly sheet: string;
  readonly range: string;
}

/// Il tipo degli appunti con cui un foglio di Fub dice da dove vengono le
/// celle copiate. Gli altri programmi non lo leggono.
export const FUB_CELLS_TYPE = "application/x-fub-cells";

/// L'ultima copia da un foglio, per i motori che non tengono i tipi propri
/// negli appunti: vale soltanto se il testo incollato è lo stesso.
let lastCopy: { readonly text: string; readonly origin: CellsOrigin } | null = null;

/// Un foglio di Fub ha copiato `text` dalle celle `origin`.
export function rememberCellsCopy(text: string, origin: CellsOrigin): void {
  lastCopy = text === "" ? null : { text, origin };
}

/// Da dove vengono le celle degli appunti, se un foglio di Fub lo ha detto.
export function cellsOrigin(data: { getData(type: string): string }): CellsOrigin | null {
  const declared = data.getData(FUB_CELLS_TYPE);
  if (declared) {
    try {
      const value = JSON.parse(declared) as Partial<CellsOrigin>;
      if (typeof value.doc === "string" && typeof value.sheet === "string" && typeof value.range === "string") {
        return { doc: value.doc, sheet: value.sheet, range: value.range };
      }
    } catch {
      // Un tipo scritto da altri: non dice niente.
    }
  }
  const text = data.getData("text/plain");
  return lastCopy !== null && text !== "" && normalizedTsv(text) === normalizedTsv(lastCopy.text) ? lastCopy.origin : null;
}

const normalizedTsv = (text: string) => text.replace(/\r\n?/gu, "\n").replace(/\n$/u, "");
