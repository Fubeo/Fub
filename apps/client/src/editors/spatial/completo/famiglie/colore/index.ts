// La famiglia «colore» del Disegno completo (piano K6, T5 e T14): il chunk `drawing-fam-colore`,
// che `../../carica.ts` porta quando la famiglia serve. Importa solo i suoi file e, per i tipi, il
// Completo: mai un'altra famiglia (la build lo vieta, `build/completo-chunks.mjs`). La sezione
// «Colore» del Design non ne ha bisogno per esserci: la mette il Completo
// (`../../colore-sezione.ts`), e i suoi comandi portano la famiglia al primo clic. Le finestre di
// Modifica colori (Satura, Regola bilanciamento colore, Sovrastampa nero) portano le loro parole
// (`testi`).

import type { ModuloFamiglia } from "../../carica";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra() {},
};

export default famiglia;
