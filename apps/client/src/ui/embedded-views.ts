// Una view dichiarata **dentro un documento**: il recinto ```tasks``` della
// resa mostra la view `tasks_query` del componente dei compiti, con le righe
// del recinto come parametro.
//
// Chi monta le view dichiarate è `ui/views.ts`, che però tocca le superfici
// della shell appena importato (`#views-left`, …): la resa Markdown non può
// importarlo. Questo modulo è la cucitura fra i due, senza DOM proprio: la
// resa chiede «metti questa view qui», `views.ts` si registra come chi sa
// farlo (`setEmbeddedViewHost`) e dice quando ha scoperto le view
// (`embeddedViewsDiscovered`). Un recinto reso prima che le view siano note
// aspetta quel momento invece di restare vuoto.
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

interface Waiting {
  view: string;
  instance: string;
  container: HTMLElement;
  params: unknown;
}

let host: EmbeddedViewHost | null = null;
let counter = 0;
const waiting = new Set<Waiting>();

/// `ui/views.ts` si registra qui; `null` lo toglie (i test).
export function setEmbeddedViewHost(next: EmbeddedViewHost | null): void {
  host = next;
  if (!next) waiting.clear();
}

/// Le view sono state (ri)scoperte: i recinti che aspettavano la loro si
/// montano adesso.
export function embeddedViewsDiscovered(): void {
  if (!host) return;
  for (const each of [...waiting]) {
    if (!host.known(each.view)) continue;
    waiting.delete(each);
    void host.mount(each.view, each.instance, each.container, each.params);
  }
}

/// Monta `view` dentro `container` finché `life` è aperta. Se la view non è
/// (ancora) dichiarata, aspetta la prossima scoperta; chi chiama mostra
/// intanto ciò che il contenitore ha già.
export function embedView(view: string, container: HTMLElement, params: unknown, life: Lifetime): void {
  if (life.closed) return;
  const each: Waiting = { view, instance: `embedded-${++counter}`, container, params };
  life.add(() => {
    waiting.delete(each);
    host?.unmount(each.view, each.instance);
  });
  if (host?.known(view)) {
    void host.mount(view, each.instance, container, params);
  } else {
    waiting.add(each);
  }
}
