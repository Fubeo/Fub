// La famiglia «effetti» del Disegno completo (piano K6, T5): il chunk
// `drawing-fam-effetti`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`). Le voci del menu Effetto
// girano da sole (`disegno.effect.apply` col loro effetto, le finestre dagli
// schemi generati): la famiglia porta i nomi dei campi, e `registra` non
// monta niente.

import type { ModuloFamiglia } from "../../carica";
import { TESTI } from "./testi";

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra() {},
};

export default famiglia;
