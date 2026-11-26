// Il catalogo delle stringhe della shell: **solo dati**.
//
// Sta in file suoi, che non importano niente fuori dal catalogo, per una
// ragione di peso e una di forma. Di peso: è testo, cresce con ogni superficie
// e lo leggono tutte le finestre, quindi ha un chunk col suo nome
// (`shell-strings` in `vite.config.ts`) invece di consumare il margine del
// chunk condiviso. Di forma: `strings.ts` importa `host/query`, che importa
// `t` da `strings.ts`; un chunk che contenesse anche quel ciclo lo
// spezzerebbe fra due file. Qui non c'è niente da cui dipendere.
//
// Le voci stanno in parti per area (`catalog-it-<area>.ts`, ognuna senza
// import), montate qui in `IT` nell'ordine di sempre; l'inglese ha le stesse
// parti (`catalog-en-<area>.ts`), con le chiavi della parte italiana.
//
// Come si scelgono le stringhe, la scala di ripiego e `t()` stanno in
// `strings.ts`.

import { IT_CORNICE } from "./catalog-it-cornice";
import { IT_ESPLORA } from "./catalog-it-esplora";
import { IT_TELEFONO } from "./catalog-it-telefono";
import { IT_LAVAGNA } from "./catalog-it-lavagna";
import { IT_MENU } from "./catalog-it-menu";

/// Il catalogo italiano. È anche la **forma** del catalogo: le altre lingue
/// devono avere le sue chiavi, tutte, o non compilano.
export const IT = {
  ...IT_CORNICE,
  ...IT_ESPLORA,
  ...IT_TELEFONO,
  ...IT_LAVAGNA,
  ...IT_MENU,
} as const;

/// Una chiave del catalogo della shell.
export type Key = keyof typeof IT;

/// L'inglese sta in `catalog-en.ts`, col suo chunk: le due lingue insieme
/// passavano il budget di un chunk.
export { EN } from "./catalog-en";
