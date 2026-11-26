// La sezione «Oggetti sul tracciato» del Design del Completo (mappa: `ispettore/design`,
// `object.objectsOnPath.options`), come la sezione delle Proprietà di VectorCraft
// (`vendor/vectorcraft/crates/ui-egui/src/panels/properties.rs`, `objects_on_path_section`):
//
// - c'è solo quando ogni oggetto scelto è un gruppo degli Oggetti sul tracciato: la selezione da
//   sola non lo dice, e la sezione nasce nascosta finché la lettura del motore non risponde
//   (`document.node` di ogni oggetto scelto, col record `objects_on_path`);
// - **Perno**: il punto di ogni oggetto che si attacca al tracciato, nove quadratini; nessuno
//   scelto se i gruppi ne hanno di diversi;
// - **Rotazione**: l'angolo di ogni oggetto rispetto al tracciato, da −360° a 360° con due
//   decimali; vuota se i gruppi ne hanno di diverse.
//
// Ogni cambio manda `object.objectsOnPath.options` col solo valore cambiato a tutti i gruppi
// scelti (`ids`), dal percorso unico dei comandi senza finestra: un passo della cronologia. La
// risposta di un giro passato si butta (la sua vita è chiusa).

import { numberField } from "../../../kit/number-field";
import { referencePoint } from "../../../kit/reference-point";
import { t, type DrawKey } from "../strings";
import { problemaDelNumero } from "./opzioni";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione: l'ultimo pezzo del posto del comando delle opzioni.
export const SEZIONE_OGGETTI_SUL_TRACCIATO = "objects-on-path";

/// Lo strumento degli Oggetti sul tracciato (l'id del motore): la voce Attacca senza tracciato lo
/// sceglie.
export const STRUMENTO_OGGETTI_SUL_TRACCIATO = "objectsOnPath";

/// Il comando che la sezione manda.
export const COMANDO_OPZIONI_OGGETTI_SUL_TRACCIATO = "object.objectsOnPath.options";

/// I gruppi scelti, coi valori che hanno in comune (`null` dove differiscono).
export interface StatoOggettiSulTracciato {
  readonly ids: readonly string[];
  readonly perno: number | null;
  readonly rotazione: number | null;
}

/// Ciò che la sezione usa del Completo.
export interface AzioniOggettiSulTracciato {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori: Readonly<Record<string, unknown>>) => Promise<void>;
  /// Gli oggetti scelti e, per ciascuno, la lettura di `document.node` (`null` se manca).
  readonly leggi: () => Promise<{ readonly ids: readonly string[]; readonly nodi: readonly unknown[] } | null>;
}

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

/// Vero se la lettura di `document.node` è un gruppo degli Oggetti sul tracciato.
export function eGruppoSulTracciato(nodo: unknown): boolean {
  return isRecord(nodo) && isRecord(nodo["objects_on_path"]);
}

/// I nove nomi dei quadratini del perno, per righe dall'alto a sinistra.
export function nomiDelPerno(): string[] {
  return Array.from({ length: 9 }, (_, i) => t(`draw.oggettiTracciato.punto.${i}` as DrawKey));
}

/// Lo stato dai nodi letti: `null` se non c'è un oggetto scelto, o se uno non è un gruppo degli
/// Oggetti sul tracciato (come VectorCraft: la sezione vale solo per loro). Un perno che manca
/// vale 4 (il centro) e una rotazione che manca 0, come i valori di serie del record.
export function statoDaiNodi(ids: readonly string[], nodi: readonly unknown[]): StatoOggettiSulTracciato | null {
  if (ids.length === 0 || nodi.length !== ids.length) return null;
  let perno: number | null | undefined;
  let rotazione: number | null | undefined;
  for (const nodo of nodi) {
    if (!eGruppoSulTracciato(nodo)) return null;
    const record = (nodo as Readonly<Record<string, Readonly<Record<string, unknown>>>>)["objects_on_path"]!;
    const p = typeof record["pivot"] === "number" ? record["pivot"] : 4;
    const r = typeof record["rotate"] === "number" ? record["rotate"] : 0;
    perno = perno === undefined ? p : perno === p ? perno : null;
    rotazione = rotazione === undefined ? r : rotazione === r ? rotazione : null;
  }
  return { ids, perno: perno ?? null, rotazione: rotazione ?? null };
}

function campo(etichetta: string, controllo: HTMLElement): HTMLDivElement {
  const riga = document.createElement("div");
  riga.className = "draw-properties-field";
  riga.dataset.column = "all";
  const parola = document.createElement("span");
  parola.className = "draw-properties-label";
  parola.textContent = etichetta;
  riga.append(parola, controllo);
  return riga;
}

function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniOggettiSulTracciato, stato: StatoOggettiSulTracciato): void {
  const { corpo, vita } = contesto;
  const manda = (valori: Readonly<Record<string, unknown>>): void => {
    void azioni.esegui(COMANDO_OPZIONI_OGGETTI_SUL_TRACCIATO, { ids: [...stato.ids], ...valori });
  };
  const perno = referencePoint({
    label: t("draw.oggettiTracciato.perno"),
    pointLabels: nomiDelPerno(),
    value: stato.perno,
    onChange: (valore) => manda({ pivot: valore }),
    lifetime: vita,
  });
  const rotazione = numberField({
    label: t("draw.oggettiTracciato.rotazione"),
    labelHidden: true,
    value: stato.rotazione,
    unit: "°",
    places: 2,
    min: -360,
    max: 360,
    step: 15,
    mixedText: "",
    problem: problemaDelNumero,
    onCommit: (valore) => {
      if (valore !== stato.rotazione) manda({ rotate: valore });
    },
    lifetime: vita,
  });
  corpo.replaceChildren(campo(t("draw.oggettiTracciato.perno"), perno.element), campo(t("draw.oggettiTracciato.rotazione"), rotazione.element));
}

function disegna(contesto: ContestoSezione, azioni: AzioniOggettiSulTracciato): () => void {
  const { corpo, vita } = contesto;
  if (contesto.motore === null) {
    contesto.mostra?.(false);
    return () => corpo.replaceChildren();
  }
  void azioni.leggi().then(
    (letto) => {
      if (vita.closed) return;
      const stato = letto === null ? null : statoDaiNodi(letto.ids, letto.nodi);
      if (stato === null) {
        corpo.replaceChildren();
        contesto.mostra?.(false);
        return;
      }
      disegnaCorpo(contesto, azioni, stato);
      contesto.mostra?.(true);
    },
    () => {
      if (!vita.closed) contesto.mostra?.(false);
    },
  );
  return () => corpo.replaceChildren();
}

/// La sezione «Oggetti sul tracciato» per la scheda Design.
export function sezioneOggettiSulTracciato(azioni: AzioniOggettiSulTracciato): Sezione {
  return {
    id: SEZIONE_OGGETTI_SUL_TRACCIATO,
    scheda: "design",
    titolo: t("draw.oggettiTracciato.titolo"),
    quando: (sel) => sel.numero > 0,
    nascostaAllInizio: true,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraOggettiSulTracciato(sezioni: Sezioni, azioni: AzioniOggettiSulTracciato): boolean {
  return registraSezione({ sezioni }, sezioneOggettiSulTracciato(azioni));
}
