// La sezione «Trasforma» dell'ispettore Design del Completo, come il pannello Transform di
// VectorCraft (`panels/transform.rs`):
// - il punto di riferimento (nove posti, di serie il centro), condiviso dal Completo aperto: X e Y
//   sono quel punto del riquadro sulla pagina, e la rotazione, l'inclinazione e i riflessi girano
//   attorno a lui;
// - X, Y, larghezza e altezza mandano `object.setBounds` con `reference`; larghezza e altezza
//   tengono le proporzioni col lucchetto (la preferenza `constrainProportions`) o con Ctrl+Invio;
// - la rotazione è l'angolo del riquadro (in senso antiorario, come il motore): un valore nuovo
//   gira la selezione a quell'angolo (`object.rotate` assoluto); l'inclinazione resta a 0 e un
//   valore inclina di tanto (`object.shear`, sotto i 90°); ognuna ha i suoi angoli pronti;
// - Alt+Invio applica a una copia (`copy`);
// - Rifletti in orizzontale e in verticale (`object.reflect`), Reimposta riquadro;
// - le caselle Scala angoli e Scala tratti ed effetti (`scaleCorners`, `scaleStrokes`).
// Il riquadro lo dà il motore (`document.inspect`, la sua `transformBox` nella scena, ruotata con
// gli oggetti ruotati, senza il contorno se «Usa i contorni di anteprima» è spento): finché la
// lettura non arriva, o senza motore, i campi mostrano le misure della vista. I valori sono
// nell'unità del pannello e vanno alla scena prima del comando; il motore li porta al documento.

import { numberField, type NumberField } from "../../../kit/number-field";
import { formCheck } from "../../../kit/form";
import { referencePoint } from "../../../kit/reference-point";
import { t, type DrawKey } from "../strings";
import { nomiDelPerno } from "./oggetti-sul-tracciato-sezione";
import { registraSezione, type ContestoSezione, type MisuraSelezione, type MisureSelezione, type Sezione, type Sezioni } from "./sezioni";

/// Un valore che il comando riceve: un numero, un testo, un sì/no o un punto `[x, y]`.
export type ValoreTrasforma = string | number | boolean | readonly number[];

/// Il comando del motore: l'id della voce, i suoi valori, e se va senza la sua finestra.
export type EseguiTrasforma = (id: string, valori: Readonly<Record<string, ValoreTrasforma>>, opzioni: { readonly senzaFinestra: boolean }) => void;

/// Il riquadro della selezione come lo dà il motore, nelle coordinate della scena: l'angolo in
/// gradi (in senso antiorario), i lati e i nove punti di riferimento, riga per riga.
export interface RiquadroTrasforma {
  readonly angolo: number;
  readonly larghezza: number;
  readonly altezza: number;
  readonly punti: readonly (readonly [number, number])[];
}

/// Le preferenze del motore che il pannello mostra e cambia.
export interface PreferenzeTrasforma {
  readonly proporzioni: boolean;
  readonly scalaAngoli: boolean;
  readonly scalaTratti: boolean;
}

/// Le preferenze di serie del motore, finché la lettura non arriva.
const PREFERENZE_DI_SERIE: PreferenzeTrasforma = { proporzioni: false, scalaAngoli: false, scalaTratti: false };

/// Il punto di riferimento condiviso dal Completo aperto (da 0 a 8, di serie il centro).
export interface RiferimentoTrasforma {
  indice: number;
}

/// Ciò che la sezione fa col motore: i comandi, e le letture del riquadro (`document.inspect`) e
/// delle preferenze (`prefs.get`), e il cambio di una preferenza (`prefs.set`).
export interface AzioniTrasforma {
  readonly esegui: EseguiTrasforma;
  /// La lettura di `document.inspect` sulla selezione; `null` se il motore non risponde.
  readonly leggi?: () => Promise<unknown>;
  /// La lettura di `prefs.get` senza chiave (`{prefs: {…}}`).
  readonly preferenze?: () => Promise<unknown>;
  /// Cambia una preferenza sì/no del motore.
  readonly imposta?: (chiave: string, valore: boolean) => void;
  /// Il punto di riferimento condiviso.
  readonly riferimento?: RiferimentoTrasforma;
}

/// Gli angoli pronti della rotazione e dell'inclinazione, come VectorCraft (`ANGLE_PRESETS`,
/// `SHEAR_PRESETS`): l'inclinazione si ferma prima dei ±90° che appiattiscono.
export const ANGOLI_PRONTI: readonly number[] = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
export const INCLINAZIONI_PRONTE: readonly number[] = [-60, -45, -30, -15, 0, 15, 30, 45, 60];

/// Le frasi dei problemi di lettura di un campo numerico (le stesse della finestra del motore).
const PROBLEMI: Readonly<Record<string, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
};

const numeroFinito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/// Il riquadro dalla lettura di `document.inspect` (`transformBox`); `null` se non c'è (niente
/// selezione) o non ha la forma attesa.
export function riquadroDa(lettura: unknown): RiquadroTrasforma | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const r = (lettura as { readonly transformBox?: unknown }).transformBox;
  if (typeof r !== "object" || r === null) return null;
  const { angle, width, height, points } = r as Record<string, unknown>;
  if (!numeroFinito(angle) || !numeroFinito(width) || !numeroFinito(height) || !Array.isArray(points) || points.length !== 9) return null;
  const punti: [number, number][] = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !numeroFinito(p[0]) || !numeroFinito(p[1])) return null;
    punti.push([p[0], p[1]]);
  }
  return { angolo: angle, larghezza: width, altezza: height, punti };
}

/// Le preferenze dalla lettura di `prefs.get` (`{prefs: {…}}`); quelle che mancano restano di serie.
export function preferenzeDa(lettura: unknown): PreferenzeTrasforma | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const prefs = (lettura as { readonly prefs?: unknown }).prefs;
  if (typeof prefs !== "object" || prefs === null) return null;
  const p = prefs as Record<string, unknown>;
  const si = (chiave: string, diSerie: boolean): boolean => (typeof p[chiave] === "boolean" ? (p[chiave] as boolean) : diSerie);
  return {
    proporzioni: si("constrainProportions", PREFERENZE_DI_SERIE.proporzioni),
    scalaAngoli: si("scaleCorners", PREFERENZE_DI_SERIE.scalaAngoli),
    scalaTratti: si("scaleStrokes", PREFERENZE_DI_SERIE.scalaTratti),
  };
}

/// Il passaggio fra l'unità del pannello e la scena per una misura: `allaScena` è lineare
/// (fattore e, per X e Y, l'origine), e `dallaScena` è il suo inverso.
interface Passaggio {
  readonly unita: string;
  readonly decimali: number;
  readonly allaScena: (valore: number) => number;
  readonly dallaScena: (valore: number) => number;
}

function passaggio(misura: MisuraSelezione | undefined, unita: string): Passaggio {
  if (misura === undefined) return { unita, decimali: 2, allaScena: (v) => v, dallaScena: (v) => v };
  const zero = misura.allaScena(0);
  const fattore = misura.allaScena(1) - zero;
  const valido = Number.isFinite(fattore) && fattore !== 0;
  return {
    unita: misura.unita,
    decimali: misura.decimali,
    allaScena: misura.allaScena,
    dallaScena: (v) => (valido ? (v - zero) / fattore : v),
  };
}

/// Lo stato di una sezione disegnata: il riquadro del motore (`undefined` finché non è letto) e
/// le preferenze.
interface Stato {
  readonly riquadro: RiquadroTrasforma | null | undefined;
  readonly preferenze: PreferenzeTrasforma;
}

/// I tasti che accompagnano l'Invio che conferma un campo: Ctrl (o Cmd) tiene le proporzioni,
/// Alt applica a una copia, come in VectorCraft.
interface Tasti {
  ctrl: boolean;
  alt: boolean;
}

function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniTrasforma, riferimento: RiferimentoTrasforma, stato: Stato): void {
  const { corpo, vita } = contesto;
  const misure: MisureSelezione = contesto.misure ?? {};
  const spenta = contesto.sel.numero === 0;
  const esegui = azioni.esegui;
  const riquadro = stato.riquadro ?? null;
  let preferenze = stato.preferenze;
  const tasti: Tasti = { ctrl: false, alt: false };
  const px = passaggio(misure.x, "px");
  const py = passaggio(misure.y, "px");
  const pw = passaggio(misure.larghezza, "px");
  const ph = passaggio(misure.altezza, "px");
  // Il punto di riferimento sulla scena, la `origin` di rotazione, inclinazione e riflessi.
  const origine = (): Readonly<Record<string, ValoreTrasforma>> => {
    const p = riquadro?.punti[riferimento.indice];
    return p === undefined ? {} : { origin: [p[0], p[1]] };
  };
  const copia = (): boolean => tasti.alt;

  const campo = (chiave: DrawKey, valore: number | null, p: Pick<Passaggio, "unita" | "decimali">, conferma: (valore: number) => void): NumberField => {
    const numero = numberField({
      label: t(chiave),
      value: valore,
      unit: p.unita,
      places: p.decimali,
      mixedText: "",
      problem: (problema) => (problema === "mixed" ? t("draw.properties.problem.mixed") : t(PROBLEMI[problema] ?? "draw.properties.problem.syntax", { units: p.unita })),
      onCommit: (scritto) => {
        conferma(scritto);
        tasti.ctrl = false;
        tasti.alt = false;
        return undefined;
      },
      lifetime: vita,
    });
    return numero;
  };

  // I valori mostrati: dal riquadro del motore, o dalle misure della vista finché non c'è.
  const daVista = (m: MisuraSelezione | undefined): number | null => m?.valore ?? null;
  const puntoScelto = riquadro?.punti[riferimento.indice];
  // La vista dà l'angolo in alto a sinistra di un riquadro diritto: il punto scelto sta a metà o
  // in fondo ai lati; con un riquadro girato la vista non basta e il campo aspetta il motore.
  const vistaDritta = (misure.rotazione?.valore ?? 0) === 0;
  const sulLato = (inizio: MisuraSelezione | undefined, lato: MisuraSelezione | undefined, passo: number): number | null => {
    const a = daVista(inizio);
    if (a === null || passo === 0) return a;
    const l = daVista(lato);
    return l === null || !vistaDritta ? null : a + (l * passo) / 2;
  };
  const valoreX =
    riquadro === null ? sulLato(misure.x, misure.larghezza, riferimento.indice % 3) : puntoScelto === undefined ? null : px.dallaScena(puntoScelto[0]);
  const valoreY =
    riquadro === null ? sulLato(misure.y, misure.altezza, Math.floor(riferimento.indice / 3)) : puntoScelto === undefined ? null : py.dallaScena(puntoScelto[1]);
  const valoreW = riquadro === null ? daVista(misure.larghezza) : pw.dallaScena(riquadro.larghezza) - pw.dallaScena(0);
  const valoreH = riquadro === null ? daVista(misure.altezza) : ph.dallaScena(riquadro.altezza) - ph.dallaScena(0);
  // La vista conta la rotazione in senso orario, il motore (e VectorCraft) in senso antiorario.
  const rotazioneVista = misure.rotazione?.valore ?? null;
  const angolo = riquadro !== null ? riquadro.angolo : rotazioneVista === null ? null : rotazioneVista === 0 ? 0 : -rotazioneVista;
  const lato = (p: Passaggio, v: number): number => p.allaScena(v) - p.allaScena(0);

  const x = campo("draw.trasforma.x", valoreX, px, (v) =>
    esegui("object.setBounds", { x: px.allaScena(v), reference: riferimento.indice, copy: copia() }, { senzaFinestra: true }),
  );
  const y = campo("draw.trasforma.y", valoreY, py, (v) =>
    esegui("object.setBounds", { y: py.allaScena(v), reference: riferimento.indice, copy: copia() }, { senzaFinestra: true }),
  );
  const w = campo("draw.trasforma.width", valoreW, pw, (v) =>
    esegui(
      "object.setBounds",
      { width: lato(pw, v), reference: riferimento.indice, proportional: preferenze.proporzioni || tasti.ctrl, copy: copia() },
      { senzaFinestra: true },
    ),
  );
  const h = campo("draw.trasforma.height", valoreH, ph, (v) =>
    esegui(
      "object.setBounds",
      { height: lato(ph, v), reference: riferimento.indice, proportional: preferenze.proporzioni || tasti.ctrl, copy: copia() },
      { senzaFinestra: true },
    ),
  );
  const ruota = (a: number): void => {
    if (angolo !== null && a === angolo) return;
    esegui("object.rotate", { angle: a, absolute: true, ...origine(), copy: copia() }, { senzaFinestra: true });
  };
  // L'inclinazione è relativa: il campo resta a 0 e un valore nuovo inclina di tanto.
  const inclina = (a: number): void => {
    if (a === 0 || Math.abs(a) >= 90) return;
    esegui("object.shear", { angle: a, axis: "horizontal", ...origine(), copy: copia() }, { senzaFinestra: true });
  };
  const rotazione = campo("draw.trasforma.rotation", angolo, { unita: "°", decimali: 2 }, ruota);
  const inclinazione = campo("draw.trasforma.skew", 0, { unita: "°", decimali: 2 }, inclina);
  const campi = [x, y, w, h, rotazione, inclinazione];

  // Il punto di riferimento: sceglierne un altro rifà i campi (X e Y sono quel punto).
  const locatore = referencePoint({
    label: t("draw.trasforma.riferimento"),
    pointLabels: nomiDelPerno(),
    value: riferimento.indice,
    onChange: (indice) => {
      riferimento.indice = indice;
      corpo.replaceChildren();
      disegnaCorpo(contesto, azioni, riferimento, { riquadro: stato.riquadro, preferenze });
      corpo.querySelector<HTMLElement>(".kit-reference-point [aria-checked='true']")?.focus();
    },
    lifetime: vita,
  });
  locatore.element.classList.add("draw-transform-reference");

  // Il lucchetto delle proporzioni: una preferenza del motore, che resta per i disegni dopo.
  const lucchetto = document.createElement("button");
  lucchetto.type = "button";
  lucchetto.className = "kit-button draw-transform-link";
  lucchetto.textContent = "🔗";
  lucchetto.title = t("draw.trasforma.proporzioni");
  lucchetto.setAttribute("aria-label", t("draw.trasforma.proporzioni"));
  lucchetto.setAttribute("aria-pressed", String(preferenze.proporzioni));
  lucchetto.disabled = azioni.imposta === undefined;
  vita.listen(lucchetto, "click", () => {
    if (azioni.imposta === undefined) return;
    preferenze = { ...preferenze, proporzioni: !preferenze.proporzioni };
    lucchetto.setAttribute("aria-pressed", String(preferenze.proporzioni));
    azioni.imposta("constrainProportions", preferenze.proporzioni);
  });

  const griglia = document.createElement("div");
  griglia.className = "draw-transform-grid";
  griglia.append(x.element, w.element, y.element, h.element);
  // Ctrl+Invio e Alt+Invio: i tasti si notano prima che il campo confermi.
  vita.listen(
    corpo,
    "keydown",
    (evento) => {
      const e = evento as KeyboardEvent;
      if (e.key !== "Enter") return;
      tasti.ctrl = e.ctrlKey || e.metaKey;
      tasti.alt = e.altKey;
    },
    { capture: true },
  );
  vita.listen(corpo, "focusout", () => {
    tasti.ctrl = false;
    tasti.alt = false;
  });
  const misureRiga = document.createElement("div");
  misureRiga.className = "draw-transform-size";
  misureRiga.append(locatore.element, griglia, lucchetto);

  // Gli angoli pronti: sceglierne uno è come scriverlo nel campo.
  const pronti = (chiave: DrawKey, valori: readonly number[], applica: (a: number) => void): HTMLSelectElement => {
    const scelta = document.createElement("select");
    scelta.className = "draw-properties-input draw-transform-presets";
    scelta.setAttribute("aria-label", t(chiave));
    scelta.title = t(chiave);
    const vuota = document.createElement("option");
    vuota.value = "";
    vuota.textContent = "▾";
    scelta.append(vuota);
    for (const v of valori) {
      const opzione = document.createElement("option");
      opzione.value = String(v);
      opzione.textContent = `${v}°`;
      scelta.append(opzione);
    }
    vita.listen(scelta, "change", () => {
      const v = Number(scelta.value);
      scelta.value = "";
      if (scelta.disabled || !Number.isFinite(v)) return;
      applica(v);
    });
    return scelta;
  };
  const prontiRotazione = pronti("draw.trasforma.pronti.rotazione", ANGOLI_PRONTI, ruota);
  const prontiInclinazione = pronti("draw.trasforma.pronti.inclinazione", INCLINAZIONI_PRONTE, inclina);
  const angoli = document.createElement("div");
  angoli.className = "draw-transform-angles";
  angoli.append(rotazione.element, prontiRotazione, inclinazione.element, prontiInclinazione);

  // I riflessi attorno al punto di riferimento: in orizzontale specchia sull'asse verticale.
  const bottone = (chiave: DrawKey, azione: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kit-button";
    b.textContent = t(chiave);
    vita.listen(b, "click", () => {
      if (!b.disabled) azione();
    });
    return b;
  };
  const orizzontale = bottone("draw.trasforma.rifletti.orizzontale", () =>
    esegui("object.reflect", { axis: "vertical", ...origine() }, { senzaFinestra: true }),
  );
  const verticale = bottone("draw.trasforma.rifletti.verticale", () =>
    esegui("object.reflect", { axis: "horizontal", ...origine() }, { senzaFinestra: true }),
  );
  const reimposta = bottone("draw.trasforma.reset", () => esegui("object.resetBoundingBox", {}, { senzaFinestra: true }));
  reimposta.classList.add("draw-transform-reset");
  const azioniRiga = document.createElement("div");
  azioniRiga.className = "draw-transform-actions";
  azioniRiga.append(orizzontale, verticale, reimposta);

  // Le opzioni: valgono anche senza selezione, per le trasformazioni che vengono.
  const opzioni = document.createElement("div");
  opzioni.className = "draw-transform-options";
  if (azioni.imposta !== undefined) {
    const imposta = azioni.imposta;
    opzioni.append(
      formCheck({
        label: t("draw.trasforma.scalaAngoli"),
        checked: preferenze.scalaAngoli,
        onChange: (si) => {
          preferenze = { ...preferenze, scalaAngoli: si };
          imposta("scaleCorners", si);
        },
        lifetime: vita,
      }).element,
      formCheck({
        label: t("draw.trasforma.scalaTratti"),
        checked: preferenze.scalaTratti,
        onChange: (si) => {
          preferenze = { ...preferenze, scalaTratti: si };
          imposta("scaleStrokes", si);
        },
        lifetime: vita,
      }).element,
    );
  }

  for (const numero of campi) numero.setDisabled(spenta);
  for (const elemento of [prontiRotazione, prontiInclinazione, orizzontale, verticale, reimposta]) elemento.disabled = spenta;
  corpo.append(misureRiga, angoli, azioniRiga);
  if (opzioni.childElementCount > 0) corpo.append(opzioni);
}

/// La sezione nel corpo di `contesto`: subito con le misure della vista, poi col riquadro e le
/// preferenze del motore. Chi sta scrivendo in un campo non lo perde: la sezione si rifà quando
/// il fuoco esce.
function disegnaTrasforma(contesto: ContestoSezione, azioni: AzioniTrasforma, riferimento: RiferimentoTrasforma): () => void {
  const { corpo, vita } = contesto;
  disegnaCorpo(contesto, azioni, riferimento, { riquadro: undefined, preferenze: PREFERENZE_DI_SERIE });
  if (contesto.motore !== null && (azioni.leggi !== undefined || azioni.preferenze !== undefined)) {
    const riquadro = contesto.sel.numero === 0 || azioni.leggi === undefined ? Promise.resolve(undefined) : azioni.leggi().then(riquadroDa, () => undefined);
    const preferenze = azioni.preferenze === undefined ? Promise.resolve(null) : azioni.preferenze().then(preferenzeDa, () => null);
    void Promise.all([riquadro, preferenze]).then(([r, p]) => {
      // Una risposta di un giro passato si butta.
      if (vita.closed || (r === undefined && p === null)) return;
      const rifai = (): void => {
        corpo.replaceChildren();
        disegnaCorpo(contesto, azioni, riferimento, { riquadro: r, preferenze: p ?? PREFERENZE_DI_SERIE });
      };
      if (!corpo.contains(document.activeElement)) {
        rifai();
        return;
      }
      vita.listen(corpo, "focusout", (evento) => {
        const verso = (evento as FocusEvent).relatedTarget;
        if (!vita.closed && !(verso instanceof Node && corpo.contains(verso)) && corpo.isConnected) rifai();
      });
    });
  }
  return () => corpo.replaceChildren();
}

/// La sezione «Trasforma» per la scheda Design, da registrare nel Completo aperto.
export function sezioneTrasforma(azioni: AzioniTrasforma | EseguiTrasforma): Sezione {
  const tutte: AzioniTrasforma = typeof azioni === "function" ? { esegui: azioni } : azioni;
  const riferimento = tutte.riferimento ?? { indice: 4 };
  return {
    id: "trasforma",
    scheda: "design",
    titolo: t("draw.trasforma.titolo"),
    disegna: (contesto) => disegnaTrasforma(contesto, tutte, riferimento),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraTrasforma(sezioni: Sezioni, azioni: AzioniTrasforma | EseguiTrasforma): boolean {
  return registraSezione({ sezioni }, sezioneTrasforma(azioni));
}
