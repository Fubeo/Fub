// Il canale unico per la preferenza di moto ridotto: legge il browser una volta e diffonde i cambi.

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

type Listener = (reduced: boolean) => void;

let mounted = false;
let reduced = false;
let media: MediaQueryList | null = null;
const listeners = new Set<Listener>();

function onChange(event: MediaQueryListEvent): void {
  reduced = event.matches;
  for (const listener of listeners) listener(reduced);
}

function ensureMounted(): void {
  if (mounted) return;
  mounted = true;
  if (typeof window === "undefined") return;
  media = window.matchMedia?.(REDUCED_QUERY) ?? null;
  reduced = media?.matches ?? false;
  if (media?.addEventListener) media.addEventListener("change", onChange);
  else media?.addListener(onChange);
}

export function reducedMotion(): boolean {
  ensureMounted();
  return reduced;
}

export function onReducedMotionChange(listener: Listener): () => void {
  ensureMounted();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
