// La fila delle opzioni della Bacchetta magica nel Disegno completo (piano K6;
// `docs/product/drawing-selection.md`, «La Bacchetta magica»). Come il pannello «Magic Wand» di
// VectorCraft (`ui-egui/src/panels/magic_wand.rs`): per riempimento, contorno, spessore del
// contorno e opacità una casella e una tolleranza; per il metodo di fusione solo la casella.
//
// Le opzioni sono della sessione del motore (`magicWand.set`, `magicWand.options`, letture che
// non fanno un passo di annulla). VectorCraft le tiene per la sessione dell'app, uguali in ogni
// documento: qui il modulo le ricorda per la corsa dell'app (`ricordate`) e, quando la fila si
// monta in un disegno, le rimanda al suo motore. Non vanno su disco.
//
// Le regole sono pure (`opzioniBacchetta`, `comandoDellaVoce`): la fila le usa, e i test le
// provano senza il DOM. Una modifica non ricostruisce la fila: il fuoco resta dov'è.

import { formCheck } from "../../../../../kit/form";
import { numberField } from "../../../../../kit/number-field";
import type { Lifetime } from "../../../../../ui/lifetime";
import type { AzioniFila, FilaOpzioni } from "../../opzioni";
import { problemaDelNumero } from "../../opzioni";
import { t, type DrawKey } from "../../../strings";

/// I comandi del motore: cambia (e rende) le opzioni, le legge.
export const COMANDO_BACCHETTA = "disegno.magicWand.set";
export const COMANDO_BACCHETTA_LETTURA = "disegno.magicWand.options";

/// Le opzioni come le dà il motore (`WandSettings`).
export interface OpzioniBacchetta {
  readonly fillColor: boolean;
  readonly fillTolerance: number;
  readonly strokeColor: boolean;
  readonly strokeTolerance: number;
  readonly strokeWeight: boolean;
  readonly weightTolerance: number;
  readonly opacity: boolean;
  readonly opacityTolerance: number;
  readonly blendingMode: boolean;
}

/// I valori di serie di VectorCraft (`engine/src/cmd/wand.rs`).
export const BACCHETTA_DI_SERIE: OpzioniBacchetta = {
  fillColor: true,
  fillTolerance: 32,
  strokeColor: false,
  strokeTolerance: 32,
  strokeWeight: false,
  weightTolerance: 5,
  opacity: false,
  opacityTolerance: 5,
  blendingMode: false,
};

type Casella = "fillColor" | "strokeColor" | "strokeWeight" | "opacity" | "blendingMode";
type Tolleranza = "fillTolerance" | "strokeTolerance" | "weightTolerance" | "opacityTolerance";

/// Le voci della fila, nell'ordine del pannello: la casella, la sua tolleranza coi limiti del
/// motore e l'unità.
export const VOCI_BACCHETTA: readonly {
  readonly casella: Casella;
  readonly chiave: DrawKey;
  readonly tolleranza?: { readonly chiave: Tolleranza; readonly max: number; readonly unita?: string };
}[] = [
  { casella: "fillColor", chiave: "draw.bacchetta.riempimento", tolleranza: { chiave: "fillTolerance", max: 255 } },
  { casella: "strokeColor", chiave: "draw.bacchetta.contorno", tolleranza: { chiave: "strokeTolerance", max: 255 } },
  { casella: "strokeWeight", chiave: "draw.bacchetta.spessore", tolleranza: { chiave: "weightTolerance", max: 1000, unita: "pt" } },
  { casella: "opacity", chiave: "draw.bacchetta.opacita", tolleranza: { chiave: "opacityTolerance", max: 100, unita: "%" } },
  { casella: "blendingMode", chiave: "draw.bacchetta.fusione" },
];

/// Le opzioni ricordate per la corsa dell'app: `null` finché nessuno le ha cambiate.
let ricordate: OpzioniBacchetta | null = null;

/// Le opzioni lette dal motore: ogni chiave che manca o è sbagliata vale quella di serie, ogni
/// tolleranza sta nei limiti.
export function opzioniBacchetta(letto: unknown): OpzioniBacchetta {
  const o = letto !== null && typeof letto === "object" && !Array.isArray(letto) ? (letto as Record<string, unknown>) : {};
  const fuori: Record<string, boolean | number> = { ...BACCHETTA_DI_SERIE };
  for (const voce of VOCI_BACCHETTA) {
    if (typeof o[voce.casella] === "boolean") fuori[voce.casella] = o[voce.casella] as boolean;
    const tol = voce.tolleranza;
    const n = tol === undefined ? undefined : o[tol.chiave];
    if (tol !== undefined && typeof n === "number" && Number.isFinite(n)) fuori[tol.chiave] = Math.min(tol.max, Math.max(0, n));
  }
  return fuori as unknown as OpzioniBacchetta;
}

/// Il valore di `magicWand.set` per una voce cambiata: solo la chiave che cambia.
export function comandoDellaVoce(chiave: Casella | Tolleranza, valore: boolean | number): Readonly<Record<string, boolean | number>> {
  return { [chiave]: valore };
}

/// Solo per le prove: dimentica le opzioni ricordate.
export function dimenticaLaBacchetta(): void {
  ricordate = null;
}

function gruppo(nome: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "draw-group kit-bar-group draw-bacchetta-voce";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", nome);
  return el;
}

/// La fila della Bacchetta magica: parte con le opzioni ricordate (o di serie), le manda al
/// motore del disegno se sono state cambiate, e mette nei controlli ciò che il motore rende.
/// `null` se la fila è già chiusa.
export function filaBacchetta(azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const element = document.createElement("div");
  element.className = "draw-options-row";
  let opzioni = ricordate ?? BACCHETTA_DI_SERIE;
  const gruppi = VOCI_BACCHETTA.map((voce) => gruppo(t(voce.chiave)));
  /// I campi delle tolleranze, per spegnerli con la loro casella senza rifare la fila.
  const campi = new Map<Casella, { setDisabled(spento: boolean): void }>();
  /// Ogni risposta del motore diventa le opzioni (e quelle ricordate, se ci sono); la più
  /// vecchia non scrive su una nuova. Solo la prima rifà i controlli: un cambio no, così il
  /// fuoco resta dov'è.
  let giro = 0;
  const manda = (id: string, valore: unknown, rifai: boolean): void => {
    const mio = ++giro;
    azioni.leggi(id, valore).then(
      (letto) => {
        if (letto === null || mio !== giro) return;
        opzioni = opzioniBacchetta(letto);
        if (ricordate !== null) ricordate = opzioni;
        if (rifai && !vita.closed) mostra();
      },
      () => undefined,
    );
  };
  const cambia = (chiave: Casella | Tolleranza, valore: boolean | number): void => {
    opzioni = { ...opzioni, [chiave]: valore };
    ricordate = opzioni;
    if (typeof valore === "boolean") campi.get(chiave as Casella)?.setDisabled(!valore);
    manda(COMANDO_BACCHETTA, comandoDellaVoce(chiave, valore), false);
  };
  const mostra = (): void => {
    VOCI_BACCHETTA.forEach((voce, i) => {
      const casella = formCheck({
        label: t(voce.chiave),
        checked: opzioni[voce.casella],
        onChange: (acceso) => cambia(voce.casella, acceso),
        lifetime: vita,
      });
      const parti: HTMLElement[] = [casella.element.querySelector<HTMLLabelElement>("label") ?? casella.element];
      const tol = voce.tolleranza;
      if (tol !== undefined) {
        const campo = numberField({
          label: `${t(voce.chiave)}: ${t("draw.bacchetta.tolleranza")}`,
          labelHidden: true,
          value: opzioni[tol.chiave],
          ...(tol.unita === undefined ? {} : { unit: tol.unita }),
          places: tol.chiave === "weightTolerance" ? 2 : 0,
          min: 0,
          max: tol.max,
          mixedText: "",
          problem: problemaDelNumero,
          onCommit: (valore) => {
            if (valore !== opzioni[tol.chiave]) cambia(tol.chiave, valore);
          },
          lifetime: vita,
        });
        campo.setDisabled(!opzioni[voce.casella]);
        campi.set(voce.casella, campo);
        parti.push(campo.element);
      }
      gruppi[i]!.replaceChildren(...parti);
    });
  };
  mostra();
  // Le opzioni ricordate vanno al motore di questo disegno; senza, si leggono le sue.
  if (ricordate !== null) manda(COMANDO_BACCHETTA, ricordate, true);
  else manda(COMANDO_BACCHETTA_LETTURA, {}, true);
  return {
    element,
    voci: gruppi.map((g, i) => ({ element: g, priorita: VOCI_BACCHETTA.length - i })),
    aggiorna: () => true,
  };
}
