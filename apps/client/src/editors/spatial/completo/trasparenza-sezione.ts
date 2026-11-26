// La sezione «Trasparenza» del Design del Completo (K6 T15, giro 2): l'opacità e il metodo di fusione
// dell'oggetto scelto. I valori attuali vengono dalla vista del pannello, come in Trasforma
// (`misure.opacita`, `misure.fusione`): il pannello li legge una volta, senza chiedere il motore.
// Ogni campo confermato manda `transparency.set` dal percorso unico (`eseguiPerId`), senza la
// finestra della voce. Nel Completo la sezione «Aspetto» del Semplice non c'è: la sua opacità la
// dà questa, così non ce n'è un doppione.

import { numberField } from "../../../kit/number-field";
import { BLEND_MODES } from "../scene/values";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type MisureSelezione, type Sezione, type Sezioni } from "./sezioni";
import type { EseguiTrasforma } from "./trasforma-sezione";

/// Il nome di ogni modo di fusione di `BLEND_MODES`, come lo mostra la scelta (le chiavi di `strings`).
const NOME_FUSIONE: Readonly<Record<string, DrawKey>> = {
  normal: "draw.trasparenza.blend.normal",
  multiply: "draw.trasparenza.blend.multiply",
  screen: "draw.trasparenza.blend.screen",
  overlay: "draw.trasparenza.blend.overlay",
  darken: "draw.trasparenza.blend.darken",
  lighten: "draw.trasparenza.blend.lighten",
  "color-dodge": "draw.trasparenza.blend.color-dodge",
  "color-burn": "draw.trasparenza.blend.color-burn",
  "hard-light": "draw.trasparenza.blend.hard-light",
  "soft-light": "draw.trasparenza.blend.soft-light",
  difference: "draw.trasparenza.blend.difference",
  exclusion: "draw.trasparenza.blend.exclusion",
  hue: "draw.trasparenza.blend.hue",
  saturation: "draw.trasparenza.blend.saturation",
  color: "draw.trasparenza.blend.color",
  luminosity: "draw.trasparenza.blend.luminosity",
};

/// La sezione nel corpo di `contesto`: il campo dell'opacità in percento, e la scelta del metodo di
/// fusione. Spenti senza una selezione, come Trasforma.
function disegnaTrasparenza(contesto: ContestoSezione, esegui: EseguiTrasforma): () => void {
  const corpo = contesto.corpo;
  const misure: MisureSelezione = contesto.misure ?? {};
  const opacita = misure.opacita;
  const campo = numberField({
    label: t("draw.trasparenza.opacita"),
    value: opacita?.valore ?? null,
    unit: "%",
    places: opacita?.decimali ?? 0,
    min: 0,
    max: 100,
    mixedText: "",
    problem: (problema) =>
      problema === "mixed"
        ? t("draw.properties.problem.mixed")
        : t(problema === "empty" ? "draw.properties.problem.empty" : "draw.properties.problem.syntax"),
    onCommit: (valore) => {
      esegui("transparency.set", { opacity: valore }, { senzaFinestra: true });
      return undefined;
    },
    lifetime: contesto.vita,
  });

  const fusione = misure.fusione;
  const scelta = document.createElement("select");
  scelta.className = "draw-properties-input draw-transparency-blend";
  if (fusione !== undefined && fusione.valore === null) {
    // Più metodi nella selezione: la voce vuota dice che non ce n'è uno solo, e non si sceglie.
    const vari = document.createElement("option");
    vari.value = "";
    vari.textContent = t("draw.trasparenza.fusione.vari");
    scelta.append(vari);
  }
  for (const modo of BLEND_MODES) {
    const chiave = NOME_FUSIONE[modo];
    if (chiave === undefined) continue;
    const voce = document.createElement("option");
    voce.value = modo;
    voce.textContent = t(chiave);
    scelta.append(voce);
  }
  scelta.value = fusione === undefined ? "normal" : (fusione.valore ?? "");
  scelta.addEventListener("change", () => {
    if (scelta.value === "") return;
    esegui("transparency.set", { blend: scelta.value }, { senzaFinestra: true });
  });
  const etichetta = document.createElement("label");
  etichetta.append(t("draw.trasparenza.fusione"), scelta);

  corpo.append(campo.element, etichetta);
  const aggiorna = (): void => {
    const spenta = contesto.sel.numero === 0;
    campo.setDisabled(spenta);
    scelta.disabled = spenta;
  };
  aggiorna();
  return () => corpo.replaceChildren();
}

/// La sezione «Trasparenza» per la scheda Design, da registrare nel Completo aperto.
export function sezioneTrasparenza(esegui: EseguiTrasforma): Sezione {
  return {
    id: "trasparenza",
    scheda: "design",
    titolo: t("draw.trasparenza.titolo"),
    disegna: (contesto) => disegnaTrasparenza(contesto, esegui),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraTrasparenza(sezioni: Sezioni, esegui: EseguiTrasforma): boolean {
  return registraSezione({ sezioni }, sezioneTrasparenza(esegui));
}
