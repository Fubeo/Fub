// Il montaggio dei tasti del motore nell'editor, col Disegno completo aperto
// (piano K6, T9b). Un ascoltatore sulla radice dell'editor: un tasto del motore
// che la regola (`tasti.ts`) lega a un comando lo fa partire con `esegui`, e
// l'evento non va più avanti (la shell lo vede con `defaultPrevented`).
//
// Il root dell'editor ha già i suoi tasti (`tools/editor/vault-images.ts`), che
// si montano prima: un tasto che quelli prendono (`defaultPrevented`) non arriva
// qui. Un tasto di Fub non è mai un tasto del motore: lo dice la regola, che col
// motore lascia a Fub solo i tasti della finestra (`TASTI_DELLA_FINESTRA`).

import { composingKey } from "../../../kit/ime";
import { isWritingField } from "../../../ui/field-history";
import type { Lifetime } from "../../../ui/lifetime";
import type { Indice, VoceIndice } from "./indice";
import { decidiTasto, risolviTasti, tastoStrumento, TASTI_DELLA_FINESTRA, type ModificheTasti, type Piattaforma, type RegolaTasti } from "./tasti";

export interface OpzioniMontaggioTasti {
  /// La radice dell'editor: i tasti si ascoltano lì. `null` senza editor: la
  /// regola c'è lo stesso (il menu e la tavolozza la leggono da qui), e nessun
  /// tasto parte.
  readonly radice: HTMLElement | null;
  /// Il Completo è acceso adesso; spento (il Semplice), nessun tasto parte. Senza, sempre acceso.
  readonly attivo?: () => boolean;
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
/// Gli strumenti del motore con il tasto attivo nel Completo. Gli altri strumenti che hanno un tasto
/// nell'indice restano senza: attivarli è una scelta a parte (ci sono tasti di Fub come `Shift-p`, e
/// molte lettere da decidere). Il Pennello tondo ha Maiusc+B, che nel motore è il suo (K6 T12, giro 2).
const STRUMENTI_CON_TASTO: ReadonlySet<string> = new Set(["blobBrush"]);

/// Uno strumento della lista sopra, con il suo tasto nell'indice.
function tastoDiStrumento(voce: VoceIndice): boolean {
  return "strumento" in voce.chiamata && STRUMENTI_CON_TASTO.has(voce.id);
}

/// Il tasto senza Ctrl, Cmd o Alt di un evento nella forma di `tastoStrumento`
/// (`d`, `Shift-x`, `/`), o `null` con un modificatore. Maiusc conta solo su una
/// lettera: `/` si scrive con Maiusc su una tastiera italiana.
function tastoNudo(event: KeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Delete" || event.key === "Backspace") return "Delete";
  if ([...event.key].length !== 1) return null;
  const lettera = /^[a-z]$/i.test(event.key);
  return `${lettera && event.shiftKey ? "Shift-" : ""}${event.key.toLowerCase()}`;
}

/// I comandi del motore con un tasto di un solo carattere nell'indice (`D`, `X`,
/// `Shift+X`, `/`, `,`, `.`, `Shift+D`), come `single_key_shortcuts` di
/// VectorCraft, più Canc e Backspace per Cancella (`nudge_and_clear`). La
/// regola della shell non li accetta, perché un tasto nudo non è una scorciatoia.
function comandiNudi(voci: Iterable<VoceIndice>): Map<string, string> {
  const nudi = new Map<string, string>();
  for (const voce of voci) {
    if (!("comando" in voce.chiamata)) continue;
    const tasto = voce.tasto === "Delete" ? "Delete" : tastoStrumento(voce.tasto);
    if (tasto !== null && !nudi.has(tasto)) nudi.set(tasto, voce.id);
  }
  return nudi;
}

export function montaTasti(opzioni: OpzioniMontaggioTasti): MontaggioTasti {
  // Solo i comandi del motore: gli strumenti e i pezzi del client non partono qui.
  let comandi: Map<string, VoceIndice> | null = null;
  let regola: RegolaTasti | null = null;
  // I comandi di un tasto nudo, tasto → comando.
  let nudi = new Map<string, string>();
  let chiuso = false;
  // La richiesta dell'indice in corso, se c'è.
  let richiesta: Promise<void> | null = null;

  const ricalcola = (): void => {
    if (comandi === null) return;
    regola = risolviTasti(
      [...comandi.values()].map((voce) => ({ id: voce.id, tasto: voce.tasto })),
      opzioni.modifiche(),
      opzioni.piattaforma,
      // Il Completo coi comandi del motore: di Fub restano solo i tasti della finestra.
      TASTI_DELLA_FINESTRA,
    );
  };

  const chiedi = (): void => {
    if (comandi !== null || richiesta !== null || chiuso) return;
    richiesta = opzioni.indice().then(
      (indice) => {
        richiesta = null;
        if (chiuso) return;
        comandi = new Map(indice.voci.filter((voce) => "comando" in voce.chiamata || tastoDiStrumento(voce)).map((voce) => [voce.id, voce]));
        nudi = comandiNudi(comandi.values());
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
    if (event.defaultPrevented || opzioni.attivo?.() === false) return;
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
    const nudo = tastoNudo(event);
    const comando =
      decisione.tipo === "esegue"
        ? decisione.comando
        : nudo !== null && !stato.vuoleTesto && !stato.componendo && !composingKey(event) && !isWritingField(event.target)
          ? (nudi.get(nudo) ?? null)
          : null;
    if (comando === null) return;
    const voce = comandi.get(comando);
    if (voce === undefined) return;
    event.preventDefault();
    opzioni.esegui(voce);
  };

  if (opzioni.radice !== null) opzioni.vita.listen(opzioni.radice, "keydown", alTasto);
  opzioni.vita.add(() => {
    chiuso = true;
  });

  return {
    aggiorna: ricalcola,
    regola: () => regola,
  };
}
