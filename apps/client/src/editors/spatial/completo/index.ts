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
import { costruisciFila, type CostruisciFila, type FilaOpzioni } from "./opzioni";
import { creaSezioni, type Sezioni } from "./sezioni";
import type { Indice, VoceIndice } from "./indice";
// I comandi nel menu ≡ e nella ricerca Ctrl+/ (T9a): le voci, il perché e l'avvio.
import { menuComando, menuNonCaricato, statoComandi, vociRicerca, type StatoComandi, type VoceRicerca } from "./comandi";
import type { CampoFinestra, ModuloFinestra } from "../motore/finestre";
import type { DrawingPreview, DrawingToolState } from "../../../host/contract";
import type { MenuItem } from "../../../ui/menu";
// Blocco degli spazi del Completo (T7): i preset e la loro applicazione.
import { applicaSpazio, presetDi, type EffettiSpazio } from "./spazi";
export type { EffettiSpazio, SchedaSpazio, SpazioPreset } from "./spazi";
// La colonna (K6 T8): le caselle e il cassetto, con il suo pezzo col `import()`.
import { COMANDO_DEL_CLIC, iconaMotore, layoutCompleto, MOTORE_PRONTO, type GruppoLayout } from "./colonna";
import { registraAllinea } from "./allinea";
import { registraTrasforma } from "./trasforma-sezione";
import { registraColore } from "./colore-sezione";
import type { Teardown } from "../../../ui/lifetime";
import { languageCurrent } from "../../../i18n/strings";
import type { ToolSpec } from "../tools/registry";
import type { Lifetime } from "../../../ui/lifetime";
import type { CassettoOptions } from "../tools/editor/chrome/drawer";
import { openPopover } from "../../../kit/popover";
import { keyboardPlatform } from "../../../ui/commands";
import { t, type DrawKey } from "../strings";
import { COLONNA_IT } from "../strings/completo";
// I tasti del motore (K6 T9b): il montaggio sulla radice dell'editor, e il
// percorso di un comando che fanno partire.
import { applicaEsito, eseguiVoce, type AzioniEsito, type DipendenzeComando, type OpzioniFinestraComando } from "./esegui";
// Gli appunti del motore (K6 T11): copia, taglia e incolla passano dal motore.
import { creaAppuntiCompleto } from "./appunti";
import { registraAppuntiCompleto } from "../tools/clipboard";
import { montaTasti } from "./montaggio-tasti";
import { seguiTastiUtente } from "./segui-tasti";
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
  /// Lo strumento del motore `strumento` come lo mostra la colonna (T11): il
  /// nome nella lingua di adesso, l'icona e lo stato della sua famiglia.
  /// `null` finché l'indice non dice la sua famiglia, o se non ce l'ha: la
  /// casella non lo mostra (mai un id al posto del nome).
  strumentoMotore(strumento: string): StrumentoMotoreColonna | null;
  /// Avvisa quando ciò che `strumentoMotore` dice può essere cambiato: l'indice
  /// è arrivato, o una famiglia ha cambiato stato. Il ritorno smette.
  ascoltaColonna(ascolto: () => void): Teardown;
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
  /// La famiglia dello strumento del motore `strumento` (dall'indice) si prepara:
  /// risolve `true` se è pronta. Uno strumento senza famiglia nell'indice, o una
  /// famiglia che non arriva, risolve `false`: il gesto non parte (K6 T8).
  preparaStrumento(strumento: string): Promise<boolean>;
  /// Il clic senza trascinare di uno strumento del motore (T13, giro 2): se la forma
  /// ha una finestra delle misure, la apre col punto del clic; altrimenti non fa niente.
  clicStrumento(strumento: string, punto: { readonly x: number; readonly y: number }): void;
  /// La fila delle opzioni dello strumento `strumento` con le sue etichette, quando
  /// la sua famiglia è pronta (`carica.testi`); `null` prima, o se lo stato non ha
  /// controlli da mostrare. Le etichette non si inventano: senza famiglia pronta non
  /// c'è fila. Una famiglia pronta che ha registrato una fila propria per lo
  /// strumento (`registraFila`, T12: i punti della Selezione diretta) dà quella:
  /// legge lo stato intero di `ambiente`, e dopo un suo comando lo fa rileggere.
  fila(
    strumento: string,
    opzioni: unknown,
    cambia: (chiave: string, valore: boolean | number | string) => void,
    vita: Lifetime,
    ambiente?: AmbienteFila,
  ): FilaOpzioni | null;
}

/// Ciò che la testata dà a una fila propria: lo stato intero dello strumento, e
/// come farlo rileggere al motore dopo un comando che lo cambia.
export interface AmbienteFila {
  readonly stato: DrawingToolState | null;
  readonly rileggi: () => void;
}

/// Le famiglie che uno strumento porta con sé, oltre alla sua: la Selezione
/// diretta e il Punto di ancoraggio sceglie i punti, e i comandi sui punti
/// stanno nei tracciati (T12). Una famiglia in più che non arriva non ferma lo
/// strumento: la sua fila non c'è.
const FAMIGLIE_IN_PIU: Readonly<Record<string, readonly string[]>> = {
  directSelection: ["tracciati"],
};

/// Quanto un comando di una fila propria aspetta la sessione del motore, come
/// in `esegui.ts`.
const ATTESA_MOTORE_FILA_MS = 2_000;

/// Uno strumento del motore nella colonna (T11): il nome (dai testi della sua
/// famiglia, o dall'indice finché la famiglia non è pronta), l'icona del
/// prototipo, e la sua famiglia: pronta, in arrivo, in errore o non chiesta.
export interface StrumentoMotoreColonna {
  readonly nome: string;
  readonly icona: string;
  readonly famiglia: "pronta" | "in-arrivo" | "errore" | "assente";
}

/// Ciò che l'editor dà a una voce del menu o della ricerca: lo strumento del
/// motore, e «Riprova». Un comando del motore non passa di qui: parte da
/// `eseguiVoce`, con le dipendenze del Completo (`esegui.ts`).
export interface AzioniVoci {
  /// Lo strumento del motore: lo sceglie l'editor.
  readonly strumento: (id: string) => void;
  /// Una voce del client (K6 T11, la vista della banda): la fa l'editor, con il suo id.
  readonly client: (id: string) => void;
  /// Rifà l'indice, per chi lo mostra («Riprova»).
  readonly riprova: () => void;
}

export interface OpzioniCompleto {
  /// Chi porta l'indice; di serie `indice()` di `./indice`, nel suo chunk.
  readonly indice?: () => Promise<Indice>;
  readonly moduli?: OpzioniCaricatore["moduli"];
  readonly prepara?: OpzioniCaricatore["prepara"];
  /// Le voci del client che l'editor fa (`comandi.ts`, `statoVoce`): `null` se si
  /// fanno, il perché se sono spente, `undefined` se non le conosce.
  readonly clientVoce?: (id: string) => string | null | undefined;
  /// La spunta delle voci del client (K6 T11, giro E), `undefined` se una voce non ne ha.
  readonly clientStato?: (id: string) => boolean | undefined;
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
  /// Le modifiche dell'utente; senza, il Completo segue `draw.keys` da sé
  /// (`segui-tasti.ts`), e un cambio vale subito.
  readonly modifiche?: () => ModificheTasti;
  readonly piattaforma?: Piattaforma;
  /// I comandi del motore che l'editor fa con la regola di Fub
  /// (`DipendenzeComando.diFub`).
  readonly diFub?: (id: string) => boolean;
}

/// La piattaforma per i tasti: Cmd su macOS, altrove Ctrl (come la shell). Senza
/// `navigator` (i test del Completo) è `other`.
const piattaformaDi = (): Piattaforma =>
  typeof navigator !== "undefined" && keyboardPlatform(navigator.platform) === "mac" ? "mac" : "other";

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

// La sezione «Disegno completo» di Impostazioni › Scorciatoie (T9c,
// `panels/settings-disegno.ts`) porta questo modulo con un `import()` quando la
// si apre, e ne prende l'indice, la regola dei tasti e il valore di `draw.keys`:
// gli stessi pezzi dell'editor, non una copia.
/// L'indice dei comandi, per chi non apre un disegno (le Impostazioni).
export const indiceDeiComandi = (): Promise<Indice> => indiceVero();
export { risolviTasti, tastoFub, type ModificheTasti, type Piattaforma, type RegolaTasti } from "./tasti";
export { percorsoPosto } from "./comandi";
export * as tastiUtente from "./tasti-utente";

/// Un campo come lo scrive lo schema della famiglia (`schema.generated.json`).
interface CampoSchema {
  readonly nome: string;
  readonly tipo: string;
  readonly facoltativo?: boolean;
  readonly valori?: readonly string[];
  /// Il minimo di un numero (T13, giro 2): sotto, OK resta spento.
  readonly minimo?: number;
  /// Il massimo di un numero (T12 e T13, giro 3): sopra, OK resta spento.
  readonly massimo?: number;
  /// Il valore di partenza che il motore dà al campo (`sides=6`).
  readonly predefinito?: string | number | boolean;
}

/// Lo schema di una famiglia: le sue finestre, per id del comando.
interface SchemaFamiglia {
  readonly finestre: readonly { readonly id: string; readonly campi: readonly CampoSchema[] }[];
}

/// Un campo dello schema come lo legge la finestra di T6. I tipi che la
/// finestra non conosce (`cella`, `json`) si leggono come testo.
function campoDi(campo: CampoSchema): CampoFinestra {
  if (campo.tipo === "numero") {
    return {
      nome: campo.nome,
      tipo: "numero",
      ...(campo.minimo === undefined ? {} : { min: campo.minimo }),
      ...(campo.massimo === undefined ? {} : { max: campo.massimo }),
    };
  }
  if (campo.tipo === "scelta") return { nome: campo.nome, tipo: "scelta", valori: campo.valori ?? [] };
  if (campo.tipo === "sino") return { nome: campo.nome, tipo: "sino" };
  return { nome: campo.nome, tipo: "testo", facoltativo: campo.facoltativo === true };
}

/// Il modulo della finestra del comando `id`, dallo schema della sua famiglia
/// (il suo chunk). `null` se lo schema non arriva o non ha il comando.
async function moduloDi(
  famiglia: string,
  id: string,
): Promise<{ readonly modulo: ModuloFinestra; readonly predefiniti: Readonly<Record<string, string | number | boolean>> } | null> {
  try {
    const file = (await import(`./famiglie/${famiglia}/schema.generated.json`)) as { readonly default?: unknown };
    const schema = (file.default ?? file) as SchemaFamiglia;
    const finestra = schema.finestre.find((one) => one.id === id);
    if (finestra === undefined) return null;
    // Il valore di partenza che lo schema dà a un campo (`sides=6`), per nome.
    const predefiniti: Record<string, string | number | boolean> = {};
    for (const campo of finestra.campi) if (campo.predefinito !== undefined) predefiniti[campo.nome] = campo.predefinito;
    return { modulo: { campi: finestra.campi.map(campoDi) }, predefiniti };
  } catch {
    return null;
  }
}

/// Il nome corto dello strumento del motore `strumento` dalle parole della
/// colonna (`draw.engine.name.<id>`, K6 T12): c'è per gli strumenti che la
/// colonna mostra prima che la loro famiglia arrivi. `null` per gli altri, che
/// lo prendono dai testi della famiglia pronta o dall'indice.
export function nomeCortoColonna(strumento: string): string | null {
  const chiave = `draw.engine.name.${strumento}`;
  return Object.prototype.hasOwnProperty.call(COLONNA_IT, chiave) ? t(chiave as DrawKey) : null;
}

/// Apre il Completo di un disegno: chiede l'indice e prepara il nucleo. Un
/// indice che non arriva non ferma niente: chi lo mostra (≡, Ctrl+/) lo
/// richiede e dice che non si è caricato, con «Riprova».
export function apri(ctx: Omit<ContestoCompleto, "sezioni" | "registraFila" | "esegui">, opzioni: OpzioniCompleto = {}): Completo {
  const indice = opzioni.indice ?? indiceVero;
  const sezioni = creaSezioni();
  // Le file proprie che le famiglie registrano, per strumento (T12).
  const fileProprie = new Map<string, CostruisciFila>();
  const registraFila = (strumento: string, costruisci: CostruisciFila): void => {
    fileProprie.set(strumento, costruisci);
  };
  // Un comando dell'indice con altri valori fissi, dal percorso unico (`eseguiVoce`): la
  // sezione «Allinea» lo usa per i suoi pulsanti. Il primo clic porta la famiglia della voce
  // (chunk e preparazione), come la finestra di un comando; dopo un errore il clic la riprova.
  // Il comando parte solo da una famiglia pronta. Chiuso il Completo, non parte.
  const eseguiPerId = (id: string, valori: Readonly<Record<string, unknown>> = {}, opzioni: { readonly senzaFinestra?: boolean } = {}): Promise<void> => {
    if (chiuso) return Promise.resolve();
    return indice().then(async (pronto) => {
      if (chiuso) return;
      const voce = pronto.voci.find((one) => one.id === id);
      if (voce === undefined || !("comando" in voce.chiamata)) return;
      const stato =
        carica.stato(voce.famiglia).kind === "errore" ? await carica.riprova(voce.famiglia) : await carica.famiglia(voce.famiglia);
      if (chiuso) return;
      if (stato.kind !== "pronta") {
        dipendenze.annuncia(t("draw.allinea.nonPronto"));
        return;
      }
      const fisso = (voce.chiamata as { readonly valore?: unknown }).valore;
      const base = typeof fisso === "object" && fisso !== null ? fisso : {};
      // Una sezione che manda il comando lo manda senza la finestra della voce (la rotazione, K6 T13 giro 3).
      const senza = opzioni.senzaFinestra === true ? { ...voce, finestra: false } : voce;
      await eseguiVoce({ ...senza, chiamata: { comando: voce.chiamata.comando, valore: { ...base, ...valori } } }, dipendenze);
    });
  };
  // La sezione «Allinea» (T13, giro 2): dall'indice, senza caricare la famiglia `trasforma`,
  // che parte solo al clic di un suo comando.
  registraAllinea(sezioni, eseguiPerId);
  // La sezione «Trasforma» (K6 T13, giro 3): posizione, misura, rotazione e inclinazione.
  registraTrasforma(sezioni, eseguiPerId);
  // La sezione «Colore» (K6 T14, giro 1): riempimento e contorno, scambia, nessuno e di serie.
  registraColore(sezioni, (id, valori) => void eseguiPerId(id, valori, { senzaFinestra: true }), ctx.life);
  const carica = caricatore({ ctx: { ...ctx, sezioni, registraFila, esegui: eseguiPerId }, moduli: opzioni.moduli, prepara: opzioni.prepara });
  // La finestra di un comando con parametri (T6): il modulo dello schema della sua
  // famiglia. `null` se la famiglia non ha la finestra di quel comando.
  const finestraDi = async (voce: VoceIndice): Promise<OpzioniFinestraComando | null> => {
    const schema = await moduloDi(voce.famiglia, voce.id);
    if (schema === null) return null;
    // Ciò che il comando ha già (il punto del clic) non si chiede: la finestra non lo
    // manda, e il comando lo prende dalla voce.
    const valore = (voce.chiamata as { readonly valore?: unknown }).valore;
    const dati = typeof valore === "object" && valore !== null ? Object.keys(valore) : [];
    const campi = schema.modulo.campi.filter((campo) => !dati.includes(campo.nome));
    // Le parole della finestra sono della famiglia: ci sono quando è pronta; prima il
    // nome del campo, e niente frase, verbo, parole delle scelte né unità.
    const stato = await carica.famiglia(voce.famiglia);
    const testi = stato.kind === "pronta" ? carica.testi(voce.famiglia) : null;
    const inglese = languageCurrent().startsWith("en");
    const parola = (chiave: string): string | undefined => {
      const una = testi?.[chiave];
      return una === undefined ? undefined : inglese ? una.en : una.it;
    };
    // Il nome di un campo: quello del comando (`campo:<id>:<nome>`) se c'è, poi quello
    // della famiglia (`campo:<nome>`): lo stesso `level` è la semplificazione o la smussatura.
    const etichette = Object.fromEntries(
      campi.map((campo): [string, string] => [campo.nome, parola(`campo:${voce.id}:${campo.nome}`) ?? parola(`campo:${campo.nome}`) ?? campo.nome]),
    );
    const scelte: Record<string, Readonly<Record<string, string>>> = {};
    const unita: Record<string, string> = {};
    for (const campo of campi) {
      if (campo.tipo === "scelta") {
        const parole = campo.valori.flatMap((valore): [string, string][] => {
          const una = parola(`scelta:${campo.nome}:${valore}`);
          return una === undefined ? [] : [[valore, una]];
        });
        if (parole.length > 0) scelte[campo.nome] = Object.fromEntries(parole);
      }
      const sigla = campo.tipo === "numero" ? parola(`unita:${campo.nome}`) : undefined;
      if (sigla !== undefined) unita[campo.nome] = sigla;
    }
    const descrizione = parola(`descrizione:${voce.id}`);
    const azione = parola(`azione:${voce.id}`);
    const iniziali = Object.fromEntries(Object.entries(schema.predefiniti).filter(([nome]) => campi.some((campo) => campo.nome === nome)));
    return {
      modulo: { campi },
      campi: etichette,
      iniziali,
      ...(descrizione === undefined ? {} : { descrizione }),
      ...(azione === undefined ? {} : { azione }),
      ...(Object.keys(scelte).length === 0 ? {} : { scelte }),
      ...(Object.keys(unita).length === 0 ? {} : { unita }),
    };
  };
  // Il percorso unico di un comando del motore (`esegui.ts`): il menu ≡, Ctrl+/ e
  // i tasti lo usano con queste stesse dipendenze, costruite qui una volta sola.
  const dipendenze: DipendenzeComando = {
    motore: ctx.motore,
    carica,
    vita: ctx.life,
    selezione: opzioni.tasti?.selezione ?? (() => []),
    anteprima: opzioni.tasti?.anteprima ?? (() => undefined),
    finestra: finestraDi,
    leggi: opzioni.tasti?.leggi ?? (() => null),
    commit: opzioni.tasti?.commit ?? (() => false),
    seleziona: opzioni.tasti?.seleziona ?? (() => undefined),
    annuncia: opzioni.tasti?.annuncia ?? (() => undefined),
    ...(opzioni.tasti?.diFub === undefined ? {} : { diFub: opzioni.tasti.diFub }),
  };
  // Gli appunti del motore (K6 T11): mentre il Completo è aperto, copiare e incollare
  // passano dal motore, e il Semplice li cede qui (`tools/clipboard.ts`). Senza
  // motore o senza tasti non ci sono.
  if (ctx.motore !== null && opzioni.tasti !== undefined) {
    const appunti = creaAppuntiCompleto({
      motore: ctx.motore,
      vita: ctx.life,
      selezione: dipendenze.selezione,
      applica: (esito, etichetta) => applicaEsito(esito, etichetta, dipendenze),
      annuncia: dipendenze.annuncia,
    });
    dipendenze.appunti = appunti;
    ctx.life.add(registraAppuntiCompleto(ctx.motore, appunti));
  }
  /// Un comando di una fila propria (T12: i comandi sui punti), col suo valore:
  /// l'esito passa da `applicaEsito` come i comandi del menu, in un passo, e
  /// lo stato dello strumento si rilegge, perché i punti scelti cambiano.
  const comandoDellaFila = async (id: string, valore: unknown, etichetta: string, rileggi: (() => void) | undefined): Promise<void> => {
    const sessione = ctx.motore === null ? null : await ctx.motore.pronta(ATTESA_MOTORE_FILA_MS);
    if (ctx.life.closed) return;
    if (sessione === null) {
      dipendenze.annuncia(t("draw.window.unanswered"));
      return;
    }
    const esito = await sessione.comando({ id, selection: [...dipendenze.selezione()], value: valore });
    if (ctx.life.closed) return;
    if (esito === null || "kind" in esito) {
      dipendenze.annuncia(t("draw.window.unanswered"));
      return;
    }
    applicaEsito(esito, etichetta, dipendenze);
    rileggi?.();
  };
  // Una voce del menu o della ricerca: uno strumento lo sceglie l'editor; un
  // comando del motore parte dal percorso unico.
  const avvia = (voce: VoceIndice, azioni: AzioniVoci): void => {
    const chiamata = voce.chiamata;
    if ("strumento" in chiamata) {
      azioni.strumento(chiamata.strumento);
      return;
    }
    if ("client" in chiamata) {
      azioni.client(chiamata.client);
      return;
    }
    eseguiVoce(voce, dipendenze);
  };
  /// Lo stato dei comandi con le voci del client dell'editor: la regola di
  /// `statoVoce` le legge da qui.
  const conVociClient = (stato: StatoComandi): StatoComandi => ({ ...stato, clientVoce: opzioni.clientVoce, clientStato: opzioni.clientStato });
  let chiuso = false;
  // I tasti dell'utente (`draw.keys`, T9c): con un editor e senza modifiche
  // date da chi apre, il Completo li segue, e rifà la regola a ogni cambio.
  // La lettura arriva sempre dopo il montaggio (è una promessa).
  const modificheUtente: () => ModificheTasti =
    opzioni.tasti === undefined
      ? () => ({})
      : (opzioni.tasti.modifiche ?? seguiTastiUtente(ctx.life, () => montaggio.aggiorna()));
  // La regola dei tasti (T9b, `montaggio-tasti.ts`): il menu e la tavolozza la
  // leggono da qui, senza un secondo calcolo. Ascolta i tasti solo con un editor
  // (la radice); senza, la regola c'è lo stesso.
  const montaggio = montaTasti({
    radice: opzioni.tasti?.radice ?? null,
    vita: ctx.life,
    indice,
    modifiche: modificheUtente,
    stato: opzioni.tasti?.stato ?? (() => ({ vuoleTesto: false, componendo: false })),
    piattaforma: opzioni.tasti?.piattaforma ?? piattaformaDi(),
    esegui: (voce) => {
      if (chiuso) return;
      eseguiVoce(voce, dipendenze);
    },
  });
  // La famiglia di uno strumento del motore, dall'indice: si chiede una volta
  // sola per strumento (la voce dell'indice non cambia). Uno strumento senza
  // voce, o un indice che non arriva, non ha famiglia.
  const famiglie = new Map<string, string>();
  /// L'indice, quando è arrivato: la colonna ne legge i nomi senza aspettare.
  let indiceArrivato: Indice | null = null;
  const voceStrumento = (pronto: Indice, strumento: string): VoceIndice | undefined =>
    pronto.voci.find((one) => "strumento" in one.chiamata && one.chiamata.strumento === strumento);
  const famigliaDi = async (strumento: string): Promise<string | null> => {
    const nota = famiglie.get(strumento);
    if (nota !== undefined) return nota;
    let pronto: Indice;
    try {
      pronto = await indice();
    } catch {
      return null;
    }
    const voce = voceStrumento(pronto, strumento);
    if (voce === undefined) return null;
    famiglie.set(strumento, voce.famiglia);
    return voce.famiglia;
  };
  /// Chi ascolta i cambi della colonna (`ascoltaColonna`).
  const ascoltiColonna = new Set<() => void>();
  const avvisaColonna = (): void => {
    if (chiuso) return;
    for (const ascolto of [...ascoltiColonna]) if (ascoltiColonna.has(ascolto)) ascolto();
  };
  ctx.life.add(carica.quandoCambia(() => avvisaColonna()));
  const completo: Completo = {
    indice,
    carica,
    sezioni,
    clicStrumento(strumento, punto) {
      if (chiuso) return;
      const comando = COMANDO_DEL_CLIC[strumento];
      if (comando === undefined || indiceArrivato === null) return;
      const voce = indiceArrivato.voci.find((one) => one.id === comando.forma);
      if (voce === undefined || !("comando" in voce.chiamata)) return;
      // La finestra parte dal punto del clic e senza selezione: una forma nuova non la
      // usa, e la selezione di prima non entra nel comando.
      const derivata: VoceIndice = {
        ...voce,
        chiamata: { comando: voce.chiamata.comando, valore: { [comando.x]: punto.x, [comando.y]: punto.y } },
      };
      eseguiVoce(derivata, { ...dipendenze, selezione: () => [] });
    },
    async preparaStrumento(strumento) {
      const famiglia = await famigliaDi(strumento);
      if (famiglia === null) return false;
      // Le famiglie in più arrivano insieme; il loro esito non conta qui.
      const inPiu = (FAMIGLIE_IN_PIU[strumento] ?? []).map((altra) => (carica.stato(altra).kind === "errore" ? carica.riprova(altra) : carica.famiglia(altra)));
      // Una famiglia in errore si riprova: chi sceglie lo strumento di nuovo
      // chiede di nuovo la famiglia.
      const stato = carica.stato(famiglia).kind === "errore" ? await carica.riprova(famiglia) : await carica.famiglia(famiglia);
      await Promise.all(inPiu);
      return stato.kind === "pronta";
    },
    fila(strumento, opzioni, cambia, vita, ambiente) {
      const propria = fileProprie.get(strumento);
      if (propria !== undefined && ctx.motore !== null) {
        const azioni = {
          esegui: (id: string, valore: unknown, etichetta: string) => void comandoDellaFila(id, valore, etichetta, ambiente?.rileggi),
          annuncia: dipendenze.annuncia,
        };
        return propria(ambiente?.stato ?? null, azioni, vita);
      }
      const famiglia = famiglie.get(strumento);
      if (famiglia === undefined) return null;
      // Le etichette ci sono solo con la famiglia pronta (`carica.testi`).
      const testi = carica.testi(famiglia);
      if (testi === null) return null;
      return costruisciFila(testi, opzioni, cambia, vita);
    },
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
    strumentoMotore(strumento) {
      // Senza motore uno strumento del motore non fa niente: non si mostra.
      if (ctx.motore === null || indiceArrivato === null) return null;
      const voce = voceStrumento(indiceArrivato, strumento);
      if (voce === undefined) return null;
      const inglese = languageCurrent().startsWith("en");
      const corto = carica.testi(voce.famiglia)?.[`strumento:${strumento}`];
      const nome = corto !== undefined ? (inglese ? corto.en : corto.it) : (nomeCortoColonna(strumento) ?? (inglese ? voce.etichetta.en : voce.etichetta.it));
      const stato = carica.stato(voce.famiglia).kind;
      return { nome, icona: iconaMotore(strumento), famiglia: stato };
    },
    ascoltaColonna(ascolto) {
      ascoltiColonna.add(ascolto);
      return () => {
        ascoltiColonna.delete(ascolto);
      };
    },
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
      const esegui = (voce: VoceIndice): void => avvia(voce, azioni);
      let pronto: Indice;
      try {
        pronto = await indice();
      } catch {
        return menuNonCaricato(azioni.riprova);
      }
      return menuComando(pronto, conVociClient(await statoComandi(ctx.motore, selezione())), esegui, montaggio.regola());
    },
    async ricerca(selezione, azioni) {
      let pronto: Indice;
      try {
        pronto = await indice();
      } catch {
        return null;
      }
      return vociRicerca(pronto, conVociClient(await statoComandi(ctx.motore, selezione())), (voce) => avvia(voce, azioni), montaggio.regola());
    },
  };
  ctx.life.add(() => completo.chiudi());
  ctx.life.add(() => ascoltiColonna.clear());
  void indice().then(
    (pronto) => {
      indiceArrivato = pronto;
      avvisaColonna();
    },
    () => {},
  );
  void carica.famiglia(NUCLEO);
  return completo;
}
