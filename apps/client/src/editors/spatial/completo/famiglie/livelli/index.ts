// La famiglia «livelli» del Disegno completo (piano K6, T5): il chunk
// `drawing-fam-livelli`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`).

import type { ModuloFamiglia } from "../../carica";
import { filaBacchetta } from "./fila-bacchetta";
import { TESTI } from "./testi";

/// La Bacchetta magica: la sua fila delle opzioni, dalla sessione del motore.
export const STRUMENTO_BACCHETTA = "magicWand";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra(ctx) {
    ctx.registraFila(STRUMENTO_BACCHETTA, (_stato, azioni, vita) => filaBacchetta(azioni, vita));
  },
};

export default famiglia;
