// Il canale unico per la preferenza di moto ridotto: legge il browser una volta e diffonde i cambi.

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

type Listener = (reduced: boolean) => void;
type Subscription = {
  listener: Listener;
  active: boolean;
  generation: number;
};

let media: MediaQueryList | null = null;
let mediaInitialized = false;
let reduced = false;
/// `appearance.motion = reduced`: l'utente chiede meno moto anche se il
/// sistema non lo dice. Si somma alla preferenza del sistema, non la sostituisce.
let forced = false;
let nativeListenerAttached = false;
let dispatchGeneration = 0;
const listeners = new Set<Subscription>();

function ensureMedia(): MediaQueryList | null {
  if (mediaInitialized || typeof window === "undefined") return media;
  mediaInitialized = true;
  media = window.matchMedia?.(REDUCED_QUERY) ?? null;
  reduced = media?.matches ?? false;
  return media;
}

function dispatch(): void {
  const effective = forced || reduced;
  const generation = ++dispatchGeneration;
  for (const subscription of listeners) {
    if (subscription.active && subscription.generation < generation) {
      subscription.listener(effective);
    }
  }
}

function onChange(event: MediaQueryListEvent): void {
  const before = forced || reduced;
  reduced = event.matches;
  if (before !== (forced || reduced)) dispatch();
}

/// La preferenza dell'utente (`appearance.motion`). La scrive anche sul
/// documento, perché il pavimento CSS di `structure.css` spenga le transizioni
/// come fa con la preferenza del sistema.
export function setReducedMotionPreference(reduce: boolean): void {
  ensureMedia();
  const before = forced || reduced;
  forced = reduce;
  if (typeof document !== "undefined") {
    if (reduce) document.documentElement.dataset.motion = "reduced";
    else delete document.documentElement.dataset.motion;
  }
  if (before !== (forced || reduced)) dispatch();
}

function attachNativeListener(): void {
  const current = ensureMedia();
  if (!current || nativeListenerAttached) return;
  reduced = current.matches;
  if (current.addEventListener) current.addEventListener("change", onChange);
  else current.addListener(onChange);
  nativeListenerAttached = true;
}

function detachNativeListener(): void {
  if (!media || !nativeListenerAttached) return;
  if (media.removeEventListener) media.removeEventListener("change", onChange);
  else media.removeListener(onChange);
  nativeListenerAttached = false;
}

export function reducedMotion(): boolean {
  ensureMedia();
  return forced || reduced;
}

export function onReducedMotionChange(listener: Listener): () => void {
  ensureMedia();
  const subscription: Subscription = { listener, active: true, generation: dispatchGeneration };
  listeners.add(subscription);
  if (listeners.size === 1) attachNativeListener();
  return () => {
    if (!subscription.active) return;
    subscription.active = false;
    listeners.delete(subscription);
    if (listeners.size === 0) detachNativeListener();
  };
}
