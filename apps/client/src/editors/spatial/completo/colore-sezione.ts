// La sezione «Colore» dell'ispettore Design del Completo (K6 T14, giro 1): il riempimento e il
// contorno della selezione, con il pozzo del colore del kit (`kit/color/well.ts`) com'è, e i tre
// pulsanti Scambia, Nessuno e Di serie.
//
// - **I valori dalla vista del pannello.** I due pozzi mostrano i colori che il pannello ha già
//   (`ContestoSezione.colori`): nessuna richiesta al motore per mostrarli.
// - **Un clic, un comando.** Un colore scelto manda `paint.setFill` o `paint.setStroke`
//   (`{none: true}` per nessun colore); Scambia `paint.swap`, Di serie `paint.default`; Nessuno toglie
//   il colore del lato attivo con `paint.setFill` o `paint.setStroke` `{none: true}`, sul lato che la
//   sezione mostra attivo. Aprire il pozzo del lato che non è attivo lo fa attivo, e lo dice al motore
//   con `paint.toggleActive {fill}`, perché i suoi tasti (X, /) vedano lo stesso lato. I comandi
//   passano dal percorso unico (`eseguiPerId`).
// - **Gli stessi pozzi da un giro all'altro.** Il pannello rifà la sezione a ogni cambio della
//   selezione; i pozzi restano gli stessi elementi, rimessi nel corpo nuovo con il valore nuovo, così
//   il selettore aperto non si chiude dopo ogni colore scelto. Vivono con il Completo.

import { colorWell, type ColorWell } from "../../../kit/color/well";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import { drawPickerText } from "../tools/color-text";
import { registraSezione, type ColoreSelezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// Il comando del motore: l'id della voce e i suoi valori.
export type EseguiColore = (id: string, valori: Readonly<Record<string, unknown>>) => void;

/// Un lato del colore: il riempimento o il contorno.
type Lato = "fill" | "stroke";

interface Parti {
  readonly radice: HTMLElement;
  readonly pozzi: Readonly<Record<Lato, ColorWell>>;
  readonly scambia: HTMLButtonElement;
  readonly nessuno: HTMLButtonElement;
  readonly diSerie: HTMLButtonElement;
}

/// Il nome di un lato nella lingua di adesso.
const nomeDi = (lato: Lato): string => t(lato === "fill" ? "draw.properties.fill" : "draw.properties.stroke");

/// Il valore da dare al pozzo: un colore, `none`, `null` se misto; ciò che non è un colore semplice
/// (una sfumatura, un motivo) resta com'è, e il pozzo lo nomina con `nomeDelValore`.
function valoreDelPozzo(colore: ColoreSelezione | undefined): string | null {
  if (colore === undefined) return null;
  if (colore.campione?.kind === "swatch") return colore.campione.color;
  return colore.valore;
}

/// Un pulsante di testo della sezione, con la sua nota come suggerimento.
function pulsante(testo: string, nota: string): HTMLButtonElement {
  const bottone = document.createElement("button");
  bottone.type = "button";
  bottone.className = "kit-button";
  bottone.textContent = testo;
  bottone.title = nota;
  bottone.setAttribute("aria-label", nota);
  return bottone;
}

/// La sezione «Colore» per la scheda Design, da registrare nel Completo aperto: `vita` è quella del
/// Completo, con cui vivono i pozzi.
export function sezioneColore(esegui: EseguiColore, vita: Lifetime): Sezione {
  let attivo: Lato = "fill";
  let parti: Parti | null = null;
  /// I colori dell'ultimo giro, per i nomi di ciò che non è un colore semplice.
  let colori: Readonly<Partial<Record<Lato, ColoreSelezione>>> = {};

  const nomeDelValore = (lato: Lato) => (valore: string): string => {
    const campione = colori[lato]?.campione;
    if (campione?.kind === "swatch" || campione?.kind === "motif") return campione.name;
    if (campione?.kind === "gradient") return t("draw.colore.sfumatura");
    if (campione !== undefined || valore.startsWith("url(")) return t("draw.colore.motivo");
    return valore.toLowerCase();
  };

  const etichetta = (lato: Lato): string => (lato === attivo ? t("draw.colore.attivo", { lato: nomeDi(lato) }) : nomeDi(lato));

  const segna = (p: Parti): void => {
    for (const lato of ["fill", "stroke"] as const) {
      p.pozzi[lato].element.classList.toggle("draw-color-active", lato === attivo);
      p.pozzi[lato].relabel({ label: etichetta(lato), mixedText: t("draw.properties.mixed"), text: drawPickerText() });
    }
    p.nessuno.title = t("draw.colore.nessuno.nota", { lato: nomeDi(attivo) });
    p.nessuno.setAttribute("aria-label", p.nessuno.title);
  };

  const crea = (): Parti => {
    const radice = document.createElement("div");
    radice.className = "draw-color";
    const coppia = document.createElement("div");
    coppia.className = "draw-color-wells";
    coppia.setAttribute("role", "group");
    coppia.setAttribute("aria-label", t("draw.colore.gruppo"));
    const pozzo = (lato: Lato): ColorWell => {
      const uno = colorWell({
        label: nomeDi(lato),
        mixedText: t("draw.properties.mixed"),
        text: drawPickerText(),
        value: null,
        allowNone: true,
        nameOf: nomeDelValore(lato),
        onChange: (colore) => {
          const id = lato === "fill" ? "paint.setFill" : "paint.setStroke";
          esegui(id, colore === "none" ? { none: true } : { color: colore });
        },
        lifetime: vita,
      });
      // Aprire il pozzo dell'altro lato lo fa attivo: un comando solo, prima che il selettore si apra.
      vita.listen(uno.button, "click", () => {
        if (attivo === lato || parti === null) return;
        attivo = lato;
        segna(parti);
        esegui("paint.toggleActive", { fill: lato === "fill" });
      });
      return uno;
    };
    const pozzi = { fill: pozzo("fill"), stroke: pozzo("stroke") };
    coppia.append(pozzi.fill.element, pozzi.stroke.element);
    const azioni = document.createElement("div");
    azioni.className = "draw-color-actions";
    const scambia = pulsante(t("draw.colore.scambia"), t("draw.colore.scambia.nota"));
    const nessuno = pulsante(t("draw.colore.nessuno"), t("draw.colore.nessuno.nota", { lato: nomeDi(attivo) }));
    const diSerie = pulsante(t("draw.colore.diSerie"), t("draw.colore.diSerie.nota"));
    vita.listen(scambia, "click", () => {
      if (!scambia.disabled) esegui("paint.swap", {});
    });
    vita.listen(nessuno, "click", () => {
      if (!nessuno.disabled) esegui(attivo === "fill" ? "paint.setFill" : "paint.setStroke", { none: true });
    });
    vita.listen(diSerie, "click", () => {
      if (!diSerie.disabled) esegui("paint.default", {});
    });
    azioni.append(scambia, nessuno, diSerie);
    radice.append(coppia, azioni);
    const fatte: Parti = { radice, pozzi, scambia, nessuno, diSerie };
    segna(fatte);
    return fatte;
  };

  const disegna = (contesto: ContestoSezione): (() => void) => {
    const p = (parti ??= crea());
    colori = { fill: contesto.colori?.riempimento, stroke: contesto.colori?.contorno };
    const spenta = contesto.sel.numero === 0;
    for (const lato of ["fill", "stroke"] as const) {
      const pozzo = p.pozzi[lato];
      // Un lato che la selezione non ha (un'immagine non ha contorno) si spegne.
      const manca = spenta || colori[lato] === undefined;
      pozzo.setValue(manca ? null : valoreDelPozzo(colori[lato]));
      pozzo.button.disabled = manca;
      if (manca) pozzo.close();
    }
    p.scambia.disabled = spenta;
    p.nessuno.disabled = spenta;
    p.diSerie.disabled = spenta;
    segna(p);
    contesto.corpo.append(p.radice);
    return () => contesto.corpo.replaceChildren();
  };

  return {
    id: "color",
    scheda: "design",
    titolo: t("draw.colore.titolo"),
    disegna,
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraColore(sezioni: Sezioni, esegui: EseguiColore, vita: Lifetime): boolean {
  return registraSezione({ sezioni }, sezioneColore(esegui, vita));
}
