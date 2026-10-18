// Ciò che una vita possiede per poco: una superficie aperta, una corsa.
//
// `Lifetime.add` non ha un «togli»: va bene per ciò che vive quanto la vita, e
// male per ciò che si apre e si chiude mille volte dentro una vita lunga,
// perché ogni apertura lascerebbe uno smontaggio in più da tenere fino alla
// fine. Qui ogni vita riceve un solo smontaggio, e dietro di lui c'è un
// insieme da cui chi si chiude per conto suo esce subito.
import type { Lifetime, Teardown } from "../ui/lifetime";

const adopted = new WeakMap<Lifetime, Set<Teardown>>();

/// Affida `teardown` a `lifetime` e rende come ritirarlo: chi si chiude prima
/// della vita chiama quello, e non lascia niente indietro. Su una vita già
/// chiusa lo smontaggio parte subito, come con `Lifetime.add`.
export function adopt(lifetime: Lifetime, teardown: Teardown): Teardown {
  if (lifetime.closed) {
    teardown();
    return () => {};
  }
  let owned = adopted.get(lifetime);
  if (!owned) {
    const fresh = new Set<Teardown>();
    owned = fresh;
    adopted.set(lifetime, fresh);
    lifetime.add(() => {
      // Dal più recente: è l'ordine in cui una vita disfa il resto.
      for (const each of [...fresh].reverse()) {
        if (fresh.delete(each)) each();
      }
    });
  }
  const set = owned;
  set.add(teardown);
  return () => void set.delete(teardown);
}
