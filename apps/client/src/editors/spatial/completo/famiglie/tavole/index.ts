// La famiglia «tavole» del Disegno completo (piano K6, T5): il chunk
// `drawing-fam-tavole`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`). Monta la fila delle
// opzioni dello strumento Quota (`../../quota.ts`).

import type { ModuloFamiglia } from "../../carica";
import { filaQuota, STRUMENTO_QUOTA } from "../../quota";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra(ctx) {
    ctx.registraFila(STRUMENTO_QUOTA, (stato, azioni, vita) => filaQuota(stato, azioni, vita));
  },
};

export default famiglia;
