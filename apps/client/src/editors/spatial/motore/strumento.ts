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
import type { Teardown } from "../../../ui/lifetime";

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

/// Gli strumenti del motore che disegnano: con «Usa cursori di precisione» mostrano la croce al posto del
/// cursore di serie (K6 T11, cursori). Sono la penna e la penna intelligente, la matita, le forme (il
/// rettangolo, il rettangolo arrotondato, l'ellisse, il poligono, la stella, il segmento, l'arco, la spirale
/// e le due griglie), i pennelli (non ancora nella colonna: T17) e la gomma dei punti di ancoraggio. La
/// selezione, il testo, i tracciati e le trasformazioni tengono il loro cursore.
export const STRUMENTI_CHE_DISEGNANO: ReadonlySet<string> = new Set([
  "pen",
  "smartPen",
  "pencil",
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "polygon",
  "star",
  "lineSegment",
  "arc",
  "spiral",
  "rectangularGrid",
  "polarGrid",
  "paintbrush",
  "blobBrush",
  "anchorEraserBrush",
]);

/// Il `cursor` CSS che lo strumento del motore `id` mostra sulla superficie. `null` vuol dire nessuno strumento
/// del motore scelto: il cursore è quello di serie. `nome` è il cursore che lo strumento dice nel suo stato,
/// `undefined` finché lo stato non si legge. Con la voce accesa, uno strumento che disegna mostra la croce.
export function cursoreDelloStrumento(id: string | null, nome: string | undefined, preciso: boolean): string {
  if (id === null) return "";
  if (preciso && STRUMENTI_CHE_DISEGNANO.has(id)) return "crosshair";
  return nome === undefined ? "" : cursoreCss(nome);
}

/// Lo stato di ogni strumento del motore, come l'ha lasciato l'ultimo esito che
/// l'ha portato. Chi mostra lo stato (la fila delle opzioni) si iscrive con
/// `ascolta`: ogni iscrizione ha il suo disposer, e dopo quello non riceve più
/// niente.
export class StatiStrumenti {
  readonly #stati = new Map<string, DrawingToolState>();
  readonly #ascolti = new Set<(id: string) => void>();

  /// Lo stato che lo strumento `id` ha dall'ultimo esito; `null` se non ne ha.
  stato(id: string): DrawingToolState | null {
    return this.#stati.get(id) ?? null;
  }

  /// Un esito arrivato porta lo stato dello strumento: il gesto dopo lo legge, e
  /// chi ascolta lo sa, con l'id dello strumento.
  registra(id: string, stato: DrawingToolState): void {
    this.#stati.set(id, stato);
    for (const ascolto of [...this.#ascolti]) if (this.#ascolti.has(ascolto)) ascolto(id);
  }

  /// Avvisa a ogni stato registrato, con l'id dello strumento. Il ritorno smette
  /// questo ascoltatore, e solo lui.
  ascolta(ascolto: (id: string) => void): Teardown {
    this.#ascolti.add(ascolto);
    return () => {
      this.#ascolti.delete(ascolto);
    };
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
