// La sezione «Contorno» del Design del Completo (K6 T15, giro 5): lo spessore, gli estremi, gli angoli
// e il tratteggio delle forme scelte. I valori attuali vengono dalla vista del pannello
// (`misure.contorno`), come in Trasforma e Trasparenza: il pannello li legge una volta, senza chiedere
// il motore. Ogni campo confermato manda `stroke.set` dal percorso unico (`eseguiPerId`), senza la
// finestra della voce: un cambio, un passo di Annulla.
//
// Il limite dell'angolo e l'allineamento dentro o fuori dalla forma il file SVG non li scrive: restano
// spenti, col perché, al valore che il file dà (4, al centro). Le punte restano nella sezione nativa,
// che nel Completo si chiama «Punte». Il testo e l'inchiostro non hanno contorno: con soli quelli
// scelti la vista non porta il contorno, e la sezione è spenta col perché; con un oggetto bloccato è
// spenta come il comando.

import { numberField, type NumberField } from "../../../kit/number-field";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type ContornoSelezione, type Sezione, type Sezioni } from "./sezioni";

/// I valori di `stroke.set`: numeri, nomi, e il tratteggio come lista di lunghezze.
type ValoriContorno = Readonly<Record<string, number | string | readonly number[]>>;

/// Il comando del motore: l'id della voce, i suoi valori, e se va senza la sua finestra.
export type EseguiContorno = (id: string, valori: ValoriContorno, opzioni: { readonly senzaFinestra: boolean }) => void;

/// Lo spessore più grande che il motore accetta (`stroke.set` lo porta in 0..1000).
const SPESSORE_MASSIMO = 1000;

/// Gli estremi e gli angoli, nell'ordine della scelta, col nome che mostra.
const ESTREMI: ReadonlyArray<readonly [string, DrawKey]> = [
  ["butt", "draw.contorno.estremi.butt"],
  ["round", "draw.contorno.estremi.round"],
  ["square", "draw.contorno.estremi.square"],
];
const ANGOLI: ReadonlyArray<readonly [string, DrawKey]> = [
  ["miter", "draw.contorno.angoli.miter"],
  ["round", "draw.contorno.angoli.round"],
  ["bevel", "draw.contorno.angoli.bevel"],
];

/// Che cosa non va in un numero scritto.
function problemaDi(problema: string): string {
  if (problema === "mixed") return t("draw.properties.problem.mixed");
  return t(problema === "empty" ? "draw.properties.problem.empty" : "draw.properties.problem.syntax");
}

/// Una scelta con la sua etichetta: con `valore` `null` (la selezione non è d'accordo) la prima voce è
/// «Misto», che non si sceglie.
function scelta(
  classe: string,
  etichetta: DrawKey,
  voci: ReadonlyArray<readonly [string, DrawKey]>,
  valore: string | null,
  cambia: (valore: string) => void,
): { readonly radice: HTMLLabelElement; readonly select: HTMLSelectElement } {
  const select = document.createElement("select");
  select.className = `draw-properties-input ${classe}`;
  if (valore === null) {
    const misto = document.createElement("option");
    misto.value = "";
    misto.textContent = t("draw.properties.mixed");
    select.append(misto);
  }
  for (const [chiave, nome] of voci) {
    const voce = document.createElement("option");
    voce.value = chiave;
    voce.textContent = t(nome);
    select.append(voce);
  }
  select.value = valore ?? "";
  select.addEventListener("change", () => {
    if (select.value !== "") cambia(select.value);
  });
  const radice = document.createElement("label");
  radice.className = "draw-properties-field draw-outline-field";
  radice.append(t(etichetta), select);
  return { radice, select };
}

/// Una nota della sezione.
function nota(testo: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "draw-properties-note draw-outline-note";
  p.textContent = testo;
  return p;
}

/// La sezione nel corpo di `contesto`.
function disegnaContorno(contesto: ContestoSezione, esegui: EseguiContorno): () => void {
  const corpo = contesto.corpo;
  const contorno: ContornoSelezione | undefined = contesto.misure?.contorno;
  const vuota = contesto.sel.numero === 0;
  const spenta = vuota || contorno === undefined || contorno.bloccato;
  const manda = (valori: ValoriContorno): void => {
    if (!spenta) esegui("stroke.set", valori, { senzaFinestra: true });
  };
  // Le lunghezze scritte sono nell'unità dello spessore; il motore lavora in quelle della scena.
  const allaScena = contorno?.spessore?.allaScena ?? ((v: number) => v);
  const unita = contorno?.spessore?.unita ?? "px";
  const decimali = contorno?.spessore?.decimali ?? 2;

  const spessore = numberField({
    label: t("draw.contorno.spessore"),
    value: contorno?.spessore?.valore ?? null,
    unit: unita,
    places: decimali,
    min: 0,
    max: SPESSORE_MASSIMO,
    mixedText: contorno?.spessore === undefined ? "" : t("draw.properties.mixed"),
    problem: problemaDi,
    onCommit: (valore) => {
      manda({ weight: allaScena(valore) });
      return undefined;
    },
    lifetime: contesto.vita,
  });

  const estremi = scelta("draw-outline-cap", "draw.contorno.estremi", ESTREMI, contorno === undefined ? "butt" : contorno.estremi, (cap) => manda({ cap }));
  const angoli = scelta("draw-outline-join", "draw.contorno.angoli", ANGOLI, contorno === undefined ? "miter" : contorno.angoli, (join) => manda({ join }));

  // Il limite dell'angolo e l'allineamento: sempre spenti, al valore del file.
  const limite = numberField({
    label: t("draw.contorno.limite"),
    value: 4,
    places: 0,
    mixedText: "",
    problem: problemaDi,
    onCommit: () => undefined,
    lifetime: contesto.vita,
  });
  limite.setDisabled(true);
  const allineamento = scelta("draw-outline-align", "draw.contorno.allineamento", [["center", "draw.contorno.allineamento.centro"]], "center", () => undefined);
  allineamento.select.disabled = true;
  const nonScritto = nota(t("draw.contorno.nonScritto"));

  // Il tratteggio: l'interruttore, poi il trattino e lo spazio.
  const trattini = contorno === undefined ? [] : contorno.trattini;
  const tratteggiato = trattini === null || trattini.length > 0;
  const interruttore = document.createElement("input");
  interruttore.type = "checkbox";
  interruttore.className = "draw-outline-dashed";
  interruttore.checked = trattini !== null && trattini.length > 0;
  interruttore.indeterminate = trattini === null;
  const voceInterruttore = document.createElement("label");
  voceInterruttore.className = "draw-properties-switch draw-outline-field";
  voceInterruttore.append(interruttore, t("draw.contorno.tratteggio"));
  const spessoreAdesso = contorno?.spessore?.valore ?? 1;
  interruttore.addEventListener("change", () => {
    if (!interruttore.checked) {
      manda({ dash: [] });
      return;
    }
    // Un tratteggio nuovo: quello «Tratteggiato» del menu del contorno, 4 e 3 volte lo spessore.
    const base = spessoreAdesso > 0 ? spessoreAdesso : 1;
    manda({ dash: [allaScena(base * 4), allaScena(base * 3)] });
  });

  const trattino = trattini !== null && trattini.length > 0 ? trattini[0]! : null;
  const spazio = trattini !== null && trattini.length > 0 ? (trattini[1] ?? trattini[0]!) : null;
  const campoLunghezza = (chiave: DrawKey, valore: number | null, scrivi: (v: number) => number[]): NumberField =>
    numberField({
      label: t(chiave),
      value: valore,
      unit: unita,
      places: decimali,
      min: 0,
      max: SPESSORE_MASSIMO,
      mixedText: t("draw.properties.mixed"),
      problem: problemaDi,
      onCommit: (v) => {
        manda({ dash: scrivi(v).map(allaScena) });
        return undefined;
      },
      lifetime: contesto.vita,
    });
  const campoTrattino = campoLunghezza("draw.contorno.trattino", trattino, (v) => [v, spazio ?? v]);
  const campoSpazio = campoLunghezza("draw.contorno.spazio", spazio, (v) => [trattino ?? v, v]);
  const lunghezze = document.createElement("div");
  lunghezze.className = "draw-outline-dashes";
  lunghezze.append(campoTrattino.element, campoSpazio.element);
  lunghezze.hidden = !tratteggiato;
  const suMisura =
    trattini !== null && trattini.length > 2 ? nota(t("draw.contorno.suMisura", { value: trattini.map((v) => String(Number(v.toFixed(decimali)))).join(" ") })) : null;

  // Perché la sezione è spenta, se lo è.
  const perche = vuota ? t("draw.contorno.vuota") : contorno === undefined ? t("draw.contorno.nessuno") : contorno.bloccato ? t("draw.contorno.bloccato") : null;

  if (perche !== null) corpo.append(nota(perche));
  corpo.append(spessore.element, estremi.radice, angoli.radice, voceInterruttore, lunghezze);
  if (suMisura !== null) corpo.append(suMisura);
  corpo.append(limite.element, allineamento.radice, nonScritto);

  spessore.setDisabled(spenta);
  estremi.select.disabled = spenta;
  angoli.select.disabled = spenta;
  interruttore.disabled = spenta;
  campoTrattino.setDisabled(spenta);
  campoSpazio.setDisabled(spenta);
  return () => corpo.replaceChildren();
}

/// La sezione «Contorno» per la scheda Design, da registrare nel Completo aperto.
export function sezioneContorno(esegui: EseguiContorno): Sezione {
  return {
    id: "contorno",
    scheda: "design",
    titolo: t("draw.contorno.titolo"),
    disegna: (contesto) => disegnaContorno(contesto, esegui),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraContorno(sezioni: Sezioni, esegui: EseguiContorno): boolean {
  return registraSezione({ sezioni }, sezioneContorno(esegui));
}
