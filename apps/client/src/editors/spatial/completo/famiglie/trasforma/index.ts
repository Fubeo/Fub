// La famiglia «trasforma» del Disegno completo (piano K6, T13). La sezione «Allinea» non ne ha
// bisogno per esserci: la mette il Completo (`completo/allinea.ts`), dalle voci `align.*`
// dell'indice. Le finestre con anteprima di Sposta, Ruota, Scala, Rifletti e Inclina portano le
// loro parole (`testi`); la famiglia si carica al primo clic di un suo comando, come gli altri
// comandi pigri.

import type { ModuloFamiglia } from "../../carica";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra() {},
};

export default famiglia;
