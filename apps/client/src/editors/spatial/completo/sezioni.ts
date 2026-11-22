// Le sezioni dell'ispettore che le famiglie del Disegno completo registrano
// quando arrivano (piano K6, T10; `docs/product/drawing-properties.md` e
// `drawing-resources.md`). Una sezione sta in una scheda dell'ispettore
// (`design`, `livelli`, `risorse`, `cronologia`, il posto `ispettore/<scheda>`
// della mappa) e si disegna da sé: il registro qui non sa niente del DOM. Il
// pannello che la mostra (`tools/resources-panel.ts`) la legge, e la
// rifà quando la selezione cambia.
//
// - **Una sola per id.** Due sezioni con lo stesso id nella stessa scheda: la
//   seconda si rifiuta (`registra` dà `false`), e la prima resta.
// - **Nell'ordine della mappa.** Le sezioni con `ordine` vengono prima, per
//   `ordine` crescente; le altre seguono nell'ordine in cui sono arrivate.
// - **Chi disegna la sezione possiede la sua vita.** `disegna` torna un
//   disposer, che il pannello chiama quando la sezione si rifà o si smonta: un
//   ascoltatore lasciato vivo è un bug.
// - **Il Completo si chiude e il registro si svuota.** Dopo `chiudi` nessuna
//   sezione si registra più, e nessuna resta da disegnare.

import type { DrawingAnchor } from "../../../host/contract";
import type { Lifetime, Teardown } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { PaintSample } from "../tools/resources";

/// Le schede dell'ispettore che una sezione può prendere: le stesse del posto
/// `ispettore/<scheda>` della mappa (`scripts/check-disegno-mappa.mjs`).
export type Scheda = "design" | "livelli" | "risorse" | "cronologia";

/// Ciò che una sezione sa della selezione di adesso: quanti oggetti ci sono, e
/// i punti di ancoraggio scelti dentro (T12, giro 4).
export interface Selezione {
  readonly numero: number;
  /// I punti scelti con lo strumento del motore di adesso (la Selezione diretta,
  /// il Punto di ancoraggio), dal suo stato (`DrawingToolState.anchors`, la porta
  /// dello stato dello strumento che c'è già). Vuoto senza uno strumento del
  /// motore, o se il suo stato non ne porta.
  readonly punti: readonly DrawingAnchor[];
  /// Il carattere e il paragrafo dei testi scelti, dalla vista del pannello (K6 T16); manca se la
  /// selezione non ha testi. Carattere e Paragrafo ci sono solo con lui.
  readonly testo?: TestoSelezione;
}

/// Una famiglia che il menu del carattere offre: il valore com'è nel disegno (`Inter, sans-serif`,
/// vuoto per quella di serie) e il nome da mostrare.
export interface FamigliaSelezione {
  readonly valore: string;
  readonly nome: string;
}

/// Il carattere e il paragrafo dei testi scelti come li mostra il pannello (K6 T16): ogni valore è
/// `null` se i testi ne hanno più d'uno.
export interface TestoSelezione {
  /// La famiglia com'è nel disegno; vuota per quella di serie.
  readonly famiglia: string | null;
  /// Le famiglie del menu: quelle di Fub e quelle che il disegno usa.
  readonly famiglie: readonly FamigliaSelezione[];
  /// Il corpo, nell'unità del pannello.
  readonly corpo?: MisuraSelezione;
  /// Il peso, da 100 a 900.
  readonly peso: number | null;
  readonly corsivo: boolean | null;
  /// La spaziatura fra le lettere in percento del corpo, come la mostra il pannello; manca se il
  /// pannello non la mostra.
  readonly spaziatura?: number | null;
  /// L'allineamento del testo all'àncora: `start`, `middle`, `end`.
  readonly allineamento: string | null;
}

/// Una misura di «Posizione e misure» come la mostra il pannello (K6 T13, giro 4): il valore nell'unità
/// del campo (`null` se la selezione non ne ha uno solo), la sua unità, i decimali, e il passaggio
/// all'unità della scena, dove lavora il motore.
export interface MisuraSelezione {
  readonly valore: number | null;
  readonly unita: string;
  readonly decimali: number;
  readonly allaScena: (valore: number) => number;
}

/// Le misure della selezione che le sezioni del Completo vedono; una misura che manca non c'è.
export interface MisureSelezione {
  readonly x?: MisuraSelezione;
  readonly y?: MisuraSelezione;
  readonly larghezza?: MisuraSelezione;
  readonly altezza?: MisuraSelezione;
  readonly rotazione?: MisuraSelezione;
  /// L'opacità in percento, come la vista del pannello la mostra (K6 T15, giro 2).
  readonly opacita?: MisuraSelezione;
  /// Il metodo di fusione della selezione: `valore` è `null` e `mista` vero se ne ha più d'uno.
  readonly fusione?: { readonly valore: string | null; readonly mista: boolean };
  /// Il contorno della selezione (K6 T15, giro 5); manca se non ne ha uno da cambiare.
  readonly contorno?: ContornoSelezione;
}

/// Il contorno della selezione come lo mostra la vista del pannello (K6 T15, giro 5): `null` dove gli
/// oggetti scelti non sono d'accordo, che la sezione mostra «Misto».
export interface ContornoSelezione {
  /// Lo spessore, nella sua unità (pt o px); manca se la vista non lo ha.
  readonly spessore?: MisuraSelezione;
  readonly estremi: "butt" | "round" | "square" | null;
  readonly angoli: "miter" | "round" | "bevel" | null;
  /// Trattini e spazi alternati, nell'unità dello spessore; vuoti per un contorno pieno.
  readonly trattini: readonly number[] | null;
  /// Un oggetto scelto è bloccato: il contorno non si cambia.
  readonly bloccato: boolean;
}

/// Un colore della selezione come lo mostra il pannello (K6 T14, giro 1): `#rrggbb`, `none`, `url(#id)`
/// per una sfumatura, un motivo o un campione del disegno, `null` se gli oggetti ne hanno più d'uno; il
/// campione dice come si chiama ciò che non è un colore semplice.
export interface ColoreSelezione {
  readonly valore: string | null;
  readonly campione?: PaintSample;
}

/// Il riempimento e il contorno della selezione che le sezioni del Completo vedono, dalla vista del
/// pannello; uno che la selezione non ha (un'immagine non ha contorno) manca.
export interface ColoriSelezione {
  readonly riempimento?: ColoreSelezione;
  readonly contorno?: ColoreSelezione;
}

/// Un campione del documento come lo legge il modello (K6 T14, giro 2): l'id della risorsa, il nome e
/// il colore `#rrggbb`.
export interface CampioneDocumento {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/// I campioni del documento per la sezione Risorse › Campioni, dal modello del disegno: nessuna
/// richiesta al motore per mostrarli.
export interface CampioniDocumento {
  /// Nell'ordine in cui stanno nel disegno.
  readonly elenco: readonly CampioneDocumento[];
  /// Gli id dei campioni che nessun oggetto usa; si contano solo quando servono.
  readonly nonUsati: () => readonly string[];
}

/// Una voce del client (`chiamata.client` dell'indice) che il Completo fa da sé, con una sezione
/// (K6 T14, giro 2: «Nuovo campione…» e «Opzioni campione…» del menu). `stato` è `null` se la voce
/// si fa adesso, o il perché se è spenta; `esegui` la fa.
export interface VoceDelCompleto {
  readonly stato: () => string | null;
  readonly esegui: () => void;
}

/// Ciò che una sezione riceve per disegnarsi.
export interface ContestoSezione {
  /// Il corpo della sezione. Lo riempie `disegna`; lo svuota il pannello a
  /// ogni giro, prima di chiamarla di nuovo.
  readonly corpo: HTMLElement;
  /// La selezione di adesso.
  readonly sel: Selezione;
  /// Il motore del disegno, se il Completo ne ha uno; i comandi della
  /// famiglia passano da lui.
  readonly motore: MotoreDelDisegno | null;
  /// Le misure della selezione come le mostra «Posizione e misure»: il pannello le prende dalla sua vista,
  /// senza chiedere il motore. Una misura che non si sa è `null`.
  readonly misure: MisureSelezione;
  /// Il riempimento e il contorno della selezione come li mostra il pannello (K6 T14): dalla sua vista,
  /// senza chiedere il motore.
  readonly colori: ColoriSelezione;
  /// I campioni del documento (K6 T14, giro 2): li dà la scheda Risorse, che ha il modello; altrove
  /// mancano.
  readonly campioni?: CampioniDocumento;
  /// Il disegno che la sezione mostra cambia: `aggiorna` la chiede di nuovo,
  /// al più una volta per fotogramma.
  readonly aggiorna: () => void;
  /// Rilegge dal motore lo stato dello strumento di adesso, dopo un comando che
  /// lo cambia (i punti scelti): la sezione si rifà quando arriva. Senza uno
  /// strumento del motore non fa niente.
  readonly rileggi: () => void;
  /// La vita di questo disegno: si chiude quando la sezione si rifà o si
  /// smonta. Una risposta che arriva dopo (un comando del motore) si scarta
  /// se la vita è chiusa.
  readonly vita: Lifetime;
}

/// Una sezione dell'ispettore, come la registra una famiglia.
export interface Sezione {
  /// L'id nella scheda: l'ultimo pezzo del posto della mappa
  /// (`ispettore/risorse/campioni` → `campioni`), in lettere minuscole e
  /// trattini.
  readonly id: string;
  readonly scheda: Scheda;
  /// Il titolo che la sezione mostra nella sua intestazione.
  readonly titolo: string;
  /// La posizione nella scheda: prima le sezioni con `ordine`, per numero
  /// crescente, poi le altre nell'ordine di arrivo.
  readonly ordine?: number;
  /// Se la sezione vale per la selezione di adesso; di serie sempre.
  readonly quando?: (sel: Selezione) => boolean;
  /// Disegna il corpo; torna il disposer che lo smonta.
  readonly disegna: (ctx: ContestoSezione) => Teardown | void;
}

/// Il registro delle sezioni di un Completo aperto.
export interface Sezioni {
  /// Registra una sezione. `false` se la scheda ha già una sezione con lo
  /// stesso id, o se il Completo si è chiuso: la sezione non entra.
  registra(sezione: Sezione): boolean;
  /// Le sezioni di una scheda, nell'ordine della mappa.
  di(scheda: Scheda): readonly Sezione[];
  /// Chiama `listener` quando l'elenco cambia (una sezione nuova, il
  /// Completo chiuso). Il disposer lo toglie.
  ascolta(listener: () => void): Teardown;
  /// Il Completo si chiude: il registro si svuota e non accetta più niente.
  chiudi(): void;
}

interface Voce {
  readonly sezione: Sezione;
  /// L'ordine di arrivo: spezza la parità fra due sezioni senza `ordine`.
  readonly arrivo: number;
}

/// Il registro vuoto di un Completo aperto.
export function creaSezioni(): Sezioni {
  const voci: Voce[] = [];
  const ascolti = new Set<() => void>();
  let arrivi = 0;
  let chiuso = false;

  const avvisa = (): void => {
    for (const listener of [...ascolti]) listener();
  };

  /// Prima le sezioni con `ordine`, per numero; poi le altre, per arrivo.
  const ordinate = (a: Voce, b: Voce): number => {
    const x = a.sezione.ordine;
    const y = b.sezione.ordine;
    if (x !== undefined && y !== undefined && x !== y) return x - y;
    if (x !== undefined && y === undefined) return -1;
    if (x === undefined && y !== undefined) return 1;
    return a.arrivo - b.arrivo;
  };

  return {
    registra(sezione) {
      if (chiuso) return false;
      if (voci.some((voce) => voce.sezione.scheda === sezione.scheda && voce.sezione.id === sezione.id)) return false;
      voci.push({ sezione, arrivo: arrivi++ });
      avvisa();
      return true;
    },
    di(scheda) {
      return voci
        .filter((voce) => voce.sezione.scheda === scheda)
        .sort(ordinate)
        .map((voce) => voce.sezione);
    },
    ascolta(listener) {
      ascolti.add(listener);
      return () => {
        ascolti.delete(listener);
      };
    },
    chiudi() {
      if (chiuso) return;
      chiuso = true;
      voci.length = 0;
      avvisa();
      ascolti.clear();
    },
  };
}

/// Registra una sezione per conto di una famiglia: `registra(ctx)` la riceve
/// col registro del Completo (`ContestoCompleto.sezioni`).
export function registraSezione(ctx: { readonly sezioni: Sezioni }, sezione: Sezione): boolean {
  return ctx.sezioni.registra(sezione);
}
