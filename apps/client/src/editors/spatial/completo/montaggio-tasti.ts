// Il montaggio dei tasti del motore nell'editor, col Disegno completo aperto
// (piano K6, T9b). Un ascoltatore sulla radice dell'editor: un tasto del motore
// che la regola (`tasti.ts`) lega a un comando lo fa partire con `esegui`, e
// l'evento non va più avanti (la shell lo vede con `defaultPrevented`).
//
// Il root dell'editor ha già i suoi tasti (`tools/editor/vault-images.ts`), che
// si montano prima: un tasto che quelli prendono (`defaultPrevented`) non arriva
// qui. Un tasto di Fub non è mai un tasto del motore: lo dice la regola.

import { composingKey } from "../../../kit/ime";
import { isWritingField } from "../../../ui/field-history";
import type { Lifetime } from "../../../ui/lifetime";
import type { Indice, VoceIndice } from "./indice";
import { decidiTasto, risolviTasti, type ModificheTasti, type Piattaforma, type RegolaTasti } from "./tasti";

export interface OpzioniMontaggioTasti {
  /// La radice dell'editor: i tasti si ascoltano lì.
  readonly radice: HTMLElement;
  /// La vita del Completo: chiusa, l'ascoltatore si toglie.
  readonly vita: Lifetime;
  /// L'indice dei comandi del Completo (`completo.indice()`): chiesto al
  /// montaggio, e poi col tasto dopo finché non arriva.
  readonly indice: () => Promise<Indice>;
  /// Le modifiche dell'utente (`draw.keys`, T9c), comando → tasto; `{}` finché non ci sono.
  readonly modifiche: () => ModificheTasti;
  /// Lo stato dello strumento del motore adesso: vuole il testo, compone.
  readonly stato: () => { readonly vuoleTesto: boolean; readonly componendo: boolean };
  readonly piattaforma: Piattaforma;
  /// Fa partire la voce: il percorso di ≡ (`esegui.ts`).
  readonly esegui: (voce: VoceIndice) => void;
}

export interface MontaggioTasti {
  /// Rifà la regola con le modifiche dell'utente di adesso (dopo una modifica).
  aggiorna(): void;
  /// La regola adesso, o `null` finché l'indice non è arrivato.
  regola(): RegolaTasti | null;
}

/// Monta i tasti del motore sulla radice dell'editor. Senza indice non parte
/// niente e il Semplice funziona come prima. L'indice si chiede al montaggio, e
/// poi a ogni tasto finché non arriva: un rifiuto non si tiene, e il tasto dopo
/// lo chiede di nuovo. Una richiesta alla volta.
export function montaTasti(opzioni: OpzioniMontaggioTasti): MontaggioTasti {
  // Solo i comandi del motore: gli strumenti e i pezzi del client non partono qui.
  let comandi: Map<string, VoceIndice> | null = null;
  let regola: RegolaTasti | null = null;
  let chiuso = false;
  // La richiesta dell'indice in corso, se c'è.
  let richiesta: Promise<void> | null = null;

  const ricalcola = (): void => {
    if (comandi === null) return;
    regola = risolviTasti(
      [...comandi.values()].map((voce) => ({ id: voce.id, tasto: voce.tasto })),
      opzioni.modifiche(),
      opzioni.piattaforma,
    );
  };

  const chiedi = (): void => {
    if (comandi !== null || richiesta !== null || chiuso) return;
    richiesta = opzioni.indice().then(
      (indice) => {
        richiesta = null;
        if (chiuso) return;
        comandi = new Map(indice.voci.filter((voce) => "comando" in voce.chiamata).map((voce) => [voce.id, voce]));
        ricalcola();
      },
      () => {
        // L'indice non arriva: niente tasti del motore, e il tasto dopo lo chiede.
        richiesta = null;
      },
    );
  };
  chiedi();

  const alTasto = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (comandi === null || regola === null) {
      // Senza indice il tasto non parte: lo chiede di nuovo, e il tasto dopo parte.
      chiedi();
      return;
    }
    const stato = opzioni.stato();
    const decisione = decidiTasto(
      event,
      regola,
      {
        inCampo: isWritingField(event.target),
        vuoleTesto: stato.vuoleTesto,
        componendo: stato.componendo || composingKey(event),
      },
      opzioni.piattaforma,
    );
    if (decisione.tipo === "passa") return;
    const voce = comandi.get(decisione.comando);
    if (voce === undefined) return;
    event.preventDefault();
    opzioni.esegui(voce);
  };

  opzioni.vita.listen(opzioni.radice, "keydown", alTasto);
  opzioni.vita.add(() => {
    chiuso = true;
  });

  return {
    aggiorna: ricalcola,
    regola: () => regola,
  };
}
