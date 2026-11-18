// Un pezzo dell'interfaccia che serve soltanto dopo un gesto: arriva con un
// `import()`, fuori dal chunk che si carica all'apertura di un documento.
//
// La regola della fluidità: il primo gesto non aspetta il codice. Il pezzo si
// chiede prima che serva, in due modi:
//
// - **a thread libero** (`warm`): chi monta la cosa che un giorno lo userà (la
//   Live con le formule, una riga delle proprietà, un diagramma) lo chiede
//   quando la pagina non ha niente da fare, una volta per finestra;
// - **al primo segnale d'intenzione** (`load`): il puntatore che ci passa
//   sopra, il fuoco che ci arriva.
//
// Se il gesto arriva lo stesso prima del codice, `run` lo mette in coda e lo
// fa appena il modulo c'è, nell'ordine in cui sono venuti, purché chi l'ha
// chiesto sia ancora lì (`alive`). Un `import()` che non riesce lo dice con un
// avviso, e il gesto dopo riprova.
//
// Il modulo arrivato si legge in modo sincrono (`current`): dal secondo gesto
// in poi, e dal primo quando il riscaldamento è arrivato prima, tutto succede
// nello stesso giro, come col codice nel chunk del ponte.
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "./notify";

export interface LazyPart<T> {
  /// Il modulo, se è già arrivato.
  current(): T | null;
  /// Il modulo: il primo `load` lo chiede, gli altri aspettano la stessa
  /// richiesta. Dopo un errore il prossimo `load` riprova.
  load(): Promise<T>;
  /// Lo chiede quando il thread è libero: una volta sola, anche se lo
  /// chiedono in tanti.
  warm(): void;
  /// Fa `gesture` col modulo: subito se è arrivato, altrimenti appena arriva,
  /// se `alive()` è ancora vero.
  run(gesture: (part: T) => void, alive?: () => boolean): void;
}

/// Quanto aspetta al più il riscaldamento un thread che non si libera mai.
export const LAZY_WARM_TIMEOUT_MS = 1500;

interface IdleScope {
  readonly requestIdleCallback?: (run: () => void, options?: { timeout?: number }) => number;
  readonly cancelIdleCallback?: (handle: number) => void;
}

/// Ogni pezzo creato: `loadLazyParts` li aspetta tutti.
const parts = new Set<LazyPart<unknown>>();

/// Aspetta che ogni pezzo creato finora sia arrivato, come dopo il
/// riscaldamento: per le prove che guardano un gesto col codice già lì.
export async function loadLazyParts(): Promise<void> {
  await Promise.all([...parts].map((part) => part.load()));
}

/// Un pezzo che arriva con `importer` (un `import()` scritto lì, perché Rollup
/// ne faccia un chunk suo).
export function lazyPart<T>(importer: () => Promise<T>): LazyPart<T> {
  let module: T | null = null;
  let request: Promise<T> | null = null;
  let warming = false;
  // Il riscaldamento in attesa: un `load` che arriva prima lo toglie.
  let idleWarm: number | undefined;
  let laterWarm: ReturnType<typeof setTimeout> | undefined;
  const scope = globalThis as IdleScope;

  const load = (): Promise<T> => {
    if (idleWarm !== undefined) scope.cancelIdleCallback?.(idleWarm);
    if (laterWarm !== undefined) clearTimeout(laterWarm);
    idleWarm = laterWarm = undefined;
    if (module) return Promise.resolve(module);
    request ??= importer().then(
      (loaded) => {
        module = loaded;
        return loaded;
      },
      (error: unknown) => {
        request = null;
        throw error;
      },
    );
    return request;
  };

  const part: LazyPart<T> = {
    current: () => module,
    load,
    warm() {
      if (module || warming) return;
      warming = true;
      const start = (): void => {
        idleWarm = laterWarm = undefined;
        // Un suggerimento: se non arriva, il gesto lo chiede di nuovo.
        void load().catch(() => {
          warming = false;
        });
      };
      // Senza `requestIdleCallback` (WebKit), dopo il giro che monta.
      if (typeof scope.requestIdleCallback === "function") idleWarm = scope.requestIdleCallback(start, { timeout: LAZY_WARM_TIMEOUT_MS });
      else laterWarm = setTimeout(start, 0);
    },
    run(gesture, alive = () => true) {
      if (module) {
        gesture(module);
        return;
      }
      load().then(
        (loaded) => {
          if (alive()) gesture(loaded);
        },
        (error: unknown) => {
          if (alive()) notify(t("app.part_failed", { reason: errorText(error) }), "guasto");
        },
      );
    },
  };
  parts.add(part);
  return part;
}
