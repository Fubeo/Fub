// FLIP: le continuità di layout come trasformazioni.
//
// Si misura prima, si lascia che il chiamante muti il DOM, si misura dopo, e
// si anima la differenza verso l'identità. Il layout è già quello finale dal
// primo fotogramma; ciò che si vede muovere è solo la distanza dal vecchio.
import type { Lifetime } from "../ui/lifetime";
import { animate, group, halt, liveState, type Motion, type Pose } from "./animate";
import { motionDriver } from "./driver";
import { motionLevel } from "./level";
import type { Spring, SpringName } from "./spring";

export interface FlipOptions {
  /// Di serie `soft`.
  spring?: SpringName | Spring;
  /// Anima anche il cambio di dimensione, come scala. Di serie sì; senza, si
  /// spostano solo i centri.
  scale?: boolean;
  /// Se c'è, la corsa è una curva a tempo (ms), come in `animate`: chi sale
  /// al posto di ciò che esce finisce entro il tempo dell'uscita.
  duration?: number;
  easing?: string;
  lifetime?: Lifetime;
}

/// Sotto questa differenza (px) un elemento non si è mosso.
const NEGLIGIBLE_PX = 0.5;

/// L'origine della trasformazione dentro il riquadro, in px. Dove il motore
/// non la sa dire vale il centro, che è il valore iniziale del CSS.
function originOf(el: Element, box: DOMRect): [number, number] {
  const match = /^(-?[\d.]+)px (-?[\d.]+)px/.exec(getComputedStyle(el).transformOrigin ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [box.width / 2, box.height / 2];
}

/// Esegue `mutate` e anima ogni elemento dal riquadro che aveva a quello che
/// ha. Un elemento già in volo parte da dove lo si vede, con la sua velocità.
/// Quelli comparsi o spariti non sono affar suo: restano dove il layout li mette.
export function flip(
  targets: Iterable<Element>,
  mutate: () => void,
  options: FlipOptions = {},
): Motion {
  if (motionLevel() === "reduced" || motionDriver().instant) {
    mutate();
    return group([]);
  }
  const items = [...targets];
  // La misura «prima» comprende la trasformazione di una corsa in volo.
  const before = items.map((el) => ({ box: el.getBoundingClientRect(), live: liveState(el) }));
  mutate();
  // La misura «dopo» vuole il layout nudo: le corse vecchie si fermano prima.
  for (const el of items) halt(el);
  const after = items.map((el) => el.getBoundingClientRect());

  const resize = options.scale !== false;
  const motions: Motion[] = [];
  items.forEach((el, index) => {
    const { box: a, live } = before[index];
    const b = after[index];
    if (!(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0)) return;
    const scaleX = resize ? a.width / b.width : 1;
    const scaleY = resize ? a.height / b.height : 1;
    // La scala agisce attorno all'origine dell'elemento: se non è il centro,
    // la traslazione la compensa, e i centri viaggiano comunque in linea retta.
    const [originX, originY] = resize ? originOf(el, b) : [b.width / 2, b.height / 2];
    const x = a.left + a.width / 2 - (b.left + b.width / 2) + (b.width / 2 - originX) * (1 - scaleX);
    const y = a.top + a.height / 2 - (b.top + b.height / 2) + (b.height / 2 - originY) * (1 - scaleY);
    const resized =
      resize &&
      (Math.abs(a.width - b.width) >= NEGLIGIBLE_PX || Math.abs(a.height - b.height) >= NEGLIGIBLE_PX);
    if (Math.abs(x) < NEGLIGIBLE_PX && Math.abs(y) < NEGLIGIBLE_PX && !resized && !live) return;

    // Ciò che una corsa in volo aveva oltre la geometria prosegue da dov'era.
    const from: Pose = { x, y, scaleX, scaleY, rotate: live?.pose.rotate, opacity: live?.pose.opacity };
    // La scala vecchia era riferita al riquadro vecchio: la sua velocità si
    // riporta a quello nuovo.
    const rebased = (speed: number | undefined, now: number, was: number | undefined): number =>
      resize && speed && was ? (speed * now) / was : 0;
    const velocity: Pose | undefined = live
      ? {
          ...live.velocity,
          scaleX: rebased(live.velocity.scaleX, scaleX, live.pose.scaleX),
          scaleY: rebased(live.velocity.scaleY, scaleY, live.pose.scaleY),
        }
      : undefined;
    motions.push(
      animate(el, {
        from,
        velocity,
        spring: options.spring ?? "soft",
        duration: options.duration,
        easing: options.easing,
        lifetime: options.lifetime,
      }),
    );
  });
  return group(motions);
}
