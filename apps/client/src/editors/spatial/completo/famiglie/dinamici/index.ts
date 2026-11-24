// La famiglia «dinamici» del Disegno completo (piano K6, T5): il chunk
// `drawing-fam-dinamici`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`). Porta solo i testi della
// finestra delle Opzioni fusione: `registra` non monta niente.

import type { ModuloFamiglia } from "../../carica";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra() {},
};

export default famiglia;
