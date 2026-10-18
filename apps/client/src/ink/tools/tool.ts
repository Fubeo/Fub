// Il contratto di uno strumento dell'inchiostro: ciò che una penna, un
// evidenziatore o una gomma sono, senza dire dove vivono.
//
// Uno strumento è **dati più funzioni pure**: un id stabile, ciò che sa fare
// (`capabilities`) e la ricetta del suo tratto. Non tiene stato, non conosce
// una scena, una camera o un formato di file; chi lo usa porta lo stato (il
// tratto in corso, il livello di destinazione, l'annulla) e lo scrive nel suo
// formato. Per questo si può registrare nello stesso registro dei prodotti che
// ne hanno bisogno, oggi come pacchetto di sistema (vedi `registry.ts`) e
// domani, senza cambiare il contratto, dietro un componente: le funzioni non
// toccano il DOM e prendono e danno solo numeri e oggetti semplici.
//
// Sono due i generi: lo strumento che **scrive** un tratto (penna,
// evidenziatore) e quello che **cancella** (gomma). Lo condividono la stessa
// pipeline dei campioni (`input/`) e la stessa geometria (`geometry.ts`).

import type { Pf1Brush } from "../brush";
import type { InkPointerType } from "../input/pointer";

/// L'id di uno strumento: minuscole, cifre e trattini, come i nomi del
/// registro dei prodotti, perché è anche ciò che il file scrive (`fub:tool`).
export const TOOL_ID = /^[a-z][a-z0-9-]*$/;

/// Ciò che sa fare uno strumento che scrive. Sono le domande che un prodotto
/// si faceva con `if (tool === "pen")`: qui hanno un nome e una risposta per
/// strumento.
export interface StrokeCapabilities {
  /// Lo spessore segue la pressione quando il dispositivo la dà.
  readonly pressure: boolean;
  /// Con il tasto di raddrizzamento il tratto va dritto dal primo all'ultimo
  /// punto.
  readonly straightWithModifier: boolean;
  /// Il tratto si ripete nelle copie di una simmetria.
  readonly symmetry: boolean;
  /// Tenendolo fermo alla fine, il tratto può diventare una forma.
  readonly holdsToShape: boolean;
  /// Il tratto può passare dallo stabilizzatore.
  readonly stabilizes: boolean;
}

/// Com'è nato un tratto, per scegliere il suo pennello.
export interface StrokeInput {
  /// Il dispositivo dà la pressione (penna): senza, mouse e dito, la pressione
  /// si simula dalla velocità.
  readonly pressure: boolean;
  /// Il tratto continua uno chiuso al limite dei campioni.
  readonly continued: boolean;
}

/// Uno strumento che scrive un tratto.
export interface StrokeTool {
  readonly kind: "stroke";
  readonly id: string;
  /// Quanto il tratto copre: 1 pieno, meno di 1 si vede attraverso e il file lo
  /// scrive come opacità del riempimento.
  readonly opacity: number;
  readonly capabilities: StrokeCapabilities;
  /// Il pennello di un tratto di spessore `width`.
  brush(width: number, input: StrokeInput): Pf1Brush;
}

/// Uno strumento che cancella ciò che il puntatore attraversa.
export interface EraseTool {
  readonly kind: "erase";
  readonly id: string;
  /// Il raggio della gomma in pixel dello schermo: col dito più largo, perché
  /// il polpastrello copre ciò che si cancella.
  radius(pointer: InkPointerType): number;
}

export type InkTool = StrokeTool | EraseTool;

/// Il pennello di un seguito di tratto: dopo la giunzione non si assottiglia,
/// perché il tratto che continua non ricomincia da una punta.
export function joined(brush: Pf1Brush, input: StrokeInput): Pf1Brush {
  return input.continued ? { ...brush, taperStart: 0 } : brush;
}

/// Il pennello del pezzo di un tratto diviso al limite dei campioni: il pezzo
/// che segue continua, quindi quello che si chiude lì non si assottiglia.
export function closedAtLimit(brush: Pf1Brush, split: boolean): Pf1Brush {
  return split ? { ...brush, taperEnd: 0 } : brush;
}

/// Lo strumento `tool` è fatto bene? Lancia `RangeError` altrimenti: lo chiede il
/// registro prima di accettarlo, perché un id sbagliato o un'opacità fuori
/// scala si scoprano alla registrazione e non al primo tratto.
export function checkTool(tool: InkTool): void {
  if (!TOOL_ID.test(tool.id)) throw new RangeError(`id dello strumento non valido: ${JSON.stringify(tool.id)}`);
  if (tool.kind === "stroke" && !(tool.opacity > 0 && tool.opacity <= 1)) {
    throw new RangeError(`opacità di ${tool.id} fuori da (0, 1]: ${tool.opacity}`);
  }
}
