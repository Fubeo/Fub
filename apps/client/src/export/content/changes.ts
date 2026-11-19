// I cambi che la sezione Contenuto fa sulla resa per la stampa (E28, T74), e
// il modo di disfarli.
//
// La resa si chiede al core una volta e resta montata: un'altra scelta del
// Contenuto (i commenti in fondo invece che nel margine, i compiti fatti
// tolti) non la richiede, la cambia. Ogni modulo di `content/` scrive i suoi
// cambi qui: un nodo aggiunto, un blocco nascosto, un attributo cambiato, un
// ripiegabile aperto. `undo` li disfa all'indietro e la resa torna com'era,
// pronta per la scelta dopo.

export class ContentChanges {
  private readonly steps: (() => void)[] = [];

  /// Un nodo nuovo, che `undo` toglie.
  add(node: Node): void {
    this.steps.push(() => node.parentNode?.removeChild(node));
  }

  /// Nasconde un elemento (fuori dalla misura e dalle pagine, `printBlocks`
  /// lo salta); `undo` gli rimette lo stato di prima.
  hide(element: HTMLElement): void {
    const before = element.hidden;
    element.hidden = true;
    this.steps.push(() => {
      element.hidden = before;
    });
  }

  /// Scrive un attributo (`null` lo toglie); `undo` rimette quello di prima.
  attribute(element: Element, name: string, value: string | null): void {
    const before = element.getAttribute(name);
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
    this.steps.push(() => {
      if (before === null) element.removeAttribute(name);
      else element.setAttribute(name, before);
    });
  }

  /// Una proprietà dello stile in linea; `undo` rimette quella di prima.
  style(element: HTMLElement, name: string, value: string): void {
    const before = element.style.getPropertyValue(name);
    const priority = element.style.getPropertyPriority(name);
    element.style.setProperty(name, value);
    this.steps.push(() => {
      if (before) element.style.setProperty(name, before, priority);
      else element.style.removeProperty(name);
    });
  }

  /// Un passo qualunque da disfare.
  later(step: () => void): void {
    this.steps.push(step);
  }

  undo(): void {
    for (const step of this.steps.splice(0).reverse()) step();
  }
}
