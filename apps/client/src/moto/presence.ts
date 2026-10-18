// Presenza: entrare, e uscire senza trattenere lo stato.
//
// Lo stato cambia subito. Chi chiude una superficie la toglie o la nasconde
// all'istante; ad uscire è una sua immagine ferma, un clone inerte posato sul
// rettangolo che l'elemento occupava. Così nessuna uscita tiene attaccato un
// editor alla sua sessione, e nessun clic cade su qualcosa che non c'è più.
import { animate, group, halt, launch, liveState, type Motion, type MotionSpec, type MotionState, type Pose } from "./animate";
import { motionDriver } from "./driver";
import { motionLevel } from "./level";
import { EXIT_SAFETY_MS } from "./spring";

export interface ExitSpec extends MotionSpec {
  /// Dove posare l'immagine. Di serie il `body`: dentro un contenitore che
  /// qualcuno riconcilia, un figlio estraneo verrebbe tolto o contato.
  layer?: HTMLElement;
}

/// Un'uscita misurata e non ancora partita.
export interface Ghost {
  /// Posa l'immagine e la anima verso `to` (di serie la sola dissolvenza),
  /// poi la toglie. Ritardo e durata insieme non passano `EXIT_SAFETY_MS`:
  /// oltre, la corsa è troncata. Vale una volta.
  play(spec?: ExitSpec): Motion;
}

/// Ciò che in un clone raddoppierebbe un'identità del documento: gli `id`,
/// chi li punta, e i `name`, che legherebbero i suoi pulsanti di scelta e i
/// suoi `details` ai gruppi veri. `autoplay` farebbe ripartire un media.
const STRIPPED = [
  "id",
  "for",
  "name",
  "autoplay",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
];

const MARKED = STRIPPED.map((name) => `[${name}]`).join(",");

/// L'immagine sta fuori dal flusso, non riceve il puntatore e non ripete le
/// trasformazioni a riposo dell'originale: il rettangolo misurato le comprende
/// già. `right` e `bottom` liberi perché in una pagina da destra a sinistra
/// vincerebbero su `left`.
const FIXED: Record<string, string> = {
  position: "fixed",
  right: "auto",
  bottom: "auto",
  margin: "0",
  "box-sizing": "border-box",
  "pointer-events": "none",
  transform: "none",
  translate: "none",
  rotate: "none",
  scale: "none",
};

const IDLE: Ghost = { play: () => group([]) };
/// I bersagli di un elemento che una corsa può muovere.
const TARGETS = ["", "::before", "::after"] as const;
/// L'immagine in uscita di ogni elemento, finché esce: serve a `enter`.
const ghosts = new WeakMap<Element, { node: HTMLElement; motion: Motion }>();

/// Ciò che `cloneNode` non porta con sé: la voce scelta di un `select` e i
/// pixel di un `canvas`.
function copyLiveState(original: Element, copy: Element): void {
  if (original instanceof HTMLSelectElement) {
    (copy as HTMLSelectElement).selectedIndex = original.selectedIndex;
  } else if (original instanceof HTMLCanvasElement) {
    try {
      (copy as HTMLCanvasElement).getContext("2d")?.drawImage(original, 0, 0);
    } catch {
      // Una tela vuota o senza contesto resta bianca: è un'immagine, non stato.
    }
  }
}

/// Misura `el` e ne prepara l'immagine. Va chiamata **prima** di toglierlo o
/// nasconderlo; poi il chiamante cambia lo stato e chiama `play`. Nel livello
/// «ridotto» non crea niente, qualunque sia `whenReduced`.
export function prepareExit(el: HTMLElement): Ghost {
  if (motionLevel() === "reduced" || motionDriver().instant || !el.isConnected) return IDLE;
  // Se stava ancora entrando, l'immagine prosegue da quella posa: il
  // rettangolo si misura a riposo e la posa passa alla corsa d'uscita.
  const inherit = liveState(el);
  halt(el);
  const box = el.getBoundingClientRect();
  // Un elemento senza riquadro (già nascosto) non ha un'uscita da mostrare.
  if (box.width === 0 && box.height === 0) return IDLE;

  const node = el.cloneNode(true) as HTMLElement;
  for (const marked of [node, ...node.querySelectorAll(MARKED)]) {
    for (const name of STRIPPED) marked.removeAttribute(name);
  }
  const originals = [el, ...el.querySelectorAll("*")];
  const copies = [node, ...node.querySelectorAll("*")];
  const scrolled: [Element, number, number][] = [];
  /// Ciò che dentro l'elemento era ancora in corsa (un dialogo che saliva sul
  /// suo velo): nell'immagine prosegue verso il riposo da dov'era, invece di
  /// saltarci. L'elemento stesso no: la sua posa passa alla corsa d'uscita.
  const carried: [Element, (typeof TARGETS)[number], MotionState][] = [];
  originals.forEach((original, index) => {
    copyLiveState(original, copies[index]);
    if (original.scrollTop || original.scrollLeft) {
      scrolled.push([copies[index], original.scrollTop, original.scrollLeft]);
    }
    for (const pseudo of TARGETS) {
      if (index === 0 && pseudo === "") continue;
      const state = liveState(original, pseudo);
      if (state) carried.push([copies[index], pseudo, state]);
    }
  });
  node.setAttribute("aria-hidden", "true");
  node.toggleAttribute("inert", true);
  for (const [property, value] of Object.entries(FIXED)) node.style.setProperty(property, value);
  node.style.setProperty("width", `${box.width}px`);
  node.style.setProperty("height", `${box.height}px`);
  const place = (left: number, top: number): void => {
    node.style.setProperty("left", `${left}px`);
    node.style.setProperty("top", `${top}px`);
  };
  place(box.left, box.top);

  let played = false;
  return {
    play(spec = {}) {
      if (played) return group([]);
      played = true;
      (spec.layer ?? el.ownerDocument.body).append(node);
      // Un antenato trasformato o contenuto fa da riferimento a `fixed`: si
      // guarda dove l'immagine è caduta e la si riporta sul rettangolo.
      const landed = node.getBoundingClientRect();
      if (landed.left !== box.left || landed.top !== box.top) {
        place(2 * box.left - landed.left, 2 * box.top - landed.top);
      }
      for (const [copy, top, left] of scrolled) {
        copy.scrollTop = top;
        copy.scrollLeft = left;
      }
      const to: Pose = spec.to ?? { opacity: 0 };
      const motion = launch(node, { ...spec, to }, {
        inherit,
        limit: EXIT_SAFETY_MS,
        onEnd() {
          node.remove();
          for (const [copy, pseudo] of carried) halt(copy, pseudo);
          if (ghosts.get(el)?.node === node) ghosts.delete(el);
        },
      });
      if (!motion.running) return motion;
      ghosts.set(el, { node, motion });
      for (const [copy, pseudo, state] of carried) {
        launch(copy, { pseudo: pseudo || undefined, lifetime: spec.lifetime }, { inherit: state, limit: EXIT_SAFETY_MS });
      }
      return motion;
    },
  };
}

/// L'uscita in un colpo: misura, posa l'immagine e la anima. Il chiamante la
/// chiama con `el` ancora al suo posto, e subito dopo lo toglie o lo nasconde.
export function exitGhost(el: HTMLElement, spec: ExitSpec = {}): Motion {
  return prepareExit(el).play(spec);
}

/// Fa entrare `el` da `from` verso il riposo. Se una sua immagine sta ancora
/// uscendo, riaprire inverte: l'immagine sparisce e l'elemento riparte dalla
/// posa e dalla velocità che quella aveva.
export function enter(el: Element, spec: MotionSpec & { from: Pose }): Motion {
  const ghost = ghosts.get(el);
  if (!ghost) return animate(el, spec);
  const inherit = liveState(ghost.node);
  ghost.motion.cancel();
  return launch(el, spec, { inherit });
}
