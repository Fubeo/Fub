// La fila delle opzioni dello strumento del motore, nella testata (piano K6, T11,
// «Riceve da T8»; `completo/opzioni.ts`). Lo strumento del motore scelto ha una
// fila solo quando la sua famiglia è pronta (`completo/index.ts`, `fila`), e
// solo se lo stato dello strumento ha controlli da mostrare: prima niente fila,
// niente controlli finti.
//
// - **Chi monta.** La fila è DOM del Completo: qui si mette nella riga delle
//   opzioni della testata (`kit/options-bar`), come una voce con la sua priorità.
// - **Quando.** Lo strumento scelto (`sceltaMotore`) e la sua preparazione
//   avvisano (`ascoltaStrumentoMotore`); a ogni avviso la fila si rimonta, si
//   aggiorna o si toglie.
// - **Lo stato.** Mentre la fila è montata, ogni stato registrato dello
//   strumento la aggiorna (`ascoltaStati`). Smontata, il suo ascolto è spento: il
//   disposer sta nella vita della fila, e la fila nella vita dell'editor.

import type { OptionItem } from "../../../../../kit/options-bar";
import { openLifetime, type Lifetime, type Teardown } from "../../../../../ui/lifetime";
import type { DrawingToolState } from "../../../../../host/contract";
import type { FilaOpzioni } from "../../../completo/opzioni";
import type { EditorContext } from "../context";

/// Ciò che il Completo aperto dà alla testata per la fila dello strumento.
export interface CompletoMotore {
  preparaStrumento(strumento: string): Promise<boolean>;
  /// Canc coi punti scelti: li toglie, e dice `true`; senza punti `false`.
  cancellaPunti?(): boolean;
  /// Lo strumento di VectorCraft che un tasto di strumento sceglie (`v`, `Shift-b`); `null` se nessuno.
  strumentoDelTasto?(premuto: string): string | null;
  /// Il motore c'è e il suo indice è arrivato: i tasti e gli strumenti sono quelli di VectorCraft.
  conMotore?(): boolean;
  /// Fa partire il comando del motore `id` coi suoi valori, senza la sua finestra (le frecce: `object.nudge`).
  eseguiComando?(id: string, valori?: Readonly<Record<string, unknown>>): void;
  fila(
    strumento: string,
    opzioni: unknown,
    cambia: (chiave: string, valore: unknown) => void,
    vita: Lifetime,
    ambiente?: { readonly stato: DrawingToolState | null; readonly rileggi: () => void },
  ): FilaOpzioni | null;
}

export interface FilaMotoreContext {
  /// Il Completo aperto e acceso; `null` se non c'è (il Semplice, un Completo
  /// spento). Senza, la testata non ha fila.
  completoMotore?: () => CompletoMotore | null;
  /// Rilegge la riga delle opzioni: col motore del Completo solo la fila del suo
  /// strumento, senza i gruppi di Fub. La chiama chi cambia spazio o vede arrivare il motore.
  sincronizzaFila: () => void;
}

/// La riga con la fila del motore: dopo il colore e gli spessori (e le
/// opzioni dell'Inchiostro, nascoste), prima della modifica, come la fila dei
/// punti nel prototipo (`opzioni-punto`, «dopo Spessore»). Senza la modifica
/// nella riga, la fila va in fondo.
export function conLaFila(gruppi: readonly OptionItem[], voci: readonly OptionItem[]): OptionItem[] {
  const modifica = gruppi.findIndex((gruppo) => gruppo.id === "draw.edit");
  if (modifica < 0) return [...gruppi, ...voci];
  return [...gruppi.slice(0, modifica), ...voci, ...gruppi.slice(modifica)];
}

/// La priorità della fila nella riga delle opzioni: va in «…» dopo il colore e
/// gli spessori (priorità 3), e alla pari con la modifica (2), prima dei livelli (1).
const PRIORITA_FILA = 2;

interface Montata {
  readonly id: string;
  readonly fila: FilaOpzioni;
  readonly voci: readonly OptionItem[];
  readonly vita: Lifetime;
  /// Lo smontaggio dell'ascolto degli stati di questa fila.
  readonly spegniStati: Teardown;
}

/// Monta la fila dello strumento del motore scelto nella riga delle opzioni.
/// Va dopo `installGestiMotore` (usa lo stato e il cambio di strumento) e dopo
/// la testata (usa `optionsBar`).
export function installFilaMotore(ctx: EditorContext): void {
  let montata: Montata | null = null;
  /// Col motore del Completo la riga è quella di VectorCraft: la fila dello strumento e
  /// basta, senza il colore, gli spessori, la modifica, i livelli e la vista di Fub.
  const soloMotore = (): boolean => ctx.completoMotore?.()?.conMotore?.() === true;
  const righe = (voci: readonly OptionItem[]): OptionItem[] => (soloMotore() ? [...voci] : conLaFila(ctx.toolbarGroups, voci));
  /// La riga senza fila messa per ultima: col motore (`true`) o di sempre (`false`);
  /// `null` dopo una fila, che va tolta. All'inizio la testata ha messo quella di sempre.
  let vuotaCol: boolean | null = false;
  /// Il modo della riga con la fila montata: col motore (`true`) o di sempre.
  let modoFila = false;
  const senzaFila = (): void => {
    if (ctx.disposed || vuotaCol === soloMotore()) return;
    vuotaCol = soloMotore();
    ctx.optionsBar.setItems(righe([]));
  };

  /// Toglie la fila montata, se c'è: il suo ascolto si spegne e la riga torna
  /// quella di sempre.
  const smonta = (): void => {
    if (montata === null) return;
    const vecchia = montata;
    montata = null;
    vecchia.spegniStati();
    vecchia.vita.close();
    // Chiudendo l'editor la riga non si tocca più: lo fa la sua vita.
    vuotaCol = null;
    senzaFila();
  };

  /// Rimonta, aggiorna o toglie la fila secondo lo strumento scelto e il suo stato.
  const sincronizza = (): void => {
    if (ctx.disposed) {
      smonta();
      return;
    }
    // Le opzioni dell'Inchiostro e della gomma di Fub seguono lo strumento del
    // motore: con uno scelto si nascondono.
    ctx.syncPenOptions();
    const id = ctx.motoreTool;
    const completo = ctx.completoMotore?.() ?? null;
    if (id === null || completo === null) {
      smonta();
      senzaFila();
      return;
    }
    const stato = ctx.statoStrumento(id);
    const opzioni = stato?.options ?? null;
    // La stessa fila per lo stesso strumento: si aggiorna, e se non ha più
    // controlli si toglie.
    if (montata !== null && montata.id === id) {
      if (!montata.fila.aggiorna(opzioni, stato)) smonta();
      return;
    }
    smonta();
    const vita = openLifetime();
    const ambiente = { stato, rileggi: () => ctx.rileggiStato(id) };
    const fila = completo.fila(id, opzioni, (chiave, valore) => ctx.opzioneMotore(id, chiave, valore), vita, ambiente);
    if (fila === null) {
      vita.close();
      senzaFila();
      return;
    }
    // Una voce per pezzo, ognuna con la sua priorità; senza pezzi, la fila
    // intera in una voce.
    const pezzi = fila.voci ?? [{ element: fila.element, priorita: PRIORITA_FILA }];
    const voci: OptionItem[] = pezzi.map((pezzo, i) => {
      const holder = document.createElement("div");
      holder.className = "draw-options-item";
      holder.append(pezzo.element);
      return { id: i === 0 ? `motore-${id}` : `motore-${id}-${i}`, element: holder, priority: pezzo.priorita };
    });
    // Lo stato dello strumento: la fila montata lo segue, e nessun altro.
    const spegniStati = ctx.ascoltaStati((altro) => {
      if (montata !== null && montata.id === altro) sincronizza();
    });
    montata = { id, fila, voci, vita, spegniStati };
    vuotaCol = null;
    modoFila = soloMotore();
    ctx.optionsBar.setItems(righe(voci));
  };
  ctx.sincronizzaFila = () => {
    if (ctx.disposed) return;
    // Lo spazio o il motore cambiano la riga anche con la stessa fila montata: la si
    // rimette solo quando cambia il modo, per non togliere il fuoco ai suoi campi.
    if (montata !== null && ctx.completoMotore?.() !== null) {
      if (modoFila !== soloMotore()) {
        modoFila = soloMotore();
        ctx.optionsBar.setItems(righe(montata.voci));
      }
      return;
    }
    sincronizza();
  };

  // Lo strumento scelto e la sua preparazione: a ogni avviso si sincronizza.
  ctx.life.add(ctx.ascoltaStrumentoMotore(sincronizza));
  ctx.life.add(() => smonta());
}
