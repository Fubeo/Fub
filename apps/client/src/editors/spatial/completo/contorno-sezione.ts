// La sezione «Contorno» del Design del Completo, come il pannello Stroke di VectorCraft
// (`vendor/vectorcraft/crates/ui-egui/src/panels/stroke.rs`): spessore, estremi, angoli e limite
// dell'angolo, allineamento del contorno, tratteggio con tre coppie trattino/spazio, esatto o adattato
// agli angoli, punte di freccia all'inizio e alla fine con la loro scala e il loro allineamento.
//
// - **Due letture.** Spessore, estremi, angoli e tratteggio arrivano subito dalla vista del pannello
//   (`misure.contorno`), senza chiedere il motore. Il resto (limite, allineamento, adattamento dei
//   trattini, punte, scala) lo dà il motore con `document.node` di ogni oggetto scelto (`leggi`): quando
//   arriva la sezione si rifà con i valori del motore, che vincono anche sullo spessore e sui trattini
//   (un contorno dentro o fuori il file lo scrive raddoppiato e ritagliato: il motore sa quello vero).
//   Finché la lettura non c'è, i controlli che ne hanno bisogno sono spenti.
// - **Un valore che gli oggetti non condividono è «Misto»** e non manda niente da solo.
// - **I comandi.** Ogni cambio manda `stroke.set` (lo scambio e la scala delle punte
//   `stroke.setAdvanced`) dal percorso unico (`eseguiPerId`), senza la finestra della voce: un cambio,
//   un passo di Annulla. Le lunghezze scritte sono nell'unità dello spessore; il motore lavora in
//   quelle della scena.
// - **Come VectorCraft.** Il limite c'è solo con gli angoli vivi (1..500); dentro e fuori solo se ogni
//   oggetto è chiuso; un trattino vuoto chiude la serie e uno spazio vuoto vale quanto il suo trattino;
//   tutto a zero è un contorno pieno; spento e riacceso, il tratteggio torna com'era (di serie 12 pt
//   adattati agli angoli); la scala e l'allineamento delle punte valgono solo con una punta; il
//   lucchetto lega le due scale.
// - Le punte di Fub (`marker-start`/`marker-end`, livello Standard) restano nella sezione nativa, che
//   nel Completo si chiama «Punte». Il testo e l'inchiostro non hanno contorno: con soli quelli scelti la
//   vista non porta il contorno, e la sezione è spenta col perché; con un oggetto bloccato è spenta
//   come il comando.

import { numberField, type NumberField } from "../../../kit/number-field";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type ContornoSelezione, type Sezione, type Sezioni } from "./sezioni";

/// I valori dei comandi del contorno: numeri, nomi, interruttori, liste di lunghezze o di scale.
type ValoriContorno = Readonly<Record<string, number | string | boolean | null | readonly number[]>>;

/// Il comando del motore: l'id della voce, i suoi valori, e se va senza la sua finestra.
export type EseguiContorno = (id: string, valori: ValoriContorno, opzioni: { readonly senzaFinestra: boolean }) => void;

/// Ciò che la sezione chiede al Completo: i comandi e, se c'è un motore, la lettura di ogni oggetto
/// scelto (`document.node`, un valore per oggetto; `null` dove la lettura non c'è).
export interface AzioniContorno {
  readonly esegui: EseguiContorno;
  readonly leggi?: () => Promise<readonly unknown[]>;
}

/// Lo spessore più grande che il motore accetta (`stroke.set` lo porta in 0..1000).
const SPESSORE_MASSIMO = 1000;
/// Il limite dell'angolo del motore: 1..500 volte lo spessore; 10 dove nessun oggetto ne ha uno.
const LIMITE_MINIMO = 1;
const LIMITE_MASSIMO = 500;
const LIMITE_DI_SERIE = 10;
/// La scala delle punte, in percento: il motore la porta in 1..1000.
const SCALA_MINIMA = 1;
const SCALA_MASSIMA = 1000;
/// Il tratteggio di serie di VectorCraft: trattini di 12 pt (16 px della scena), adattati agli angoli.
const TRATTEGGIO_DI_SERIE: readonly number[] = [16];

/// Gli estremi, gli angoli e gli allineamenti, nell'ordine della scelta, col nome che mostra.
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
const ALLINEAMENTI: ReadonlyArray<readonly [string, DrawKey]> = [
  ["center", "draw.contorno.allineamento.centro"],
  ["inside", "draw.contorno.allineamento.dentro"],
  ["outside", "draw.contorno.allineamento.fuori"],
];

/// Le punte di VectorCraft nell'ordine del suo menu (`Arrowhead::ALL`), dopo «Nessuna».
export const PUNTE = [
  "Arrow",
  "ArrowOpen",
  "Barbed",
  "Concave",
  "DoubleArrow",
  "HalfArrowLeft",
  "HalfArrowRight",
  "Chevron",
  "Feather",
  "Swallowtail",
  "Triangle",
  "TriangleOpen",
  "TriangleReverse",
  "TriangleBar",
  "Kite",
  "Leaf",
  "Drop",
  "Circle",
  "CircleOpen",
  "HalfCircle",
  "Oval",
  "Target",
  "Square",
  "SquareOpen",
  "Tag",
  "TagOpen",
  "Diamond",
  "DiamondOpen",
  "Hexagon",
  "HexagonOpen",
  "Star",
  "Cross",
  "Plus",
  "Bar",
  "DoubleBar",
  "DotOnBar",
  "Slash",
  "DoubleSlash",
  "Bracket",
  "Fork",
] as const;
const VOCI_PUNTE: ReadonlyArray<readonly [string, DrawKey]> = [
  ["none", "draw.contorno.freccia.none"],
  ...PUNTE.map((nome) => [nome, `draw.contorno.freccia.${nome}` as DrawKey] as const),
];

/// Il tratteggio dell'ultimo contorno spento, per riaccenderlo com'era (come VectorCraft lo tiene per
/// la sessione); la scena, i trattini nelle sue unità.
let ultimoTratteggio: { readonly trattini: readonly number[]; readonly adattati: boolean } | null = null;
/// Il lucchetto delle due scale: chiuso, cambiarne una cambia anche l'altra. Vale per la sessione.
let scaleLegate = false;

/// Ciò che il motore dice del contorno degli oggetti scelti; `null` dove non sono d'accordo. Le
/// lunghezze sono nelle unità della scena.
export interface LetturaContorno {
  readonly spessore: number | null;
  readonly limite: number | null;
  readonly allineamento: string | null;
  /// Ogni oggetto prende il contorno dentro o fuori (è chiuso).
  readonly siAllinea: boolean;
  /// I trattini (vuoti per un contorno pieno).
  readonly trattini: readonly number[] | null;
  readonly adattati: boolean | null;
  /// La punta d'inizio e di fine: un nome di `PUNTE` o `"none"`.
  readonly inizio: string | null;
  readonly fine: string | null;
  /// La scala delle punte in percento, d'inizio e di fine.
  readonly scala: readonly [number | null, number | null];
  readonly allineaPunte: string | null;
  /// Almeno un oggetto ha una punta: la scala e l'allineamento valgono.
  readonly conPunta: boolean;
}

/// Il valore comune, o `null` se gli oggetti non sono d'accordo.
function comune<T>(valori: readonly T[], uguali: (a: T, b: T) => boolean = (a, b) => a === b): T | null {
  if (valori.length === 0) return null;
  const primo = valori[0]!;
  return valori.every((v) => uguali(v, primo)) ? primo : null;
}

const stesseLunghezze = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const testo = (v: unknown): string | null => (typeof v === "string" ? v : null);

/// Le letture del motore, unite: `null` se nessun oggetto scelto ha un contorno che il motore dice.
export function unisciLetture(nodi: readonly unknown[]): LetturaContorno | null {
  const tratti = nodi.flatMap((nodo) => {
    if (typeof nodo !== "object" || nodo === null) return [];
    const record = nodo as Record<string, unknown>;
    const opzioni = record.strokeOptions;
    if (typeof opzioni !== "object" || opzioni === null) return [];
    return [{ spessore: numero(record.strokeWidth), opzioni: opzioni as Record<string, unknown> }];
  });
  if (tratti.length === 0) return null;
  const tutti = <T>(leggi: (o: Record<string, unknown>) => T): T[] => tratti.map(({ opzioni }) => leggi(opzioni));
  const punta = (v: unknown): string => testo(v) ?? "none";
  const scale = tutti((o) => (Array.isArray(o.arrowScale) ? o.arrowScale : [100, 100]));
  const spessori = tratti.map(({ spessore }) => spessore);
  return {
    spessore: spessori.includes(null) ? null : comune(spessori),
    limite: comune(tutti((o) => numero(o.miterLimit) ?? LIMITE_DI_SERIE)),
    allineamento: comune(tutti((o) => testo(o.align) ?? "center")),
    siAllinea: tutti((o) => o.canAlign === true).every(Boolean),
    trattini: comune(
      tutti((o) => (Array.isArray(o.dash) ? o.dash.filter((v): v is number => typeof v === "number") : [])),
      stesseLunghezze,
    ),
    adattati: comune(tutti((o) => o.alignDashes === true)),
    inizio: comune(tutti((o) => punta(o.startArrow))),
    fine: comune(tutti((o) => punta(o.endArrow))),
    scala: [comune(scale.map((s) => numero(s[0]) ?? 100)), comune(scale.map((s) => numero(s[1]) ?? 100))],
    allineaPunte: comune(tutti((o) => (o.arrowAlign === "tip" ? "tip" : "extend"))),
    conPunta: tutti((o) => punta(o.startArrow) !== "none" || punta(o.endArrow) !== "none").some(Boolean),
  };
}

/// Sei campi trattino/spazio → i trattini, come `edited_dash_pattern` di VectorCraft: la serie si ferma
/// al primo trattino vuoto, uno spazio vuoto vale quanto il suo trattino, con tutti e sei pieni restano
/// i trattini di prima oltre il sesto, e tutto a zero è un contorno pieno.
export function trattiniDaiCampi(campi: readonly (number | null)[], prima: readonly number[]): number[] {
  const fuori: number[] = [];
  for (let coppia = 0; coppia < 3; coppia++) {
    const trattino = campi[coppia * 2] ?? null;
    if (trattino === null) break;
    const spazio = campi[coppia * 2 + 1] ?? trattino;
    fuori.push(Math.max(0, trattino), Math.max(0, spazio));
  }
  if (fuori.length === 6) fuori.push(...prima.slice(6));
  return fuori.every((v) => v === 0) ? [] : fuori;
}

/// Che cosa non va in un numero scritto.
function problemaDi(problema: string): string {
  if (problema === "mixed") return t("draw.properties.problem.mixed");
  return t(problema === "empty" ? "draw.properties.problem.empty" : "draw.properties.problem.syntax");
}

/// Una scelta con la sua etichetta: con `valore` `null` (la selezione non è d'accordo) la prima voce è
/// «Misto», che non si sceglie. `spente` sono le voci che non si possono scegliere.
function scelta(
  classe: string,
  etichetta: DrawKey,
  voci: ReadonlyArray<readonly [string, DrawKey]>,
  valore: string | null,
  cambia: (valore: string) => void,
  spente: ReadonlySet<string> = new Set(),
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
    voce.disabled = spente.has(chiave);
    select.append(voce);
  }
  select.value = valore ?? "";
  select.addEventListener("change", () => {
    if (select.value !== "" && select.value !== valore) cambia(select.value);
  });
  const radice = document.createElement("label");
  radice.className = "draw-properties-field draw-outline-field";
  radice.append(t(etichetta), select);
  return { radice, select };
}

/// Un bottone premuto o no, che manda `clic`.
function bottone(classe: string, etichetta: string, premuto: boolean | null, clic: () => void): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `draw-button draw-properties-segment ${classe}`;
  control.textContent = etichetta;
  if (premuto !== null) control.setAttribute("aria-pressed", String(premuto));
  control.addEventListener("click", () => {
    if (!control.disabled) clic();
  });
  return control;
}

/// Una riga di controlli col suo nome.
function riga(classe: string, etichetta: string, ...figli: HTMLElement[]): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `draw-properties-field ${classe}`;
  div.setAttribute("role", "group");
  div.setAttribute("aria-label", etichetta);
  const nome = document.createElement("span");
  nome.className = "draw-properties-label";
  nome.textContent = etichetta;
  div.append(nome, ...figli);
  return div;
}

/// Una nota della sezione.
function nota(testo: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "draw-properties-note draw-outline-note";
  p.textContent = testo;
  return p;
}

/// Il corpo della sezione con la lettura del motore, se c'è.
function disegnaCorpo(contesto: ContestoSezione, esegui: EseguiContorno, lettura: LetturaContorno | null): void {
  const corpo = contesto.corpo;
  const contorno: ContornoSelezione | undefined = contesto.misure?.contorno;
  const vuota = contesto.sel.numero === 0;
  const spenta = vuota || contorno === undefined || contorno.bloccato;
  // I controlli che vogliono il motore: spenti finché la sua lettura non c'è.
  const senzaMotore = spenta || lettura === null;
  const manda = (valori: ValoriContorno, id = "stroke.set"): void => {
    if (!spenta) esegui(id, valori, { senzaFinestra: true });
  };
  // Le lunghezze scritte sono nell'unità dello spessore; il motore lavora in quelle della scena.
  const allaScena = contorno?.spessore?.allaScena ?? ((v: number) => v);
  const perScena = allaScena(1) > 0 ? allaScena(1) : 1;
  const dallaScena = (v: number): number => v / perScena;
  const unita = contorno?.spessore?.unita ?? "px";
  const decimali = contorno?.spessore?.decimali ?? 2;

  // Lo spessore: quello del motore, se l'ha letto, sennò quello della vista.
  const spessoreAdesso = lettura === null ? (contorno?.spessore?.valore ?? null) : lettura.spessore === null ? null : dallaScena(lettura.spessore);
  const spessore = numberField({
    label: t("draw.contorno.spessore"),
    value: spessoreAdesso,
    unit: unita,
    places: decimali,
    min: 0,
    max: SPESSORE_MASSIMO,
    mixedText: contorno?.spessore === undefined ? "" : t("draw.properties.mixed"),
    problem: problemaDi,
    onCommit: (valore) => {
      // Lo stesso spessore che c'è già non è un cambio: niente comando, niente passo.
      if (spessoreAdesso === null || valore !== Number(spessoreAdesso.toFixed(decimali))) manda({ weight: allaScena(valore) });
      return undefined;
    },
    lifetime: contesto.vita,
  });

  const estremi = scelta("draw-outline-cap", "draw.contorno.estremi", ESTREMI, contorno === undefined ? "butt" : contorno.estremi, (cap) => manda({ cap }));
  const angoliAdesso = contorno === undefined ? "miter" : contorno.angoli;
  const angoli = scelta("draw-outline-join", "draw.contorno.angoli", ANGOLI, angoliAdesso, (join) => manda({ join }));

  // Il limite: solo con gli angoli vivi (o misti), come VectorCraft.
  const limiteAdesso = lettura === null ? LIMITE_DI_SERIE : lettura.limite;
  const limite = numberField({
    label: t("draw.contorno.limite"),
    value: limiteAdesso,
    unit: "×",
    places: 0,
    min: LIMITE_MINIMO,
    max: LIMITE_MASSIMO,
    mixedText: t("draw.properties.mixed"),
    problem: problemaDi,
    onCommit: (valore) => {
      if (valore !== limiteAdesso) manda({ miterLimit: valore });
      return undefined;
    },
    lifetime: contesto.vita,
  });

  // L'allineamento: dentro e fuori solo se ogni oggetto è chiuso.
  const siAllinea = lettura?.siAllinea ?? false;
  const allineamento = scelta(
    "draw-outline-align",
    "draw.contorno.allineamento",
    ALLINEAMENTI,
    lettura === null ? "center" : lettura.allineamento,
    (align) => manda({ align }),
    siAllinea ? new Set() : new Set(["inside", "outside"]),
  );

  // Il tratteggio: l'interruttore, esatto o adattato, poi tre coppie trattino/spazio.
  const trattiniScena: readonly number[] | null =
    lettura !== null ? lettura.trattini : contorno === undefined ? [] : contorno.trattini === null ? null : contorno.trattini.map(allaScena);
  const tratteggiato = trattiniScena !== null && trattiniScena.length > 0;
  const adattati = lettura === null ? null : lettura.adattati;
  // Ciò che i campi mostrano: i trattini, o col contorno pieno quelli che il tratteggio riprenderebbe.
  const ripresa = ultimoTratteggio ?? { trattini: TRATTEGGIO_DI_SERIE, adattati: true };
  const mostrati: readonly number[] = trattiniScena === null ? [] : tratteggiato ? trattiniScena : ripresa.trattini;
  const interruttore = document.createElement("input");
  interruttore.type = "checkbox";
  interruttore.className = "draw-outline-dashed";
  interruttore.checked = tratteggiato;
  interruttore.indeterminate = trattiniScena === null;
  const voceInterruttore = document.createElement("label");
  voceInterruttore.className = "draw-properties-switch draw-outline-field";
  voceInterruttore.append(interruttore, t("draw.contorno.tratteggio"));
  interruttore.addEventListener("change", () => {
    if (!interruttore.checked) {
      if (tratteggiato) ultimoTratteggio = { trattini: trattiniScena, adattati: adattati ?? false };
      manda({ dash: [] });
      return;
    }
    const campi = [0, 1, 2, 3, 4, 5].map((i) => mostrati[i] ?? null);
    const valori: Record<string, readonly number[] | boolean> = { dash: trattiniDaiCampi(campi, mostrati) };
    // L'adattamento lo manda solo il motore che lo sa scrivere: senza la sua lettura resta com'è.
    if (lettura !== null) valori.alignDashes = ripresa.adattati;
    manda(valori);
  });
  const esatti = bottone("draw-outline-dash-exact", t("draw.contorno.esatti"), tratteggiato && adattati === false, () => manda({ alignDashes: false }));
  const adatta = bottone("draw-outline-dash-fit", t("draw.contorno.adattati"), tratteggiato && adattati === true, () => manda({ alignDashes: true }));
  esatti.disabled = senzaMotore || !tratteggiato;
  adatta.disabled = senzaMotore || !tratteggiato;

  const campiTrattini: NumberField[] = [];
  const valoriCampi = [0, 1, 2, 3, 4, 5].map((i) => (trattiniScena === null ? null : (mostrati[i] ?? null)));
  for (let i = 0; i < 6; i++) {
    const coppia = Math.floor(i / 2) + 1;
    const valore = valoriCampi[i] ?? null;
    campiTrattini.push(
      numberField({
        label: t(i % 2 === 0 ? "draw.contorno.trattinoN" : "draw.contorno.spazioN", { n: String(coppia) }),
        value: valore === null ? null : dallaScena(valore),
        unit: unita,
        places: decimali,
        min: 0,
        max: SPESSORE_MASSIMO,
        mixedText: trattiniScena === null ? t("draw.properties.mixed") : "",
        problem: problemaDi,
        onCommit: (v) => {
          const campi = valoriCampi.map((c, j) => (j === i ? allaScena(v) : c));
          manda({ dash: trattiniDaiCampi(campi, trattiniScena ?? []) });
          return undefined;
        },
        onClear: () => {
          const campi = valoriCampi.map((c, j) => (j === i ? null : c));
          manda({ dash: trattiniDaiCampi(campi, trattiniScena ?? []) });
          return undefined;
        },
        lifetime: contesto.vita,
      }),
    );
  }
  const lunghezze = document.createElement("div");
  lunghezze.className = "draw-outline-dashes";
  lunghezze.append(...campiTrattini.map((c) => c.element));

  // Le punte: inizio e fine, lo scambio, la scala col lucchetto e l'allineamento.
  const inizio = scelta("draw-outline-start-arrow", "draw.contorno.frecce.inizio", VOCI_PUNTE, lettura === null ? "none" : lettura.inizio, (a) =>
    manda({ startArrow: a }),
  );
  const fine = scelta("draw-outline-end-arrow", "draw.contorno.frecce.fine", VOCI_PUNTE, lettura === null ? "none" : lettura.fine, (a) => manda({ endArrow: a }));
  const scambia = bottone("draw-outline-arrow-swap", t("draw.contorno.frecce.scambia"), null, () => manda({ swapArrows: true }, "stroke.setAdvanced"));
  const conPunta = lettura?.conPunta ?? false;
  const scala = lettura?.scala ?? [100, 100];
  const campoScala = (chiave: DrawKey, lato: 0 | 1): NumberField =>
    numberField({
      label: t(chiave),
      value: scala[lato],
      unit: "%",
      places: 0,
      min: SCALA_MINIMA,
      max: SCALA_MASSIMA,
      mixedText: t("draw.properties.mixed"),
      problem: problemaDi,
      onCommit: (v) => {
        const altro = scala[lato === 0 ? 1 : 0];
        // Senza il lucchetto l'altra scala resta: se è mista, ognuno la tiene, e il comando vuole due
        // numeri; allora la si scrive uguale a questa.
        const restante = scaleLegate || altro === null ? v : altro;
        manda({ arrowScale: lato === 0 ? [v, restante] : [restante, v] }, "stroke.setAdvanced");
        return undefined;
      },
      lifetime: contesto.vita,
    });
  const scalaInizio = campoScala("draw.contorno.frecce.scalaInizio", 0);
  const scalaFine = campoScala("draw.contorno.frecce.scalaFine", 1);
  const lucchetto = bottone("draw-outline-arrow-link", t("draw.contorno.frecce.lega"), scaleLegate, () => {
    scaleLegate = !scaleLegate;
    lucchetto.setAttribute("aria-pressed", String(scaleLegate));
  });
  const allineaPunte = [
    bottone("draw-outline-arrow-extend", t("draw.contorno.frecce.oltre"), lettura?.allineaPunte === "extend", () => manda({ arrowAlign: "extend" })),
    bottone("draw-outline-arrow-tip", t("draw.contorno.frecce.sulCapo"), lettura?.allineaPunte === "tip", () => manda({ arrowAlign: "tip" })),
  ];

  // Perché la sezione è spenta, se lo è.
  const perche = vuota ? t("draw.contorno.vuota") : contorno === undefined ? t("draw.contorno.nessuno") : contorno.bloccato ? t("draw.contorno.bloccato") : null;

  if (perche !== null) corpo.append(nota(perche));
  corpo.append(
    spessore.element,
    estremi.radice,
    angoli.radice,
    limite.element,
    allineamento.radice,
    voceInterruttore,
    riga("draw-outline-dash-align", t("draw.contorno.adattamento"), esatti, adatta),
    lunghezze,
    inizio.radice,
    fine.radice,
    scambia,
    riga("draw-outline-arrow-scale", t("draw.contorno.frecce.scala"), scalaInizio.element, scalaFine.element, lucchetto),
    riga("draw-outline-arrow-align", t("draw.contorno.frecce.allineamento"), ...allineaPunte),
  );

  spessore.setDisabled(spenta);
  estremi.select.disabled = spenta;
  angoli.select.disabled = spenta;
  limite.setDisabled(senzaMotore || angoliAdesso === "round" || angoliAdesso === "bevel");
  allineamento.select.disabled = senzaMotore;
  interruttore.disabled = spenta;
  for (const campo of campiTrattini) campo.setDisabled(spenta || !tratteggiato);
  inizio.select.disabled = senzaMotore;
  fine.select.disabled = senzaMotore;
  scambia.disabled = senzaMotore;
  scalaInizio.setDisabled(senzaMotore || !conPunta);
  scalaFine.setDisabled(senzaMotore || !conPunta);
  lucchetto.disabled = senzaMotore;
  for (const b of allineaPunte) b.disabled = senzaMotore || !conPunta;
}

/// La sezione nel corpo di `contesto`: subito con la vista, poi con la lettura del motore.
function disegnaContorno(contesto: ContestoSezione, azioni: AzioniContorno): () => void {
  const { corpo, vita } = contesto;
  disegnaCorpo(contesto, azioni.esegui, null);
  const contorno = contesto.misure?.contorno;
  const spenta = contesto.sel.numero === 0 || contorno === undefined || contorno.bloccato;
  if (!spenta && azioni.leggi !== undefined && contesto.motore !== null) {
    void azioni.leggi().then(
      (nodi) => {
        const lettura = unisciLetture(nodi);
        // Una risposta di un giro passato si butta.
        if (vita.closed || lettura === null) return;
        const rifai = (): void => {
          corpo.replaceChildren();
          disegnaCorpo(contesto, azioni.esegui, lettura);
        };
        if (!corpo.contains(document.activeElement)) {
          rifai();
          return;
        }
        // Chi sta scrivendo in un campo non lo perde: la sezione si rifà quando il fuoco esce.
        vita.listen(corpo, "focusout", (evento) => {
          const verso = (evento as FocusEvent).relatedTarget;
          if (!vita.closed && !(verso instanceof Node && corpo.contains(verso)) && corpo.isConnected) rifai();
        });
      },
      () => undefined,
    );
  }
  return () => corpo.replaceChildren();
}

/// La sezione «Contorno» per la scheda Design, da registrare nel Completo aperto.
export function sezioneContorno(azioni: AzioniContorno | EseguiContorno): Sezione {
  const tutte: AzioniContorno = typeof azioni === "function" ? { esegui: azioni } : azioni;
  return {
    id: "contorno",
    scheda: "design",
    titolo: t("draw.contorno.titolo"),
    disegna: (contesto) => disegnaContorno(contesto, tutte),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraContorno(sezioni: Sezioni, azioni: AzioniContorno | EseguiContorno): boolean {
  return registraSezione({ sezioni }, sezioneContorno(azioni));
}
