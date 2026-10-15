// Le righe delle preferenze, seguite da fuori.
//
// La vista (`panels/settings.ts`) riscrive il corpo a ogni scheda, ricerca e
// valore: una riga di ieri non è la riga di oggi. Chi veste una riga tiene
// quindi un nodo suo, sempre lo stesso, e lo rimette nella riga nuova ogni
// volta che la vista ha finito; della riga legge soltanto ciò che la vista
// promette (`data-setting-key`, `.setting-control`, il campo numerico con il
// suo `change`).
//
// Il valore si scrive **attraverso la riga**: il campo numerico della vista
// riceve il numero e un `change`, e da lì parte la sua stessa scrittura
// (`api.setSetting`), con l'attesa, l'esito sotto la riga, la riga tenuta in
// vista sotto un filtro e il fuoco rimesso. Una seconda strada verso l'host
// avrebbe dovuto rifare tutte e quattro le cose.
import type { Lifetime } from "../../../ui/lifetime";

/// La riga di un'impostazione nel disegno corrente, se c'è.
export function rowFor(body: HTMLElement, key: string): HTMLElement | null {
  return body.querySelector<HTMLElement>(`.setting-row[data-setting-key="${key}"]`);
}

/// Il campo numerico che la vista ha messo nella riga: da solo, o accanto al
/// suo cursore.
export function numberField(row: HTMLElement): HTMLInputElement | null {
  return row.querySelector<HTMLInputElement>('.setting-control input[type="number"]');
}

/// Scrive un numero dalla strada della riga.
export function writeThrough(field: HTMLInputElement, value: number): void {
  field.value = String(value);
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/// Scrive un attributo solo se cambia: chi osserva il corpo non deve
/// svegliarsi per una riscrittura uguale.
export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value);
  }
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

type Disableable = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;

export function setDisabled(nodes: Iterable<Disableable>, disabled: boolean): void {
  for (const node of nodes) if (node.disabled !== disabled) node.disabled = disabled;
}

function unreachable(node: HTMLElement): boolean {
  return !node.isConnected || (node as Partial<Disableable>).disabled === true || node.closest("[hidden]") !== null;
}

/**
 * Ricorda quale nodo di `root` aveva il fuoco, e glielo ridà.
 *
 * La vista, scrivendo, spegne i controlli della riga e poi la sostituisce: il
 * fuoco cade sul documento senza che nessuno l'abbia spostato. `restore` lo
 * rimette dov'era, e solo in quel caso: se nel frattempo la persona è andata
 * altrove, il suo fuoco non si tocca.
 *
 * `fallback` dice se un nodo è un ripiego: un posto in cui il fuoco finisce
 * perché ce lo mette la vista, non perché ci va la persona.
 */
export function keepFocus(lifetime: Lifetime, root: HTMLElement, fallback: (target: HTMLElement) => boolean = () => false): () => void {
  let held: HTMLElement | null = null;
  const stray = (target: HTMLElement): boolean => target.closest("[hidden]") !== null || fallback(target);
  lifetime.listen(document, "focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (root.contains(target)) held = target;
    // Un controllo nascosto non è un posto in cui si va: se il fuoco ci
    // finisce, ce l'ha messo un ripiego, non la persona.
    else if (!stray(target)) held = null;
  });
  lifetime.listen(root, "focusout", (event) => {
    // Verso il niente con il nodo ancora al suo posto: un clic sul vuoto.
    // Spento o staccato, invece, il fuoco gliel'ha tolto la vista.
    if (event.relatedTarget === null && held !== null && !unreachable(held)) held = null;
  });
  lifetime.add(() => {
    held = null;
  });
  return () => {
    if (held === null || unreachable(held)) return;
    const active = document.activeElement;
    if (active === held) return;
    const nowhere = active === null || active === document.body || (active instanceof HTMLElement && stray(active));
    if (nowhere) held.focus({ preventScroll: true });
  };
}

/// Una veste: il nodo che prende il posto del controllo generico di una riga.
export interface Dress {
  readonly key: string;
  /// Sempre lo stesso nodo, da una riscrittura all'altra.
  readonly element: HTMLElement;
  /// Allinea il nodo alla riga appena scritta. Scrive solo ciò che cambia.
  update(row: HTMLElement, field: HTMLInputElement): void;
}

/// Un pezzo che segue la vista: il gesto da ripetere a ogni riscrittura del
/// corpo. Dice `true` quando ha rimesso il suo nodo nel disegno nuovo, cioè
/// quando ha cambiato l'altezza di ciò che scorre.
export type Piece = () => boolean;

/**
 * Tiene una veste nella sua riga. Torna il gesto da ripetere a ogni
 * riscrittura del corpo: non fa niente se niente è cambiato.
 *
 * Senza la riga, o senza il campo numerico che la veste sa pilotare, la veste
 * si toglie e resta il controllo della vista.
 */
export function dressRow(lifetime: Lifetime, body: HTMLElement, dress: Dress): Piece {
  // Il controllo della vista, nella riga vestita, è nascosto: la persona non ci
  // arriva. La vista sì — dopo una scrittura rimette il fuoco «sul controllo
  // della riga», e se arriva prima che la veste sia tornata trova lui.
  const restore = keepFocus(lifetime, dress.element, (target) => {
    const control = target.closest(".setting-control");
    return control !== null && !dress.element.contains(target) &&
      control.closest<HTMLElement>(".setting-row")?.dataset.settingKey === dress.key;
  });
  lifetime.add(() => dress.element.remove());
  // Il nome visibile della riga punta al campo nascosto: un clic su di lui
  // porta alla veste, che è ciò che quel nome nomina adesso.
  lifetime.listen(body, "click", (event) => {
    const label = event.target instanceof Element ? event.target.closest("label") : null;
    const row = label?.closest<HTMLElement>(".setting-row");
    if (!label || !row || !row.contains(dress.element) || dress.element.contains(label)) return;
    event.preventDefault();
    (dress.element.querySelector<HTMLElement>('[tabindex="0"]') ?? dress.element.querySelector<HTMLElement>("button, input"))?.focus();
  });
  return () => {
    const row = rowFor(body, dress.key);
    const field = row ? numberField(row) : null;
    const control = field?.closest<HTMLElement>(".setting-control") ?? null;
    if (!row || !field || !control) {
      if (dress.element.isConnected) dress.element.remove();
      return false;
    }
    const native = field.closest<HTMLElement>(".setting-range") ?? field;
    if (!native.hidden) native.hidden = true;
    const placed = dress.element.parentElement !== control || dress.element.previousElementSibling !== native;
    if (placed) native.after(dress.element);
    dress.update(row, field);
    restore();
    return placed;
  };
}
