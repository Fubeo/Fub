// Le finestre dei comandi del disegno (K6 T6): una sola finestra del kit che
// legge lo schema di un comando, ne mostra i campi e, con «Anteprima» accesa,
// lascia vedere l'esito sul foglio.
//
// La finestra non sa di famiglie. Riceve lo schema (`ModuloFinestra`, i
// parametri del comando), una promessa che dice quando la famiglia è pronta
// (`pronto`, che si rifiuta con `"no_memory"` o con altro) e il comando da
// mandare (`esegui`). Chi la apre le dà anche il foglio (`sulFoglio`) e la vita
// del disegno: quando il disegno si chiude, la finestra si chiude senza
// mandare niente.
//
// - **Caricamento ed errore.** Mentre la famiglia arriva la finestra lo dice.
//   Se non ci riesce lo dice, con «Riprova» se chi l'ha aperta sa rifarlo.
// - **L'anteprima.** Con «Anteprima» accesa il comando gira in anteprima al
//   più ogni 120 ms, e il foglio mostra l'esito. Un esito arrivato dopo uno
//   più nuovo, o dopo la chiusura, si butta. Se il motore non fa anteprime
//   (`no_preview`) la casella non c'è.
// - **OK** manda il comando una volta sola: è un passo della cronologia. Un
//   numero fuori dai limiti, o un testo vuoto, non si prende e OK resta spento
//   (o non fa niente, con un testo).
// - **Annulla ed Esc** non mandano niente e tolgono l'anteprima dal foglio.
// - **I valori** dell'ultima volta si ricordano per sessione, sotto l'id del
//   comando: non vanno sul disco.
//
// Lo schema è un sottoinsieme del `Modulo` di K3 (`fub-motori`): la finestra
// legge solo i campi che usa. Il numero non ha un vuoto: un parametro
// facoltativo numerico è un lavoro di chi porta la famiglia.
import type { DrawingPreview, DrawingRefusal } from "../../../host/contract";
import { openDialog } from "../../../kit/dialog";
import { adopt } from "../../../kit/owned";
import { formBody, formCheck, formChoice, formError, formNote, formNumber, formRow, formText } from "../../../kit/form";
import { composingKey } from "../../../kit/ime";
import type { QuantityProblem } from "../../../kit/quantity";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { skeleton } from "../../../ui/skeleton";
import { t, type DrawKey } from "../strings";

/// Un campo del modulo come la finestra lo legge. I limiti di un numero li dà
/// chi porta la famiglia: lo schema del motore dice il tipo, non i limiti.
export type CampoFinestra =
  | { readonly nome: string; readonly tipo: "testo"; readonly facoltativo: boolean }
  | { readonly nome: string; readonly tipo: "numero"; readonly min?: number; readonly max?: number }
  | { readonly nome: string; readonly tipo: "scelta"; readonly valori: readonly string[] }
  | { readonly nome: string; readonly tipo: "sino" };

/// Il modulo dei parametri di un comando: i campi nell'ordine dello schema.
export interface ModuloFinestra {
  readonly campi: readonly CampoFinestra[];
}

/// Il valore di un campo, come va nei parametri del comando.
export type ValoreCampo = string | number | boolean;

/// L'esito che il motore dà a un comando: l'anteprima, se era un'anteprima, e
/// il motivo del rifiuto, se ce n'è uno. È il `DrawingOutcome` ridotto a ciò
/// che la finestra legge.
export interface EsitoComando {
  readonly anteprima: DrawingPreview | null;
  readonly rifiuto: DrawingRefusal | null;
}

/// Manda il comando con questi valori. Con `anteprima` vero il motore lo
/// calcola senza scriverlo nella cronologia, e chi lo chiama lo mette sul
/// foglio; falso lo applica come un passo della cronologia.
export type Esegui = (valori: Readonly<Record<string, ValoreCampo>>, anteprima: boolean) => Promise<EsitoComando>;

export interface FinestraOpzioni {
  /// Il comando: sotto questo id si ricordano i valori dell'ultima volta.
  readonly id: string;
  /// Il nome del comando, come lo legge la tavolozza.
  readonly titolo: string;
  /// Una frase sotto il titolo, se il comando ne ha una.
  readonly descrizione?: string;
  /// Il verbo che manda il comando, come «Sposta». Di serie «OK».
  readonly azione?: string;
  /// Il nome di ogni campo, per nome del campo.
  readonly campi: Readonly<Record<string, string>>;
  /// Le parole di ogni scelta: per campo, poi per valore.
  readonly scelte?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /// L'unità di ogni numero, per nome del campo.
  readonly unita?: Readonly<Record<string, string>>;
  /// I valori di partenza, per nome del campo, se non ci sono quelli di prima.
  readonly iniziali: Readonly<Record<string, ValoreCampo>>;
  /// La frase del caricamento, se la funzione ne ha una sua.
  readonly caricamento?: string;
  /// Il disegno. Quando si chiude, la finestra si chiude senza mandare niente.
  readonly vita: Lifetime;
  /// Mette l'anteprima sul foglio, o la toglie con `null`.
  readonly sulFoglio: (anteprima: DrawingPreview | null) => void;
  /// Rifà la promessa di `pronto` dopo un errore di caricamento. Senza, il
  /// «Riprova» dell'errore non c'è.
  readonly riprova?: () => Promise<unknown>;
}

/// La scelta che il pulsante ha fatto.
type Scelta = "ok" | "annulla" | "riprova";

/// L'attesa minima fra due anteprime che partono.
export const INTERVALLO_ANTEPRIMA_MS = 120;

/// Che cosa non va in ciò che si scrive in un campo di numeri: le stesse frasi
/// del pannello delle proprietà.
const PROBLEMI: Readonly<Record<QuantityProblem, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// I valori dell'ultima volta, per id del comando. Vivono quanto la pagina: non
/// vanno sul disco.
const RICORDATI = new Map<string, Readonly<Record<string, ValoreCampo>>>();

/// Un campo mentre la finestra è aperta: da dove si legge il suo valore, se è
/// valido e dove va il fuoco.
interface CampoVivo {
  readonly nome: string;
  readonly nodo: HTMLElement;
  /// Il valore da mandare; `undefined` se un testo facoltativo è vuoto.
  valore(): ValoreCampo | undefined;
  /// Vero se il valore si può prendere; un testo non valido dice perché.
  controlla(): boolean;
  /// Falso se un numero è in errore: il pulsante di conferma ne tiene conto.
  valido(): boolean;
}

/// Mostra un comando del disegno in una finestra del kit. Risolve `true` se il
/// comando è stato applicato con OK, `false` se si è chiusa senza.
export function apriFinestra(
  modulo: ModuloFinestra,
  pronto: Promise<unknown>,
  esegui: Esegui,
  opzioni: FinestraOpzioni,
): Promise<boolean> {
  return new Promise<boolean>((fine) => {
    const own = openLifetime();
    // Chiudendosi il disegno, la finestra si chiude: il suo `own` va con lei.
    const releaseFromDrawing = adopt(opzioni.vita, () => own.close());

    let chiusa = false;
    /// Il numero dell'ultima anteprima mandata: un esito con un numero vecchio
    /// si butta.
    let numero = 0;
    let ultimoInvio = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let anteprimaAccesa = true;
    let anteprimaPossibile = true;
    let formaPronta = false;
    let campi: readonly CampoVivo[] = [];
    let anteprimaRiga: HTMLElement | null = null;
    let errore: HTMLParagraphElement | null = null;
    /// Che cosa fa «Riprova» adesso, se c'è qualcosa da rifare. Non risponde
    /// alla finestra: chi la rifà chiude da sé con OK, o rimanda l'anteprima.
    let ripeti: (() => void) | null = null;

    const corpo = formBody([]);
    const handle = openDialog<Scelta>({
      title: opzioni.titolo,
      description: opzioni.descrizione,
      body: corpo,
      actions: [
        { id: "riprova", label: t("draw.window.retry"), value: "riprova" },
        { id: "annulla", label: t("draw.window.cancel"), value: "annulla" },
        { id: "ok", label: opzioni.azione ?? t("draw.window.ok"), kind: "primary", value: "ok" },
      ],
      dismissValue: "annulla",
      lifetime: own,
      className: "draw-effect-dialog",
      preview: true,
      confirm: (scelta) => decidi(scelta),
    });
    const dialog = handle.element;
    const descrizione = dialog.querySelector<HTMLElement>(".kit-dialog-description");
    const ok = dialog.querySelector<HTMLButtonElement>('[data-action="ok"]')!;
    const riprova = dialog.querySelector<HTMLButtonElement>('[data-action="riprova"]')!;
    const annulla = dialog.querySelector<HTMLButtonElement>('[data-action="annulla"]')!;

    // Un Invio in un campo di testo o di numeri conferma, come in un modulo. Il
    // campo di numeri già lo ha preso per sé (lo passa a chi lo ha scritto):
    // qui si chiede al pulsante di OK, che è spento se il valore non va.
    own.listen(corpo, "keydown", (event) => {
      const target = event.target;
      const campo = target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset"].includes(target.type);
      if (event.key !== "Enter" || !campo || !formaPronta || composingKey(event) || event.repeat) return;
      event.preventDefault();
      ok.click();
    });

    const aggiornaOk = (): void => {
      ok.disabled = !formaPronta || campi.some((campo) => !campo.valido());
    };

    const annullaAnteprima = (): void => {
      numero += 1;
      fermaTimer();
      opzioni.sulFoglio(null);
    };

    const fermaTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const leggi = (): Record<string, ValoreCampo> => {
      const valori: Record<string, ValoreCampo> = {};
      for (const campo of campi) {
        const valore = campo.valore();
        if (valore !== undefined) valori[campo.nome] = valore;
      }
      return valori;
    };

    const messaggioDi = (motivo: DrawingRefusal | "unanswered"): string => {
      if (motivo === "no_memory") return t("draw.window.nomemory");
      if (motivo === "unanswered") return t("draw.window.unanswered");
      return t("draw.window.refused");
    };

    const togliErrore = (): void => {
      errore?.remove();
      errore = null;
      ripeti = null;
      riprova.hidden = true;
    };

    const mostraErroreComando = (motivo: DrawingRefusal | "unanswered", rifai: () => void): void => {
      if (errore === null) {
        errore = formError(messaggioDi(motivo));
        corpo.append(errore);
      } else {
        errore.textContent = messaggioDi(motivo);
      }
      ripeti = rifai;
      riprova.hidden = false;
    };

    const mandaAnteprima = (): void => {
      if (chiusa || !formaPronta || !anteprimaAccesa || !anteprimaPossibile) return;
      ultimoInvio = Date.now();
      const mio = ++numero;
      const valori = leggi();
      Promise.resolve()
        .then(() => esegui(valori, true))
        .then(
          (esito) => {
            if (chiusa || mio !== numero) return;
            if (esito.rifiuto === "no_preview") {
              anteprimaPossibile = false;
              anteprimaRiga?.remove();
              anteprimaRiga = null;
              opzioni.sulFoglio(null);
              return;
            }
            if (esito.rifiuto === "no_memory") {
              opzioni.sulFoglio(null);
              mostraErroreComando("no_memory", () => mandaAnteprima());
              return;
            }
            togliErrore();
            opzioni.sulFoglio(esito.rifiuto === null ? esito.anteprima : null);
          },
          () => {
            if (chiusa || mio !== numero) return;
            opzioni.sulFoglio(null);
          },
        );
    };

    const pianificaAnteprima = (): void => {
      if (chiusa || !formaPronta || !anteprimaAccesa || !anteprimaPossibile) return;
      const attesa = INTERVALLO_ANTEPRIMA_MS - (Date.now() - ultimoInvio);
      if (attesa <= 0) {
        fermaTimer();
        mandaAnteprima();
        return;
      }
      timer ??= setTimeout(() => {
        timer = null;
        mandaAnteprima();
      }, attesa);
    };

    const controllaTutti = (): boolean => {
      let tutto = true;
      for (const campo of campi) {
        if (campo.controlla()) continue;
        if (tutto) campo.nodo.querySelector<HTMLElement>("input")?.focus();
        tutto = false;
      }
      return tutto;
    };

    const conferma = (): boolean | Promise<boolean> => {
      if (!formaPronta || !controllaTutti()) return false;
      annullaAnteprima();
      const valori = leggi();
      togliErrore();
      return Promise.resolve()
        .then(() => esegui(valori, false))
        .then(
          (esito) => {
            if (esito.rifiuto === null) {
              RICORDATI.set(opzioni.id, valori);
              return true;
            }
            mostraErroreComando(esito.rifiuto, rifaiOk);
            return false;
          },
          () => {
            mostraErroreComando("unanswered", rifaiOk);
            return false;
          },
        );
    };

    /// «Riprova» di un comando rifatto: il pulsante OK fa il suo lavoro, con la
    /// sua occupazione e la sua chiusura.
    const rifaiOk = (): void => {
      ok.click();
    };

    const decidi = (scelta: Scelta): boolean | Promise<boolean> => {
      if (scelta === "annulla") return true;
      if (scelta === "ok") return conferma();
      ripeti?.();
      return false;
    };

    const mostraCaricamento = (): void => {
      formaPronta = false;
      corpo.replaceChildren(formNote(opzioni.caricamento ?? t("draw.window.loading"), true), skeleton(5, "div", true));
      corpo.setAttribute("aria-busy", "true");
      dialog.setAttribute("aria-busy", "true");
      if (descrizione) descrizione.hidden = true;
      ok.disabled = true;
      togliErrore();
      annulla.focus();
    };

    const mostraErroreCaricamento = (motivo: unknown): void => {
      corpo.replaceChildren(formError(motivo === "no_memory" ? t("draw.window.nomemory") : t("draw.window.failed")));
      corpo.removeAttribute("aria-busy");
      dialog.removeAttribute("aria-busy");
      if (descrizione) descrizione.hidden = true;
      ok.disabled = true;
      const rifai = opzioni.riprova;
      ripeti = rifai === undefined ? null : () => attendi(rifai());
      riprova.hidden = rifai === undefined;
      if (rifai !== undefined) riprova.focus();
    };

    const costruisci = (): void => {
      const partenza: Readonly<Record<string, ValoreCampo>> = { ...opzioni.iniziali, ...RICORDATI.get(opzioni.id) };
      const righe: HTMLElement[] = [];
      campi = modulo.campi.map((campo) => {
        const etichetta = opzioni.campi[campo.nome] ?? campo.nome;
        switch (campo.tipo) {
          case "testo": {
            const testo = formText({
              label: etichetta,
              value: String(partenza[campo.nome] ?? ""),
              blank: t("draw.window.blank"),
              onChange: () => {
                if (testo.valid()) testo.setError(null);
              },
              lifetime: own,
            });
            righe.push(testo.element);
            return {
              nome: campo.nome,
              nodo: testo.element,
              valore: () => (campo.facoltativo && testo.value().trim() === "" ? undefined : testo.value()),
              controlla: () => {
                if (campo.facoltativo || testo.valid()) {
                  testo.setError(null);
                  return true;
                }
                testo.setError(t("draw.window.blank"));
                return false;
              },
              valido: () => true,
            };
          }
          case "numero": {
            const unita = opzioni.unita?.[campo.nome];
            const campoNumero = formNumber({
              label: etichetta,
              value: Number(partenza[campo.nome] ?? 0),
              unit: unita,
              min: campo.min,
              max: campo.max,
              places: 2,
              outOfRange: (min, max) => rangeDi(min, max),
              problem: (problem) => (problem === "mixed" ? t("draw.properties.problem.mixed") : t(PROBLEMI[problem], { units: unita ?? "" })),
              onChange: () => pianificaAnteprima(),
              onValidity: () => aggiornaOk(),
              lifetime: own,
            });
            righe.push(formRow(campoNumero.element));
            return {
              nome: campo.nome,
              nodo: campoNumero.element,
              valore: () => campoNumero.value(),
              controlla: () => campoNumero.valid(),
              valido: () => campoNumero.valid(),
            };
          }
          case "scelta": {
            const parole = opzioni.scelte?.[campo.nome] ?? {};
            const scelta = formChoice({
              label: etichetta,
              choices: campo.valori.map((valore) => ({ value: valore, label: parole[valore] ?? valore })),
              value: String(partenza[campo.nome] ?? campo.valori[0] ?? ""),
              onChange: () => pianificaAnteprima(),
              lifetime: own,
            });
            righe.push(scelta.element);
            return {
              nome: campo.nome,
              nodo: scelta.element,
              valore: () => scelta.value(),
              controlla: () => true,
              valido: () => true,
            };
          }
          case "sino": {
            const casellaCampo = formCheck({
              label: etichetta,
              checked: partenza[campo.nome] === true,
              onChange: () => pianificaAnteprima(),
              lifetime: own,
            });
            righe.push(casellaCampo.element);
            return {
              nome: campo.nome,
              nodo: casellaCampo.element,
              valore: () => casellaCampo.checked(),
              controlla: () => true,
              valido: () => true,
            };
          }
        }
      });

      // La casella «Anteprima»: sparisce se il motore non ne fa.
      const casellaAnteprima = formCheck({
        label: t("draw.window.preview"),
        checked: anteprimaAccesa,
        onChange: (accesa) => {
          anteprimaAccesa = accesa;
          if (accesa) pianificaAnteprima();
          else annullaAnteprima();
        },
        lifetime: own,
      });
      anteprimaRiga = casellaAnteprima.element;
      corpo.replaceChildren(...righe, casellaAnteprima.element);
      corpo.removeAttribute("aria-busy");
      dialog.removeAttribute("aria-busy");
      if (descrizione) descrizione.hidden = false;
      riprova.hidden = true;
      ripeti = null;
      formaPronta = true;
      aggiornaOk();
      const primo = campi[0];
      if (primo) primo.nodo.querySelector<HTMLElement>('[aria-checked="true"], input, button')?.focus();
      else casellaAnteprima.element.querySelector<HTMLElement>("input")?.focus();
      pianificaAnteprima();
    };

    const attendi = (promessa: Promise<unknown>): void => {
      mostraCaricamento();
      promessa.then(
        () => {
          if (!chiusa) costruisci();
        },
        (motivo: unknown) => {
          if (!chiusa) mostraErroreCaricamento(motivo);
        },
      );
    };

    handle.result.then((scelta) => {
      chiusa = true;
      fermaTimer();
      opzioni.sulFoglio(null);
      releaseFromDrawing();
      own.close();
      fine(scelta === "ok");
    });

    attendi(pronto);
  });
}

/// La frase quando un numero è fuori dai suoi limiti, con i limiti scritti.
function rangeDi(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return t("draw.window.range", { min, max });
  if (min !== undefined) return t("draw.window.range.min", { min });
  return t("draw.window.range.max", { max: max ?? 0 });
}
