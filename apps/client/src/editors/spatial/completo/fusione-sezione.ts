// La sezione «Fusione» del Design del Completo (K6 T17, pannello `blend` della mappa), come il
// pannello Fusione di VectorCraft (`vendor/vectorcraft/crates/ui-egui/src/panels/blend.rs`):
//
// - **Crea** (`object.blend.make`), acceso con due oggetti scelti o più.
// - **Spaziatura e Orientamento** della fusione scelta, letti dal motore (`object.blend.info`);
//   senza una fusione scelta, le opzioni delle fusioni nuove. Accesi con una fusione scelta o con
//   due oggetti o più. **Andamento e Rampa** vogliono una fusione scelta con una dorsale sua (sostituita)
//   o allineata al tracciato; **Spostamento colore** una fusione scelta.
// - **Inverti davanti/dietro**, **Inverti dorsale**, **Sostituisci dorsale**, **Espandi** e **Rilascia**,
//   accesi quando il loro comando lo è per il motore.
//
// Ogni cambio manda `object.blend.options` col solo valore cambiato (come VectorCraft), dal percorso
// unico dei comandi senza la finestra della voce: un passo della cronologia. Il primo giro disegna
// tutto spento; quando il motore risponde la sezione si rifà coi valori letti. La risposta di un giro
// passato si butta (la sua vita è chiusa).

import { numberField, type NumberField } from "../../../kit/number-field";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione: l'id del pannello della mappa (`pannello blend`).
export const SEZIONE_FUSIONE = "blend";

/// I comandi dei pulsanti, per l'id del motore.
export const COMANDI_FUSIONE = [
  "object.blend.make",
  "object.blend.reverseFrontToBack",
  "object.blend.reverseSpine",
  "object.blend.replaceSpine",
  "object.blend.expand",
  "object.blend.release",
] as const;

const SPAZIATURE = ["smooth", "steps", "distance"] as const;
const ORIENTAMENTI = ["page", "path"] as const;
const ANDAMENTI = ["easeIn", "easeOut", "easeInOut", "easeOutIn"] as const;

/// Le opzioni lette da `object.blend.info`, con i valori di VectorCraft dove mancano.
export interface InfoFusione {
  /// `blend` se c'è una fusione scelta; `defaults` per le opzioni delle fusioni nuove.
  readonly bersaglio: "blend" | "defaults";
  readonly spaziatura: (typeof SPAZIATURE)[number];
  readonly passi: number;
  readonly distanza: number;
  readonly orientamento: (typeof ORIENTAMENTI)[number];
  readonly andamento: (typeof ANDAMENTI)[number];
  readonly rampa: number;
  readonly spostamento: number;
  /// Se la fusione scelta ha una dorsale sua (sostituita), non la linea fra le chiavi.
  readonly dorsoProprio: boolean;
}

/// Ciò che il motore dice alla sezione: le opzioni lette e i comandi accesi adesso.
export interface StatoFusione {
  readonly info: InfoFusione;
  readonly accesi: ReadonlySet<string>;
}

/// Ciò che la sezione usa del Completo.
export interface AzioniFusione {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori?: Readonly<Record<string, unknown>>) => Promise<void>;
  /// Legge le opzioni e i comandi accesi sugli oggetti scelti; `null` se il motore non c'è o non
  /// risponde.
  readonly leggi: () => Promise<StatoFusione | null>;
}

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function una<T extends string>(valori: readonly T[], valore: unknown, serie: T): T {
  return valori.find((v) => v === valore) ?? serie;
}

function numero(valore: unknown, serie: number): number {
  return typeof valore === "number" && Number.isFinite(valore) ? valore : serie;
}

/// Le opzioni da una lettura di `object.blend.info`; `null` se non è un oggetto.
export function infoDaLettura(lettura: unknown): InfoFusione | null {
  if (!isRecord(lettura)) return null;
  const dorso = lettura.spine;
  return {
    bersaglio: lettura.target === "blend" ? "blend" : "defaults",
    spaziatura: una(SPAZIATURE, lettura.spacing, "smooth"),
    passi: numero(lettura.steps, 5),
    distanza: numero(lettura.distance, 10),
    orientamento: una(ORIENTAMENTI, lettura.orientation, "page"),
    andamento: una(ANDAMENTI, lettura.easingType, "easeIn"),
    rampa: numero(lettura.ramp, 0),
    spostamento: numero(lettura.colorShift, 0),
    dorsoProprio: isRecord(dorso) && dorso.explicit === true,
  };
}

/// I valori di `object.blend.options` per la spaziatura `modo`, coi passi e la distanza mostrati
/// (come `spacing_params` di VectorCraft).
export function valoriSpaziatura(modo: string, passi: number, distanza: number): Readonly<Record<string, unknown>> {
  if (modo === "steps") return { spacing: "steps", steps: passi };
  if (modo === "distance") return { spacing: "distance", distance: distanza };
  return { spacing: "smooth" };
}

/// Le opzioni di serie, per il giro prima che il motore risponda.
const INFO_DI_SERIE: InfoFusione = {
  bersaglio: "defaults",
  spaziatura: "smooth",
  passi: 5,
  distanza: 10,
  orientamento: "page",
  andamento: "easeIn",
  rampa: 0,
  spostamento: 0,
  dorsoProprio: false,
};

let identificativi = 0;

function problemaDelCampo(problema: string): string {
  if (problema === "mixed") return t("draw.properties.problem.mixed");
  return t(problema === "empty" ? "draw.properties.problem.empty" : "draw.properties.problem.syntax");
}

function campo(etichetta: string, controllo: HTMLElement): HTMLElement {
  const riga = document.createElement("label");
  riga.className = "draw-properties-field";
  riga.dataset.column = "all";
  const nome = document.createElement("span");
  nome.className = "draw-properties-label";
  nome.textContent = etichetta;
  riga.append(nome, controllo);
  return riga;
}

function scelta<T extends string>(valori: readonly T[], attuale: T, chiave: (v: T) => DrawKey, classe: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = `draw-properties-input ${classe}`;
  for (const valore of valori) {
    const voce = document.createElement("option");
    voce.value = valore;
    voce.textContent = t(chiave(valore));
    select.append(voce);
  }
  select.value = attuale;
  return select;
}

function pulsante(testo: string, comando: string, acceso: boolean): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "draw-button draw-blend-button";
  control.dataset.id = comando;
  control.textContent = testo;
  control.disabled = !acceso;
  return control;
}

function divisore(): HTMLElement {
  const linea = document.createElement("hr");
  linea.className = "draw-properties-divider";
  return linea;
}

/// Disegna il corpo dallo stato `stato` (`null`: il motore non ha ancora risposto, tutto spento).
function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniFusione, stato: StatoFusione | null): void {
  const { corpo, vita } = contesto;
  corpo.replaceChildren();
  const numero = ++identificativi;
  const info = stato?.info ?? INFO_DI_SERIE;
  const acceso = (comando: string): boolean => stato?.accesi.has(comando) === true;
  const esegui = (id: string, valori: Readonly<Record<string, unknown>> = {}): void => {
    if (vita.closed) return;
    void azioni.esegui(id, valori).then(() => {
      if (!vita.closed) contesto.aggiorna();
    });
  };
  const opzioni = (valori: Readonly<Record<string, unknown>>): void => esegui("object.blend.options", valori);

  const fila = (voci: readonly (readonly [DrawKey, string])[]): HTMLElement => {
    const riga = document.createElement("div");
    riga.className = "draw-properties-bar draw-blend-row";
    for (const [chiave, comando] of voci) {
      // Crea vuole due oggetti scelti o più, come VectorCraft.
      const si = acceso(comando) && (comando !== "object.blend.make" || contesto.sel.numero >= 2);
      const control = pulsante(t(chiave), comando, si);
      vita.listen(control, "click", () => {
        if (!control.disabled) esegui(comando);
      });
      riga.append(control);
    }
    return riga;
  };

  corpo.append(fila([["draw.fusione.crea", "object.blend.make"]]), divisore());

  // Le opzioni: con una fusione scelta, o con due oggetti o più (le opzioni delle fusioni nuove).
  const fusioneScelta = info.bersaglio === "blend";
  const opzioniAccese = stato !== null && (fusioneScelta || contesto.sel.numero >= 2);
  const dorso = info.dorsoProprio || info.orientamento === "path";

  const spaziatura = scelta(SPAZIATURE, info.spaziatura, (v) => `draw.fusione.spaziatura.${v}` as DrawKey, "draw-blend-spacing");
  spaziatura.disabled = !opzioniAccese;
  vita.listen(spaziatura, "change", () => opzioni(valoriSpaziatura(spaziatura.value, info.passi, info.distanza)));
  corpo.append(campo(t("draw.fusione.spaziatura"), spaziatura));

  const quanti: NumberField =
    info.spaziatura === "distance"
      ? numberField({
          label: t("draw.fusione.distanza"),
          value: info.distanza,
          unit: "pt",
          places: 2,
          min: 0.01,
          max: 10000,
          mixedText: "",
          problem: problemaDelCampo,
          onCommit: (valore) => opzioni(valoriSpaziatura("distance", info.passi, valore)),
          lifetime: vita,
        })
      : numberField({
          label: t("draw.fusione.passi"),
          value: info.passi,
          places: 0,
          min: 1,
          max: 1000,
          mixedText: "",
          problem: problemaDelCampo,
          onCommit: (valore) => opzioni(valoriSpaziatura("steps", Math.round(valore), info.distanza)),
          lifetime: vita,
        });
  // Colore uniforme sceglie i passi da sé: il campo li mostra, spento.
  quanti.setDisabled(!opzioniAccese || info.spaziatura === "smooth");
  corpo.append(quanti.element);

  const orientamento = document.createElement("div");
  orientamento.className = "draw-properties-bar";
  orientamento.setAttribute("role", "group");
  const etichettaOrientamento = document.createElement("span");
  etichettaOrientamento.className = "draw-properties-label";
  etichettaOrientamento.id = `draw-blend-orientation-${numero}`;
  etichettaOrientamento.textContent = t("draw.fusione.orientamento");
  orientamento.setAttribute("aria-labelledby", etichettaOrientamento.id);
  for (const valore of ORIENTAMENTI) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-properties-segment";
    control.dataset.orientation = valore;
    control.textContent = t(`draw.fusione.orientamento.${valore}`);
    control.setAttribute("aria-pressed", String(info.orientamento === valore));
    control.disabled = !opzioniAccese;
    vita.listen(control, "click", () => {
      if (!control.disabled) opzioni({ orientation: valore });
    });
    orientamento.append(control);
  }
  const rigaOrientamento = document.createElement("div");
  rigaOrientamento.className = "draw-properties-field";
  rigaOrientamento.dataset.column = "all";
  rigaOrientamento.append(etichettaOrientamento, orientamento);
  corpo.append(rigaOrientamento);

  // L'andamento della posizione vuole un dorso da seguire: uno sostituito, o Allinea al tracciato.
  const andamentoAcceso = opzioniAccese && fusioneScelta && dorso;
  const andamento = scelta(ANDAMENTI, info.andamento, (v) => `draw.fusione.andamento.${v}` as DrawKey, "draw-blend-easing");
  andamento.disabled = !andamentoAcceso;
  vita.listen(andamento, "change", () => opzioni({ easingType: andamento.value }));
  corpo.append(campo(t("draw.fusione.andamento"), andamento));

  const rampa = numberField({
    label: t("draw.fusione.rampa"),
    value: info.rampa,
    unit: "%",
    places: 0,
    min: 0,
    max: 100,
    mixedText: "",
    problem: problemaDelCampo,
    onCommit: (valore) => opzioni({ ramp: valore }),
    lifetime: vita,
  });
  rampa.setDisabled(!andamentoAcceso);
  const spostamento = numberField({
    label: t("draw.fusione.spostamento"),
    value: info.spostamento,
    unit: "%",
    places: 0,
    min: -100,
    max: 100,
    mixedText: "",
    problem: problemaDelCampo,
    onCommit: (valore) => opzioni({ colorShift: valore }),
    lifetime: vita,
  });
  spostamento.setDisabled(!(opzioniAccese && fusioneScelta));
  corpo.append(rampa.element, spostamento.element);

  if (stato !== null && !fusioneScelta && opzioniAccese) {
    const nota = document.createElement("p");
    nota.className = "draw-properties-note";
    nota.textContent = t("draw.fusione.nuove");
    corpo.append(nota);
  }

  const direzione = document.createElement("div");
  direzione.className = "draw-properties-field";
  direzione.dataset.column = "all";
  const etichettaDirezione = document.createElement("span");
  etichettaDirezione.className = "draw-properties-label";
  etichettaDirezione.textContent = t("draw.fusione.direzione");
  direzione.append(etichettaDirezione, fila([["draw.fusione.inverti.avanti", "object.blend.reverseFrontToBack"]]));
  corpo.append(
    direzione,
    divisore(),
    fila([
      ["draw.fusione.inverti.dorso", "object.blend.reverseSpine"],
      ["draw.fusione.sostituisci.dorso", "object.blend.replaceSpine"],
    ]),
    divisore(),
    fila([
      ["draw.fusione.espandi", "object.blend.expand"],
      ["draw.fusione.rilascia", "object.blend.release"],
    ]),
  );
}

function disegna(contesto: ContestoSezione, azioni: AzioniFusione): () => void {
  const { corpo, vita } = contesto;
  if (contesto.motore === null) {
    const nota = document.createElement("p");
    nota.className = "draw-properties-note";
    nota.textContent = t("draw.fusione.nessun.disegno");
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

/// La sezione «Fusione» per la scheda Design.
export function sezioneFusione(azioni: AzioniFusione): Sezione {
  return {
    id: SEZIONE_FUSIONE,
    scheda: "design",
    titolo: t("draw.fusione.titolo"),
    // Senza oggetti scelti è tutto spento, come in VectorCraft: la sezione non c'è.
    quando: (sel) => sel.numero > 0,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraFusione(sezioni: Sezioni, azioni: AzioniFusione): boolean {
  return registraSezione({ sezioni }, sezioneFusione(azioni));
}
