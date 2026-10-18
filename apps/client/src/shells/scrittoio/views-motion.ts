// Il movimento delle viste dichiarative.
//
// Il riconciliatore (`ui/node.ts`) mette l'albero nello stato nuovo, subito, e
// non anima niente. Dalla sua giuntura (`setNodeMotion`) questo modulo sa, per
// ogni contenitore, chi resta, chi esce e chi entra, e muove la differenza: chi
// resta scivola dal posto che aveva (FLIP), chi entra compare, chi esce lascia
// un'immagine ferma che sbiadisce, e la sagoma della voce scelta scorre dalla
// riga di prima a quella di adesso.
//
// Una **passata** è tutto ciò che il riconciliatore fa a una vista in un giro
// sincrono: tocca più contenitori, annidati, anche in più riprese. Le misure
// «prima» si prendono alla prima chiamata della passata, quando il DOM è ancora
// per intero quello vecchio; le misure «dopo» e le corse partono in un
// microtask, a riconciliazione finita e prima che il browser disegni. Fra le
// due non passa un fotogramma, e lo stato è già quello finale.
//
// Dove e quando:
// - solo nelle viste (`.declared-view`, `.pane-view`), non negli incastri del
//   documento, che usano lo stesso riconciliatore;
// - solo nei contenitori di flusso — pile, elenchi, alberi, corpi di sezione e
//   di ramo —, non in tabelle e schede, dove un figlio non è una riga;
// - entra ed esce con un movimento soltanto un figlio **con chiave**: senza,
//   l'identità è la posizione, e a uscire sarebbe sempre l'ultimo;
// - niente al primo disegno (la giuntura non chiama), niente se la vista non si
//   vede, niente se la passata tocca più di `CHANGED_MAX` voci o la vista ne ha
//   più di `MEASURED_MAX` da misurare. In un contenitore dove cambia più di
//   quanto resta non c'è continuità da mostrare: è un altro elenco;
// - «ridotto»: resta la sola dissolvenza di chi entra. «Calmo»: le stesse
//   corse senza rimbalzo, e lo fa `moto`.
//
// Il FLIP è fatto a mano e non con `flip` di `moto`: una foglia che resta è un
// elemento nuovo (il riconciliatore la ricostruisce), le misure si annidano, e
// «prima» e «dopo» stanno ai due capi di un giro che non è nostro.
import {
  DURATION,
  animate,
  enter,
  liveState,
  motionLevel,
  prepareExit,
  stagger,
  type Ghost,
  type Motion,
  type MotionState,
  type Pose,
} from "../../moto";
import type { Lifetime } from "../../ui/lifetime";
import { setNodeMotion } from "../../ui/node";

/// Dove una vista dichiarativa è montata.
const HOSTS = ".declared-view, .pane-view";
/// I contenitori i cui figli stanno in fila. Il corpo di un gruppo di schede
/// ha la stessa classe ma tiene pannelli sovrapposti: lo esclude `isFlow`.
const FLOW = ".ui-list, .ui-tree, .ui-stack, div.ui-children";
/// La riga che porta la sagoma della voce scelta, e l'elenco che ne è il piano
/// (le due metà della regola in `theme/scrittoio/skin/nodes.css`).
const SELECTED = '.ui-list-item[aria-current="true"], .ui-tree-item[aria-selected="true"] > .ui-tree-label';
const SCOPES = ".ui-list, .ui-tree";

/// Oltre queste voci da misurare una vista cambia e basta.
export const MEASURED_MAX = 160;
/// Oltre queste voci entrate o uscite in una passata, anche.
export const CHANGED_MAX = 8;
/// Un sottoalbero più grande di così non si clona per vederlo sbiadire.
export const GHOST_NODES_MAX = 80;
/// Di quanto scende chi entra (px).
const ENTER_RISE_PX = 6;
/// Sotto questa differenza (px) un elemento non si è mosso.
const NEGLIGIBLE_PX = 0.5;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Offset {
  x: number;
  y: number;
}

/// Un elemento com'era prima della passata.
interface Before {
  /// Dove lo si vedeva: il riquadro a riposo, più la posa sua e dei suoi
  /// antenati se una corsa era in volo.
  box: Box;
  /// Di quanto la posa in volo lo scostava dal riposo.
  drift: Offset;
  /// La corsa che aveva: da lì riparte.
  live: MotionState | null;
}

/// La voce scelta di un elenco prima della passata.
interface Mark {
  scope: Element;
  row: Element;
  /// Dove si vedeva la sagoma, corsa compresa.
  box: Box;
  live: MotionState | null;
}

interface Exit {
  ghost: Ghost;
  parent: HTMLElement;
  key: string;
  from: Pose | undefined;
}

interface Pass {
  readonly host: HTMLElement;
  /// La vista non si vede: non si misura e non si muove niente.
  blind: boolean;
  /// Troppo da misurare o da muovere: resta solo la sagoma della voce scelta.
  off: boolean;
  /// Qualcuno è entrato, uscito o ha cambiato posto.
  moved: boolean;
  /// C'erano corse in volo: ripartono anche se niente ha cambiato posto.
  flying: boolean;
  changed: number;
  readonly before: Map<Element, Before>;
  /// Chi restava in ogni contenitore, fra il prima e il dopo di quel giro.
  readonly frames: Map<HTMLElement, readonly HTMLElement[]>;
  /// I contenitori dove è cambiato più di quanto è rimasto.
  readonly replaced: Set<HTMLElement>;
  /// L'elemento nuovo e quello di cui ha preso il posto.
  readonly alias: Map<Element, Element>;
  readonly entered: HTMLElement[];
  readonly exits: Exit[];
  readonly marks: Mark[];
  /// Ciò che della vista si vede, in coordinate di finestra; `null` se niente.
  clip: Box | null | undefined;
}

const NO_OFFSET: Offset = { x: 0, y: 0 };

function boxOf(el: Element): Box {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const shown = (box: Box): boolean => box.width > 0 && box.height > 0;

function touches(box: Box, clip: Box | null): boolean {
  return (
    clip !== null &&
    box.left < clip.left + clip.width &&
    box.left + box.width > clip.left &&
    box.top < clip.top + clip.height &&
    box.top + box.height > clip.top
  );
}

function within(box: Box, clip: Box | null): boolean {
  return (
    clip !== null &&
    box.left >= clip.left - NEGLIGIBLE_PX &&
    box.top >= clip.top - NEGLIGIBLE_PX &&
    box.left + box.width <= clip.left + clip.width + NEGLIGIBLE_PX &&
    box.top + box.height <= clip.top + clip.height + NEGLIGIBLE_PX
  );
}

const CLIPPING = /^(?:auto|scroll|hidden|clip)$/;

/// La parte di finestra in cui `host` si vede: la finestra, stretta da ogni
/// antenato che taglia ciò che sporge.
function visibleArea(host: HTMLElement): Box | null {
  const view = host.ownerDocument.defaultView;
  if (!view) return null;
  let left = 0;
  let top = 0;
  let right = view.innerWidth;
  let bottom = view.innerHeight;
  for (let el: HTMLElement | null = host; el; el = el.parentElement) {
    const style = view.getComputedStyle(el);
    if (!CLIPPING.test(style.overflowX) && !CLIPPING.test(style.overflowY)) continue;
    const box = boxOf(el);
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.left + box.width);
    bottom = Math.min(bottom, box.top + box.height);
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function isFlow(el: Element): boolean {
  return el.matches(FLOW) && !(el.classList.contains("ui-children") && el.parentElement?.matches(".ui-tabs"));
}

function flowContainers(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(FLOW)].filter(isFlow);
}

/// Vero se `kept` sta già nel DOM nell'ordine in cui starà.
function inOrder(kept: readonly HTMLElement[]): boolean {
  for (let i = 1; i < kept.length; i++) {
    if (!(kept[i - 1].compareDocumentPosition(kept[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
  }
  return true;
}

/// Il riquadro di una sagoma in corsa: centro spostato, lati scalati.
function posed(box: Box, pose: Pose): Box {
  const width = box.width * (pose.scaleX ?? 1);
  const height = box.height * (pose.scaleY ?? 1);
  return {
    left: box.left + box.width / 2 + (pose.x ?? 0) - width / 2,
    top: box.top + box.height / 2 + (pose.y ?? 0) - height / 2,
    width,
    height,
  };
}

/// Accende il movimento delle viste per la vita di `lifetime`.
export function mountViewsMotion(lifetime: Lifetime): void {
  /// Le passate aperte: una per vista, fino al suo microtask.
  const passes = new Map<HTMLElement, Pass>();
  /// Le corse vive sugli elementi (FLIP ed entrate), per fermarle a misura e
  /// farle ripartire da dov'erano.
  const flights = new Map<Element, Motion>();
  /// Le sagome in corsa, per riga.
  const glides = new Map<Element, Motion>();
  /// Le immagini che stanno uscendo, per contenitore e chiave: se la stessa
  /// voce rientra, l'immagine le cede il posto.
  const fading = new WeakMap<HTMLElement, Map<string, { motion: Motion; node: Element | null }>>();

  function track(registry: Map<Element, Motion>, el: Element, motion: Motion): void {
    if (!motion.running) return;
    registry.set(el, motion);
    void motion.finished.then(() => {
      if (registry.get(el) === motion) registry.delete(el);
    });
  }

  function open(host: HTMLElement): Pass {
    const pass: Pass = {
      host,
      blind: false,
      off: false,
      moved: false,
      flying: false,
      changed: 0,
      before: new Map(),
      frames: new Map(),
      replaced: new Set(),
      alias: new Map(),
      entered: [],
      exits: [],
      marks: [],
      clip: undefined,
    };
    passes.set(host, pass);
    queueMicrotask(() => flush(pass));
    if (host.ownerDocument.visibilityState === "hidden" || boxOf(host).width === 0) {
      pass.blind = true;
      return pass;
    }
    if (motionLevel() === "reduced") return pass;

    // Le corse ancora vive della vista si fermano qui: le misure vogliono il
    // layout nudo, e ognuna riparte nel microtask dalla posa che aveva.
    const poses = new Map<Element, MotionState>();
    for (const [el, motion] of [...flights]) {
      if (!host.contains(el)) continue;
      const state = motion.running ? liveState(el) : null;
      if (state) poses.set(el, state);
      motion.cancel();
      flights.delete(el);
    }
    pass.flying = poses.size > 0;
    const drift = (el: Element): Offset => {
      if (poses.size === 0) return NO_OFFSET;
      let x = 0;
      let y = 0;
      for (let at: Element | null = el; at && at !== host; at = at.parentElement) {
        const pose = poses.get(at)?.pose;
        if (!pose) continue;
        x += pose.x ?? 0;
        y += pose.y ?? 0;
      }
      return x || y ? { x, y } : NO_OFFSET;
    };

    const containers = flowContainers(host);
    if (containers.reduce((sum, container) => sum + container.children.length, 0) > MEASURED_MAX) {
      pass.off = true;
    } else {
      for (const container of containers) {
        for (const el of container.children) {
          const box = boxOf(el);
          const by = drift(el);
          pass.before.set(el, {
            box: by === NO_OFFSET ? box : { ...box, left: box.left + by.x, top: box.top + by.y },
            drift: by,
            live: poses.get(el) ?? null,
          });
        }
      }
    }

    const marks = new Map<Element, Mark | null>();
    for (const row of host.querySelectorAll(SELECTED)) {
      const scope = row.closest(SCOPES);
      if (!scope) continue;
      if (marks.has(scope)) {
        // Due voci scelte nello stesso elenco: non c'è una riga da cui partire.
        marks.set(scope, null);
        continue;
      }
      const rest = boxOf(row);
      const by = drift(row);
      const live = liveState(row, "::after");
      const box = { ...rest, left: rest.left + by.x, top: rest.top + by.y };
      marks.set(scope, { scope, row, box: live ? posed(box, live.pose) : box, live });
    }
    for (const mark of marks.values()) if (mark) pass.marks.push(mark);
    return pass;
  }

  function clipOf(pass: Pass): Box | null {
    if (pass.clip === undefined) pass.clip = visibleArea(pass.host);
    return pass.clip;
  }

  function before(
    parent: HTMLElement,
    kept: readonly HTMLElement[],
    leaving: readonly HTMLElement[],
    entering: number,
  ): void {
    const host = parent.closest<HTMLElement>(HOSTS);
    if (!host || lifetime.closed) return;
    const pass = passes.get(host) ?? open(host);
    pass.frames.set(parent, kept);
    if (pass.blind || !isFlow(parent)) return;
    if (leaving.length === 0 && entering === 0 && inOrder(kept)) return;

    pass.moved = true;
    pass.changed += leaving.length + entering;
    if (pass.changed > CHANGED_MAX) pass.off = true;
    if (leaving.length > 0 && entering > 0 && leaving.length + entering > kept.length) {
      pass.replaced.add(parent);
      return;
    }
    pass.replaced.delete(parent);
    if (pass.off) return;
    for (const el of leaving) {
      const key = el.dataset.key;
      const was = pass.before.get(el);
      // Un'immagine `fixed` non è tagliata dal pannello che scorre: esce solo
      // chi si vedeva per intero.
      if (key === undefined || !was || !shown(was.box) || !within(was.box, clipOf(pass))) continue;
      if (el.getElementsByTagName("*").length > GHOST_NODES_MAX) continue;
      const from =
        was.live || was.drift !== NO_OFFSET
          ? { x: was.drift.x, y: was.drift.y, opacity: was.live?.pose.opacity }
          : undefined;
      pass.exits.push({ ghost: prepareExit(el), parent, key, from });
    }
  }

  function after(parent: HTMLElement, kept: readonly HTMLElement[], entered: readonly HTMLElement[]): void {
    const host = parent.closest<HTMLElement>(HOSTS);
    const pass = host ? passes.get(host) : undefined;
    if (!pass) return;
    const was = pass.frames.get(parent);
    pass.frames.delete(parent);
    if (was) {
      kept.forEach((el, index) => {
        const old = was[index];
        if (old && old !== el) pass.alias.set(el, old);
      });
    }
    if (pass.blind || !isFlow(parent) || pass.replaced.has(parent)) return;
    for (const el of entered) {
      if (el.dataset.key !== undefined) pass.entered.push(el);
    }
  }

  function flush(pass: Pass): void {
    const { host } = pass;
    if (passes.get(host) === pass) passes.delete(host);
    if (lifetime.closed || pass.blind || !host.isConnected) return;
    const reduced = motionLevel() === "reduced";
    /// L'elemento di prima della passata di cui `el` ha preso il posto.
    const origin = (el: Element): Element => {
      let at = el;
      for (let old = pass.alias.get(at); old; old = pass.alias.get(at)) at = old;
      return at;
    };
    /// Di quanto, in tutto, si sta spostando ciò che contiene `el`.
    const applied = new Map<Element, Offset>();
    const carried = (el: Element | null): Offset => {
      for (let at = el; at && at !== host; at = at.parentElement) {
        const offset = applied.get(at);
        if (offset) return offset;
      }
      return NO_OFFSET;
    };

    // Prima tutte le misure, poi le corse: una corsa avviata sposta già
    // l'elemento e ciò che contiene, e una misura presa dopo la conterrebbe.
    const clip = clipOf(pass);
    const kept: { el: Element; container: HTMLElement; was: Before; now: Box }[] = [];
    if (!reduced && !pass.off && (pass.moved || pass.flying)) {
      for (const container of flowContainers(host)) {
        for (const el of container.children) {
          const was = pass.before.get(origin(el));
          if (!was || !shown(was.box)) continue;
          const now = boxOf(el);
          if (shown(now)) kept.push({ el, container, was, now });
        }
      }
    }
    const fresh = pass.off
      ? []
      : pass.entered.filter((el) => {
          if (!host.contains(el)) return false;
          const box = boxOf(el);
          return shown(box) && touches(box, clip);
        });
    const chosen: { mark: Mark; row: Element; now: Box | null }[] = [];
    for (const mark of reduced ? [] : pass.marks) {
      if (!mark.scope.isConnected) continue;
      const rows = [...mark.scope.querySelectorAll(SELECTED)].filter((row) => row.closest(SCOPES) === mark.scope);
      if (rows.length !== 1 || rows[0] === mark.row) continue;
      // La stessa voce, ricostruita, non ha un posto nuovo da misurare.
      chosen.push({ mark, row: rows[0], now: origin(rows[0]) === mark.row ? null : boxOf(rows[0]) });
    }

    // Chi resta: dal posto in cui lo si vedeva a quello che ha. Un contenitore
    // viene prima di ciò che contiene, così un figlio toglie dal proprio
    // scarto quello che il padre sta già percorrendo.
    for (const { el, container, was, now } of kept) {
      const base = carried(container);
      const x = was.box.left - now.left - base.x;
      const y = was.box.top - now.top - base.y;
      const still = Math.abs(x) < NEGLIGIBLE_PX && Math.abs(y) < NEGLIGIBLE_PX;
      if (still && !was.live) continue;
      if (!touches(was.box, clip) && !touches(now, clip)) continue;
      const motion = animate(el, {
        from: { x, y, opacity: was.live?.pose.opacity },
        velocity: was.live?.velocity,
        spring: "soft",
        lifetime,
      });
      track(flights, el, motion);
      applied.set(el, { x: base.x + x, y: base.y + y });
    }

    // Chi entra: compare scendendo di poco, una voce dopo l'altra. Se la sua
    // immagine stava ancora uscendo, riparte dall'opacità di quella.
    stagger(fresh, (el) => {
      const parent = el.parentElement;
      const leaving = parent ? fading.get(parent)?.get(el.dataset.key ?? "") : undefined;
      let opacity = 0;
      if (leaving?.motion.running) {
        opacity = (leaving.node && liveState(leaving.node)?.pose.opacity) ?? 0;
        leaving.motion.cancel();
      }
      const motion = enter(el, {
        from: { opacity, y: -ENTER_RISE_PX },
        spring: "soft",
        whenReduced: "fade",
        lifetime,
      });
      track(flights, el, motion);
      return motion;
    });
    if (reduced) return;

    // Chi esce: l'immagine presa prima sbiadisce dov'era.
    if (!pass.off) {
      for (const exit of pass.exits) {
        if (pass.replaced.has(exit.parent)) continue;
        const motion = exit.ghost.play({
          from: exit.from,
          to: { opacity: 0 },
          duration: DURATION.swap,
          // Nella vista, per ereditarne la pelle, ma fuori dall'albero
          // montato: lì dentro una chiave doppia confonderebbe una patch.
          layer: host,
          lifetime,
        });
        if (!motion.running) continue;
        const node = host.lastElementChild;
        let byKey = fading.get(exit.parent);
        if (!byKey) fading.set(exit.parent, (byKey = new Map()));
        const entry = { motion, node: node?.hasAttribute("inert") ? node : null };
        const keyed = byKey;
        keyed.set(exit.key, entry);
        void motion.finished.then(() => {
          if (keyed.get(exit.key) === entry) keyed.delete(exit.key);
        });
      }
    }

    // La voce scelta: la sagoma parte da dove stava quella di prima.
    for (const { mark, row, now } of chosen) {
      glides.get(mark.row)?.cancel();
      if (!now) {
        // La sagoma, se correva, prosegue sull'elemento nuovo.
        if (mark.live) {
          const carry = animate(row, {
            pseudo: "::after",
            from: mark.live.pose,
            velocity: mark.live.velocity,
            spring: "soft",
            lifetime,
          });
          track(glides, row, carry);
        }
        continue;
      }
      if (!shown(now) || !shown(mark.box) || !touches(now, clip) || !touches(mark.box, clip)) continue;
      const base = carried(row);
      const motion = animate(row, {
        pseudo: "::after",
        from: {
          x: mark.box.left + mark.box.width / 2 - (now.left + now.width / 2) - base.x,
          y: mark.box.top + mark.box.height / 2 - (now.top + now.height / 2) - base.y,
          scaleX: mark.box.width / now.width,
          scaleY: mark.box.height / now.height,
        },
        velocity: mark.live ? { x: mark.live.velocity.x, y: mark.live.velocity.y } : undefined,
        spring: "soft",
        lifetime,
      });
      track(glides, row, motion);
    }
  }

  lifetime.add(setNodeMotion({ before, after }));
  lifetime.add(() => {
    passes.clear();
    flights.clear();
    glides.clear();
  });
}
