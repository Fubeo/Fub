// L'ingresso del Disegno completo (piano K6, T5;
// `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// `chrome/workspace.ts` lo porta con un `import()` quando si entra nel
// Completo col componente «Disegno completo» acceso; Vite lo mette nel chunk
// `drawing-completo`, che nessuna pagina carica all'avvio. Terrà i pezzi della
// cornice del Completo (lo spazio, la colonna, le opzioni, i tasti e le
// sezioni), e dà l'indice dei comandi e il caricatore delle famiglie. Oggi
// `apri` porta l'indice e prepara il nucleo, e basta.

import { caricatore, type Caricatore, type ContestoCompleto, type OpzioniCaricatore } from "./carica";
import { creaSezioni, type Sezioni } from "./sezioni";
import type { Indice } from "./indice";
// Blocco degli spazi del Completo (T7): i preset e la loro applicazione.
import { applicaSpazio, presetDi, type EffettiSpazio } from "./spazi";
export type { EffettiSpazio, SchedaSpazio, SpazioPreset } from "./spazi";

export type { Caricatore, ContestoCompleto, StatoFamiglia, PercheErrore, ModuloFamiglia } from "./carica";
export type { Indice, VoceIndice } from "./indice";
export { registraSezione, type ContestoSezione, type Scheda, type Selezione, type Sezione, type Sezioni } from "./sezioni";

/// La famiglia che ogni Completo aperto prepara subito.
export const NUCLEO = "nucleo";

export interface Completo {
  /// L'indice dei comandi: lo stesso per ogni chiamata finché arriva; se non
  /// è arrivato, la chiamata dopo («Riprova») lo chiede di nuovo.
  indice(): Promise<Indice>;
  readonly carica: Caricatore;
  /// Le sezioni dell'ispettore che le famiglie registrano (T10); il pannello
  /// Risorse e le sezioni del Design le leggono di qui.
  readonly sezioni: Sezioni;
  /// Il disegno si chiude: gli esiti in volo si buttano.
  chiudi(): void;
  /// Applica lo spazio `space` del Completo (un preset, o `full` per i dati di
  /// serie): la scheda, la sezione, e le famiglie da preparare.
  spazio(space: string, effetti: EffettiSpazio): void;
}

export interface OpzioniCompleto {
  /// Chi porta l'indice; di serie `indice()` di `./indice`, nel suo chunk.
  readonly indice?: () => Promise<Indice>;
  readonly moduli?: OpzioniCaricatore["moduli"];
  readonly prepara?: OpzioniCaricatore["prepara"];
}

/// L'indice vero, dal suo chunk (`drawing-indice`).
const indiceVero = (): Promise<Indice> => import("./indice").then((m) => m.indice());

/// Apre il Completo di un disegno: chiede l'indice e prepara il nucleo. Un
/// indice che non arriva non ferma niente: chi lo mostra (≡, Ctrl+/) lo
/// richiede e dice che non si è caricato, con «Riprova».
export function apri(ctx: Omit<ContestoCompleto, "sezioni">, opzioni: OpzioniCompleto = {}): Completo {
  const indice = opzioni.indice ?? indiceVero;
  const sezioni = creaSezioni();
  const carica = caricatore({ ctx: { ...ctx, sezioni }, moduli: opzioni.moduli, prepara: opzioni.prepara });
  let chiuso = false;
  const completo: Completo = {
    indice,
    carica,
    sezioni,
    chiudi() {
      if (chiuso) return;
      chiuso = true;
      carica.chiudi();
      sezioni.chiudi();
    },
    spazio(space, effetti) {
      // Il Completo di serie non apre niente: una scheda aperta farebbe
      // cambiare il fuoco dell'editor appena il Completo arriva.
      const preset = presetDi(space);
      if (preset === null) return;
      applicaSpazio(preset, effetti, carica);
    },
  };
  ctx.life.add(() => completo.chiudi());
  void indice().catch(() => {});
  void carica.famiglia(NUCLEO);
  return completo;
}
