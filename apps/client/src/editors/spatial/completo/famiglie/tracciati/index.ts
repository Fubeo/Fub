// La famiglia «tracciati» del Disegno completo (piano K6, T5 e T12): il chunk
// `drawing-fam-tracciati`, che `../../carica.ts` porta quando la famiglia serve.
// Importa solo i suoi file e, per i tipi, il Completo: mai un'altra famiglia
// (la build lo vieta, `build/completo-chunks.mjs`). Pronta, registra la fila
// dei punti scelti per la Selezione diretta e il Punto di ancoraggio
// (`opzioni-punto.ts`); i ventuno strumenti di «disegnare» li sblocca la
// colonna (`../../colonna.ts`), coi nomi corti di `testi.ts`.

import type { ModuloFamiglia } from "../../carica";
import { filaPunti } from "./opzioni-punto";
import { TESTI } from "./testi";

/// Gli strumenti che hanno la fila dei punti scelti.
export const STRUMENTI_CON_I_PUNTI = ["directSelection", "anchorPoint"] as const;

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra(ctx) {
    for (const strumento of STRUMENTI_CON_I_PUNTI) ctx.registraFila(strumento, (stato, azioni, vita) => filaPunti(TESTI, stato, azioni, vita));
  },
};

export default famiglia;
