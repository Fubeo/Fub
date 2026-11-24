// Le guide del righello sul foglio del Disegno completo (`fub:guides`, la famiglia
// `tavole` del motore), come in VectorCraft (`vendor/vectorcraft/crates/tools/src/rulerguide.rs`):
//
// - **si vedono** sopra il disegno, in tutta la vista; una guida di una tavola (`board=`)
//   solo lungo la sua tavola. Una guida bloccata è tratteggiata, quella sotto il puntatore
//   o che si trascina ha il colore della linea. Nascondi guide (`view.guides`) le toglie
//   dalla vista, e una guida su un livello nascosto non si vede;
// - **una guida si prende** con le Selezioni, se si vede e si cambia (non bloccata, né lei
//   né il suo livello, e Blocca guide spento): trascinata si sposta (`guide.move`), con
//   Alt se ne sposta una copia, lasciata sul suo righello se ne va (`guide.remove`);
// - **una guida nuova** si tira dal righello, con ogni strumento: da quello in alto una
//   guida orizzontale, da quello a sinistra una verticale (Alt le scambia), e nasce dove
//   si lascia sul foglio (`guide.add`); lasciata sopra un righello non nasce. Con lo
//   strumento Tavola è una guida della tavola dove nasce;
// - **l'aggancio**: con Maiusc la guida va sulla tacca più vicina del righello, altrimenti
//   sulla griglia se aggancia, o sul pixel se l'aggancio al pixel è acceso.
//
// Le guide si cambiano solo coi comandi del motore, un passo di cronologia per gesto:
// durante il trascinamento la guida si mostra qui, senza chiamare il motore.

import { t } from "../../strings";
import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { RulerGuide } from "../../scene/rulers";
import { compose } from "../../scene/matrix";
import { pathData } from "../../scene/serialize";
import { toScene, toScreen, viewMatrix, type View } from "../../view";
import { gridStep } from "../grid";
import { rulerTicks } from "../rulers";
import type { GuidePath } from "../hit/indexer";
import type { EditorContext } from "./context";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Quanto vicino, in pixel dello schermo, il puntatore prende una guida: la tolleranza di
/// scelta di VectorCraft.
export const PRESA_GUIDA_PX = 4;
/// Quanto si muove il puntatore prima che una guida presa cominci a spostarsi.
export const SOGLIA_TRASCINA_PX = 3;
/// Lo spessore dei righelli di bordo (`edge-rulers.ts`, e il CSS `draw-ruler-x`/`-y`).
export const RIGHELLO_ALTO_PX = 20;
export const RIGHELLO_SINISTRA_PX = 28;

/// Ciò che una guida sa del suo livello: se si vede e se si cambia.
export interface LivelloDellaGuida {
  readonly hidden: boolean;
  readonly locked: boolean;
}

/// Una guida sullo schermo: i due capi del tratto e se si prende.
export interface GuidaSulloSchermo {
  readonly index: number;
  readonly guida: RulerGuide;
  readonly a: Point;
  readonly b: Point;
  readonly modificabile: boolean;
}

/// Ciò che serve per mettere le guide sullo schermo.
export interface StatoGuide {
  readonly camera: View;
  readonly larghezza: number;
  readonly altezza: number;
  readonly guide: readonly RulerGuide[];
  /// I rettangoli delle tavole, per id.
  readonly tavole: ReadonlyMap<string, Bounds>;
  /// I livelli, per id.
  readonly livelli: ReadonlyMap<string, LivelloDellaGuida>;
  readonly nascoste: boolean;
  readonly bloccate: boolean;
}

/// Le guide che si vedono, coi tratti sullo schermo: lungo la tavola una guida di tavola,
/// altrimenti attraverso tutta la vista (anche girata).
export function guideSulloSchermo(stato: StatoGuide): GuidaSulloSchermo[] {
  if (stato.nascoste) return [];
  const { camera, larghezza: w, altezza: h } = stato;
  // Il riquadro della scena che si vede: i quattro angoli dello schermo portati nella scena.
  const angoli = [toScene(camera, [0, 0]), toScene(camera, [w, 0]), toScene(camera, [0, h]), toScene(camera, [w, h])];
  const xs = angoli.map((p) => p[0]);
  const ys = angoli.map((p) => p[1]);
  const vista: Bounds = { min: [Math.min(...xs) - 1, Math.min(...ys) - 1], max: [Math.max(...xs) + 1, Math.max(...ys) + 1] };
  const fuori: GuidaSulloSchermo[] = [];
  stato.guide.forEach((guida, index) => {
    const livello = guida.layer === undefined ? undefined : stato.livelli.get(guida.layer);
    if (livello?.hidden === true) return;
    const tavola = guida.board === undefined ? undefined : stato.tavole.get(guida.board);
    const lungo = tavola ?? vista;
    const [a, b]: [Point, Point] =
      guida.axis === "x"
        ? [[guida.at, lungo.min[1]], [guida.at, lungo.max[1]]]
        : [[lungo.min[0], guida.at], [lungo.max[0], guida.at]];
    fuori.push({
      index,
      guida,
      a: toScreen(camera, a),
      b: toScreen(camera, b),
      modificabile: !stato.bloccate && !guida.locked && livello?.locked !== true,
    });
  });
  return fuori;
}

/// La distanza fra il punto `p` e il tratto da `a` a `b`.
function distanza(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/// La guida che si prende al punto `p` dello schermo: la più vicina entro
/// [`PRESA_GUIDA_PX`], e fra due alla stessa distanza la più nuova, come in VectorCraft.
export function guidaSotto(guide: readonly GuidaSulloSchermo[], p: Point): GuidaSulloSchermo | null {
  let presa: GuidaSulloSchermo | null = null;
  let meglio = Infinity;
  for (const g of guide) {
    if (!g.modificabile) continue;
    const d = distanza(p, g.a, g.b);
    if (d <= PRESA_GUIDA_PX && d <= meglio) {
      presa = g;
      meglio = d;
    }
  }
  return presa;
}

/// Il righello sotto il punto `p` dello schermo, coi righelli accesi: `x` per quello a
/// sinistra (le guide verticali), `y` per quello in alto, `null` fuori. Nell'angolo vince
/// quello in alto.
export function righelloSotto(p: Point, accesi: boolean): "x" | "y" | null {
  if (!accesi) return null;
  if (p[1] >= 0 && p[1] < RIGHELLO_ALTO_PX && p[0] >= 0) return "y";
  if (p[0] >= 0 && p[0] < RIGHELLO_SINISTRA_PX && p[1] >= 0) return "x";
  return null;
}

/// Una guida lasciata qui va via: sul suo righello, o fuori dal foglio da quel lato.
export function lasciataSulRighello(asse: "x" | "y", p: Point, accesi: boolean): boolean {
  if (asse === "x") return p[0] < (accesi ? RIGHELLO_SINISTRA_PX : 0);
  return p[1] < (accesi ? RIGHELLO_ALTO_PX : 0);
}

/// Come si aggancia una guida che si trascina.
export interface Aggancio {
  readonly maiusc: boolean;
  /// Il passo della griglia se aggancia, un pixel con l'aggancio al pixel, altrimenti `null`.
  readonly passo: number | null;
  readonly camera: View;
  readonly larghezza: number;
  readonly altezza: number;
  readonly unita: Parameters<typeof rulerTicks>[3];
}

/// Dove va una guida lungo `asse` trascinata a `v` (nella scena): con Maiusc sulla tacca
/// più vicina del righello (con la vista dritta), altrimenti sul passo dell'aggancio. A due
/// decimali, come la scrive il file.
export function agganciata(asse: "x" | "y", v: number, aggancio: Aggancio): number {
  const { camera } = aggancio;
  let at = v;
  if (aggancio.maiusc && camera.angle === 0) {
    const offset = asse === "x" ? camera.tx : camera.ty;
    const lunghezza = asse === "x" ? aggancio.larghezza : aggancio.altezza;
    const schermo = v * camera.scale + offset;
    let vicina: number | null = null;
    for (const tacca of rulerTicks(offset, camera.scale, lunghezza, aggancio.unita).ticks) {
      if (vicina === null || Math.abs(tacca.at - schermo) < Math.abs(vicina - schermo)) vicina = tacca.at;
    }
    if (vicina !== null) at = (vicina - offset) / camera.scale;
  } else if (aggancio.passo !== null && aggancio.passo > 0) {
    at = Math.round(v / aggancio.passo) * aggancio.passo;
  }
  return Math.round(at * 100) / 100 || 0;
}

/// Il gesto di una guida.
type Gesto =
  | {
      readonly kind: "sposta";
      readonly pointerId: number;
      readonly index: number;
      /// Le guide che il gesto sposta: le scelte, fra cui quella presa.
      readonly gruppo: readonly number[];
      /// Maiusc sopra una guida già scelta: lasciata senza trascinarla, esce dalla scelta.
      readonly togliSeClic: boolean;
      readonly asse: "x" | "y";
      readonly da: number;
      readonly inizio: Point;
      readonly inizioScena: Point;
      cominciato: boolean;
      at: number;
      via: boolean;
      copia: boolean;
    }
  | {
      readonly kind: "nuova";
      readonly pointerId: number;
      /// L'asse del righello da cui viene, prima di Alt.
      readonly asse: "x" | "y";
      /// Dove si vede adesso, `null` sopra un righello o fuori dal foglio.
      dove: { readonly asse: "x" | "y"; readonly at: number } | null;
    };

/// Monta le guide del Disegno completo: `ctx.guidesHidden` e `ctx.guidesLocked` (Nascondi e
/// Blocca guide, della vista, come in VectorCraft) e `ctx.showGuides`, che le ridisegna.
export function installGuideLines(ctx: EditorContext): void {
  ctx.guidesHidden = false;
  ctx.guidesLocked = false;
  let svg: SVGSVGElement | null = null;
  let gesto: Gesto | null = null;
  let sotto: number | null = null;
  let disegnato = "";
  /// Le guide scelte (indici di `fub:guides`), come la selezione delle guide di VectorCraft:
  /// della vista, non del file. Gli oggetti scelti le tolgono, e loro tolgono gli oggetti.
  let scelte: number[] = [];
  /// Quante guide aveva il disegno quando la scelta è nata: se cambiano, gli indici non
  /// valgono più e la scelta si svuota.
  let quanteAllaScelta = 0;
  /// Quante ne aveva prima di una copia mandata al motore e non ancora tornata: finché il
  /// disegno resta così, la scelta (le copie) aspetta.
  let quanteInAttesa: number | null = null;
  /// Sceglie `indici`; `quante` è il numero di guide che il disegno avrà, quando il comando
  /// appena mandato al motore (una copia) ne aggiunge.
  const sceglie = (indici: readonly number[], quante = (ctx.scene.root.guides ?? []).length): void => {
    scelte = [...new Set(indici)].sort((a, b) => a - b);
    const ora = (ctx.scene.root.guides ?? []).length;
    quanteInAttesa = quante === ora ? null : ora;
    quanteAllaScelta = quante;
  };

  /// Il motore c'è: le guide sono del Completo.
  const completo = () => {
    const c = ctx.completoMotore?.() ?? null;
    return c !== null && c.conMotore?.() === true ? c : null;
  };

  const stato = (): StatoGuide => {
    const { w, h } = ctx.surfaceSize();
    const tavole = new Map<string, Bounds>();
    for (const b of ctx.boardsNow()) tavole.set(b.id, b.box);
    const livelli = new Map<string, LivelloDellaGuida>();
    for (const l of ctx.currentIndex().layers) if (l.id !== null) livelli.set(l.id, { hidden: l.hidden, locked: l.locked });
    return {
      camera: ctx.camera,
      larghezza: w,
      altezza: h,
      guide: ctx.scene.root.guides ?? [],
      tavole,
      livelli,
      nascoste: ctx.guidesHidden,
      bloccate: ctx.guidesLocked || !ctx.editable(),
    };
  };

  const linea = (a: Point, b: Point, classe: string): SVGLineElement => {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("class", classe);
    l.setAttribute("x1", String(a[0]));
    l.setAttribute("y1", String(a[1]));
    l.setAttribute("x2", String(b[0]));
    l.setAttribute("y2", String(b[1]));
    return l;
  };

  /// Il tratto sullo schermo di una guida lungo `asse` a `at`, attraverso tutta la vista.
  const trattoIntero = (asse: "x" | "y", at: number): [Point, Point] => {
    const { w, h } = ctx.surfaceSize();
    const s = stato();
    const finta = guideSulloSchermo({ ...s, larghezza: w, altezza: h, guide: [{ axis: asse, at, locked: false }], nascoste: false });
    return [finta[0]!.a, finta[0]!.b];
  };

  /// I tracciati-guida della scena (Crea guide): ricalcolati solo quando la scena si
  /// ricostruisce, cioè quando il disegno cambia.
  let tracciati: { readonly scena: unknown; readonly unita: readonly GuidePath[] } | null = null;
  let versione = 0;
  const tracciatiGuida = (): readonly GuidePath[] => {
    if (tracciati?.scena !== ctx.scene) {
      const model = ctx.engine.model;
      tracciati = { scena: ctx.scene, unita: model === null ? [] : ctx.indexer.guides(model) };
      versione++;
    }
    return tracciati.unita;
  };

  /// Un tracciato-guida sullo schermo: la sua forma, portata dalla vista con `transform`
  /// (il tratto resta di un pixel, `vector-effect`).
  const tracciatoSulloSchermo = (unita: GuidePath): SVGPathElement | null => {
    const d = pathData(unita.segments);
    if (d === "") return null;
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("class", "draw-guide-line draw-guide-path");
    p.setAttribute("d", d);
    p.setAttribute("transform", `matrix(${compose(viewMatrix(ctx.camera), unita.matrix).join(" ")})`);
    return p;
  };

  const disegna = (): void => {
    if (ctx.disposed) return;
    const guide = ctx.scene.root.guides ?? [];
    // Gli indici scelti valgono finché le guide restano quelle: un'altra guida aggiunta o
    // tolta, gli oggetti scelti, Nascondi o Blocca guide svuotano la scelta.
    if (guide.length === quanteAllaScelta) quanteInAttesa = null;
    if (scelte.length > 0 && ((guide.length !== quanteAllaScelta && guide.length !== quanteInAttesa) || ctx.selection.length > 0 || ctx.guidesHidden || ctx.guidesLocked || !ctx.editable())) scelte = [];
    const conTracciati = tracciatiGuida();
    if (svg === null && guide.length === 0 && conTracciati.length === 0 && gesto === null) return;
    if (svg === null) {
      svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      svg.setAttribute("class", "draw-guides");
      svg.setAttribute("aria-hidden", "true");
      // Sotto i righelli di bordo, che si aggiungono dopo.
      ctx.surface.prepend(svg);
      const questo = svg;
      ctx.life.add(() => {
        questo.remove();
        svg = null;
      });
    }
    const { w, h } = ctx.surfaceSize();
    const { tx, ty, scale, angle } = ctx.camera;
    const chiave = JSON.stringify([tx, ty, scale, angle, w, h, guide, ctx.guidesHidden, ctx.guidesLocked, sotto, gesto, ctx.boards === null, versione, scelte]);
    if (chiave === disegnato) return;
    disegnato = chiave;
    const figli: SVGElement[] = [];
    // I tracciati-guida, come le guide del righello: Nascondi guide li toglie.
    if (!ctx.guidesHidden) {
      for (const unita of conTracciati) {
        const p = tracciatoSulloSchermo(unita);
        if (p !== null) figli.push(p);
      }
    }
    // Le guide che si spostano non restano al loro posto, salvo con Alt, che ne lascia una copia.
    const spostate = new Set(gesto?.kind === "sposta" && gesto.cominciato && !gesto.copia ? gesto.gruppo : []);
    const mobili: { readonly asse: "x" | "y"; readonly at: number }[] = [];
    for (const g of guideSulloSchermo(stato())) {
      if (gesto?.kind === "sposta" && gesto.cominciato && !gesto.via && gesto.gruppo.includes(g.index)) {
        // Si sposta lungo l'asse di chi la trascina: una guida dell'altro asse resta dov'è.
        const d = gesto.at - gesto.da;
        mobili.push({ asse: g.guida.axis, at: g.guida.axis === gesto.asse ? g.guida.at + d : g.guida.at });
      }
      if (spostate.has(g.index)) continue;
      const classi = ["draw-guide-line"];
      if (g.guida.locked) classi.push("draw-guide-line-locked");
      if (g.index === sotto) classi.push("draw-guide-line-hot");
      if (scelte.includes(g.index)) classi.push("draw-guide-line-scelta");
      figli.push(linea(g.a, g.b, classi.join(" ")));
    }
    if (gesto?.kind === "nuova" && gesto.dove !== null) mobili.push(gesto.dove);
    for (const mobile of mobili) {
      const [a, b] = trattoIntero(mobile.asse, mobile.at);
      figli.push(linea(a, b, "draw-guide-line draw-guide-line-hot"));
    }
    svg.replaceChildren(...figli);
  };
  ctx.showGuides = disegna;
  ctx.life.add(ctx.status.subscribe(disegna));

  const aggancio = (maiusc: boolean): Aggancio => {
    const { w, h } = ctx.surfaceSize();
    const unita = ctx.docUnit();
    return {
      maiusc,
      passo: ctx.grid.snap ? gridStep(ctx.grid, unita) : ctx.grid.snapPixel === true ? 1 : null,
      camera: ctx.camera,
      larghezza: w,
      altezza: h,
      unita,
    };
  };

  /// Le Selezioni prendono le guide; gli altri strumenti le tirano solo dal righello.
  const selezione = (): boolean => {
    const motore = ctx.motoreTool ?? null;
    return motore === "selection" || motore === "directSelection" || motore === "groupSelection" || (motore === null && ctx.tool === "select");
  };

  const giu = (event: PointerEvent): void => {
    if (gesto !== null || event.button !== 0 || completo() === null || !ctx.editable()) return;
    // Un campo, un pulsante o un testo scritto sul posto sopra il foglio tengono il loro clic.
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable]") !== null) return;
    const p = ctx.localPoint(event.clientX, event.clientY);
    const punto: Point = [p.x, p.y];
    const righello = righelloSotto(punto, ctx.edgeRulers && ctx.camera.angle === 0 && !ctx.guidesHidden);
    let nuovo: Gesto | null = null;
    if (righello !== null) {
      // Dal righello in alto una guida orizzontale, da quello a sinistra una verticale.
      nuovo = { kind: "nuova", pointerId: event.pointerId, asse: righello === "y" ? "y" : "x", dove: null };
    } else if (selezione()) {
      const presa = guidaSotto(guideSulloSchermo(stato()), punto);
      if (presa === null) {
        // Un clic fuori dalle guide (senza Maiusc) le toglie dalla scelta; il clic va agli strumenti.
        if (scelte.length > 0 && !event.shiftKey) {
          scelte = [];
          disegna();
        }
        return;
      }
      // Come in VectorCraft: il clic sceglie la guida (e lascia gli oggetti); con Maiusc la
      // aggiunge, o la toglie se era scelta e non si trascina; trascinarla sposta le scelte.
      const giaScelta = scelte.includes(presa.index);
      if (!giaScelta) sceglie(event.shiftKey ? [...scelte, presa.index] : [presa.index]);
      if (ctx.selection.length > 0) ctx.select([]);
      const scena = ctx.sceneAt(event.clientX, event.clientY);
      nuovo = {
        kind: "sposta",
        pointerId: event.pointerId,
        index: presa.index,
        gruppo: [...scelte],
        togliSeClic: giaScelta && event.shiftKey,
        asse: presa.guida.axis,
        da: presa.guida.at,
        inizio: punto,
        inizioScena: scena,
        cominciato: false,
        at: presa.guida.at,
        via: false,
        copia: false,
      };
    }
    if (nuovo === null) return;
    // Il gesto è della guida: gli strumenti non lo vedono.
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      ctx.surface.setPointerCapture(event.pointerId);
    } catch {
      // Non catturabile: il gesto prosegue finché il puntatore resta sopra.
    }
    gesto = nuovo;
    disegna();
  };

  const muovi = (event: PointerEvent): void => {
    if (gesto === null) {
      // Il puntatore che passa accende la guida che si prenderebbe.
      if (event.buttons !== 0 || completo() === null || !selezione()) return cambiaSotto(null);
      const p = ctx.localPoint(event.clientX, event.clientY);
      cambiaSotto(guidaSotto(guideSulloSchermo(stato()), [p.x, p.y]));
      return;
    }
    if (event.pointerId !== gesto.pointerId) return;
    event.stopImmediatePropagation();
    segui(event);
    disegna();
  };

  const segui = (event: PointerEvent): void => {
    if (gesto === null) return;
    const p = ctx.localPoint(event.clientX, event.clientY);
    const punto: Point = [p.x, p.y];
    const scena = ctx.sceneAt(event.clientX, event.clientY);
    const { w, h } = ctx.surfaceSize();
    if (gesto.kind === "nuova") {
      const asse = event.altKey ? (gesto.asse === "x" ? "y" : "x") : gesto.asse;
      const fuori = punto[0] < 0 || punto[1] < 0 || punto[0] > w || punto[1] > h || righelloSotto(punto, ctx.edgeRulers) !== null;
      gesto.dove = fuori ? null : { asse, at: agganciata(asse, asse === "x" ? scena[0] : scena[1], aggancio(event.shiftKey)) };
      return;
    }
    if (!gesto.cominciato) {
      if (Math.hypot(punto[0] - gesto.inizio[0], punto[1] - gesto.inizio[1]) < SOGLIA_TRASCINA_PX) return;
      gesto.cominciato = true;
    }
    const spostamento = gesto.asse === "x" ? scena[0] - gesto.inizioScena[0] : scena[1] - gesto.inizioScena[1];
    gesto.at = agganciata(gesto.asse, gesto.da + spostamento, aggancio(event.shiftKey));
    gesto.copia = event.altKey;
    gesto.via = !event.altKey && lasciataSulRighello(gesto.asse, punto, ctx.edgeRulers);
  };

  const su = (event: PointerEvent): void => {
    if (gesto === null || event.pointerId !== gesto.pointerId) return;
    event.stopImmediatePropagation();
    segui(event);
    const finito = gesto;
    gesto = null;
    const c = completo();
    if (c !== null) {
      if (finito.kind === "nuova") {
        if (finito.dove !== null) {
          // Con lo strumento Tavola, una guida della tavola sotto il punto, come in VectorCraft.
          const valori: Record<string, unknown> = { vertical: finito.dove.asse === "x", pos: finito.dove.at };
          if (ctx.motoreTool === "artboard") {
            const [x, y] = ctx.sceneAt(event.clientX, event.clientY);
            const tavola = ctx.boardsNow().findIndex((b) => x >= b.box.min[0] && x <= b.box.max[0] && y >= b.box.min[1] && y <= b.box.max[1]);
            if (tavola >= 0) valori.artboard = tavola;
          }
          c.eseguiComando?.("guide.add", valori);
        }
      } else if (!finito.cominciato) {
        if (finito.togliSeClic) sceglie(scelte.filter((i) => i !== finito.index));
      } else if (finito.gruppo.length <= 1) {
        if (finito.via) c.eseguiComando?.("guide.remove", { index: finito.index });
        else if (finito.copia) {
          const d = finito.at - finito.da;
          const prima = (ctx.scene.root.guides ?? []).length;
          c.eseguiComando?.("guide.move", { guides: [finito.index], dx: finito.asse === "x" ? d : 0, dy: finito.asse === "y" ? d : 0, copy: true });
          // Come in VectorCraft, resta scelta la copia, in coda alle guide.
          sceglie([prima], prima + 1);
        } else if (finito.at !== finito.da) c.eseguiComando?.("guide.move", { index: finito.index, pos: finito.at });
      } else {
        // Le guide scelte si spostano insieme, lungo l'asse di quella presa.
        const d = finito.at - finito.da;
        const valori = { guides: finito.gruppo, dx: finito.asse === "x" ? d : 0, dy: finito.asse === "y" ? d : 0 };
        if (finito.via) c.eseguiComando?.("guide.remove", { guides: finito.gruppo });
        else if (finito.copia) {
          const prima = (ctx.scene.root.guides ?? []).length;
          c.eseguiComando?.("guide.move", { ...valori, copy: true });
          sceglie(finito.gruppo.map((_, k) => prima + k), prima + finito.gruppo.length);
        } else if (d !== 0) c.eseguiComando?.("guide.move", valori);
      }
    }
    disegnato = "";
    disegna();
  };

  const annulla = (event: PointerEvent): void => {
    if (gesto === null || event.pointerId !== gesto.pointerId) return;
    gesto = null;
    disegnato = "";
    disegna();
  };

  const cambiaSotto = (presa: GuidaSulloSchermo | null): void => {
    const index = presa?.index ?? null;
    if (index === sotto) return;
    sotto = index;
    // Il cursore dice dove la guida si sposta sullo schermo: una guida verticale va a destra
    // e a sinistra, ma con la vista girata di un quarto va su e giù.
    if (presa === null) delete ctx.surface.dataset.guidaSotto;
    else ctx.surface.dataset.guidaSotto = Math.abs(presa.a[0] - presa.b[0]) < Math.abs(presa.a[1] - presa.b[1]) ? "x" : "y";
    disegna();
  };

  ctx.life.listen(ctx.surface, "pointerdown", giu, { capture: true });
  ctx.life.listen(ctx.surface, "pointermove", muovi, { capture: true });
  ctx.life.listen(ctx.surface, "pointerup", su, { capture: true });
  ctx.life.listen(ctx.surface, "pointercancel", annulla, { capture: true });
  ctx.life.listen(ctx.surface, "pointerleave", () => {
    if (gesto === null) cambiaSotto(null);
  });

  /// I tasti delle guide scelte, come in VectorCraft: Canc le toglie, le frecce le spostano
  /// del passo della tastiera (`object.nudge` del motore; Maiusc dieci passi, Alt una copia).
  /// Vero se il tasto è loro.
  ctx.guideKey = (event) => {
    const c = completo();
    if (scelte.length === 0 || c === null || !ctx.editable() || ctx.selection.length > 0 || event.ctrlKey || event.metaKey) return false;
    const freccia = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[event.key as "ArrowLeft"];
    if (event.key === "Delete" || event.key === "Backspace") {
      c.eseguiComando?.("guide.remove", { guides: scelte });
      scelte = [];
    } else if (freccia !== undefined) {
      const prima = (ctx.scene.root.guides ?? []).length;
      const gruppo = scelte;
      c.eseguiComando?.("object.nudge", { dx: freccia[0], dy: freccia[1], big: event.shiftKey, copy: event.altKey, guides: gruppo });
      if (event.altKey) sceglie(gruppo.map((_, k) => prima + k), prima + gruppo.length);
    } else return false;
    disegnato = "";
    disegna();
    return true;
  };

  /// Nascondi guide: le toglie dalla vista, e non si prendono.
  ctx.setGuidesHidden = (nascoste) => {
    if (ctx.disposed || ctx.guidesHidden === nascoste) return;
    ctx.guidesHidden = nascoste;
    cambiaSotto(null);
    disegnato = "";
    disegna();
    ctx.announce(t(nascoste ? "draw.guides.hidden" : "draw.guides.shown"));
  };
  /// Blocca guide: si vedono, ma non si prendono, come in VectorCraft.
  ctx.setGuidesLocked = (bloccate) => {
    if (ctx.disposed || ctx.guidesLocked === bloccate) return;
    ctx.guidesLocked = bloccate;
    cambiaSotto(null);
    disegnato = "";
    disegna();
    ctx.announce(t(bloccate ? "draw.guides.locked" : "draw.guides.unlocked"));
  };
}
