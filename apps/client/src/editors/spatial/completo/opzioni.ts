// La fila delle opzioni dello strumento del motore nel Disegno completo (piano K6,
// T8 e T11; `docs/product/drawing.md`, «La colonna»). Le opzioni arrivano dal
// motore in `DrawingToolState.options` (`host/contract.ts`), come un valore
// JSON: questa regola dice che controllo fa ogni chiave, e quali non si
// disegnano.
//
// - un sì o no è una casella;
// - un numero è un campo;
// - un colore `#rrggbb` è un campione;
// - `{ scelta, scelte }` con una scelta fra le sue è una scelta;
// - ogni altra chiave NON si mostra, e la regola dice il perché
//   (`fuori`): una forma che il disegno generico non sa fare, o una chiave
//   senza etichetta (un id grezzo non si legge mai).
//
// Le etichette vengono dai `testi.ts` della famiglia dello strumento, letti
// quando la famiglia è pronta (`carica.ts`): la fila non le inventa, e senza
// non si monta. I controlli sono quelli del kit (`kit/form.ts`, `kit/color/well.ts`),
// con le frasi di `draw.properties.problem.*`. Un cambio passa da
// `disegno.strumento.opzione`: chi monta la fila lo manda (`cambia`).
//
// La regola (`descrivi`) è pura. La fila è DOM, e sta nel chunk del Completo:
// la testata (`tools/editor/chrome/fila-motore.ts`) la monta solo quando
// `completo/index.ts` la dà. Un nuovo stato dello strumento la aggiorna in
// place: un valore cambiato rifà solo il suo controllo, e il fuoco resta dove
// stava; una chiave in più o in meno rifà la fila.

import type { DrawingToolState } from "../../../host/contract";
import { formCheck, formChoice, formNumber } from "../../../kit/form";
import { colorWell } from "../../../kit/color/well";
import type { QuantityProblem } from "../../../kit/quantity";
import { languageCurrent, onLanguage } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { drawPickerText } from "../tools/color-text";
import { t, type DrawKey } from "../strings";

/// Un controllo della fila: la chiave del motore e il suo valore.
export type Controllo =
  | { readonly tipo: "casella"; readonly chiave: string; readonly valore: boolean }
  | { readonly tipo: "numero"; readonly chiave: string; readonly valore: number }
  | { readonly tipo: "scelta"; readonly chiave: string; readonly valore: string; readonly scelte: readonly string[] }
  | { readonly tipo: "colore"; readonly chiave: string; readonly valore: string };

/// Una chiave che non si mostra, e perché.
export interface Fuori {
  readonly chiave: string;
  readonly perche: "forma" | "etichetta";
}

/// Un'etichetta nelle due lingue, come nei `testi.ts` delle famiglie.
export type Etichette = Readonly<Record<string, { readonly it: string; readonly en: string }>>;

export interface Descrizione {
  readonly controlli: readonly Controllo[];
  readonly fuori: readonly Fuori[];
}

const COLORE = /^#[0-9a-f]{6}$/i;

/// Le opzioni di uno strumento come controlli, e le chiavi che restano fuori.
/// `options` vuoto o non un oggetto non dà niente.
export function descrivi(options: unknown, etichette: Etichette): Descrizione {
  const controlli: Controllo[] = [];
  const fuori: Fuori[] = [];
  if (options === null || typeof options !== "object" || Array.isArray(options)) return { controlli, fuori };
  for (const [chiave, valore] of Object.entries(options as Record<string, unknown>)) {
    if (etichette[chiave] === undefined) {
      fuori.push({ chiave, perche: "etichetta" });
      continue;
    }
    if (typeof valore === "boolean") controlli.push({ tipo: "casella", chiave, valore });
    else if (typeof valore === "number" && Number.isFinite(valore)) controlli.push({ tipo: "numero", chiave, valore });
    else if (typeof valore === "string" && COLORE.test(valore)) controlli.push({ tipo: "colore", chiave, valore });
    else if (sceltaValida(valore)) controlli.push({ tipo: "scelta", chiave, valore: valore.scelta, scelte: valore.scelte });
    else fuori.push({ chiave, perche: "forma" });
  }
  return { controlli, fuori };
}

interface SceltaGrezza {
  readonly scelta: string;
  readonly scelte: readonly string[];
}

/// Una scelta è `{ scelta, scelte }` con `scelta` fra le `scelte` (testi).
function sceltaValida(valore: unknown): valore is SceltaGrezza {
  if (valore === null || typeof valore !== "object") return false;
  const { scelta, scelte } = valore as { scelta?: unknown; scelte?: unknown };
  return typeof scelta === "string" && Array.isArray(scelte) && scelte.every((s) => typeof s === "string") && scelte.includes(scelta);
}

/// La fila montata: il suo elemento, e `aggiorna` con lo stato nuovo dello
/// strumento (le sue opzioni, e lo stato intero per chi legge altro, come i
/// punti scelti). `aggiorna` dice se la fila ha ancora controlli: se non ne
/// ha, chi la monta la toglie.
export interface FilaOpzioni {
  readonly element: HTMLElement;
  /// Le voci della fila nella riga delle opzioni, ognuna con la sua priorità
  /// (la più bassa va prima in «…»), come i pezzi del prototipo. Senza, la
  /// fila è una voce sola, `element`.
  readonly voci?: readonly { readonly element: HTMLElement; readonly priorita: number }[];
  aggiorna(opzioni: unknown, stato?: DrawingToolState | null): boolean;
}

/// Ciò che una fila propria di una famiglia sa fare: un comando del motore
/// col suo valore, in un passo della cronologia col nome `etichetta`, e una
/// frase per chi ascolta.
export interface AzioniFila {
  esegui(id: string, valore: unknown, etichetta: string): void;
  /// Un comando che legge e non cambia niente (K6 T14, giro 7: le preferenze del Contagocce):
  /// la sua lettura, o `null` se il motore non risponde.
  leggi(id: string, valore: unknown): Promise<unknown>;
  annuncia(testo: string): void;
}

/// Una fila che una famiglia monta da sé per uno strumento (anche di un'altra
/// famiglia, come la Selezione diretta per i punti dei tracciati), al posto di
/// quella generica delle opzioni (`ContestoCompleto.registraFila`). `null` se
/// non c'è niente da mostrare.
export type CostruisciFila = (stato: DrawingToolState | null, azioni: AzioniFila, vita: Lifetime) => FilaOpzioni | null;

/// Le frasi di un numero che non si prende, come le vuole il campo del kit.
const PROBLEMI: Record<QuantityProblem, DrawKey> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// L'etichetta di una chiave nella lingua di adesso.
function etichettaDi(etichette: Etichette, chiave: string): string {
  const e = etichette[chiave]!;
  return languageCurrent().startsWith("en") ? e.en : e.it;
}

/// Il controllo del kit per `controllo`, col suo nome. `cambiato` riceve il
/// valore preso; `vita` lo tiene finché la fila non lo rifà.
function creaControllo(controllo: Controllo, nome: string, cambiato: (valore: boolean | number | string) => void, vita: Lifetime): HTMLElement {
  if (controllo.tipo === "casella") {
    return formCheck({ label: nome, checked: controllo.valore, onChange: cambiato, lifetime: vita }).element;
  }
  if (controllo.tipo === "numero") {
    return formNumber({
      label: nome,
      value: controllo.valore,
      outOfRange: () => "",
      problem: (problema) => (problema === "mixed" ? "" : t(PROBLEMI[problema], { units: "" })),
      onChange: cambiato,
      lifetime: vita,
    }).element;
  }
  if (controllo.tipo === "colore") {
    return colorWell({
      label: nome,
      mixedText: t("draw.chrome.mixed"),
      text: drawPickerText(),
      value: controllo.valore,
      now: () => ({ free: true }),
      onChange: (colore) => cambiato(colore),
      lifetime: vita,
    }).element;
  }
  return formChoice({
    label: nome,
    choices: controllo.scelte.map((scelta) => ({ value: scelta, label: scelta })),
    value: controllo.valore,
    onChange: cambiato,
    lifetime: vita,
  }).element;
}

/// Ciò che la fila sa di un suo controllo: il valore mostrato, il suo nodo e la
/// sua vita (si chiude quando il controllo è rifatto).
interface Mostrato {
  readonly tipo: Controllo["tipo"];
  valore: boolean | number | string;
  nodo: HTMLElement;
  readonly vita: Lifetime;
}

/// La firma di una fila: chiavi, tipi e scelte. Se cambia, la fila si rifà.
function firma(controlli: readonly Controllo[]): string {
  return JSON.stringify(controlli.map((c) => [c.chiave, c.tipo, c.tipo === "scelta" ? c.scelte : null]));
}

/// La fila delle opzioni dello strumento con le sue etichette (`testi` della
/// famiglia), il valore di `opzioni` (lo stato dello strumento) e `cambia`, che
/// riceve la chiave e il valore nuovo. `null` se non ci sono controlli da
/// mostrare: niente fila vuota. `vita` tiene la fila e i suoi ascolti.
export function costruisciFila(
  etichette: Etichette,
  opzioni: unknown,
  cambia: (chiave: string, valore: boolean | number | string) => void,
  vita: Lifetime,
): FilaOpzioni | null {
  if (vita.closed) return null;
  const iniziale = descrivi(opzioni, etichette);
  if (iniziale.controlli.length === 0) return null;

  const element = document.createElement("div");
  element.className = "draw-options-row";
  const mostrati = new Map<string, Mostrato>();
  let firmaCorrente = "";
  // Le opzioni dell'ultimo stato: la lingua che cambia le rifà con queste.
  let opzioniCorrenti = opzioni;

  /// Il controllo di `controllo` in una sua voce. Il valore cambiato dal
  /// controllo vale subito: lo ricorda, e lo manda a chi monta la fila.
  const costruisci = (controllo: Controllo): Mostrato => {
    const sotto = openLifetime();
    const voce = document.createElement("div");
    voce.className = "draw-option";
    voce.dataset.chiave = controllo.chiave;
    const mostrato: Mostrato = { tipo: controllo.tipo, valore: controllo.valore, nodo: voce, vita: sotto };
    voce.append(
      creaControllo(
        controllo,
        etichettaDi(etichette, controllo.chiave),
        (valore) => {
          mostrato.valore = valore;
          cambia(controllo.chiave, valore);
        },
        sotto,
      ),
    );
    return mostrato;
  };

  /// Rifà tutta la fila dai controlli `controlli`.
  const ricostruisci = (controlli: readonly Controllo[]): void => {
    for (const mostrato of mostrati.values()) mostrato.vita.close();
    mostrati.clear();
    const nodi: HTMLElement[] = [];
    for (const controllo of controlli) {
      const mostrato = costruisci(controllo);
      mostrati.set(controllo.chiave, mostrato);
      nodi.push(mostrato.nodo);
    }
    element.replaceChildren(...nodi);
    firmaCorrente = firma(controlli);
  };

  /// Rifà un solo controllo, se il valore non è quello che mostra. Se il fuoco
  /// era dentro, va al controllo nuovo.
  const rifai = (controllo: Controllo, vecchio: Mostrato): void => {
    const eraDentro = document.activeElement !== null && vecchio.nodo.contains(document.activeElement);
    vecchio.vita.close();
    const nuovo = costruisci(controllo);
    vecchio.nodo.replaceWith(nuovo.nodo);
    mostrati.set(controllo.chiave, nuovo);
    if (eraDentro) (nuovo.nodo.querySelector<HTMLElement>("input, select, button") ?? nuovo.nodo).focus({ preventScroll: true });
  };

  ricostruisci(iniziale.controlli);
  // Un cambio di lingua rifà la fila con le etichette nuove; il suo ascolto ha
  // il suo disposer, nella vita della fila.
  vita.add(onLanguage(() => ricostruisci(descrivi(opzioniCorrenti, etichette).controlli)));
  vita.add(() => {
    for (const mostrato of mostrati.values()) mostrato.vita.close();
    mostrati.clear();
  });

  return {
    element,
    aggiorna(nuove) {
      opzioniCorrenti = nuove;
      const { controlli } = descrivi(nuove, etichette);
      if (controlli.length === 0) return false;
      if (firma(controlli) !== firmaCorrente) {
        ricostruisci(controlli);
        return true;
      }
      for (const controllo of controlli) {
        const vecchio = mostrati.get(controllo.chiave)!;
        // Il valore che il controllo ha già (anche quello appena cambiato da chi
        // lo usa) non si rifà: il fuoco e il cursore restano.
        if (vecchio.valore !== controllo.valore) rifai(controllo, vecchio);
      }
      return true;
    },
  };
}
