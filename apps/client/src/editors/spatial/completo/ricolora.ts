// Ricolora grafica (K6 T14, giro 3): la finestra di Modifica › Ricolora grafica. Una riga per colore
// della scelta: a sinistra il colore attuale, a destra il colore nuovo, col selettore del kit.
// Riduci colori e Colori casuali riempiono le righe con le proposte del motore (`recolor.reduce` e
// `recolor.randomize`, letture). Ogni cambio manda un'anteprima (`recolor.apply` con `preview`) sul
// foglio; OK la scrive una volta sola con la strada dei comandi del Completo; Annulla ed Esc tolgono
// l'anteprima e non scrivono niente.
import type { DrawingRefusal } from "../../../host/contract";
import { textButton } from "../../../kit/button";
import { createColorPicker } from "../../../kit/color/picker";
import { openDialog } from "../../../kit/dialog";
import {
  formBody,
  formCheck,
  formChoice,
  formError,
  formNote,
  formNumber,
  formRow,
  type FormChoiceHandle,
  type FormNumber,
} from "../../../kit/form";
import type { QuantityProblem } from "../../../kit/quantity";
import { adopt } from "../../../kit/owned";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { INTERVALLO_ANTEPRIMA_MS } from "../motore/finestre";
import { motivoDelRifiuto } from "../motore/rifiuto";
import { t, type DrawKey } from "../strings";
import { drawPickerText } from "../tools/color-text";
import { testoPerche, type StatoComandi } from "./comandi";
import { applicaEsito, chiama, type DipendenzeComando } from "./esegui";
import {
  conProposta,
  gruppiIniziali,
  mappaCompleta,
  mappaDeiGruppi,
  METODI,
  metodoValido,
  normalizzaHex,
  type GruppoColore,
  type Metodo,
} from "./ricolora-modello";

/// Il comando del motore che scrive la ricolorazione: lo manda la finestra, non il menu.
export const COMANDO_RICOLORA = "disegno.recolor.apply";

/// La voce di menu che apre la finestra (Modifica › Ricolora grafica…): una voce del client.
export const VOCE_RICOLORA = "ui.recolorDialog";

/// Perché la voce di menu è spenta: il motore dice se il comando che la finestra scrive si può
/// fare (senza scelta, con un oggetto bloccato o un tratto dell'Inchiostro no). `null` se è accesa
/// o il motore non ha detto niente.
export function motivoRicolora(stato: StatoComandi): string | null {
  const info = stato.per?.get(COMANDO_RICOLORA);
  if (info === undefined || info.enabled) return null;
  return testoPerche(info.disabled_reason);
}

/// I comandi del motore che la finestra usa, con il prefisso del Completo.
const LEGGI = "disegno.recolor.colors";
const RIDUCI = "disegno.recolor.reduce";
const CASUALI = "disegno.recolor.randomize";
const APPLICA = COMANDO_RICOLORA;

const ETICHETTA_METODO: Readonly<Record<Metodo, DrawKey>> = {
  exact: "draw.recolor.metodo.exact",
  preserveTints: "draw.recolor.metodo.preserveTints",
  scaleTints: "draw.recolor.metodo.scaleTints",
  tintsShades: "draw.recolor.metodo.tintsShades",
  hueShift: "draw.recolor.metodo.hueShift",
};

const PROBLEMI: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

type Scelta = "ok" | "annulla" | "riprova";

function messaggioDelRifiuto(rifiuto: DrawingRefusal): string {
  const motivo = motivoDelRifiuto(rifiuto);
  return motivo === null ? t("draw.recolor.nessun.cambio") : t("draw.rejected", { reason: t(motivo) });
}

/// Un numero della finestra: fuori dai limiti o non letto, dice perché.
function campoNumero(etichetta: string, valore: number, min: number, max: number, onChange: () => void, vita: Lifetime): FormNumber {
  return formNumber({
    label: etichetta,
    value: valore,
    min,
    max,
    places: 0,
    outOfRange: (minimo, massimo) => t("draw.recolor.fuori", { min: String(minimo ?? min), max: String(massimo ?? max) }),
    problem: (problema) => t(problema === "mixed" ? PROBLEMI.syntax : PROBLEMI[problema]),
    onChange,
    lifetime: vita,
  });
}

/// La finestra di Ricolora grafica. Risolve `true` se OK ha scritto la ricolorazione, `false` se
/// si è chiusa senza (Annulla, Esc, il velo, la chiusura del disegno).
export function apriRicolora(dipendenze: DipendenzeComando): Promise<boolean> {
  return new Promise<boolean>((fine) => {
    const own = openLifetime();
    const liberaDalDisegno = adopt(dipendenze.vita, () => own.close());
    let chiusa = false;
    let gruppi: readonly GruppoColore[] = [];
    let metodo: Metodo = "exact";
    let occupato = false;
    // Il numero dell'ultima anteprima o proposta mandata: un esito più vecchio si butta.
    let versione = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let righe: Lifetime = openLifetime();
    let ok: HTMLButtonElement | null = null;

    const fermaTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    own.add(() => {
      chiusa = true;
      fermaTimer();
      righe.close();
      liberaDalDisegno();
    });

    const nota = formNote("");
    const errore = formError("");
    errore.hidden = true;
    const elenco = document.createElement("div");
    elenco.className = "draw-recolor-list";
    const contenitoreMetodo = document.createElement("div");
    let scegliMetodo: FormChoiceHandle | null = null;

    const aggiornaStato = (): void => {
      if (ok !== null) ok.disabled = occupato || mappaDeiGruppi(gruppi).length === 0;
    };
    const mostraNota = (testo: string): void => {
      nota.textContent = testo;
      nota.hidden = testo === "";
    };
    const mostraErrore = (testo: string | null): void => {
      errore.textContent = testo ?? "";
      errore.hidden = testo === null;
    };

    const montaMetodo = (): void => {
      scegliMetodo = formChoice({
        label: t("draw.recolor.metodo"),
        choices: METODI.map((m) => ({ value: m, label: t(ETICHETTA_METODO[m]) })),
        value: metodo,
        onChange: (valore) => {
          if (!metodoValido(valore)) return;
          metodo = valore;
          programma();
        },
        lifetime: own,
      });
      contenitoreMetodo.replaceChildren(scegliMetodo.element);
    };

    /// Una riga: a sinistra i colori attuali del gruppo, a destra il colore nuovo.
    const riga = (gruppo: GruppoColore, indice: number): HTMLElement => {
      const contenitore = document.createElement("div");
      contenitore.className = "draw-recolor-row";
      const attuale = document.createElement("div");
      attuale.className = "draw-recolor-current";
      for (const hex of gruppo.attuali) {
        const campione = document.createElement("span");
        campione.className = "draw-recolor-chip";
        campione.style.backgroundColor = hex;
        campione.setAttribute("aria-hidden", "true");
        attuale.append(campione);
      }
      const codice = document.createElement("code");
      codice.className = "draw-recolor-code";
      codice.textContent = gruppo.attuali.length > 1 ? `${gruppo.attuali[0]} +${gruppo.attuali.length - 1}` : gruppo.attuali[0]!;
      attuale.append(codice);
      const freccia = document.createElement("span");
      freccia.className = "draw-recolor-arrow";
      freccia.setAttribute("aria-hidden", "true");
      freccia.textContent = "→";
      const selettore = createColorPicker({
        value: gruppo.nuovo,
        text: drawPickerText(),
        free: true,
        onChange: (colore) => cambia(indice, colore),
        lifetime: righe,
      });
      contenitore.append(attuale, freccia, selettore.element);
      return contenitore;
    };

    const disegnaRighe = (): void => {
      righe.close();
      righe = openLifetime();
      elenco.replaceChildren(...gruppi.map((gruppo, indice) => riga(gruppo, indice)));
    };

    const cambia = (indice: number, colore: string): void => {
      const hex = normalizzaHex(colore);
      if (hex === null) return;
      gruppi = gruppi.map((gruppo, i) => (i === indice ? { ...gruppo, nuovo: hex } : gruppo));
      aggiornaStato();
      programma();
    };

    /// Un'anteprima: parte dopo una breve attesa, e l'ultima scelta vince.
    const programma = (): void => {
      fermaTimer();
      timer = setTimeout(() => {
        timer = null;
        void anteprimaOra();
      }, INTERVALLO_ANTEPRIMA_MS);
    };
    const anteprimaOra = async (): Promise<void> => {
      if (chiusa) return;
      const questa = ++versione;
      const mappa = mappaDeiGruppi(gruppi);
      if (mappa.length === 0) {
        dipendenze.anteprima(null);
        mostraErrore(null);
        return;
      }
      const esito = await chiama(dipendenze, APPLICA, { map: mappa, method: metodo }, true).catch(() => null);
      if (chiusa || questa !== versione) return;
      if (esito === null) {
        dipendenze.anteprima(null);
        mostraErrore(t("draw.recolor.errore.motore"));
        return;
      }
      if (esito.refused !== null) {
        dipendenze.anteprima(null);
        mostraErrore(messaggioDelRifiuto(esito.refused));
        return;
      }
      mostraErrore(null);
      dipendenze.anteprima(esito.preview);
    };

    /// Le letture del motore: colori attuali, o una proposta di Riduci e Colori casuali.
    const attendi = async (id: string, valore: unknown): Promise<unknown> => {
      occupato = true;
      versione += 1;
      fermaTimer();
      aggiornaStato();
      const esito = await chiama(dipendenze, id, valore, false).catch(() => null);
      occupato = false;
      if (chiusa) return null;
      if (esito === null || esito.refused !== null) {
        mostraErrore(esito?.refused ? messaggioDelRifiuto(esito.refused) : t("draw.recolor.errore.motore"));
        aggiornaStato();
        return null;
      }
      return esito.reading;
    };

    const ricarica = async (): Promise<void> => {
      mostraErrore(null);
      // Senza scelta il menu tiene la voce spenta; se la finestra si apre lo stesso (un tasto), lo
      // dice e non legge niente: il motore sceglierebbe da sé, e Ricolora no.
      if (dipendenze.selezione().length === 0) {
        mostraNota(t("draw.disabled.no_selection"));
        aggiornaStato();
        return;
      }
      mostraNota(t("draw.recolor.caricamento"));
      const letti = gruppiIniziali(await attendi(LEGGI, {}));
      if (chiusa) return;
      if (letti === null) {
        mostraNota("");
        mostraErrore(t("draw.recolor.errore.lettura"));
        aggiornaStato();
        return;
      }
      gruppi = letti;
      mostraNota(letti.length === 0 ? t("draw.recolor.vuoto") : "");
      disegnaRighe();
      aggiornaStato();
    };

    /// Applica la proposta del motore alle righe. `metodoDelMotore` è il metodo che il motore usa
    /// per la proposta (Riduci colori ne dà uno): la scelta della finestra lo segue.
    const applicaProposta = (lettura: unknown, metodoDelMotore: boolean): void => {
      const nuovi = conProposta(gruppi, lettura);
      if (nuovi === null) {
        mostraErrore(t("draw.recolor.errore.proposta"));
        aggiornaStato();
        return;
      }
      gruppi = nuovi;
      const proposto = typeof lettura === "object" && lettura !== null ? (lettura as { method?: unknown }).method : undefined;
      if (metodoDelMotore && metodoValido(proposto)) {
        metodo = proposto;
        montaMetodo();
      }
      disegnaRighe();
      aggiornaStato();
      programma();
    };

    const riduciColori = async (): Promise<void> => {
      if (occupato || chiusa || gruppi.length === 0 || !quanti.valid()) return;
      const lettura = await attendi(RIDUCI, { colors: quanti.value() });
      if (lettura !== null && !chiusa) applicaProposta(lettura, true);
    };

    const coloriCasuali = async (): Promise<void> => {
      if (occupato || chiusa || gruppi.length === 0 || !seme.valid()) return;
      const lettura = await attendi(CASUALI, {
        map: mappaCompleta(gruppi),
        order: ordine.checked(),
        saturationBrightness: saturazione.checked(),
        seed: seme.value(),
      });
      if (lettura !== null && !chiusa) applicaProposta(lettura, false);
    };

    const quanti = campoNumero(t("draw.recolor.riduci.quanti"), 3, 1, 999, () => undefined, own);
    const riduci = textButton({ label: t("draw.recolor.riduci"), onPress: () => void riduciColori(), lifetime: own });
    const seme = campoNumero(t("draw.recolor.seme"), 0, 0, 4294967295, () => undefined, own);
    const ordine = formCheck({ label: t("draw.recolor.casuali.ordine"), checked: true, onChange: () => undefined, lifetime: own });
    const saturazione = formCheck({
      label: t("draw.recolor.casuali.saturazione"),
      checked: false,
      onChange: () => undefined,
      lifetime: own,
    });
    const casuali = textButton({ label: t("draw.recolor.casuali"), onPress: () => void coloriCasuali(), lifetime: own });
    montaMetodo();

    const decidi = async (scelta: Scelta): Promise<boolean> => {
      if (scelta === "annulla") return true;
      if (scelta === "riprova") {
        void ricarica();
        return false;
      }
      const mappa = mappaDeiGruppi(gruppi);
      if (mappa.length === 0 || occupato) return false;
      occupato = true;
      versione += 1;
      fermaTimer();
      aggiornaStato();
      const esito = await chiama(dipendenze, APPLICA, { map: mappa, method: metodo }, false).catch(() => null);
      occupato = false;
      if (chiusa) return false;
      if (esito === null) {
        mostraErrore(t("draw.recolor.errore.motore"));
        aggiornaStato();
        return false;
      }
      const riuscita = applicaEsito(esito, t("draw.recolor.titolo"), dipendenze);
      if (!riuscita) {
        mostraErrore(esito.refused !== null ? messaggioDelRifiuto(esito.refused) : t("draw.recolor.errore.scrittura"));
        aggiornaStato();
      }
      return riuscita;
    };

    const corpo = formBody([
      nota,
      elenco,
      contenitoreMetodo,
      formRow(quanti.element, riduci),
      formRow(seme.element, ordine.element, saturazione.element, casuali),
      errore,
    ]);
    const handle = openDialog<Scelta>({
      title: t("draw.recolor.titolo"),
      description: t("draw.recolor.descrizione"),
      body: corpo,
      actions: [
        { id: "retry", label: t("draw.window.retry"), value: "riprova" },
        { id: "cancel", label: t("draw.window.cancel"), value: "annulla" },
        { id: "ok", label: t("draw.recolor.azione"), kind: "primary", value: "ok" },
      ],
      dismissValue: "annulla",
      lifetime: own,
      className: "draw-effect-dialog draw-recolor-dialog",
      preview: true,
      confirm: (scelta) => decidi(scelta),
    });
    ok = handle.element.querySelector<HTMLButtonElement>('[data-action="ok"]');
    aggiornaStato();
    handle.result.then((scelta) => {
      chiusa = true;
      fermaTimer();
      versione += 1;
      dipendenze.anteprima(null);
      own.close();
      fine(scelta === "ok");
    });
    void ricarica();
  });
}
