// Il clic del mouse sul disegno del banco (K6 T15, giro 2). Il motore vero sceglie ciò che sta sotto il
// punto: `un_clic_sceglie_l_oggetto_in_cima_e_il_gruppo` e
// `un_clic_sceglie_l_ellisse_piena_e_la_linea_senza_riempimento` in
// `crates/fub-disegno/tests/gesti_selezione.rs`. Il banco non ha il motore: prima rispondeva «selezione
// invariata» a ogni gesto che non fosse un vettore di prova, e il clic non sceglieva niente. Qui la
// risposta viene dal foglio che il browser disegna: il punto sta su un elemento con la tolleranza del
// motore, e vince il primo in alto. Il disegno del banco non ha gruppi: ogni elemento si sceglie per sé.

import type { DrawingGesture, DrawingPointer } from "../src/host/contract";

/// La tolleranza di scelta del motore, in unità del disegno (`selection_tolerance`).
const TOLLERANZA = 3;

/// Il gesto è un clic se nessun punto del gesto si allontana dal punto di giù più della tolleranza.
/// Un trascinamento il banco non lo fa: la sua selezione resta com'è.
function puntoDelClic(eventi: readonly DrawingPointer[]): DrawingPointer | null {
  const giu = eventi.find((evento) => evento.kind === "down");
  if (giu === undefined) return null;
  const fuori = eventi.some((evento) => Math.hypot(evento.x - giu.x, evento.y - giu.y) > TOLLERANZA);
  return fuori ? null : giu;
}

/// Il punto tocca l'elemento? Riempimenti e tratti come li disegna il browser (`isPointInFill`,
/// `isPointInStroke`), il testo col suo riquadro; i punti intorno al punto, alla tolleranza, valgono.
function tocca(elemento: SVGGraphicsElement, p: DrawingPointer): boolean {
  const intorno = [
    { dx: 0, dy: 0 },
    { dx: TOLLERANZA, dy: 0 },
    { dx: -TOLLERANZA, dy: 0 },
    { dx: 0, dy: TOLLERANZA },
    { dx: 0, dy: -TOLLERANZA },
  ];
  return intorno.some(({ dx, dy }) => {
    const q = new DOMPoint(p.x + dx, p.y + dy);
    if (elemento instanceof SVGGeometryElement) return elemento.isPointInFill(q) || elemento.isPointInStroke(q);
    const riquadro = elemento.getBBox();
    return q.x >= riquadro.x && q.x <= riquadro.x + riquadro.width && q.y >= riquadro.y && q.y <= riquadro.y + riquadro.height;
  });
}

/// L'id dell'elemento più in alto sotto il punto, nel foglio del disegno aperto. Il fondo della pagina
/// (`fub-paper`) e il livello (un `g`) non si scelgono.
function elementoSotto(p: DrawingPointer): string | null {
  const foglio = document.querySelector(".draw-editor .draw-surface");
  if (foglio === null) return null;
  const elementi = [...foglio.querySelectorAll<SVGGraphicsElement>("[data-scene-id]")];
  for (let i = elementi.length - 1; i >= 0; i--) {
    const elemento = elementi[i]!;
    const id = elemento.getAttribute("data-scene-id");
    if (id === null || id === "fub-paper" || elemento.tagName.toLowerCase() === "g") continue;
    if (tocca(elemento, p)) return id;
  }
  return null;
}

/// La selezione che il banco dà dopo un clic di Selezione sul foglio: l'elemento sotto il punto, o
/// niente se il punto è nel vuoto (come nel motore). Con Maiusc il clic aggiunge o toglie l'elemento.
/// `null` se il gesto non è un clic.
export function selezioneDelClic(gesto: DrawingGesture): string[] | null {
  const giu = puntoDelClic(gesto.events);
  if (giu === null) return null;
  const id = elementoSotto(giu);
  if (!giu.shift) return id === null ? [] : [id];
  if (id === null) return [...gesto.selection];
  return gesto.selection.includes(id) ? gesto.selection.filter((scelto) => scelto !== id) : [...gesto.selection, id];
}
