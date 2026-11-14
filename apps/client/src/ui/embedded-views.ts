// Una view dichiarata **dentro un documento**: il recinto ```tasks``` della
// resa mostra la view `tasks_query` del componente dei compiti, con le righe
// del recinto come parametro.
//
// Chi monta le view dichiarate è `ui/views.ts`, che però tocca le superfici
// della shell appena importato (`#views-left`, …): la resa Markdown non può
// importarlo. Questo modulo è la cucitura fra i due, senza DOM proprio: la
// resa chiede «metti questa view qui», `views.ts` si registra come chi sa
// farlo (`setEmbeddedViewHost`) e dice ogni volta che ha (ri)scoperto le view
// (`embeddedViewsDiscovered`).
//
// Ogni recinto vivo segue le scoperte, in tre stati: **aspetta** finché le
// view non sono mai state scoperte (chi chiama mostra intanto ciò che il
// contenitore ha già), è **montato** finché la view è dichiarata, è **perso**
// quando una scoperta non la trova — il componente si è spento —, e allora chi
// chiama rimette al suo posto ciò che c'era (il codice del recinto). Alla
// scoperta che la ritrova si rimonta da sé.
//
// L'esemplare è uno per recinto e non si riusa: è l'identità con cui il kernel
// distingue due recinti della stessa view, anche nella stessa nota. Quando
// ridisegnarlo lo decide il registro dei pannelli (`ui/panel-host.ts`), con la
// maschera che la view dichiara: un indice cambiato ridisegna il recinto come
// ridisegna l'ispettore.
import type { Lifetime } from "./lifetime";

/// Chi sa montare una view dichiarata in un contenitore qualsiasi.
export interface EmbeddedViewHost {
  /// La view è dichiarata adesso.
  known(view: string): boolean;
  mount(view: string, instance: string, container: HTMLElement, params: unknown): Promise<void>;
  unmount(view: string, instance: string): void;
}

/// Ciò che chi incorpora fa quando la view se ne va e quando torna.
export interface EmbedFallback {
  /// La view non è più dichiarata: il contenitore è già smontato, e chi
  /// chiama rimette ciò che c'era prima.
  lost(): void;
  /// La view è di nuovo dichiarata: chi chiama rimette il contenitore al suo
  /// posto, subito prima che la view ci si monti.
  found(): void;
}

type EmbedState = "waiting" | "mounted" | "lost";

interface Embed {
  view: string;
  instance: string;
  container: HTMLElement;
  params: unknown;
  fallback: EmbedFallback;
  state: EmbedState;
}

let host: EmbeddedViewHost | null = null;
let counter = 0;
/// Le view sono state scoperte almeno una volta: da lì una view che non c'è è
/// una view spenta, non una che deve ancora arrivare.
let discovered = false;
const live = new Set<Embed>();

/// `ui/views.ts` si registra qui; `null` lo toglie (i test).
export function setEmbeddedViewHost(next: EmbeddedViewHost | null): void {
  host = next;
  if (!next) {
    live.clear();
    discovered = false;
  }
}

/// Le view sono state (ri)scoperte: ogni recinto vivo si monta se la sua view
/// c'è, e torna a ciò che era se non c'è più.
export function embeddedViewsDiscovered(): void {
  if (!host) return;
  discovered = true;
  for (const each of [...live]) settle(each);
}

function settle(each: Embed): void {
  if (!host) return;
  if (host.known(each.view)) {
    if (each.state === "mounted") return;
    if (each.state === "lost") each.fallback.found();
    each.state = "mounted";
    void host.mount(each.view, each.instance, each.container, each.params);
    return;
  }
  if (each.state === "mounted") host.unmount(each.view, each.instance);
  if (each.state !== "lost" && discovered) {
    each.state = "lost";
    each.fallback.lost();
  }
}

/// Monta `view` dentro `container` finché `life` è aperta, e la segue nelle
/// scoperte successive (vedi il modulo).
export function embedView(
  view: string,
  container: HTMLElement,
  params: unknown,
  life: Lifetime,
  fallback: EmbedFallback,
): void {
  if (life.closed) return;
  const each: Embed = { view, instance: `embedded-${++counter}`, container, params, fallback, state: "waiting" };
  live.add(each);
  life.add(() => {
    live.delete(each);
    if (each.state === "mounted") host?.unmount(each.view, each.instance);
  });
  settle(each);
}
