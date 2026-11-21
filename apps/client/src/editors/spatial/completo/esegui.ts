// Il percorso di un comando del motore dal Disegno completo (piano K6, T9b): il
// tasto del motore e la voce di ≡ passano di qui. Un comando senza parametri
// gira subito, con la sua famiglia pronta; uno con parametri apre la finestra di
// T6 (`motore/finestre.ts`), che aspetta la famiglia da sola e dice il caricamento
// e l'errore.
//
// Niente valori da `motore/gesti.ts`: la superficie del disegno non entra nel
// chunk del Completo (come in `carica.ts`). La lettura delle operazioni e la
// cronologia le porta chi ha l'editor, con `AzioniEsito`.

import type { DrawingOutcome, DrawingPreview } from "../../../host/contract";
import { languageCurrent } from "../../../i18n/strings";
import type { Lifetime } from "../../../ui/lifetime";
import { apriFinestra, type Esegui, type EsitoComando, type FinestraOpzioni, type ModuloFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { Op } from "../scene/ops";
import { t } from "../strings";
import type { Caricatore } from "./carica";
import type { VoceIndice } from "./indice";

/// Quanto il comando aspetta la sessione del motore: come `ATTESA_APERTURA_MS`
/// di `../motore/gesti.ts`, qui un numero suo, come in `carica.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Ciò che l'editor sa fare con l'esito di un comando. Lo porta chi ha
/// l'editor: la lettura delle operazioni è quella dei gesti (`opsDellEsito`).
export interface AzioniEsito {
  /// Le operazioni dell'esito come lista, o `null` se non valgono.
  readonly leggi: (ops: string | null) => readonly Op[] | null;
  /// Le operazioni in un solo passo della cronologia; `false` se il disegno le rifiuta.
  readonly commit: (ops: readonly Op[]) => boolean;
  readonly seleziona: (ids: readonly string[]) => void;
  readonly annuncia: (testo: string) => void;
}

/// La finestra di un comando con parametri: il suo schema e le sue parole, che
/// dà la famiglia quando è arrivata. `null` se la famiglia non ne ha una.
export interface OpzioniFinestraComando extends Omit<FinestraOpzioni, "id" | "titolo" | "vita" | "sulFoglio" | "iniziali" | "riprova"> {
  readonly modulo: ModuloFinestra;
  readonly iniziali?: FinestraOpzioni["iniziali"];
}

export interface DipendenzeComando extends AzioniEsito {
  /// Il motore del disegno aperto; `null` se non c'è.
  readonly motore: MotoreDelDisegno | null;
  readonly carica: Caricatore;
  /// La vita del disegno: chiuso, un comando che aspetta non parte.
  readonly vita: Lifetime;
  /// La selezione adesso, come id del motore.
  readonly selezione: () => readonly string[];
  /// Mette l'anteprima sul foglio, o la toglie con `null`.
  readonly anteprima: (anteprima: DrawingPreview | null) => void;
  /// La finestra del comando, se la voce ne ha una.
  readonly finestra: (voce: VoceIndice) => Promise<OpzioniFinestraComando | null>;
}

/// L'etichetta della voce nella lingua che l'app usa adesso: l'indice porta
/// l'italiana e l'inglese.
export function etichettaDi(voce: VoceIndice): string {
  return languageCurrent().startsWith("en") ? voce.etichetta.en : voce.etichetta.it;
}

/// Il comando del motore di una voce, o `null` se la voce è uno strumento o un
/// pezzo del client, che non partono da qui.
function comandoDi(voce: VoceIndice): { readonly id: string; readonly valore: unknown } | null {
  const chiamata = voce.chiamata;
  return "comando" in chiamata ? { id: chiamata.comando, valore: chiamata.valore } : null;
}

/// Il valore fisso di una voce (un effetto con il suo valore), come oggetto.
function comeOggetto(valore: unknown): Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore) ? (valore as Readonly<Record<string, unknown>>) : {};
}

/// Il chiamante di `apriFinestra`: una promessa che si risolve quando la
/// famiglia è pronta, e si rifiuta con `no_memory` o con altro.
function famigliaPronta(carica: Caricatore, famiglia: string): Promise<void> {
  return carica.famiglia(famiglia).then((stato) => {
    if (stato.kind === "pronta") return;
    return Promise.reject(stato.kind === "errore" && stato.perche === "no-memory" ? "no_memory" : "motore");
  });
}

/// Manda il comando al motore. `null` se il motore non c'è o non risponde.
async function chiama(
  dipendenze: DipendenzeComando,
  id: string,
  valore: unknown,
  anteprima: boolean,
): Promise<DrawingOutcome | null> {
  if (dipendenze.motore === null) return null;
  const sessione = await dipendenze.motore.pronta(ATTESA_MOTORE_MS);
  if (sessione === null) return null;
  const esito = await sessione.comando({ id, selection: [...dipendenze.selezione()], value: valore, preview: anteprima });
  if (esito === null || "kind" in esito) return null;
  return esito;
}

/// Un esito che non è un'anteprima: la selezione, le operazioni in un passo, e
/// lo si dice. Un rifiuto del motore si dice e non cambia niente.
export function applicaEsito(esito: DrawingOutcome, etichetta: string, azioni: AzioniEsito): void {
  if (esito.refused !== null) {
    azioni.seleziona(esito.selection);
    azioni.annuncia(t("draw.window.refused"));
    return;
  }
  const ops = azioni.leggi(esito.ops);
  if (ops === null) {
    azioni.annuncia(t("draw.completo.key.failed"));
    return;
  }
  if (ops.length > 0 && !azioni.commit(ops)) {
    azioni.annuncia(t("draw.completo.key.failed"));
    return;
  }
  azioni.seleziona(esito.selection);
  azioni.annuncia(t("draw.completo.key.done", { command: etichetta }));
}

/// Fa partire il comando della voce `voce`: subito se non ha parametri (dopo
/// l'arrivo della sua famiglia, se serve), con la finestra di T6 se ne ha una.
/// Una voce che non è un comando del motore non fa niente.
export function eseguiVoce(voce: VoceIndice, dipendenze: DipendenzeComando): void {
  const comando = comandoDi(voce);
  if (comando === null) return;
  const etichetta = etichettaDi(voce);

  if (voce.finestra) {
    void dipendenze.finestra(voce).then((opzioni) => {
      if (opzioni === null) {
        dipendenze.annuncia(t("draw.completo.key.nowindow"));
        return;
      }
      if (dipendenze.vita.closed) return;
      const esegui: Esegui = async (valori, anteprima): Promise<EsitoComando> => {
        const esito = await chiama(dipendenze, comando.id, { ...comeOggetto(comando.valore), ...valori }, anteprima);
        if (esito === null) return { anteprima: null, rifiuto: "not_ready" };
        // OK manda il comando una volta sola: un passo della cronologia.
        if (!anteprima) applicaEsito(esito, etichetta, dipendenze);
        return { anteprima: esito.preview, rifiuto: esito.refused };
      };
      void apriFinestra(opzioni.modulo, famigliaPronta(dipendenze.carica, voce.famiglia), esegui, {
        ...opzioni,
        id: voce.id,
        titolo: etichetta,
        iniziali: opzioni.iniziali ?? {},
        vita: dipendenze.vita,
        sulFoglio: dipendenze.anteprima,
      });
    });
    return;
  }

  // Senza finestra il comando aspetta la famiglia, e lo si vede.
  if (dipendenze.carica.stato(voce.famiglia).kind !== "pronta") {
    dipendenze.annuncia(t("draw.completo.key.waiting"));
  }
  void dipendenze.carica.famiglia(voce.famiglia).then(async (stato) => {
    if (dipendenze.vita.closed) return;
    if (stato.kind !== "pronta") {
      dipendenze.annuncia(t("draw.window.failed"));
      return;
    }
    const esito = await chiama(dipendenze, comando.id, comeOggetto(comando.valore), false);
    if (dipendenze.vita.closed) return;
    if (esito === null) {
      dipendenze.annuncia(t("draw.window.unanswered"));
      return;
    }
    applicaEsito(esito, etichetta, dipendenze);
  });
}
