// Lo scheduler del browser per `PenQuiet`: il lavoro rimandato gira quando il
// thread è libero.
//
// Usa `requestIdleCallback` con un `timeout` (il lavoro non aspetta per sempre
// un thread che non si libera mai) e, dove non c'è (WebKitGTK può non averlo),
// `setTimeout(run, 0)`: il turno dopo, che è il meglio che si può chiedere
// senza sapere quando il thread è libero. La funzione si legge da `globalThis`
// a ogni richiesta, non una volta all'import.
//
// Ogni richiesta ha un padrone: si annulla con la funzione che `Schedule`
// restituisce e, tutte insieme, alla chiusura della `Lifetime`. Le richieste in
// attesa stanno in un insieme che si svuota man mano: la `Lifetime` riceve uno
// smontaggio solo, non uno per richiesta, così una lavagna aperta a lungo non
// accumula niente.

import type { Lifetime } from "../../ui/lifetime";
import type { Schedule } from "../quiet";

/// Le due funzioni del browser, che `lib.dom` dichiara sempre presenti e che un
/// motore può non avere.
interface IdleScope {
  readonly requestIdleCallback?: (run: () => void, options?: { timeout?: number }) => number;
  readonly cancelIdleCallback?: (handle: number) => void;
}

/// Uno `Schedule` che fa girare il lavoro quando il thread è libero, al più
/// tardi dopo `timeoutMs` millisecondi, e che `owner` chiude. Su una `Lifetime`
/// chiusa una richiesta non fa niente.
export function idleSchedule(owner: Lifetime, timeoutMs = 100): Schedule {
  const pending = new Set<() => void>();
  owner.add(() => {
    const cancels = [...pending];
    pending.clear();
    for (const cancel of cancels) cancel();
  });

  return (run) => {
    if (owner.closed) return () => {};
    let done = false;
    const fire = (): void => {
      if (done) return;
      done = true;
      pending.delete(cancel);
      run();
    };
    const scope = globalThis as IdleScope;
    let release: () => void;
    if (typeof scope.requestIdleCallback === "function") {
      const handle = scope.requestIdleCallback(fire, { timeout: timeoutMs });
      release = () => scope.cancelIdleCallback?.(handle);
    } else {
      const handle = setTimeout(fire, 0);
      release = () => clearTimeout(handle);
    }
    function cancel(): void {
      if (done) return;
      done = true;
      pending.delete(cancel);
      release();
    }
    // Un motore che fa girare la richiesta subito l'ha già chiusa.
    if (!done) pending.add(cancel);
    return cancel;
  };
}
