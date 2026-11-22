// La sezione «Trasforma» dell'ispettore Design del Completo (K6 T13, giro 3 e 4): posizione, misura,
// rotazione e inclinazione, e il riquadro da reimpostare. I campi mostrano le misure della selezione
// che il pannello ha già nella sua vista (giro 4), nell'unità del pannello, e restano vuoti se la
// selezione non ha un valore solo. Ogni campo confermato manda il suo comando del motore, con il
// valore riportato alle unità della scena: `object.setBounds` per X, Y, larghezza e altezza;
// `object.rotate` assoluto per la rotazione; `object.shear` per l'inclinazione (di quanto si inclina,
// da 0); `object.resetBoundingBox` per il riquadro. I comandi passano dal percorso unico
// (`eseguiPerId`), senza la finestra della voce.

import { numberField, type NumberField } from "../../../kit/number-field";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type MisuraSelezione, type MisureSelezione, type Sezione, type Sezioni } from "./sezioni";

/// Un valore che il comando riceve: un numero, un testo o un sì/no.
export type ValoreTrasforma = string | number | boolean;

/// Il comando del motore: l'id della voce, i suoi valori, e se va senza la sua finestra.
export type EseguiTrasforma = (id: string, valori: Readonly<Record<string, ValoreTrasforma>>, opzioni: { readonly senzaFinestra: boolean }) => void;

interface CampoTrasforma {
  readonly chiave: DrawKey;
  /// L'unità che il campo mostra se il pannello non ne dà una.
  readonly unita: string;
  /// L'id della voce dell'indice (`object.setBounds`…).
  readonly voce: string;
  /// I valori che il comando riceve per il numero del campo (in unità della scena).
  readonly valori: (valore: number) => Readonly<Record<string, ValoreTrasforma>>;
  readonly senzaFinestra: boolean;
  /// La misura del pannello che il campo mostra, se ce n'è una.
  readonly misura?: "x" | "y" | "larghezza" | "altezza" | "rotazione";
}

/// I campi della sezione, nell'ordine in cui si vedono.
const CAMPI: readonly CampoTrasforma[] = [
  { chiave: "draw.trasforma.x", unita: "px", voce: "object.setBounds", valori: (x) => ({ x }), senzaFinestra: false, misura: "x" },
  { chiave: "draw.trasforma.y", unita: "px", voce: "object.setBounds", valori: (y) => ({ y }), senzaFinestra: false, misura: "y" },
  { chiave: "draw.trasforma.width", unita: "px", voce: "object.setBounds", valori: (width) => ({ width }), senzaFinestra: false, misura: "larghezza" },
  { chiave: "draw.trasforma.height", unita: "px", voce: "object.setBounds", valori: (height) => ({ height }), senzaFinestra: false, misura: "altezza" },
  { chiave: "draw.trasforma.rotation", unita: "°", voce: "object.rotate", valori: (angle) => ({ angle, absolute: true }), senzaFinestra: true, misura: "rotazione" },
  { chiave: "draw.trasforma.skew", unita: "°", voce: "object.shear", valori: (angle) => ({ angle, axis: "horizontal" }), senzaFinestra: true },
];

/// Le frasi dei problemi di lettura di un campo numerico (le stesse della finestra del motore).
const PROBLEMI: Readonly<Record<string, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
};

/// La sezione nel corpo di `contesto`: i sei campi, e il riquadro da reimpostare. Spenti
/// senza una selezione, come gli allineamenti.
function disegnaTrasforma(contesto: ContestoSezione, esegui: EseguiTrasforma): () => void {
  const corpo = contesto.corpo;
  const misure: MisureSelezione = contesto.misure ?? {};
  const campi: NumberField[] = [];
  const griglia = document.createElement("div");
  griglia.className = "draw-transform-grid";
  for (const campo of CAMPI) {
    const misura: MisuraSelezione | undefined = campo.misura === undefined ? undefined : misure[campo.misura];
    const numero = numberField({
      label: t(campo.chiave),
      value: misura?.valore ?? null,
      unit: misura?.unita ?? campo.unita,
      places: misura?.decimali ?? 2,
      mixedText: "",
      problem: (problema) => (problema === "mixed" ? t("draw.properties.problem.mixed") : t(PROBLEMI[problema] ?? "draw.properties.problem.syntax", { units: misura?.unita ?? campo.unita })),
      onCommit: (valore) => {
        // Il valore scritto è nell'unità del pannello: il motore lavora nelle unità della scena.
        const allaScena = misura?.allaScena ?? ((v: number) => v);
        esegui(campo.voce, campo.valori(allaScena(valore)), { senzaFinestra: campo.senzaFinestra });
        return undefined;
      },
      lifetime: contesto.vita,
    });
    campi.push(numero);
    griglia.append(numero.element);
  }
  const reimposta = document.createElement("button");
  reimposta.type = "button";
  reimposta.className = "kit-button";
  reimposta.textContent = t("draw.trasforma.reset");
  reimposta.addEventListener("click", () => {
    if (!reimposta.disabled) esegui("object.resetBoundingBox", {}, { senzaFinestra: true });
  });
  const aggiorna = (): void => {
    const spenta = contesto.sel.numero === 0;
    for (const numero of campi) numero.setDisabled(spenta);
    reimposta.disabled = spenta;
  };
  corpo.append(griglia, reimposta);
  aggiorna();
  return () => corpo.replaceChildren();
}

/// La sezione «Trasforma» per la scheda Design, da registrare nel Completo aperto.
export function sezioneTrasforma(esegui: EseguiTrasforma): Sezione {
  return {
    id: "trasforma",
    scheda: "design",
    titolo: t("draw.trasforma.titolo"),
    disegna: (contesto) => disegnaTrasforma(contesto, esegui),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraTrasforma(sezioni: Sezioni, esegui: EseguiTrasforma): boolean {
  return registraSezione({ sezioni }, sezioneTrasforma(esegui));
}
