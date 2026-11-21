// Gli strumenti del motore visti dall'editor (piano K6, T8; `docs/product/
// drawing.md`, «La colonna»). Uno strumento del motore manda
// `DrawingTool::Engine { id }` (`host/contract.ts`: `{ engine: { id } }`). Qui
// stanno le tre regole che l'editor ne ricava, senza DOM e senza motore:
//
// - **Il nome nel contratto.** `motoreDelloStrumento(id)` è lo strumento che
//   il gesto manda.
// - **Il cursore.** `DrawingToolState.cursor` è un nome in `snake_case`; una
//   tabella lo traduce in un `cursor` CSS. Uno sconosciuto è la freccia di
//   serie, come dice il contratto.
// - **Lo stato fra un gesto e l'altro.** Le opzioni e il cursore dell'ultimo
//   esito restano per lo strumento, e un'opzione cambiata durante un gesto
//   vale dal gesto dopo: chi legge lo stato lo prende dall'esito che l'ha
//   portato, mai da quello in volo.
// - **La famiglia che arriva.** Uno strumento scelto mentre la sua famiglia si
//   prepara aspetta; se la preparazione fallisce, il gesto non parte, e lo
//   strumento di prima resta (`sceltaMentrePrepara`).

import type { DrawingTool, DrawingToolState } from "../../../host/contract";

/// Lo strumento del motore con quell'id, nel nome del contratto.
export function motoreDelloStrumento(id: string): DrawingTool {
  return { engine: { id } };
}

/// Il cursore di serie, quando lo strumento non ne dice uno che si conosce.
export const CURSORE_DI_SERIE = "default";

/// I nomi che il motore dà al cursore, e il `cursor` CSS che ne viene. Chi
/// aggiunge un nome lo aggiunge qui; uno sconosciuto è `CURSORE_DI_SERIE`.
const CURSORI: Readonly<Record<string, string>> = {
  arrow: "default",
  move: "move",
  crosshair: "crosshair",
  pen: "crosshair",
  pen_close: "pointer",
  text: "text",
};

/// Il `cursor` CSS per il cursore del motore `nome`.
export function cursoreCss(nome: string): string {
  return Object.prototype.hasOwnProperty.call(CURSORI, nome) ? CURSORI[nome]! : CURSORE_DI_SERIE;
}

/// Lo stato di ogni strumento del motore, come l'ha lasciato l'ultimo esito che
/// l'ha portato.
export class StatiStrumenti {
  readonly #stati = new Map<string, DrawingToolState>();

  /// Lo stato che lo strumento `id` ha dall'ultimo esito; `null` se non ne ha.
  stato(id: string): DrawingToolState | null {
    return this.#stati.get(id) ?? null;
  }

  /// Un esito arrivato porta lo stato dello strumento: il gesto dopo lo legge.
  registra(id: string, stato: DrawingToolState): void {
    this.#stati.set(id, stato);
  }
}

/// Che cosa fa uno strumento scelto mentre la sua famiglia arriva: `attendi`
/// (la casella dice che si prepara, il gesto aspetta), `avvia` (la famiglia è
/// pronta), `errore` (non è arrivata: l'errore dice «Riprova» e lo strumento di
/// prima resta).
export type SceltaMentrePrepara = "attendi" | "avvia" | "errore";

export function sceltaMentrePrepara(preparazione: "in-corso" | "pronta" | "fallita"): SceltaMentrePrepara {
  if (preparazione === "pronta") return "avvia";
  return preparazione === "in-corso" ? "attendi" : "errore";
}
