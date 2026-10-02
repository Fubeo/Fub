// Gli id che FubDraw dà agli elementi che crea (formato della scena, §7).
//
// Un oggetto ha `o` seguito da 8 caratteri base36 casuali, un livello `l`
// seguito da 8, la carta `fub-paper`. Il caso viene da `crypto.getRandomValues`
// e ogni carattere è uniforme: un byte vale solo sotto 252, il più grande
// multiplo di 36 che sta in un byte, così nessuna cifra esce più spesso delle
// altre. Un id già usato nel documento si scarta e se ne genera un altro.
//
// FubDraw non cambia mai un id esistente: questi id sono solo per gli
// elementi nuovi, e per quelli che ricevono un id con l'operazione `ident`.

/// L'id della carta (§2).
export const PAPER_ID = "fub-paper";

/// Che cosa riceve l'id: un oggetto qualunque o un livello.
export type IdKind = "object" | "layer";

/// Quanti caratteri casuali seguono il prefisso.
export const ID_RANDOM_LENGTH = 8;

const PREFIX: Readonly<Record<IdKind, string>> = { object: "o", layer: "l" };

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/// Il byte più grande che si usa, escluso: 7 × 36.
const UNBIASED = 252;

const PATTERN: Readonly<Record<IdKind, RegExp>> = {
  object: /^o[0-9a-z]{8}$/,
  layer: /^l[0-9a-z]{8}$/,
};

/// Quante volte si ritenta prima di arrendersi: con 36⁸ id possibili un
/// documento non ne esaurisce mai abbastanza da arrivarci, quindi arrivarci
/// vuol dire una sorgente di caso guasta.
const MAX_ATTEMPTS = 1_000;

/// Riempie `bytes` di byte casuali.
export type RandomBytes = (bytes: Uint8Array) => void;

const cryptoBytes: RandomBytes = (bytes) => {
  crypto.getRandomValues(bytes);
};

/// Vero se `id` ha la forma degli id nuovi di `kind`.
export function isNewId(id: string, kind: IdKind): boolean {
  return PATTERN[kind].test(id);
}

/// Un id nuovo di `kind` che `taken` non conosce.
export function createId(kind: IdKind, taken: (id: string) => boolean, random: RandomBytes = cryptoBytes): string {
  // Un byte su 64 circa si scarta: 16 bastano quasi sempre per 8 caratteri.
  const bytes = new Uint8Array(16);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let id = PREFIX[kind];
    while (id.length < ID_RANDOM_LENGTH + 1) {
      random(bytes);
      for (const byte of bytes) {
        if (byte >= UNBIASED) continue;
        id += BASE36[byte % 36];
        if (id.length === ID_RANDOM_LENGTH + 1) break;
      }
    }
    if (!taken(id)) return id;
  }
  throw new Error(`nessun id libero dopo ${MAX_ATTEMPTS} tentativi: la sorgente di caso non è casuale`);
}
