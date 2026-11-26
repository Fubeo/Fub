// La famiglia «grafici» del Disegno completo (piano K6, T5): il chunk
// `drawing-fam-grafici`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`). Porta i testi delle
// finestre Crea grafico, Tipo di grafico e Dati del grafico (`./testi.ts`);
// `registra` non monta niente: la tabella dei dati è del Completo
// (`../../grafico-dati-finestra.ts`).

import type { ModuloFamiglia } from "../../carica";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra() {},
};

export default famiglia;
