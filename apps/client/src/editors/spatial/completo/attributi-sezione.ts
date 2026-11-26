// La sezione «Attributi» del Design del Completo (pannello `attributes` della mappa): per ora la sola
// regola di riempimento dei tracciati, come i due pulsanti del pannello Attributi di VectorCraft
// (`path.setFillRule`, letta con `attributes.info`).
//
// - **Diversa da zero** e **Pari-dispari** dicono la regola dei tracciati scelti (propria o
//   ereditata dal gruppo); nessuno è premuto se sono diverse. Il clic manda `path.setFillRule`, un
//   passo della cronologia, e il file scrive `fill-rule` solo dove cambia quella del genitore.
// - Accesi quando il motore accende `path.setFillRule`. Il primo giro disegna tutto spento; quando il
//   motore risponde la sezione si rifà. La risposta di un giro passato si butta (la sua vita è chiusa).

import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione: l'id del pannello della mappa (`pannello attributes`).
export const SEZIONE_ATTRIBUTI = "attributes";

/// Il comando dei pulsanti.
export const COMANDO_REGOLA = "path.setFillRule";

const REGOLE = ["nonZero", "evenOdd"] as const;
export type Regola = (typeof REGOLE)[number];

/// Ciò che il motore dice alla sezione: la regola dei tracciati scelti (`null` se sono diverse o non
/// ci sono tracciati) e se il comando è acceso.
export interface StatoAttributi {
  readonly regola: Regola | null;
  readonly acceso: boolean;
}

/// Ciò che la sezione usa del Completo.
export interface AzioniAttributi {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori: Readonly<Record<string, unknown>>) => Promise<void>;
  /// Legge la regola e il comando acceso; `null` se il motore non c'è o non risponde.
  readonly leggi: () => Promise<StatoAttributi | null>;
}

/// La regola da una lettura di `attributes.info`: `null` se manca o non è una delle due.
export function regolaDaLettura(lettura: unknown): Regola | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const regola = (lettura as Record<string, unknown>).fillRule;
  return REGOLE.find((r) => r === regola) ?? null;
}

let identificativi = 0;

function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniAttributi, stato: StatoAttributi | null): void {
  const { corpo, vita } = contesto;
  corpo.replaceChildren();
  const etichetta = document.createElement("span");
  etichetta.className = "draw-properties-label";
  etichetta.id = `draw-attributes-rule-${++identificativi}`;
  etichetta.textContent = t("draw.attributi.regola");
  const fila = document.createElement("div");
  fila.className = "draw-properties-bar";
  fila.setAttribute("role", "group");
  fila.setAttribute("aria-labelledby", etichetta.id);
  for (const regola of REGOLE) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-properties-segment";
    control.dataset.rule = regola;
    control.textContent = t(`draw.attributi.regola.${regola}` as DrawKey);
    control.setAttribute("aria-pressed", String(stato?.regola === regola));
    control.disabled = stato?.acceso !== true;
    vita.listen(control, "click", () => {
      if (control.disabled || vita.closed || stato?.regola === regola) return;
      void azioni.esegui(COMANDO_REGOLA, { rule: regola }).then(() => {
        if (!vita.closed) contesto.aggiorna();
      });
    });
    fila.append(control);
  }
  const riga = document.createElement("div");
  riga.className = "draw-properties-field";
  riga.dataset.column = "all";
  riga.append(etichetta, fila);
  corpo.append(riga);
}

function disegna(contesto: ContestoSezione, azioni: AzioniAttributi): () => void {
  const { corpo, vita } = contesto;
  if (contesto.motore === null) {
    const nota = document.createElement("p");
    nota.className = "draw-properties-note";
    nota.textContent = t("draw.attributi.nessun.disegno");
    corpo.replaceChildren(nota);
    return () => corpo.replaceChildren();
  }
  disegnaCorpo(contesto, azioni, null);
  void azioni.leggi().then(
    (stato) => {
      if (stato !== null && !vita.closed) disegnaCorpo(contesto, azioni, stato);
    },
    () => undefined,
  );
  return () => corpo.replaceChildren();
}

/// La sezione «Attributi» per la scheda Design.
export function sezioneAttributi(azioni: AzioniAttributi): Sezione {
  return {
    id: SEZIONE_ATTRIBUTI,
    scheda: "design",
    titolo: t("draw.attributi.titolo"),
    // Senza oggetti scelti non c'è una regola da cambiare.
    quando: (sel) => sel.numero > 0,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraAttributi(sezioni: Sezioni, azioni: AzioniAttributi): boolean {
  return registraSezione({ sezioni }, sezioneAttributi(azioni));
}
