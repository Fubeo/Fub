// Il registro degli strumenti dell'inchiostro: uno solo, per chiunque scriva a
// mano.
//
// Qui un prodotto trova *che cosa fa* uno strumento (id, capacità, ricetta del
// tratto). Come lo *offre* (icona, etichetta, tasto, livello) è del prodotto, e
// FubDraw lo tiene nel suo registro della barra con gli stessi id: un test lega
// i due (vedi `editors/spatial/tools/ink-tools.test.ts`), perché uno strumento
// che c'è da una parte sola sarebbe un pulsante morto o un comportamento senza
// pulsante.
//
// Gli strumenti di sistema (penna, evidenziatore, gomma) sono registrati
// all'avvio e non si tolgono. `InkToolRegistry` è il registro che si può
// riempire: lo usano i test e chi in futuro registrerà uno strumento da un
// componente, e ogni registrazione ha il suo disposer.

import { ERASER } from "./eraser";
import { HIGHLIGHTER } from "./highlighter";
import { PEN } from "./pen";
import { checkTool, type EraseTool, type InkTool, type StrokeTool } from "./tool";

/// Ciò che chi usa gli strumenti vede del registro.
export interface InkTools {
  get(id: string): InkTool | undefined;
  stroke(id: string): StrokeTool | undefined;
  erase(id: string): EraseTool | undefined;
  /// Nell'ordine di registrazione.
  list(): readonly InkTool[];
}

export class InkToolRegistry implements InkTools {
  private readonly tools = new Map<string, InkTool>();

  /// Registra `tool`. Lancia `RangeError` se non è fatto bene o se l'id c'è già:
  /// due strumenti con lo stesso id non si sostituiscono di nascosto. Torna il
  /// disposer, che lo toglie.
  register(tool: InkTool): () => void {
    checkTool(tool);
    if (this.tools.has(tool.id)) throw new RangeError(`strumento dell'inchiostro già registrato: ${tool.id}`);
    this.tools.set(tool.id, tool);
    return () => {
      if (this.tools.get(tool.id) === tool) this.tools.delete(tool.id);
    };
  }

  get(id: string): InkTool | undefined {
    return this.tools.get(id);
  }

  stroke(id: string): StrokeTool | undefined {
    const tool = this.tools.get(id);
    return tool?.kind === "stroke" ? tool : undefined;
  }

  erase(id: string): EraseTool | undefined {
    const tool = this.tools.get(id);
    return tool?.kind === "erase" ? tool : undefined;
  }

  list(): readonly InkTool[] {
    return [...this.tools.values()];
  }
}

/// Un registro con gli strumenti di sistema.
export function systemInkTools(): InkToolRegistry {
  const registry = new InkToolRegistry();
  for (const tool of [PEN, HIGHLIGHTER, ERASER]) registry.register(tool);
  return registry;
}

const SYSTEM = systemInkTools();

/// Gli strumenti di sistema, in sola lettura: il pacchetto che ogni prodotto
/// dell'inchiostro trova già registrato.
export const INK_TOOLS: InkTools = {
  get: (id) => SYSTEM.get(id),
  stroke: (id) => SYSTEM.stroke(id),
  erase: (id) => SYSTEM.erase(id),
  list: () => SYSTEM.list(),
};
