// La famiglia «trasforma» del Disegno completo (piano K6, T13). La sezione «Allinea»
// non ne ha bisogno per esserci: la mette il Completo (`completo/allinea.ts`), dalle
// voci `align.*` dell'indice, e le sue parole stanno nel catalogo del Completo. La
// famiglia si carica al primo clic di un suo comando, come gli altri comandi pigri.

import type { ModuloFamiglia } from "../../carica";

const famiglia: ModuloFamiglia = {
  registra() {},
};

export default famiglia;
