// La famiglia «colore» del Disegno completo (piano K6, T5 e T14): il chunk `drawing-fam-colore`,
// che `../../carica.ts` porta quando la famiglia serve. Importa solo i suoi file e, per i tipi, il
// Completo: mai un'altra famiglia (la build lo vieta, `build/completo-chunks.mjs`). La sezione
// «Colore» del Design non ne ha bisogno per esserci: la mette il Completo
// (`../../colore-sezione.ts`), e i suoi comandi portano la famiglia al primo clic. Le finestre di
// Modifica colori (Satura, Regola bilanciamento colore, Sovrastampa nero) portano le loro parole
// (`testi`).

import type { ModuloFamiglia } from "../../carica";
import { filaContagocce } from "./opzioni-contagocce";
import { TESTI } from "./testi";

/// Il Contagocce (K6 T14, giro 7): la sua fila delle opzioni, dalle preferenze del motore.
export const STRUMENTO_CONTAGOCCE = "eyedropper";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra(ctx) {
    ctx.registraFila(STRUMENTO_CONTAGOCCE, (_stato, azioni, vita) => filaContagocce(azioni, vita));
  },
};

export default famiglia;
