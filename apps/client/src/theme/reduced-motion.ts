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

function onChange(event: MediaQueryListEvent): void {
  reduced = event.matches;
  const generation = ++dispatchGeneration;
  for (const subscription of listeners) {
    if (subscription.active && subscription.generation < generation) {
      subscription.listener(reduced);
    }
  }
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
  return reduced;
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
