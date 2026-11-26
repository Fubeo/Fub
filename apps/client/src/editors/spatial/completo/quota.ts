// La Quota del Disegno completo: le opzioni di una quota, la finestra che le cambia, la fila dello
// strumento e la sezione del Design, come VectorCraft (lo strumento
// `vendor/vectorcraft/crates/tools/src/dimension.rs`, le opzioni `doc/src/dimension.rs`, i comandi
// `dimension.create`, `dimension.update` e `dimension.applyToAll`).
//
// - **Le opzioni.** Ventidue chiavi, sempre tutte: il motore prende le opzioni intere (quelle che
//   mancano tornano di serie, e una chiave che non conosce è un errore). La finestra parte da quelle
//   che ha e le manda intere; i colori sono terne `[r, g, b]`, e la finestra li mostra come `#rrggbb`.
// - **La fila dello strumento.** Il tipo (Lineare, Angolare, Radiale: l'opzione `mode`) e «Opzioni
//   quota…», che apre la finestra con lo stile delle quote nuove (l'opzione `style`).
// - **La sezione del Design.** C'è solo quando ogni oggetto scelto è una quota (la lettura di
//   `document.node` ha il record `dimension`): la distanza della linea dall'oggetto misurato,
//   «Opzioni quota…» con lo stile della prima quota scelta (OK lo manda a tutte, `dimension.update`)
//   e «Applica a tutti», che copia lo stile della prima su ogni quota del disegno. Ogni cambio è un
//   passo della cronologia.
//
// La finestra non manda niente di sbagliato: un numero fuori dai limiti del motore resta nel campo
// con la sua frase, e una scala che non è «disegno:reale» spegne OK.

import { openDialog } from "../../../kit/dialog";
import { colorWell } from "../../../kit/color/well";
import { formBody, formCheck, formChoice, formNote, formNumber, formRow, formText } from "../../../kit/form";
import { createGroupLabel } from "../../../kit/group-label";
import { numberField } from "../../../kit/number-field";
import type { DrawingToolState } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { drawPickerText } from "../tools/color-text";
import { t, type DrawKey } from "../strings";
import { problemaDelNumero, type AzioniFila, type FilaOpzioni } from "./opzioni";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// Lo strumento Quota (l'id del motore).
export const STRUMENTO_QUOTA = "dimension";
/// L'id della sezione del Design.
export const SEZIONE_QUOTA = "dimension";

export const UNITA = ["in", "mm", "pt", "pc", "px", "cm", "m", "ft", "yd"] as const;
export const TRATTI = ["solid", "dashed", "dotted"] as const;
export const FRECCE = ["filled", "open", "tick", "none"] as const;
export const POSIZIONI = ["away", "between"] as const;
export const ALLINEAMENTI = ["left", "center", "right"] as const;
export const TIPI = ["linear", "angular", "radial"] as const;

export type Rgb = readonly [number, number, number];
export type Tipo = (typeof TIPI)[number];

/// Le opzioni di una quota, con le chiavi del motore.
export interface OpzioniQuota {
  readonly units: (typeof UNITA)[number];
  readonly precision: number;
  readonly scale: string;
  readonly hideUnits: boolean;
  readonly lineWeight: number;
  readonly lineType: (typeof TRATTI)[number];
  readonly lineColor: Rgb;
  readonly arrowStyle: (typeof FRECCE)[number];
  readonly arrowScale: number;
  readonly extensionWeight: number;
  readonly extensionType: (typeof TRATTI)[number];
  readonly extensionColor: Rgb;
  readonly extensionOffset: number;
  readonly extensionLength: number;
  readonly hideExtensions: boolean;
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontSize: number;
  readonly textColor: Rgb;
  readonly textPosition: (typeof POSIZIONI)[number];
  readonly textAlignment: (typeof ALLINEAMENTI)[number];
  readonly textOffset: number;
}

/// I valori di serie di VectorCraft (`DimensionOptions::default`).
export const QUOTA_DI_SERIE: OpzioniQuota = {
  units: "pt",
  precision: 2,
  scale: "1:1",
  hideUnits: false,
  lineWeight: 0.5,
  lineType: "solid",
  lineColor: [0, 0, 0],
  arrowStyle: "filled",
  arrowScale: 100,
  extensionWeight: 0.5,
  extensionType: "solid",
  extensionColor: [0, 0, 0],
  extensionOffset: 4,
  extensionLength: 6,
  hideExtensions: false,
  fontFamily: "Source Sans 3",
  fontStyle: "Regular",
  fontSize: 12,
  textColor: [0, 0, 0],
  textPosition: "away",
  textAlignment: "center",
  textOffset: 4,
};

/// I limiti dei numeri, quelli di `DimensionOptions::validate`.
export const LIMITI = {
  precision: [0, 6],
  lineWeight: [0.1, 100],
  extensionWeight: [0.1, 100],
  arrowScale: [1, 1000],
  fontSize: [1, 1000],
  extensionOffset: [0, 10000],
  extensionLength: [0, 10000],
  textOffset: [0, 10000],
} as const satisfies Partial<Record<keyof OpzioniQuota, readonly [number, number]>>;

type ChiaveNumero = keyof typeof LIMITI;

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function fra<T extends string>(valori: readonly T[], valore: unknown, serie: T): T {
  return typeof valore === "string" && (valori as readonly string[]).includes(valore) ? (valore as T) : serie;
}

function rgb(valore: unknown, serie: Rgb): Rgb {
  if (!Array.isArray(valore) || valore.length !== 3) return serie;
  const [r, g, b] = valore as unknown[];
  const ok = (c: unknown): c is number => typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 255;
  return ok(r) && ok(g) && ok(b) ? [r, g, b] : serie;
}

/// Le opzioni da un valore del motore: ogni chiave che manca, o che non è come il motore la scrive,
/// prende il valore di serie.
export function opzioniQuota(valore: unknown): OpzioniQuota {
  const o = isRecord(valore) ? valore : {};
  const numero = (chiave: ChiaveNumero): number => {
    const v = o[chiave];
    const [min, max] = LIMITI[chiave];
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : QUOTA_DI_SERIE[chiave];
  };
  const testo = (chiave: "scale" | "fontFamily" | "fontStyle"): string => {
    const v = o[chiave];
    return typeof v === "string" && (chiave === "fontStyle" || v !== "") ? v : QUOTA_DI_SERIE[chiave];
  };
  const si = (chiave: "hideUnits" | "hideExtensions"): boolean => (typeof o[chiave] === "boolean" ? (o[chiave] as boolean) : QUOTA_DI_SERIE[chiave]);
  return {
    units: fra(UNITA, o["units"], QUOTA_DI_SERIE.units),
    precision: Math.round(numero("precision")),
    scale: testo("scale"),
    hideUnits: si("hideUnits"),
    lineWeight: numero("lineWeight"),
    lineType: fra(TRATTI, o["lineType"], QUOTA_DI_SERIE.lineType),
    lineColor: rgb(o["lineColor"], QUOTA_DI_SERIE.lineColor),
    arrowStyle: fra(FRECCE, o["arrowStyle"], QUOTA_DI_SERIE.arrowStyle),
    arrowScale: numero("arrowScale"),
    extensionWeight: numero("extensionWeight"),
    extensionType: fra(TRATTI, o["extensionType"], QUOTA_DI_SERIE.extensionType),
    extensionColor: rgb(o["extensionColor"], QUOTA_DI_SERIE.extensionColor),
    extensionOffset: numero("extensionOffset"),
    extensionLength: numero("extensionLength"),
    hideExtensions: si("hideExtensions"),
    fontFamily: testo("fontFamily"),
    fontStyle: testo("fontStyle"),
    fontSize: numero("fontSize"),
    textColor: rgb(o["textColor"], QUOTA_DI_SERIE.textColor),
    textPosition: fra(POSIZIONI, o["textPosition"], QUOTA_DI_SERIE.textPosition),
    textAlignment: fra(ALLINEAMENTI, o["textAlignment"], QUOTA_DI_SERIE.textAlignment),
    textOffset: numero("textOffset"),
  };
}

/// Vero se `scala` è «disegno:reale» come la vuole il motore (`DimensionOptions::factor`): due numeri
/// positivi fino a un miliardo, con un rapporto fra un milionesimo e un milione.
export function scalaValida(scala: string): boolean {
  const parti = scala.split(":");
  if (parti.length !== 2) return false;
  const leggi = (s: string): number | null => {
    const testo = s.trim();
    if (!/^[+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(testo)) return null;
    const n = Number(testo);
    return Number.isFinite(n) && n > 0 && n <= 1e9 ? n : null;
  };
  const a = leggi(parti[0]!);
  const b = leggi(parti[1]!);
  if (a === null || b === null) return false;
  const f = b / a;
  return f >= 1e-6 && f <= 1e6;
}

export function esadecimale(c: Rgb): string {
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function daEsadecimale(testo: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(testo.trim());
  if (m === null) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/// Vero se la lettura di `document.node` è una quota.
export function eQuota(nodo: unknown): boolean {
  return isRecord(nodo) && isRecord(nodo["dimension"]);
}

/// Le quote scelte: le opzioni della prima (la finestra parte da lì) e la distanza in comune
/// (`null` se differisce).
export interface StatoQuote {
  readonly ids: readonly string[];
  readonly opzioni: OpzioniQuota;
  readonly distanza: number | null;
}

/// Lo stato dai nodi letti: `null` se non c'è un oggetto scelto o se uno non è una quota.
export function statoDelleQuote(ids: readonly string[], nodi: readonly unknown[]): StatoQuote | null {
  if (ids.length === 0 || nodi.length !== ids.length || !nodi.every(eQuota)) return null;
  const record = (nodo: unknown): Readonly<Record<string, unknown>> => (nodo as Readonly<Record<string, Readonly<Record<string, unknown>>>>)["dimension"]!;
  const distanze = nodi.map((n) => {
    const v = record(n)["offset"];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  const distanza = distanze.every((d) => d === distanze[0]) ? distanze[0]! : null;
  return { ids, opzioni: opzioniQuota(record(nodi[0])["options"]), distanza };
}

// ── La finestra ───────────────────────────────────────────────────────────────────────────────

function tendina<T extends string>(etichetta: string, valori: readonly T[], attuale: T, nome: (v: T) => string, cambia: (v: T) => void, vita: Lifetime): HTMLElement {
  const riga = document.createElement("label");
  riga.className = "kit-form-row draw-dimension-field";
  const parola = document.createElement("span");
  parola.className = "kit-form-label";
  parola.textContent = etichetta;
  const select = document.createElement("select");
  select.className = "draw-properties-input";
  for (const valore of valori) {
    const voce = document.createElement("option");
    voce.value = valore;
    voce.textContent = nome(valore);
    select.append(voce);
  }
  select.value = attuale;
  vita.listen(select, "change", () => cambia(select.value as T));
  riga.append(parola, select);
  return riga;
}

function gruppo(titolo: string, righe: readonly HTMLElement[]): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute("role", "group");
  box.append(...righe);
  const etichetta = createGroupLabel({ text: titolo, labels: box });
  const fuori = document.createElement("div");
  fuori.append(etichetta, box);
  return fuori;
}

/// Il corpo della finestra: ogni opzione col suo controllo. `cambia` riceve le opzioni intere dopo
/// ogni cambio; `valido` dice se OK si può premere (nessun campo in errore, la scala giusta).
export function corpoOpzioniQuota(iniziali: OpzioniQuota, cambia: (opzioni: OpzioniQuota) => void, valido: (ok: boolean) => void, vita: Lifetime): HTMLElement {
  let opzioni = iniziali;
  const errori = new Set<string>();
  const metti = <K extends keyof OpzioniQuota>(chiave: K, valore: OpzioniQuota[K]): void => {
    opzioni = { ...opzioni, [chiave]: valore };
    cambia(opzioni);
  };
  const segna = (chiave: string, ok: boolean): void => {
    if (ok) errori.delete(chiave);
    else errori.add(chiave);
    valido(errori.size === 0);
  };
  const numero = (chiave: ChiaveNumero, etichetta: DrawKey, unita: string | undefined, decimali: number): HTMLElement => {
    const [min, max] = LIMITI[chiave];
    return formNumber({
      label: t(etichetta),
      value: opzioni[chiave],
      ...(unita === undefined ? {} : { unit: unita }),
      min,
      max,
      places: decimali,
      outOfRange: (a, b) => t("draw.quota.fuori", { min: String(a ?? ""), max: String(b ?? "") }),
      problem: problemaDelNumero,
      onChange: (v) => metti(chiave, v),
      onValidity: (ok) => segna(chiave, ok),
      lifetime: vita,
    }).element;
  };
  const colore = (chiave: "lineColor" | "extensionColor" | "textColor"): HTMLElement => {
    const pozzo = colorWell({
      label: t("draw.quota.colore"),
      mixedText: t("draw.chrome.mixed"),
      text: drawPickerText(),
      value: esadecimale(opzioni[chiave]),
      now: () => ({ free: true }),
      onChange: (testo) => {
        const c = daEsadecimale(testo);
        if (c !== null) metti(chiave, c);
      },
      lifetime: vita,
    });
    const riga = document.createElement("div");
    riga.className = "kit-form-row draw-dimension-field";
    const parola = document.createElement("span");
    parola.className = "kit-form-label";
    parola.textContent = t("draw.quota.colore");
    riga.append(parola, pozzo.element);
    return riga;
  };
  const tratto = (chiave: "lineType" | "extensionType"): HTMLElement =>
    tendina(t("draw.quota.tipoLinea"), TRATTI, opzioni[chiave], (v) => t(`draw.quota.tratto.${v}` as DrawKey), (v) => metti(chiave, v), vita);

  const scala = formText({
    label: t("draw.quota.scala"),
    value: opzioni.scale,
    placeholder: "1:1",
    blank: t("draw.quota.scala.errore"),
    onChange: (testo) => {
      const ok = scalaValida(testo);
      scala.setError(ok ? null : t("draw.quota.scala.errore"));
      segna("scale", ok);
      if (ok) metti("scale", testo.trim());
    },
    lifetime: vita,
  });
  const famiglia = formText({
    label: t("draw.quota.famigliaFont"),
    value: opzioni.fontFamily,
    blank: t("draw.quota.fontVuoto"),
    onChange: (testo) => {
      const ok = testo.trim() !== "" && testo.length <= 256;
      famiglia.setError(ok ? null : t("draw.quota.fontVuoto"));
      segna("fontFamily", ok);
      if (ok) metti("fontFamily", testo.trim());
    },
    lifetime: vita,
  });
  const stile = formText({
    label: t("draw.quota.stileFont"),
    value: opzioni.fontStyle,
    blank: "",
    onChange: (testo) => {
      const ok = testo.length <= 128;
      segna("fontStyle", ok);
      if (ok) metti("fontStyle", testo.trim());
    },
    lifetime: vita,
  });

  return formBody([
    gruppo(t("draw.quota.visualizzazione"), [
      tendina(t("draw.quota.unita"), UNITA, opzioni.units, (v) => v, (v) => metti("units", v), vita),
      formRow(numero("precision", "draw.quota.precisione", undefined, 0)),
      scala.element,
      formNote(t("draw.quota.scala.nota")),
      formCheck({ label: t("draw.quota.nascondiUnita"), checked: opzioni.hideUnits, onChange: (v) => metti("hideUnits", v), lifetime: vita }).element,
    ]),
    gruppo(t("draw.quota.linea"), [
      formRow(numero("lineWeight", "draw.quota.spessore", "pt", 2)),
      tratto("lineType"),
      colore("lineColor"),
      tendina(t("draw.quota.frecce"), FRECCE, opzioni.arrowStyle, (v) => t(`draw.quota.freccia.${v}` as DrawKey), (v) => metti("arrowStyle", v), vita),
      formRow(numero("arrowScale", "draw.quota.scalaFrecce", "%", 0)),
    ]),
    gruppo(t("draw.quota.estensione"), [
      formRow(numero("extensionWeight", "draw.quota.spessore", "pt", 2)),
      tratto("extensionType"),
      colore("extensionColor"),
      formRow(numero("extensionOffset", "draw.quota.spostamento", "pt", 2), numero("extensionLength", "draw.quota.lunghezza", "pt", 2)),
      formCheck({ label: t("draw.quota.nascondiEstensioni"), checked: opzioni.hideExtensions, onChange: (v) => metti("hideExtensions", v), lifetime: vita }).element,
    ]),
    gruppo(t("draw.quota.testo"), [
      famiglia.element,
      stile.element,
      formRow(numero("fontSize", "draw.quota.dimensione", "pt", 2)),
      colore("textColor"),
      formChoice({
        label: t("draw.quota.posizione"),
        choices: POSIZIONI.map((v) => ({ value: v, label: t(`draw.quota.posizione.${v}` as DrawKey) })),
        value: opzioni.textPosition,
        onChange: (v) => metti("textPosition", v as OpzioniQuota["textPosition"]),
        lifetime: vita,
      }).element,
      formChoice({
        label: t("draw.quota.allineamento"),
        choices: ALLINEAMENTI.map((v) => ({ value: v, label: t(`draw.quota.allineamento.${v}` as DrawKey) })),
        value: opzioni.textAlignment,
        onChange: (v) => metti("textAlignment", v as OpzioniQuota["textAlignment"]),
        lifetime: vita,
      }).element,
      formRow(numero("textOffset", "draw.quota.spostamento", "pt", 2)),
    ]),
  ]);
}

/// Apre la finestra con `iniziali`: rende le opzioni di OK, o `null` con Annulla o Esc. `vita` la
/// chiude (con `null`) quando chi l'ha aperta se ne va.
export function apriOpzioniQuota(titolo: string, iniziali: OpzioniQuota, vita: Lifetime): Promise<OpzioniQuota | null> {
  const finestra = openLifetime();
  vita.add(() => finestra.close());
  let opzioni = iniziali;
  let ok = true;
  const corpo = corpoOpzioniQuota(
    iniziali,
    (nuove) => {
      opzioni = nuove;
    },
    (valido) => {
      ok = valido;
      const pulsante = dialogo.element.querySelector<HTMLButtonElement>('[data-action="ok"]');
      if (pulsante !== null) pulsante.disabled = !valido;
    },
    finestra,
  );
  const dialogo = openDialog<"ok" | "annulla">({
    title: titolo,
    body: corpo,
    actions: [
      { id: "cancel", label: t("draw.quota.annulla"), value: "annulla" },
      { id: "ok", label: t("draw.quota.ok"), kind: "primary", value: "ok" },
    ],
    dismissValue: "annulla",
    lifetime: finestra,
    className: "draw-dimension-dialog",
    submit: "ok",
    confirm: (azione) => azione === "annulla" || ok,
  });
  return dialogo.result.then((azione) => {
    finestra.close();
    return azione === "ok" && ok ? opzioni : null;
  });
}

// ── La fila dello strumento ───────────────────────────────────────────────────────────────────

/// Il tipo e lo stile dello strumento dalle sue opzioni (`{mode, style}`).
export function opzioniDelloStrumento(opzioni: unknown): { readonly tipo: Tipo; readonly stile: OpzioniQuota } {
  const o = isRecord(opzioni) ? opzioni : {};
  const modo = o["mode"];
  // `radius` e `diameter` sono il tipo radiale, come in `Kind::parse`.
  const tipo: Tipo = modo === "radius" || modo === "diameter" ? "radial" : fra(TIPI, modo, "linear");
  return { tipo, stile: opzioniQuota(o["style"]) };
}

export function filaQuota(stato: DrawingToolState | null, azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const element = document.createElement("div");
  element.className = "draw-options-row";
  const tipoBox = document.createElement("div");
  tipoBox.className = "draw-group kit-bar-group";
  tipoBox.setAttribute("role", "group");
  tipoBox.setAttribute("aria-label", t("draw.quota.tipo"));
  const opzioniBox = document.createElement("div");
  opzioniBox.className = "draw-group kit-bar-group";
  element.append(tipoBox, opzioniBox);

  let mostrato = opzioniDelloStrumento(stato?.options ?? null);
  const disegnaTipo = (): void => {
    const scelta = formChoice({
      label: t("draw.quota.tipo"),
      choices: TIPI.map((v) => ({ value: v, label: t(`draw.quota.tipo.${v}` as DrawKey) })),
      value: mostrato.tipo,
      onChange: (v) => {
        mostrato = { ...mostrato, tipo: v as Tipo };
        azioni.opzione("mode", v);
      },
      lifetime: vita,
    });
    tipoBox.replaceChildren(scelta.element);
  };
  const apri = document.createElement("button");
  apri.type = "button";
  apri.className = "draw-button";
  apri.dataset.action = "dimension-options";
  apri.textContent = t("draw.quota.opzioniQuota");
  vita.listen(apri, "click", () => {
    void apriOpzioniQuota(t("draw.quota.opzioni"), mostrato.stile, vita).then((nuove) => {
      if (nuove === null || vita.closed) return;
      mostrato = { ...mostrato, stile: nuove };
      azioni.opzione("style", nuove);
    });
  });
  opzioniBox.append(apri);
  disegnaTipo();

  return {
    element,
    voci: [
      { element: tipoBox, priorita: 2 },
      { element: opzioniBox, priorita: 1 },
    ],
    aggiorna(opzioni) {
      if (vita.closed) return false;
      const letto = opzioniDelloStrumento(opzioni);
      const tipoCambiato = letto.tipo !== mostrato.tipo;
      mostrato = letto;
      if (tipoCambiato) disegnaTipo();
      return true;
    },
  };
}

// ── La sezione del Design ─────────────────────────────────────────────────────────────────────

/// Ciò che la sezione usa del Completo.
export interface AzioniQuota {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori: Readonly<Record<string, unknown>>) => Promise<void>;
  /// Gli oggetti scelti e, per ciascuno, la lettura di `document.node` (`null` se il primo non è
  /// una quota).
  readonly leggi: () => Promise<{ readonly ids: readonly string[]; readonly nodi: readonly unknown[] } | null>;
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

function pulsante(testo: string, azione: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "draw-button";
  b.dataset.action = azione;
  b.textContent = testo;
  return b;
}

function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniQuota, stato: StatoQuote): void {
  const { corpo, vita } = contesto;
  const ids = [...stato.ids];
  const distanza = numberField({
    label: t("draw.quota.distanza"),
    labelHidden: true,
    value: stato.distanza,
    unit: "pt",
    places: 2,
    min: -10000,
    max: 10000,
    mixedText: "",
    problem: problemaDelNumero,
    onCommit: (valore) => {
      if (valore !== stato.distanza) void azioni.esegui("dimension.update", { ids, offset: valore });
    },
    lifetime: vita,
  });
  const opzioni = pulsante(t("draw.quota.opzioniQuota"), "dimension-options");
  vita.listen(opzioni, "click", () => {
    void apriOpzioniQuota(t("draw.quota.aggiorna"), stato.opzioni, vita).then((nuove) => {
      if (nuove !== null && !vita.closed) void azioni.esegui("dimension.update", { ids, options: nuove });
    });
  });
  const tutti = pulsante(t("draw.quota.applicaATutti"), "dimension-apply-to-all");
  vita.listen(tutti, "click", () => void azioni.esegui("dimension.applyToAll", { id: ids[0] }));
  const fila = document.createElement("div");
  fila.className = "draw-properties-field";
  fila.dataset.column = "all";
  fila.append(opzioni, tutti);
  corpo.replaceChildren(campo(t("draw.quota.distanza"), distanza.element), fila);
}

function disegna(contesto: ContestoSezione, azioni: AzioniQuota): () => void {
  const { corpo, vita } = contesto;
  if (contesto.motore === null) {
    contesto.mostra?.(false);
    return () => corpo.replaceChildren();
  }
  void azioni.leggi().then(
    (letto) => {
      if (vita.closed) return;
      const stato = letto === null ? null : statoDelleQuote(letto.ids, letto.nodi);
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

/// La sezione «Quota» per la scheda Design.
export function sezioneQuota(azioni: AzioniQuota): Sezione {
  return {
    id: SEZIONE_QUOTA,
    scheda: "design",
    titolo: t("draw.quota.titolo"),
    quando: (sel) => sel.numero > 0,
    nascostaAllInizio: true,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraQuota(sezioni: Sezioni, azioni: AzioniQuota): boolean {
  return registraSezione({ sezioni }, sezioneQuota(azioni));
}
