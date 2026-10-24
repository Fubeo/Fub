// La coreografia delle superfici sovrane della shell: modali, menu, pannelli.
//
// Passa da `moto`, come tutto il resto: lo stato cambia subito e ciò che si
// vede è la differenza. Una superficie entra dalla sua posa verso il riposo del
// CSS; esce lasciando un'immagine ferma che se ne va in `DURATION.swap` al
// più, mentre lei è già nascosta o tolta. Riaprirla mentre l'immagine esce la
// fa ripartire da lì (`enter`). Niente fotogrammi chiave nella pelle e niente
// View Transitions: animano una fotografia della pagina invece dell'elemento,
// non sentono il livello del moto, e su alcuni WebKitGTK la cattura del
// vecchio fotogramma fa cadere il processo.
import { DURATION, animate, enter, exitGhost, type Pose, type SpringName } from "../moto";

interface SurfaceMotion {
  /// Da dove entra la superficie, verso il suo riposo.
  readonly from: Pose;
  /// Dove va l'immagine che esce.
  readonly to: Pose;
  readonly spring: SpringName;
  /// Quanto dura l'uscita: una voce di `DURATION`, letta quando si esce.
  readonly leave: "state" | "swap";
  /// Una parte che entra a modo suo, dentro la superficie.
  readonly part?: { readonly selector: string; readonly from: Pose };
}

const FADE: SurfaceMotion = { from: { opacity: 0 }, to: { opacity: 0 }, spring: "soft", leave: "swap" };

/// Le superfici, dalla prima che corrisponde. Le altre sfumano.
const SURFACES: readonly (readonly [string, SurfaceMotion])[] = [
  // Il velo sfuma, la scatola scende dall'alto.
  [".modale", { ...FADE, part: { selector: ".palette-box", from: { y: -12 } } }],
  [
    ".settings-panel, .icon-picker",
    { from: { y: 12, opacity: 0 }, to: { y: 6, scale: 0.99, opacity: 0 }, spring: "soft", leave: "swap" },
  ],
  // La modale di una vista: come quella della shell, il pannello sale.
  [".views-modal", { ...FADE, part: { selector: ".declared-view-panel", from: { y: 12 } } }],
  // Un avviso sale dal bordo.
  [".toast", { from: { y: 12, opacity: 0 }, to: { opacity: 0 }, spring: "soft", leave: "swap" }],
  // I centri e i popover scendono appena dal bottone che li apre. Il menu si
  // apre dal punto chiesto (l'origine la mette `ui/menu.ts`), e se ne va più
  // in fretta. Entrando niente scala: dopo una corsa composita con una scala
  // Chromium dipinge un elemento posato su una frazione di pixel un pixel più
  // in là, e lo stato d'arrivo non sarebbe più quello del moto ridotto.
  [
    ".dock-panel, .graph-panel-popover",
    { from: { y: -4, opacity: 0 }, to: { y: -2, scale: 0.98, opacity: 0 }, spring: "snap", leave: "swap" },
  ],
  [".context-menu", { from: { y: -4, opacity: 0 }, to: { y: -2, scale: 0.98, opacity: 0 }, spring: "snap", leave: "state" }],
  // Il disco del menu radiale cresce dal centro mentre lo strato appare.
  [".draw-radial", { ...FADE, part: { selector: ".draw-radial-ring", from: { scale: 0.8 } } }],
];

function motionOf(element: HTMLElement): SurfaceMotion {
  return SURFACES.find(([selector]) => element.matches(selector))?.[1] ?? FADE;
}

/// Fa entrare una superficie già nel suo stato visibile. Se una sua immagine
/// stava uscendo, riparte da dove quella era.
export function enterSurface(element: HTMLElement): void {
  const motion = motionOf(element);
  enter(element, { from: motion.from, spring: motion.spring, whenReduced: "fade" });
  const part = motion.part ? element.querySelector<HTMLElement>(motion.part.selector) : null;
  if (part && motion.part) animate(part, { from: motion.part.from, spring: motion.spring, whenReduced: "none" });
}

/// Fa uscire una superficie: ne lascia un'immagine che se ne va, poi chiama
/// subito `conceal`, che la nasconde o la toglie. Lo stato è già quello finale:
/// chi apre un'altra superficie non trova questa sotto.
export function exitSurface(element: HTMLElement, conceal: () => void): void {
  if (element.isConnected && !element.hidden) {
    const motion = motionOf(element);
    exitGhost(element, { to: motion.to, duration: DURATION[motion.leave], easing: "ease-in" });
  }
  conceal();
}
