// Il percorso di un comando del motore dal Disegno completo (piano K6, T9b): il
// tasto del motore e la voce di ≡ passano di qui. Un comando senza parametri
// gira subito, con la sua famiglia pronta; uno con parametri apre la finestra di
// T6 (`motore/finestre.ts`), che aspetta la famiglia da sola e dice il caricamento
// e l'errore.
//
// Niente valori da `motore/gesti.ts`: la superficie del disegno non entra nel
// chunk del Completo (come in `carica.ts`). La lettura delle operazioni e la
// cronologia le porta chi ha l'editor, con `AzioniEsito`.

import type { DrawingAnchor, DrawingOutcome, DrawingPreview } from "../../../host/contract";
import { languageCurrent } from "../../../i18n/strings";
import type { Lifetime } from "../../../ui/lifetime";
import { apriFinestra, type Esegui, type EsitoComando, type FinestraOpzioni, type ModuloFinestra } from "../motore/finestre";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { ArgomentiRifiutati } from "../motore/sessione";
import { motivoDelRifiuto } from "../motore/rifiuto";
import type { Op } from "../scene/ops";
import { t } from "../strings";
import type { AppuntiCompleto } from "../tools/clipboard";
import type { Caricatore, StatoFamiglia } from "./carica";
import type { VoceIndice } from "./indice";

/// Quanto il comando aspetta la sessione del motore: come `ATTESA_APERTURA_MS`
/// di `../motore/gesti.ts`, qui un numero suo, come in `carica.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Ciò che l'editor sa fare con l'esito di un comando. Lo porta chi ha
/// l'editor: la lettura delle operazioni è quella dei gesti (`opsDellEsito`).
export interface AzioniEsito {
  /// Le operazioni dell'esito come lista, o `null` se non valgono.
  readonly leggi: (ops: string | null) => readonly Op[] | null;
  /// Le operazioni in un solo passo della cronologia, col nome del comando
  /// (`nome`, come negli annunci); `false` se il disegno le rifiuta. Due
  /// comandi diversi sono due passi anche se arrivano a meno di `MERGE_MS`.
  readonly commit: (ops: readonly Op[], nome: string) => boolean;
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
  /// I punti scelti adesso con lo strumento del motore (la Selezione diretta):
  /// Media e Media e unisci li mandano nel `value` (`anchors`). Senza, o vuoti,
  /// quei comandi valgono sui tracciati scelti interi.
  readonly punti?: () => readonly DrawingAnchor[];
  /// L'id di Fub del livello corrente del disegno (`livello-corrente.ts`), o
  /// `null` se non ce n'è uno con un id: Sposta sul livello corrente lo manda
  /// nel `value` (`layer`). Senza, il ponte usa il livello più alto libero.
  readonly livello?: () => string | null;
  /// Mette l'anteprima sul foglio, o la toglie con `null`.
  readonly anteprima: (anteprima: DrawingPreview | null) => void;
  /// La finestra del comando, se la voce ne ha una.
  readonly finestra: (voce: VoceIndice) => Promise<OpzioniFinestraComando | null>;
  /// Gli appunti del Completo per questo motore (K6 T11): copia, taglia,
  /// incolla e cancella cronologia passano di qui, non dal motore. `null` senza motore.
  appunti?: AppuntiCompleto;
  /// I comandi del motore che Fub fa da sé, con la sua regola: vero se il
  /// comando `id` è uno di quelli ed è partito. Senza, ogni comando va al motore.
  readonly diFub?: (id: string) => boolean;
  /// I comandi con finestra la cui finestra è aperta o si sta aprendo, per id: un secondo
  /// comando sulla stessa voce (un doppio clic) non apre una finestra in più. Senza, nessuna guardia.
  readonly finestreAperte?: Set<string>;
}

/// I comandi del motore che passano dagli appunti del Completo (`appunti.ts`). Le
/// varianti d'incolla ricevono il nome della loro voce, per i messaggi.
const AZIONI_APPUNTI: Readonly<Record<string, (appunti: AppuntiCompleto, etichetta: string) => Promise<void>>> = {
  "disegno.edit.copy": (appunti) => appunti.copia("copy"),
  "disegno.edit.cut": (appunti) => appunti.copia("cut"),
  "disegno.edit.paste": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.paste", etichetta }),
  "disegno.edit.pasteInFront": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.pasteInFront", etichetta }),
  "disegno.edit.pasteInBack": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.pasteInBack", etichetta }),
  "disegno.edit.pasteInPlace": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.pasteInPlace", etichetta }),
  "disegno.edit.pasteOnAllArtboards": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.pasteOnAllArtboards", etichetta }),
  "disegno.edit.pasteWithoutFormatting": (appunti, etichetta) => appunti.incollaDaMenu({ comando: "edit.pasteWithoutFormatting", etichetta }),
  "disegno.edit.clearHistory": (appunti) => appunti.cancellaCronologia(),
};

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

/// Il valore di un comando con i valori di una finestra o di una sezione: per un effetto
/// (`disegno.effect.apply`, col suo `effect`) vanno nei `params` dell'effetto, come il
/// motore li prende; per gli altri comandi accanto al valore fisso.
export function conValori(
  voce: Pick<VoceIndice, "fonte">,
  base: Readonly<Record<string, unknown>>,
  valori: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (voce.fonte !== "effetto") return { ...base, ...valori };
  return { ...base, params: { ...comeOggetto(base.params), ...valori } };
}

/// I comandi del menu che valgono sui punti scelti, se ce ne sono (K6 T12):
/// il menu ≡, Ctrl+/ e il tasto li mandano coi punti dello strumento.
const SUI_PUNTI_SCELTI: ReadonlySet<string> = new Set([
  "disegno.path.average",
  "disegno.path.averageJoin",
  "disegno.path.moveAnchors",
  "disegno.path.deleteAnchors",
]);

/// Il comando che vale sul livello corrente, che sta nel client: lo manda col
/// suo id di Fub (`layer`), e il ponte lo toglie prima del motore.
const SUL_LIVELLO_CORRENTE = "disegno.object.arrange.sendToCurrentLayer";

/// Il valore di partenza del comando `id`: quello fisso della voce, più i punti
/// scelti adesso per un comando che li usa e non li ha già, o il livello
/// corrente per Sposta sul livello corrente.
function valoreDi(id: string, valore: unknown, dipendenze: DipendenzeComando): Readonly<Record<string, unknown>> {
  const base = comeOggetto(valore);
  if (id === SUL_LIVELLO_CORRENTE && !("layer" in base)) {
    const livello = dipendenze.livello?.() ?? null;
    return livello === null ? base : { ...base, layer: livello };
  }
  if (!SUI_PUNTI_SCELTI.has(id) || "anchors" in base) return base;
  const punti = dipendenze.punti?.() ?? [];
  return punti.length === 0 ? base : { ...base, anchors: [...punti] };
}

/// Il chiamante di `apriFinestra`: una promessa che si risolve quando la
/// famiglia è pronta, e si rifiuta con `no_memory` o con altro. Vale sia per
/// l'attesa sia per «Riprova» (`carica.riprova`).
function attesaFamiglia(stato: StatoFamiglia): Promise<void> {
  if (stato.kind === "pronta") return Promise.resolve();
  return Promise.reject(stato.kind === "errore" && stato.perche === "no-memory" ? "no_memory" : "motore");
}

/// Manda il comando al motore. Gli argomenti rifiutati (`bad_args`) tornano
/// con la frase del motore, e il motore resta pronto; `null` se il motore non
/// c'è o non risponde.
export async function chiamaConArgomenti(
  dipendenze: DipendenzeComando,
  id: string,
  valore: unknown,
  anteprima: boolean,
): Promise<DrawingOutcome | ArgomentiRifiutati | null> {
  if (dipendenze.motore === null) return null;
  const sessione = await dipendenze.motore.pronta(ATTESA_MOTORE_MS);
  if (sessione === null) return null;
  const esito = await sessione.comando({ id, selection: [...dipendenze.selezione()], value: valore, preview: anteprima });
  if (esito === null || ("kind" in esito && esito.kind === "assente")) return null;
  return esito;
}

/// Manda il comando al motore, per una lettura: `null` se il motore non c'è,
/// non risponde o non ne prende gli argomenti. Un comando che cambia il
/// disegno, o che una persona ha chiesto, passa da `chiamaConArgomenti` e dice
/// la frase del motore.
export async function chiama(
  dipendenze: DipendenzeComando,
  id: string,
  valore: unknown,
  anteprima: boolean,
): Promise<DrawingOutcome | null> {
  const esito = await chiamaConArgomenti(dipendenze, id, valore, anteprima);
  return esito === null || "kind" in esito ? null : esito;
}

/// Un esito che non è un'anteprima: la selezione, le operazioni in un passo, e
/// lo si dice, con le perdite dell'esito se ce ne sono. Un rifiuto del motore si dice col suo motivo (`motivoDelRifiuto`,
/// come per i colori) e non cambia niente. `true` se il comando è andato: le
/// operazioni sono entrate (o non ce n'erano), senza un rifiuto.
export function applicaEsito(esito: DrawingOutcome, etichetta: string, azioni: AzioniEsito): boolean {
  if (esito.refused !== null) {
    azioni.seleziona(esito.selection);
    const motivo = motivoDelRifiuto(esito.refused);
    // Un oggetto bloccato nella selezione dice da sé di sbloccarlo o toglierlo (T13).
    if (motivo === "draw.reason.lockedSelection") {
      azioni.annuncia(t(motivo));
      return false;
    }
    azioni.annuncia(motivo === null ? t("draw.completo.key.unchanged", { command: etichetta }) : t("draw.rejected", { reason: t(motivo) }));
    return false;
  }
  const ops = azioni.leggi(esito.ops);
  if (ops === null) {
    azioni.annuncia(t("draw.completo.key.failed"));
    return false;
  }
  if (ops.length > 0 && !azioni.commit(ops, etichetta)) {
    azioni.annuncia(t("draw.completo.key.failed"));
    return false;
  }
  azioni.seleziona(esito.selection);
  // Quello che il comando non ha potuto scrivere (per esempio le sfumature di
  // «Campioni predefiniti») si dice con la frase del motore, mai in silenzio.
  const perdite = esito.losses.map((perdita) => perdita.detail).join(" ");
  azioni.annuncia(
    perdite === ""
      ? t("draw.completo.key.done", { command: etichetta })
      : t("draw.completo.key.doneWithLosses", { command: etichetta, losses: perdite }),
  );
  return true;
}

/// L'esito di un comando (`applicaEsito`), o gli argomenti che il motore ha
/// rifiutato, detti con la sua frase: niente cambia, e il disegno resta
/// modificabile. `true` solo se il comando è andato.
export function applicaRisposta(esito: DrawingOutcome | ArgomentiRifiutati, etichetta: string, azioni: AzioniEsito): boolean {
  if ("kind" in esito) {
    azioni.annuncia(esito.message);
    return false;
  }
  return applicaEsito(esito, etichetta, azioni);
}

/// Fa partire il comando della voce `voce`: subito se non ha parametri (dopo
/// l'arrivo della sua famiglia, se serve), con la finestra di T6 se ne ha una.
/// Una voce che non è un comando del motore non fa niente. La promessa si
/// risolve quando il giro è finito: l'esito applicato (o detto), o la finestra
/// aperta. La sezione dei punti (T12, giro 4) la aspetta per rileggere lo stato
/// dello strumento. `true` solo per un comando senza finestra andato
/// (`applicaEsito`): Ripeti Elaborazione tracciati ricorda così l'ultima
/// elaborazione fatta (T13).
export function eseguiVoce(voce: VoceIndice, dipendenze: DipendenzeComando): Promise<boolean> {
  const comando = comandoDi(voce);
  if (comando === null) return Promise.resolve(false);
  const etichetta = etichettaDi(voce);
  // Gli appunti e la cronologia del Completo (K6 T11): non passano dal motore come un comando qualsiasi.
  const appunti = dipendenze.appunti;
  const azioneAppunti = AZIONI_APPUNTI[comando.id];
  if (appunti !== undefined && azioneAppunti !== undefined) {
    return azioneAppunti(appunti, etichetta).then(() => false);
  }
  // «Sblocca tutto» e «Mostra tutto» sono quelli di Fub: il motore non sa che
  // un livello bloccato o nascosto di Fub resta com'è, con ciò che contiene.
  if (dipendenze.diFub?.(comando.id) === true) return Promise.resolve(false);

  if (voce.finestra) {
    // Una finestra per comando: un secondo comando sulla voce, mentre la sua finestra si apre o è
    // aperta (un doppio clic), non ne apre un'altra. Si libera quando la finestra si chiude.
    const aperte = dipendenze.finestreAperte;
    if (aperte?.has(voce.id) === true) return Promise.resolve(false);
    aperte?.add(voce.id);
    const libera = (): void => {
      aperte?.delete(voce.id);
    };
    return dipendenze.finestra(voce).then((opzioni) => {
      if (opzioni === null) {
        libera();
        dipendenze.annuncia(t("draw.completo.key.nowindow"));
        return false;
      }
      if (dipendenze.vita.closed) {
        libera();
        return false;
      }
      // I punti scelti quando la finestra si apre: valgono fino a OK.
      const partenza = valoreDi(comando.id, comando.valore, dipendenze);
      const esegui: Esegui = async (valori, anteprima): Promise<EsitoComando> => {
        const esito = await chiamaConArgomenti(dipendenze, comando.id, conValori(voce, partenza, valori), anteprima);
        if (esito === null) return { anteprima: null, rifiuto: "not_ready" };
        // I valori che il motore non prende: la finestra dice la sua frase e resta aperta.
        if ("kind" in esito) return { anteprima: null, rifiuto: null, argomenti: esito.message };
        // OK manda il comando una volta sola: un passo della cronologia.
        if (!anteprima) applicaEsito(esito, etichetta, dipendenze);
        return { anteprima: esito.preview, rifiuto: esito.refused };
      };
      // La finestra risolve quando si chiude (OK, Annulla o Esc): allora la voce è di nuovo libera.
      void apriFinestra(opzioni.modulo, dipendenze.carica.famiglia(voce.famiglia).then(attesaFamiglia), esegui, {
        ...opzioni,
        id: voce.id,
        titolo: etichetta.replace(/…$/u, ""),
        iniziali: opzioni.iniziali ?? {},
        vita: dipendenze.vita,
        sulFoglio: dipendenze.anteprima,
        // «Riprova» dell'errore della famiglia: rifà la sua attesa.
        riprova: () => dipendenze.carica.riprova(voce.famiglia).then(attesaFamiglia),
      }).then(libera);
      return false;
    }, (errore: unknown) => {
      libera();
      throw errore;
    });
  }

  // Senza finestra il comando aspetta la famiglia, e lo si vede.
  if (dipendenze.carica.stato(voce.famiglia).kind !== "pronta") {
    dipendenze.annuncia(t("draw.completo.key.waiting"));
  }
  return dipendenze.carica.famiglia(voce.famiglia).then(async (stato) => {
    if (dipendenze.vita.closed) return false;
    if (stato.kind !== "pronta") {
      dipendenze.annuncia(t("draw.window.failed"));
      return false;
    }
    const esito = await chiamaConArgomenti(dipendenze, comando.id, valoreDi(comando.id, comando.valore, dipendenze), false);
    if (dipendenze.vita.closed) return false;
    if (esito === null) {
      dipendenze.annuncia(t("draw.window.unanswered"));
      return false;
    }
    return applicaRisposta(esito, etichetta, dipendenze);
  });
}
