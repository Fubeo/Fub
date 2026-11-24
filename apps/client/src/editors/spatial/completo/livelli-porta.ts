// I comandi di livello del Completo (K6 T15, giro 4): l'albero dei livelli resta quello nativo
// (`tools/objects.ts`, con filtro, miniature, trascinamento e tastiera), e quando il Completo del
// motore è acceso occhio, lucchetto, rinomina, livello nuovo ed elimina passano dal motore, con la
// regola della famiglia `livelli` (`crates/fub-disegno/src/famiglie/livelli.rs`). L'editor chiede
// qui, e scrive le operazioni dell'esito col suo passo di cronologia e il suo annuncio.
//
// Il numero del motore di un livello si legge da `document.inspect` (T11) prima di ogni comando:
// il livello di Fub vi si chiama col suo id della scena (`livelli-modello.ts`). Una lettura per
// comando, cioè per clic: niente per tasto né per fotogramma.

import type { Op } from "../scene/ops";
import type { DrawKey } from "../strings";
import type { DrawingOutcome } from "../../../host/contract";
import type { Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import { motivoDelRifiuto } from "../motore/rifiuto";
import type { Caricatore } from "./carica";
import { livelliDi, numeriDeiLivelli } from "./livelli-modello";

/// Le famiglie che un comando di livello vuole pronte: il nucleo per `document.inspect`, e
/// `livelli` per i comandi.
const FAMIGLIE = ["nucleo", "livelli"] as const;

/// Quanto un comando di livello aspetta la sessione del motore, come in `esegui.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Un comando di livello del pannello. `livello` è l'id della scena del livello.
export type RichiestaLivello =
  | {
      readonly kind: "proprieta";
      readonly livello: string;
      readonly nome?: string;
      readonly visibile?: boolean;
      readonly bloccato?: boolean;
    }
  | { readonly kind: "nuovo"; readonly nome: string }
  | { readonly kind: "elimina"; readonly livello: string }
  /// Duplica livello: la copia va subito sopra, col nome «… copia». Solo del motore.
  | { readonly kind: "duplica"; readonly livello: string }
  /// Appiattisci grafica: tutto nel livello, i livelli nascosti si scartano. Solo del motore.
  | { readonly kind: "appiattisci"; readonly livello: string };

/// Com'è andato un comando di livello.
/// - `fatto`: le operazioni da scrivere (vuote se non cambiava niente);
/// - `rifiuto`: il motore non l'ha fatto, col perché a parole (`null`: non cambiava niente);
/// - `nativo`: il motore non può farlo adesso (spento, fermo, la famiglia non arriva, il livello
///   non ha un id che il motore conosce): lo fa l'editor da sé, con le stesse operazioni;
/// - `fallito`: il motore ha risposto con operazioni che non si leggono;
/// - `argomenti`: il motore ha rifiutato i valori del comando (`bad_args`), con la sua frase; non
///   cambia niente, e l'editor non lo rifà da sé.
export type EsitoLivello =
  | { readonly kind: "fatto"; readonly ops: readonly Op[] }
  | { readonly kind: "rifiuto"; readonly motivo: DrawKey | null }
  | { readonly kind: "argomenti"; readonly frase: string }
  | { readonly kind: "nativo" }
  | { readonly kind: "fallito" };

/// La porta dei comandi di livello del Completo aperto.
export interface PortaLivelli {
  comando(richiesta: RichiestaLivello): Promise<EsitoLivello>;
}

export interface DipendenzePorta {
  readonly motore: MotoreDelDisegno | null;
  readonly carica: Pick<Caricatore, "famiglia">;
  readonly vita: Lifetime;
  /// La lettura delle operazioni dei gesti (`opsDellEsito`), dall'editor.
  readonly leggi: (ops: string | null) => readonly Op[] | null;
}

/// Il perché a parole di un comando di livello rifiutato. Un livello bloccato ha la sua frase: quella
/// dei comandi (`draw.reason.lockedSelection`) parla della selezione, che qui non c'entra.
export function motivoDelLivello(esito: DrawingOutcome): DrawKey | null {
  if (esito.refused === null) return null;
  return esito.refused === "locked" ? "draw.livelli.bloccato" : motivoDelRifiuto(esito.refused);
}

/// Il comando del motore e il suo valore per `richiesta`, coi numeri dei livelli; `null` se il
/// livello non c'è fra quelli che il motore conosce.
function chiamataDi(richiesta: RichiestaLivello, numeri: ReadonlyMap<string, number>): { readonly id: string; readonly value: unknown } | null {
  switch (richiesta.kind) {
    case "nuovo":
      return { id: "disegno.layer.new", value: { name: richiesta.nome, visible: true, locked: false } };
    case "elimina": {
      const numero = numeri.get(richiesta.livello);
      return numero === undefined ? null : { id: "disegno.layer.delete", value: { ids: [numero] } };
    }
    case "duplica": {
      const numero = numeri.get(richiesta.livello);
      return numero === undefined ? null : { id: "disegno.layer.duplicate", value: { ids: [numero] } };
    }
    case "appiattisci": {
      const numero = numeri.get(richiesta.livello);
      return numero === undefined ? null : { id: "disegno.layer.flatten", value: { id: numero } };
    }
    case "proprieta": {
      const numero = numeri.get(richiesta.livello);
      if (numero === undefined) return null;
      return {
        id: "disegno.layer.setProps",
        value: {
          ids: [numero],
          ...(richiesta.nome === undefined ? {} : { name: richiesta.nome }),
          ...(richiesta.visibile === undefined ? {} : { visible: richiesta.visibile }),
          ...(richiesta.bloccato === undefined ? {} : { locked: richiesta.bloccato }),
        },
      };
    }
  }
}

/// La porta dei comandi di livello sul motore di `dipendenze`.
export function creaPortaLivelli(dipendenze: DipendenzePorta): PortaLivelli {
  const nativo: EsitoLivello = { kind: "nativo" };
  return {
    async comando(richiesta) {
      const motore = dipendenze.motore;
      if (motore === null || motore.assente() !== null || dipendenze.vita.closed) return nativo;
      const stati = await Promise.all(FAMIGLIE.map((famiglia) => dipendenze.carica.famiglia(famiglia)));
      if (dipendenze.vita.closed || stati.some((stato) => stato.kind !== "pronta")) return nativo;
      const sessione = await motore.pronta(ATTESA_MOTORE_MS);
      if (sessione === null || dipendenze.vita.closed) return nativo;
      // Un livello nuovo non ha bisogno dei numeri: la lettura si salta.
      let numeri: ReadonlyMap<string, number> = new Map();
      if (richiesta.kind !== "nuovo") {
        const lettura = await sessione.comando({ id: "disegno.document.inspect", selection: [], value: {}, preview: false });
        if (lettura === null || "kind" in lettura || lettura.refused !== null || dipendenze.vita.closed) return nativo;
        numeri = numeriDeiLivelli(livelliDi(lettura.reading));
      }
      const chiamata = chiamataDi(richiesta, numeri);
      if (chiamata === null) return nativo;
      const esito = await sessione.comando({ id: chiamata.id, selection: [], value: chiamata.value, preview: false });
      if (dipendenze.vita.closed) return nativo;
      if (esito !== null && "kind" in esito && esito.kind === "argomenti") return { kind: "argomenti", frase: esito.message };
      if (esito === null || "kind" in esito) return nativo;
      if (esito.refused !== null) return { kind: "rifiuto", motivo: motivoDelLivello(esito) };
      const ops = dipendenze.leggi(esito.ops);
      return ops === null ? { kind: "fallito" } : { kind: "fatto", ops };
    },
  };
}
