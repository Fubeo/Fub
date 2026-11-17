// Il lavoro che si fa prima che serva, quando l'utente non sta facendo niente.
//
// Certe prime volte costano più delle altre per ragioni che non sono di chi
// apre la cosa: la WebView compila le sue procedure di disegno al primo canvas
// che le usa, un carattere caricato tardi ricalcola lo stile della pagina. Chi
// ha una prima volta cara le registra qui un compito (`register`), e la shell,
// a consegna finita, fa partire la coda (`start`).
//
// Le regole:
//
// - **Mai sopra un gesto.** Il primo compito aspetta `startMs` dalla partenza,
//   e ogni passo aspetta che puntatore, tastiera e rotella stiano fermi da
//   `quietMs`; poi un fotogramma, così il passo ha davanti un fotogramma
//   intero e non ruba quello di un'animazione. Un compito con più passi pesanti
//   chiama `next()` prima di ognuno: fra un passo e l'altro torna il silenzio.
// - **Uno alla volta**, nell'ordine in cui sono stati registrati. Un compito
//   registrato a coda partita si mette in fondo.
// - **È un suggerimento.** Un errore non si dice a nessuno e non ferma i
//   compiti dopo: senza riscaldamento la prima volta costa come prima.
// - **Ha un padrone.** Lo smontaggio di `register` toglie il compito che non è
//   partito e ferma quello partito al suo prossimo `next()`; chiudere la vita
//   data a `start` ferma la coda allo stesso modo.
import type { Lifetime, Teardown } from "./lifetime";

/// Un compito di riscaldamento. `next()` si risolve quando si può fare il
/// passo dopo, e rifiuta quando il compito non deve più continuare.
export type WarmTask = (next: () => Promise<void>) => Promise<void> | void;

export interface WarmupOptions {
  /// Quanto aspettare dalla partenza prima del primo compito.
  readonly startMs?: number;
  /// Quanto devono stare fermi puntatore, tastiera e rotella prima di un passo.
  readonly quietMs?: number;
  /// Per i test: il fotogramma (predefinito `requestAnimationFrame`).
  readonly frame?: (run: () => void) => void;
  /// Per i test: l'orologio (predefinito `performance.now`).
  readonly now?: () => number;
}

/// Dopo la consegna l'app ha ancora l'ultima entrata delle regioni e i primi
/// dati del vault in arrivo: due secondi la lasciano finire.
export const WARM_START_MS = 2000;
/// Una pausa più lunga di quella fra due tasti o due movimenti del mouse di chi
/// sta lavorando.
export const WARM_QUIET_MS = 600;

const INPUT = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/// Il rifiuto di `next()` quando il compito deve smettere.
class Stopped extends Error {}

export interface Warmups {
  register(task: WarmTask): Teardown;
  start(lifetime: Lifetime, options?: WarmupOptions): void;
}

export function createWarmups(): Warmups {
  interface Entry {
    readonly task: WarmTask;
    removed: boolean;
  }
  const queue: Entry[] = [];
  let kick: (() => void) | null = null;

  return {
    register(task) {
      const entry: Entry = { task, removed: false };
      queue.push(entry);
      kick?.();
      return () => {
        entry.removed = true;
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
      };
    },
    start(lifetime, options = {}) {
      if (kick !== null || lifetime.closed) return;
      const startMs = options.startMs ?? WARM_START_MS;
      const quietMs = options.quietMs ?? WARM_QUIET_MS;
      let pendingFrame: number | null = null;
      const frame =
        options.frame ??
        ((run: () => void) => {
          pendingFrame = requestAnimationFrame(() => {
            pendingFrame = null;
            run();
          });
        });
      const now = options.now ?? (() => performance.now());
      let lastInput = now();
      for (const type of INPUT) {
        lifetime.listen(window, type, () => (lastInput = now()), { capture: true, passive: true });
      }
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const later = (run: () => void, ms: number): void => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          run();
        }, ms);
        timers.add(timer);
      };
      lifetime.add(() => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      });

      /// Si risolve dopo `quietMs` senza ingressi e un fotogramma; non si
      /// risolve più a vita chiusa (la coda resta ferma lì, senza timer).
      const quiet = (): Promise<void> =>
        new Promise((resolve) => {
          const check = (): void => {
            if (lifetime.closed) return;
            const wait = lastInput + quietMs - now();
            if (wait > 0) later(check, wait);
            else frame(() => later(() => (lifetime.closed ? undefined : resolve()), 0));
          };
          check();
        });

      let running = false;
      let started = false;
      const run = async (): Promise<void> => {
        if (running || !started) return;
        running = true;
        try {
          while (!lifetime.closed && queue.length > 0) {
            const entry = queue.shift()!;
            const next = async (): Promise<void> => {
              await quiet();
              if (entry.removed || lifetime.closed) throw new Stopped();
            };
            try {
              await entry.task(next);
            } catch {
              // Un suggerimento: senza riscaldamento la prima volta costa
              // come prima, e i compiti dopo partono lo stesso.
            }
          }
        } finally {
          running = false;
        }
      };
      const ownKick = (): void => void run();
      kick = ownKick;
      // A vita chiusa la coda si può far ripartire con un'altra vita (una
      // shell rimontata): i compiti non ancora partiti aspettano lì.
      lifetime.add(() => {
        if (kick === ownKick) kick = null;
      });
      later(() => {
        started = true;
        void run();
      }, startMs);
    },
  };
}

/// La coda dell'app: i compiti si registrano dove nasce la prima volta cara,
/// la shell la fa partire a consegna finita.
export const warmups: Warmups = createWarmups();
