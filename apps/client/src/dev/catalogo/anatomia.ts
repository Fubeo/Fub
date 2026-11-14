// I provini dell'anatomia: un elemento per ogni hook di un componente, in uno
// dei suoi stati.
//
// Non un solo nodo con tutte le classi addosso: nel DOM vero gli hook stanno
// su nodi in rapporto — un `.tab` contiene un `.tab-name`, `.views-modal` è
// un fisso a sé — e la pila piatta li fa combattere su uno stesso elemento
// con esiti (scrim sotto testo, accent sotto danger) che nessun selettore
// della pelle produce davvero. Un hook, un elemento: ogni provino è quello di
// un selettore reale.
//
// Li disegnano il catalogo del banco (`bench/catalog.ts`), una cella per ogni
// coppia componente/stato, e la pagina «Tutti i componenti» (`pagina.ts`), un
// riquadro per componente.
import type { ComponentState, ShellComponent } from "../../theme/scrittoio/anatomia";

/// Hook che **sono** una superficie a sé, non un contenuto: il velo a pagina
/// intera di una modale, la carta del disegno, la tavola, l'inchiostro e il
/// laser della presentazione. Si fotografano senza prosa addosso.
export const BARE_HOOKS: ReadonlySet<string> = new Set([
  "modale",
  "views-modal",
  "draw-page",
  "draw-present-board",
  "draw-present-ink",
  "draw-present-laser",
]);

/// Il provino di un hook: l'elemento con la classe, col componente e lo stato
/// scritti nei `data-`, e col nome del componente e dell'hook per testo.
export function anatomyProof(component: ShellComponent, state: ComponentState, hook: string): HTMLDivElement {
  const proof = document.createElement("div");
  proof.className = hook;
  proof.dataset.component = component.name;
  proof.dataset.state = state.name;
  if (hook === "grid-viewport") {
    proof.tabIndex = 0;
    proof.setAttribute("role", "document");
    proof.setAttribute("aria-label", "Foglio di calcolo");
    proof.style.minHeight = "var(--space-8)";
  }
  // La carta non ha una misura sua: gliela dà l'editor, dalla pagina
  // del disegno e dalla vista. Qui ne ha una qualunque, così si vede.
  if (hook === "draw-page") {
    proof.style.width = "8rem";
    proof.style.height = "5rem";
  }
  // Le superfici di copertura (`.modale`, `.views-modal`) sono un velo
  // a pagina intera: il loro testo vero sta dentro il pannello che
  // ospitano — che qui arriva per conto suo, come hook a sé. Mettere
  // della prosa **sul velo** fotograferebbe uno stato che la pelle non
  // produce: il velo si fotografa nudo. Così la carta del disegno, che
  // è bianca in ogni tema e non porta mai testo, e nella presentazione
  // la tavola, l'inchiostro e il punto del laser.
  if (!BARE_HOOKS.has(hook)) proof.textContent = `${component.name} · ${hook}`;
  return proof;
}

/// Tiene raggiungibili da tastiera i riquadri dei provini che scorrono.
///
/// Il ritaglio conserva la geometria dei campioni posizionati; quando un
/// riquadro (o l'hook dentro, se la pelle gli dà un suo `overflow`) scorre
/// davvero, diventa una regione con un nome e un punto di Tab, e smette di
/// esserlo quando non scorre più. `label` dà il nome di un riquadro.
/// Restituisce lo smontaggio.
export function keepScrollersReachable(
  frames: Iterable<HTMLElement>,
  label: (frame: HTMLElement) => string,
): () => void {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const frame = entry.target as HTMLElement;
      const style = getComputedStyle(frame);
      const scrolls = ((style.overflowY === "auto" || style.overflowY === "scroll")
        && frame.scrollHeight > frame.clientHeight)
        || ((style.overflowX === "auto" || style.overflowX === "scroll")
          && frame.scrollWidth > frame.clientWidth);
      if (scrolls) {
        frame.tabIndex = 0;
        frame.setAttribute("role", "region");
        frame.setAttribute("aria-label", label(frame));
      } else {
        frame.removeAttribute("tabindex");
        frame.removeAttribute("role");
        frame.removeAttribute("aria-label");
      }
    }
  });
  for (const frame of frames) observer.observe(frame);
  return () => observer.disconnect();
}
