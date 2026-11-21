// L'ingresso del Disegno completo (piano K6, T5;
// `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// `chrome/workspace.ts` lo porta con un `import()` quando si entra nel
// Completo col componente «Disegno completo» acceso; Vite lo mette nel chunk
// `drawing-completo`, che nessuna pagina carica all'avvio. Terrà i pezzi della
// cornice del Completo (lo spazio, la colonna, le opzioni, i tasti e le
// sezioni), e dà l'indice dei comandi e il caricatore delle famiglie. Oggi
// `apri` porta l'indice e prepara il nucleo, e basta.

import { caricatore, type Caricatore, type ContestoCompleto, type OpzioniCaricatore, type StatoFamiglia } from "./carica";
import { creaSezioni, type Sezioni } from "./sezioni";
import type { Indice, VoceIndice } from "./indice";
// I comandi nel menu ≡ e nella ricerca Ctrl+/ (T9a): le voci, il perché e l'avvio.
import { inviaComando, menuComando, menuNonCaricato, nomeVoce, statoComandi, vociRicerca, type VoceRicerca } from "./comandi";
import { apriFinestra, type CampoFinestra, type EsitoComando, type ModuloFinestra } from "../motore/finestre";
import type { DrawingOutcome, DrawingPreview } from "../../../host/contract";
import type { MenuItem } from "../../../ui/menu";
// Blocco degli spazi del Completo (T7): i preset e la loro applicazione.
import { applicaSpazio, presetDi, type EffettiSpazio } from "./spazi";
export type { EffettiSpazio, SchedaSpazio, SpazioPreset } from "./spazi";
// La colonna (K6 T8): le caselle e il cassetto, con il suo pezzo col `import()`.
import { layoutCompleto, MOTORE_PRONTO, type GruppoLayout } from "./colonna";
import type { ToolSpec } from "../tools/registry";
import type { Lifetime } from "../../../ui/lifetime";
import type { CassettoOptions } from "../tools/editor/chrome/drawer";
import { openPopover } from "../../../kit/popover";
import { keyboardPlatform } from "../../../ui/commands";
import { t } from "../strings";
// I tasti del motore (K6 T9b): il montaggio sulla radice dell'editor, e il
// percorso di un comando che fanno partire.
import { eseguiVoce, type AzioniEsito, type OpzioniFinestraComando } from "./esegui";
import { montaTasti } from "./montaggio-tasti";
import type { ModificheTasti, Piattaforma } from "./tasti";
export type { GruppoLayout } from "./colonna";

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
  /// La colonna del Completo per gli strumenti offerti (T8): sei gruppi, le
  /// caselle che hanno strumenti pronti, nell'ordine del prototipo.
  colonna(offerti: readonly ToolSpec[]): readonly GruppoLayout[];
  /// Apre il cassetto «Tutti gli strumenti» dalla sua casella (T8). Il suo
  /// pezzo arriva con un `import()`, la prima volta.
  cassetto(anchor: HTMLElement, opzioni: Omit<CassettoOptions, "anchor" | "lifetime">, lifetime: Lifetime): void;
  /// Il menu ≡ con le voci dell'indice (T9a): i sottomenu `menu/<sottomenu>`,
  /// le voci spente col loro perché. Se l'indice non arriva, lo dice, con
  /// «Riprova» (`azioni.riprova`).
  menu(selezione: () => readonly string[], azioni: AzioniVoci): Promise<MenuItem[]>;
  /// Le voci della ricerca Ctrl+/ (T9a), con il tasto, il posto e il perché.
  /// `null` se l'indice non arriva: chi cerca lo dice, con «Riprova».
  ricerca(selezione: () => readonly string[], azioni: AzioniVoci): Promise<VoceRicerca[] | null>;
}

/// Ciò che l'editor dà a una voce del menu o della ricerca (T9a).
export interface AzioniVoci {
  /// Lo strumento del motore: lo sceglie l'editor.
  readonly strumento: (id: string) => void;
  /// Applica al disegno l'esito di un comando: le sue operazioni, o il rifiuto.
  readonly applica: (esito: DrawingOutcome) => void;
  /// Mette l'anteprima di una finestra sul foglio, o la toglie con `null`.
  readonly sulFoglio: (anteprima: DrawingPreview | null) => void;
  /// Rifà l'indice, per chi lo mostra («Riprova»).
  readonly riprova: () => void;
}

export interface OpzioniCompleto {
  /// Chi porta l'indice; di serie `indice()` di `./indice`, nel suo chunk.
  readonly indice?: () => Promise<Indice>;
  readonly moduli?: OpzioniCaricatore["moduli"];
  readonly prepara?: OpzioniCaricatore["prepara"];
  /// I tasti del motore nell'editor (K6 T9b). Senza, nessun tasto del motore
  /// parte: il Semplice e i suoi tasti restano com'erano.
  readonly tasti?: OpzioniTastiCompleto;
}

/// Ciò che l'editor dà al Completo per i tasti del motore: il suo root, la
/// selezione e la cronologia (`AzioniEsito`), lo stato dello strumento, e le
/// modifiche dell'utente quando ci sono.
export interface OpzioniTastiCompleto extends AzioniEsito {
  readonly radice: HTMLElement;
  readonly selezione: () => readonly string[];
  readonly anteprima: (anteprima: DrawingPreview | null) => void;
  readonly stato: () => { readonly vuoleTesto: boolean; readonly componendo: boolean };
  readonly modifiche?: () => ModificheTasti;
  readonly finestra?: (voce: VoceIndice) => Promise<OpzioniFinestraComando | null>;
  readonly piattaforma?: Piattaforma;
}

/// Senza una finestra data, un comando con parametri dice che non ce l'ha.
const nessunaFinestra = (): Promise<OpzioniFinestraComando | null> => Promise.resolve(null);

/// La piattaforma per i tasti: Cmd su macOS, altrove Ctrl (come la shell).
const piattaformaDi = (): Piattaforma => (keyboardPlatform(navigator.platform) === "mac" ? "mac" : "other");

/// Dice che il cassetto non si è aperto (il suo pezzo non è arrivato), con
/// «Riprova», che lo apre di nuovo. Sta qui, non nel pezzo del cassetto: il
/// pezzo è quello che non è arrivato.
export function apriErroreCassetto(anchor: HTMLElement, lifetime: Lifetime, riprova: () => void): void {
  const testo = document.createElement("div");
  testo.className = "draw-drawer-failed";
  const messaggio = document.createElement("p");
  messaggio.className = "draw-drawer-note";
  messaggio.setAttribute("role", "alert");
  messaggio.textContent = t("draw.chrome.drawer.failed");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "draw-drawer-edit";
  retry.textContent = t("draw.window.retry");
  testo.append(messaggio, retry);
  const popover = openPopover({
    anchor,
    content: testo,
    placement: "right",
    align: "start",
    label: t("draw.chrome.drawer.failed"),
    className: "kit-rail-popover draw-drawer-popover",
    lifetime,
  });
  retry.addEventListener("click", () => {
    popover.close("manual");
    riprova();
  });
}

/// L'indice vero, dal suo chunk (`drawing-indice`).
const indiceVero = (): Promise<Indice> => import("./indice").then((m) => m.indice());

/// Un campo come lo scrive lo schema della famiglia (`schema.generated.json`).
interface CampoSchema {
  readonly nome: string;
  readonly tipo: string;
  readonly facoltativo?: boolean;
  readonly valori?: readonly string[];
}

/// Lo schema di una famiglia: le sue finestre, per id del comando.
interface SchemaFamiglia {
  readonly finestre: readonly { readonly id: string; readonly campi: readonly CampoSchema[] }[];
}

/// Un campo dello schema come lo legge la finestra di T6. I tipi che la
/// finestra non conosce (`cella`, `json`) si leggono come testo.
function campoDi(campo: CampoSchema): CampoFinestra {
  if (campo.tipo === "numero") return { nome: campo.nome, tipo: "numero" };
  if (campo.tipo === "scelta") return { nome: campo.nome, tipo: "scelta", valori: campo.valori ?? [] };
  if (campo.tipo === "sino") return { nome: campo.nome, tipo: "sino" };
  return { nome: campo.nome, tipo: "testo", facoltativo: campo.facoltativo === true };
}

/// Il modulo della finestra del comando `id`, dallo schema della sua famiglia
/// (il suo chunk). `null` se lo schema non arriva o non ha il comando.
async function moduloDi(famiglia: string, id: string): Promise<ModuloFinestra | null> {
  try {
    const file = (await import(`./famiglie/${famiglia}/schema.generated.json`)) as { readonly default?: unknown };
    const schema = (file.default ?? file) as SchemaFamiglia;
    const finestra = schema.finestre.find((one) => one.id === id);
    return finestra === undefined ? null : { campi: finestra.campi.map(campoDi) };
  } catch {
    return null;
  }
}

/// Apre il Completo di un disegno: chiede l'indice e prepara il nucleo. Un
/// indice che non arriva non ferma niente: chi lo mostra (≡, Ctrl+/) lo
/// richiede e dice che non si è caricato, con «Riprova».
export function apri(ctx: Omit<ContestoCompleto, "sezioni">, opzioni: OpzioniCompleto = {}): Completo {
  const indice = opzioni.indice ?? indiceVero;
  const sezioni = creaSezioni();
  const carica = caricatore({ ctx: { ...ctx, sezioni }, moduli: opzioni.moduli, prepara: opzioni.prepara });
  // Una voce del menu o della ricerca (T9a): uno strumento lo sceglie l'editor;
  // un comando con parametri apre la finestra di T6; gli altri girano subito.
  const avvia = (voce: VoceIndice, selezione: readonly string[], azioni: AzioniVoci): void => {
    const chiamata = voce.chiamata;
    if ("strumento" in chiamata) {
      azioni.strumento(chiamata.strumento);
      return;
    }
    if (!("comando" in chiamata)) return;
    if (voce.finestra) {
      finestraDi(voce, selezione, azioni);
      return;
    }
    void inviaComando(ctx.motore, { id: chiamata.comando, selection: [...selezione], value: chiamata.valore ?? {} }).then(
      (esito) => {
        if (esito !== null) azioni.applica(esito);
      },
      (errore: unknown) => console.error(errore),
    );
  };
  const finestraDi = (voce: VoceIndice, selezione: readonly string[], azioni: AzioniVoci): void => {
    const famiglia = voce.famiglia;
    // La famiglia pronta, o il suo errore: la finestra lo mostra con «Riprova».
    const aspetta = (stato: StatoFamiglia): void => {
      if (stato.kind === "errore") throw stato.perche;
    };
    void moduloDi(famiglia, voce.id).then(
      (modulo) => {
        apriFinestra(
          modulo ?? { campi: [] },
          modulo === null ? Promise.reject("chunk") : carica.famiglia(famiglia).then(aspetta),
          (valori, anteprima) => eseguiFinestra(voce.id, selezione, valori, anteprima, azioni),
          {
            id: voce.id,
            titolo: nomeVoce(voce),
            campi: Object.fromEntries((modulo?.campi ?? []).map((campo) => [campo.nome, campo.nome])),
            iniziali: {},
            vita: ctx.life,
            sulFoglio: azioni.sulFoglio,
            riprova: () => carica.riprova(famiglia).then(aspetta),
          },
        );
      },
      (errore: unknown) => console.error(errore),
    );
  };
  const eseguiFinestra = async (
    id: string,
    selezione: readonly string[],
    valori: Readonly<Record<string, string | number | boolean>>,
    anteprima: boolean,
    azioni: AzioniVoci,
  ): Promise<EsitoComando> => {
    const esito = await inviaComando(ctx.motore, { id, selection: [...selezione], value: valori, preview: anteprima });
    if (esito === null) return { anteprima: null, rifiuto: "closed" };
    // OK manda il comando una volta sola: il suo esito entra nel disegno.
    if (!anteprima && esito.refused === null) azioni.applica(esito);
    return { anteprima: esito.preview, rifiuto: esito.refused };
  };
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
    colonna: (offerti) => layoutCompleto(offerti, MOTORE_PRONTO),
    cassetto(anchor, opzioni, lifetime) {
      // Il cassetto è nel suo pezzo: si apre appena arriva, e non dopo la
      // chiusura del disegno. Se il pezzo non arriva, lo dice e «Riprova» lo
      // chiede di nuovo.
      const apri = (): void => {
        void import("../tools/editor/chrome/drawer").then(
          ({ apriCassetto }) => {
            if (chiuso) return;
            apriCassetto({ ...opzioni, anchor, lifetime });
          },
          () => {
            if (chiuso) return;
            apriErroreCassetto(anchor, lifetime, apri);
          },
        );
      };
      apri();
    },
    async menu(selezione, azioni) {
      const esegui = (voce: VoceIndice): void => avvia(voce, selezione(), azioni);
      let pronto: Indice;
      try {
        pronto = await indice();
      } catch {
        return menuNonCaricato(azioni.riprova);
      }
      return menuComando(pronto, await statoComandi(ctx.motore, selezione()), esegui);
    },
    async ricerca(selezione, azioni) {
      let pronto: Indice;
      try {
        pronto = await indice();
      } catch {
        return null;
      }
      return vociRicerca(pronto, await statoComandi(ctx.motore, selezione()), (voce) => avvia(voce, selezione(), azioni));
    },
  };
  ctx.life.add(() => completo.chiudi());
  void indice().catch(() => {});
  void carica.famiglia(NUCLEO);
  const tasti = opzioni.tasti;
  if (tasti !== undefined) {
    montaTasti({
      radice: tasti.radice,
      vita: ctx.life,
      indice: () => completo.indice(),
      modifiche: tasti.modifiche ?? (() => ({})),
      stato: tasti.stato,
      piattaforma: tasti.piattaforma ?? piattaformaDi(),
      esegui: (voce) => {
        if (chiuso) return;
        eseguiVoce(voce, {
          motore: ctx.motore,
          carica,
          vita: ctx.life,
          selezione: tasti.selezione,
          anteprima: tasti.anteprima,
          finestra: tasti.finestra ?? nessunaFinestra,
          leggi: tasti.leggi,
          commit: tasti.commit,
          seleziona: tasti.seleziona,
          annuncia: tasti.annuncia,
        });
      },
    });
  }
  return completo;
}
