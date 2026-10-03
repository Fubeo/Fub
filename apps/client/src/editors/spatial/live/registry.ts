// Il punto d'incontro della sessione live di un disegno: ciò che la shell, la
// superficie e la sessione si devono dire senza che il codice della sessione
// sia caricato.
//
// La sessione (`session.ts` e i suoi moduli) arriva con un `import()` alla
// prima «Avvia sessione live»: chi non la usa non la scarica. Questo modulo
// invece è piccolo e sta con la shell, perché lo leggono tutti e tre:
//
// - **i comandi**, per sapere se un disegno ha già una sessione;
// - **la superficie**, che offre il suo foglio (`offerStage`) e annota
//   l'operazione di ogni gesto (`noteSceneChange`);
// - **la sessione**, che disegna sui fogli offerti e manda allo scrittore le
//   operazioni nate sul PC.

import { registerDocumentCache } from "../../../state/document-caches";
import type { Op } from "../scene/ops";
import type { DrawStage } from "../tools/editor";

/// Un foglio del disegno montato in un riquadro.
export interface LiveStage {
  /// La superficie del disegno, dove la sessione mette il suo indicatore.
  readonly root: HTMLElement;
  readonly stage: DrawStage;
  /// Il foglio si vede: Disegno, e non Lettura.
  visible(): boolean;
}

/// Una sessione live aperta, vista da fuori.
export interface LiveHandle {
  /// Il documento, adesso: segue le rinomine.
  readonly doc: string;
  /// Apre il pannello della sessione.
  show(): void;
  /// «Termina»: risponde ai commit rimasti e chiude.
  stop(): Promise<void>;
}

/// I fogli offerti, col documento che mostrano adesso.
const stages = new Map<LiveStage, string>();
let renames: (() => void) | null = null;
const listeners = new Set<() => void>();
const sessions = new Set<LiveHandle>();
let noted: { readonly text: string; readonly op: Op } | null = null;

function changed(): void {
  for (const listener of [...listeners]) listener();
}

/// Offre il foglio di un editor montato sul documento `doc`. Il ritorno lo
/// ritira.
export function offerStage(doc: string, stage: LiveStage): () => void {
  // Il riquadro può restare montato mentre il file cambia nome: il foglio
  // segue il documento, come la sessione.
  renames ??= registerDocumentCache({
    invalidate: () => {},
    rename: (from, to) => {
      for (const [offered, shown] of stages) if (shown === from) stages.set(offered, to);
    },
  });
  stages.set(stage, doc);
  changed();
  return () => {
    if (stages.delete(stage)) changed();
  };
}

/// I fogli montati sul documento `doc`.
export function stagesOf(doc: string): LiveStage[] {
  return [...stages].filter(([, shown]) => shown === doc).map(([stage]) => stage);
}

/// Avvisa quando un foglio arriva o se ne va. Il ritorno smette.
export function onStages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/// Annota l'operazione che ha portato il disegno a `text`. La superficie la
/// scrive prima di consegnare il gesto alla `DocumentSession`, e la sessione
/// live la ritrova nella diffusione che segue, nello stesso giro.
export function noteSceneChange(text: string, op: Op): void {
  noted = { text, op };
}

/// L'operazione annotata per `text`, una volta sola.
export function takeSceneChange(text: string): Op | null {
  const found = noted;
  noted = null;
  return found !== null && found.text === text ? found.op : null;
}

export function addLive(handle: LiveHandle): void {
  sessions.add(handle);
  changed();
}

export function removeLive(handle: LiveHandle): void {
  if (sessions.delete(handle)) changed();
}

/// La sessione del documento `doc`, se c'è.
export function liveFor(doc: string): LiveHandle | null {
  for (const handle of sessions) if (handle.doc === doc) return handle;
  return null;
}

/// Le sessioni aperte, nell'ordine in cui sono partite.
export function liveSessions(): readonly LiveHandle[] {
  return [...sessions];
}
