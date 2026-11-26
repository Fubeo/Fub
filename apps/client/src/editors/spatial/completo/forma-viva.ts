// Le proprietà della forma viva nella sezione «Trasforma» e la finestra «Angoli…» (`ui.corners`),
// come VectorCraft (`panels/transform.rs::live_shape_rows`, `panels.rs::corner_radius_row`,
// `panels/properties.rs::corner_rows`, la finestra `corners`):
// - rettangolo: il raggio degli angoli, uno per tutti col collegamento acceso (la preferenza
//   `singleCornerRadius`, di serie accesa) o uno per angolo (0 in alto a sinistra, poi in senso
//   orario);
// - poligono: lati, angolo (antiorario), tipo e raggio degli angoli, raggio, lunghezza del lato e
//   «Rendi i lati uguali», acceso solo se i lati non sono già uguali;
// - ellisse: inizio e fine dello spicchio e «Inverti spicchio»;
// - un tracciato con angoli (un rettangolo importato, un tracciato coi suoi angoli tagliati): il
//   tipo e il raggio degli angoli.
// Ogni campo manda `object.setLiveShape` con la sua chiave; le lunghezze sono della scena (il motore
// le porta al documento) e qui passano per l'unità del pannello. La forma la legge il motore
// (`document.inspect`, `liveShape`); senza lettura le righe non ci sono.

import { openDialog } from "../../../kit/dialog";
import { numberField, type NumberField } from "../../../kit/number-field";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";

/// Il tipo di un angolo, come `CornerKind` del motore.
export type TipoAngolo = "round" | "invertedRound" | "chamfer";
export const TIPI_ANGOLO: readonly TipoAngolo[] = ["round", "invertedRound", "chamfer"];

/// Gli angoli di un tracciato: il raggio e il tipo comuni (`null` se diversi), e quelli di ogni
/// angolo; `relativi` se i raggi sono frazioni del raggio più grande possibile.
export interface AngoliForma {
  readonly raggio: number | null;
  readonly tipo: TipoAngolo | null;
  readonly raggi: readonly number[];
  readonly tipi: readonly TipoAngolo[];
  readonly relativi: boolean;
}

/// La forma del primo oggetto scelto come la dà il motore (`liveShape`).
export interface FormaViva {
  /// `null` per un tracciato qualunque.
  readonly forma: "rectangle" | "polygon" | "ellipse" | "line" | "path" | null;
  readonly angoli: AngoliForma | null;
  readonly lati?: number;
  readonly angolo?: number | null;
  readonly raggio?: number | null;
  readonly lato?: number | null;
  readonly latiUguali?: boolean;
  readonly spicchio?: readonly [number, number];
}

const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const tipo = (v: unknown): TipoAngolo | null => (TIPI_ANGOLO as readonly unknown[]).includes(v) ? (v as TipoAngolo) : null;
const FORME = new Set(["rectangle", "polygon", "ellipse", "line", "path"]);

/// La forma dalla lettura di `document.inspect`; `null` senza `liveShape` o con una forma diversa.
export function formaDa(lettura: unknown): FormaViva | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const f = (lettura as { readonly liveShape?: unknown }).liveShape;
  if (typeof f !== "object" || f === null) return null;
  const c = f as Record<string, unknown>;
  const nome = c.shape === null ? null : typeof c.shape === "string" && FORME.has(c.shape) ? (c.shape as FormaViva["forma"]) : undefined;
  if (nome === undefined) return null;
  let angoli: AngoliForma | null = null;
  if (typeof c.corners === "object" && c.corners !== null) {
    const a = c.corners as Record<string, unknown>;
    const raggi = Array.isArray(a.radii) ? a.radii.filter(numero) : [];
    const tipi = Array.isArray(a.kinds) ? a.kinds.map(tipo).filter((k): k is TipoAngolo => k !== null) : [];
    angoli = { raggio: numero(a.radius) ? a.radius : null, tipo: tipo(a.kind), raggi, tipi, relativi: a.relative === true };
  }
  const forma: FormaViva = { forma: nome, angoli };
  if (nome === "polygon") {
    return {
      ...forma,
      lati: numero(c.sides) ? c.sides : 3,
      angolo: numero(c.angle) ? c.angle : null,
      raggio: numero(c.radius) ? c.radius : null,
      lato: numero(c.sideLength) ? c.sideLength : null,
      latiUguali: c.sidesEqual !== false,
    };
  }
  if (nome === "ellipse" && Array.isArray(c.pie) && c.pie.length === 2 && numero(c.pie[0]) && numero(c.pie[1])) {
    return { ...forma, spicchio: [c.pie[0], c.pie[1]] };
  }
  return forma;
}

/// Ciò che le righe fanno: il comando con i suoi valori, e la preferenza `singleCornerRadius`.
export interface AzioniForma {
  readonly esegui: (valori: Readonly<Record<string, string | number | boolean | readonly number[]>>) => void;
  /// Il collegamento dei raggi: `undefined` se il motore non c'è (resta acceso).
  readonly angoloUnico?: { readonly acceso: boolean; readonly cambia: (acceso: boolean) => void };
}

/// Le misure di una lunghezza: l'unità del pannello e il passaggio alla scena.
export interface Lunghezza {
  readonly unita: string;
  readonly decimali: number;
  readonly allaScena: (v: number) => number;
  readonly dallaScena: (v: number) => number;
}

const PROBLEMI: Readonly<Record<string, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
};

/// Gli angoli del rettangolo nell'ordine dei suoi campi, coi loro nomi.
const ANGOLI_RETTANGOLO: readonly [number, DrawKey][] = [
  [0, "draw.forma.alto.sinistra"],
  [1, "draw.forma.alto.destra"],
  [2, "draw.forma.basso.destra"],
  [3, "draw.forma.basso.sinistra"],
];

function campo(
  vita: Lifetime,
  chiave: DrawKey,
  valore: number | null,
  misura: { readonly unita: string; readonly decimali: number },
  conferma: (v: number) => void,
  minimo?: number,
): NumberField {
  return numberField({
    label: t(chiave),
    value: valore,
    unit: misura.unita,
    places: misura.decimali,
    ...(minimo === undefined ? {} : { min: minimo }),
    mixedText: "",
    problem: (problema) => (problema === "mixed" ? t("draw.properties.problem.mixed") : t(PROBLEMI[problema] ?? "draw.properties.problem.syntax", { units: misura.unita })),
    onCommit: (v) => {
      conferma(v);
      return undefined;
    },
    lifetime: vita,
  });
}

/// La tendina del tipo d'angolo: vuota se gli angoli ne hanno di diversi.
export function sceltaTipo(vita: Lifetime, attuale: TipoAngolo | null, scegli: (tipo: TipoAngolo) => void): HTMLLabelElement {
  const etichetta = document.createElement("label");
  etichetta.className = "kit-number-label draw-shape-kind";
  const testo = document.createElement("span");
  testo.textContent = t("draw.forma.tipo");
  const scelta = document.createElement("select");
  scelta.className = "draw-properties-input";
  if (attuale === null) {
    const vuota = document.createElement("option");
    vuota.value = "";
    vuota.textContent = "";
    scelta.append(vuota);
  }
  for (const k of TIPI_ANGOLO) {
    const opzione = document.createElement("option");
    opzione.value = k;
    opzione.textContent = t(`draw.forma.tipo.${k}` as DrawKey);
    scelta.append(opzione);
  }
  scelta.value = attuale ?? "";
  vita.listen(scelta, "change", () => {
    const k = tipo(scelta.value);
    if (k !== null && !scelta.disabled) scegli(k);
  });
  etichetta.append(testo, scelta);
  return etichetta;
}

/// Un raggio d'angolo nell'unità del pannello (un raggio relativo resta una frazione).
function raggioMostrato(angoli: AngoliForma, r: number | null, l: Lunghezza): number | null {
  if (r === null) return null;
  return angoli.relativi ? r : l.dallaScena(r) - l.dallaScena(0);
}
const raggioAllaScena = (angoli: AngoliForma, v: number, l: Lunghezza): number => (angoli.relativi ? v : l.allaScena(v) - l.allaScena(0));

/// Le righe della forma per la sezione Trasforma: `null` se la forma non ne ha (una linea, un
/// tracciato senza angoli).
export function righeForma(vita: Lifetime, forma: FormaViva, l: Lunghezza, azioni: AzioniForma): HTMLElement | null {
  const blocco = document.createElement("div");
  blocco.className = "draw-shape-properties";
  const titolo = (chiave: DrawKey): void => {
    const h = document.createElement("h4");
    h.className = "draw-shape-heading";
    h.textContent = t(chiave);
    blocco.append(h);
  };
  const misura = { unita: l.unita, decimali: l.decimali };
  const angoli = forma.angoli;
  const unitaRaggio = (a: AngoliForma) => (a.relativi ? { unita: "", decimali: 3 } : misura);
  if (forma.forma === "rectangle" && angoli !== null) {
    titolo("draw.forma.rettangolo");
    const unico = azioni.angoloUnico?.acceso ?? true;
    const riga = document.createElement("div");
    riga.className = "draw-shape-row";
    if (unico) {
      riga.append(
        campo(vita, "draw.forma.raggioAngolo", raggioMostrato(angoli, angoli.raggio, l), unitaRaggio(angoli), (v) => azioni.esegui({ radius: raggioAllaScena(angoli, v, l) }), 0)
          .element,
      );
    }
    if (azioni.angoloUnico !== undefined) {
      const cambia = azioni.angoloUnico.cambia;
      const collega = document.createElement("button");
      collega.type = "button";
      collega.className = "kit-button draw-transform-link draw-shape-link";
      collega.textContent = "🔗";
      collega.title = t("draw.forma.angoloUnico");
      collega.setAttribute("aria-label", t("draw.forma.angoloUnico"));
      collega.setAttribute("aria-pressed", String(unico));
      vita.listen(collega, "click", () => cambia(!unico));
      riga.append(collega);
    }
    blocco.append(riga);
    if (!unico) {
      const griglia = document.createElement("div");
      griglia.className = "draw-transform-grid draw-shape-corners";
      for (const [k, chiave] of ANGOLI_RETTANGOLO) {
        griglia.append(
          campo(vita, chiave, raggioMostrato(angoli, angoli.raggi[k] ?? null, l), unitaRaggio(angoli), (v) =>
            azioni.esegui({ radius: raggioAllaScena(angoli, v, l), corners: [k] }),
          0).element,
        );
      }
      blocco.append(griglia);
    }
    return blocco;
  }
  if (forma.forma === "polygon") {
    titolo("draw.forma.poligono");
    const griglia = document.createElement("div");
    griglia.className = "draw-transform-grid draw-shape-polygon";
    griglia.append(
      campo(vita, "draw.forma.lati", forma.lati ?? 3, { unita: "", decimali: 0 }, (v) => azioni.esegui({ sides: Math.max(3, Math.round(v)) }), 3).element,
      campo(vita, "draw.forma.angolo", forma.angolo ?? null, { unita: "°", decimali: 1 }, (v) => azioni.esegui({ polygonAngle: v })).element,
    );
    if (angoli !== null) {
      griglia.append(
        sceltaTipo(vita, angoli.tipo, (k) => azioni.esegui({ kind: k })),
        campo(vita, "draw.forma.raggioAngolo", raggioMostrato(angoli, angoli.raggio, l), unitaRaggio(angoli), (v) => azioni.esegui({ radius: raggioAllaScena(angoli, v, l) }), 0)
          .element,
      );
    }
    const lunghezza = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : l.dallaScena(v) - l.dallaScena(0));
    const allaScena = (v: number): number => l.allaScena(v) - l.allaScena(0);
    griglia.append(
      campo(vita, "draw.forma.raggio", lunghezza(forma.raggio), misura, (v) => azioni.esegui({ polygonRadius: allaScena(v) }), 0).element,
      campo(vita, "draw.forma.lato", lunghezza(forma.lato), misura, (v) => azioni.esegui({ sideLength: allaScena(v) }), 0).element,
    );
    const uguali = document.createElement("button");
    uguali.type = "button";
    uguali.className = "kit-button";
    uguali.textContent = t("draw.forma.latiUguali");
    uguali.disabled = forma.latiUguali !== false;
    vita.listen(uguali, "click", () => {
      if (!uguali.disabled) azioni.esegui({ makeSidesEqual: true });
    });
    blocco.append(griglia, uguali);
    return blocco;
  }
  if (forma.forma === "ellipse" && forma.spicchio !== undefined) {
    titolo("draw.forma.ellisse");
    const griglia = document.createElement("div");
    griglia.className = "draw-transform-grid draw-shape-pie";
    griglia.append(
      campo(vita, "draw.forma.spicchio.inizio", forma.spicchio[0], { unita: "°", decimali: 1 }, (v) => azioni.esegui({ pieStart: v })).element,
      campo(vita, "draw.forma.spicchio.fine", forma.spicchio[1], { unita: "°", decimali: 1 }, (v) => azioni.esegui({ pieEnd: v })).element,
    );
    const inverti = document.createElement("button");
    inverti.type = "button";
    inverti.className = "kit-button";
    inverti.textContent = t("draw.forma.spicchio.inverti");
    vita.listen(inverti, "click", () => azioni.esegui({ invertPie: true }));
    blocco.append(griglia, inverti);
    return blocco;
  }
  // Un tracciato con angoli: il loro tipo e raggio, come la sezione Angoli di VectorCraft.
  if ((forma.forma === null || forma.forma === "path") && angoli !== null) {
    titolo("draw.forma.angoli");
    const griglia = document.createElement("div");
    griglia.className = "draw-transform-grid draw-shape-path-corners";
    griglia.append(
      sceltaTipo(vita, angoli.tipo, (k) => azioni.esegui({ kind: k })),
      campo(vita, "draw.forma.raggioAngolo", raggioMostrato(angoli, angoli.raggio, l), unitaRaggio(angoli), (v) => azioni.esegui({ radius: raggioAllaScena(angoli, v, l) }), 0)
        .element,
    );
    blocco.append(griglia);
    return blocco;
  }
  return null;
}

/// Il tipo e il raggio (nella scena, o la frazione se i raggi sono relativi) scelti nella finestra
/// Angoli.
export interface SceltaAngoli {
  readonly tipo: TipoAngolo;
  readonly raggio: number;
}

/// La finestra «Angoli…»: tipo e raggio, partendo da quelli comuni agli angoli (arrotondato e 0 se
/// diversi). `null` se si annulla.
export function chiediAngoli(angoli: AngoliForma, l: Lunghezza): Promise<SceltaAngoli | null> {
  const vita = openLifetime();
  const corpo = document.createElement("div");
  corpo.className = "draw-shape-corners-dialog-body";
  let scelto: TipoAngolo = angoli.tipo ?? "round";
  corpo.append(
    sceltaTipo(vita, scelto, (k) => {
      scelto = k;
    }),
  );
  const iniziale = raggioMostrato(angoli, angoli.raggio, l) ?? 0;
  const raggio = numberField({
    label: t("draw.forma.raggioAngolo"),
    value: iniziale,
    unit: angoli.relativi ? "" : l.unita,
    places: angoli.relativi ? 3 : l.decimali,
    min: 0,
    mixedText: "",
    problem: (problema) => t(PROBLEMI[problema] ?? "draw.properties.problem.syntax", { units: l.unita }),
    onCommit: () => undefined,
    lifetime: vita,
  });
  corpo.append(raggio.element);
  const dialogo = openDialog<"ok" | "annulla">({
    title: t("draw.forma.finestra.titolo"),
    description: t("draw.forma.finestra.descrizione"),
    body: corpo,
    actions: [
      { id: "cancel", label: t("draw.forma.finestra.annulla"), value: "annulla" },
      { id: "apply", label: t("draw.forma.finestra.ok"), kind: "primary", value: "ok" },
    ],
    dismissValue: "annulla",
    lifetime: vita,
    submit: "apply",
    className: "draw-shape-corners-dialog",
  });
  return dialogo.result.then((esito) => {
    const r = raggio.value() ?? iniziale;
    vita.close();
    if (esito !== "ok" || !(r >= 0)) return null;
    return { tipo: scelto, raggio: raggioAllaScena(angoli, r, l) };
  });
}

/// La voce del client della finestra Angoli.
export const VOCE_ANGOLI = "ui.corners";
