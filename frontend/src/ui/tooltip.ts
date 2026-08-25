// Il suggerimento della shell: un solo elemento, acceso dal fuoco o dal puntatore.
// Il testo è della shell; la pelle che lo veste sta in theme/serie/skin/tooltip.css.

export const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_ID = "fub-tooltip";
const GAP = 8;
const EDGE = 8;

type Registration = {
  text: string;
  timer: number | undefined;
  disposed: boolean;
  show: () => void;
  hide: () => void;
  update: (text: string) => void;
  dispose: () => void;
};

const registrations = new WeakMap<HTMLElement, Registration>();
let current: { target: HTMLElement; registration: Registration; element: HTMLElement } | null = null;
let serial = 0;

/** Collega un suggerimento a un elemento della shell e restituisce lo smontaggio. */
export function attachTooltip(target: HTMLElement, text: string): () => void {
  const previous = registrations.get(target);
  previous?.dispose();

  const registration = {} as Registration;
  registration.text = text;
  registration.timer = undefined;
  registration.disposed = false;

  const schedule = () => {
    if (registration.disposed || registration.text.trim() === "") return;
    window.clearTimeout(registration.timer);
    registration.timer = window.setTimeout(registration.show, TOOLTIP_DELAY_MS);
  };
  const cancel = () => {
    window.clearTimeout(registration.timer);
    registration.timer = undefined;
    if (current?.target === target) registration.hide();
  };
  registration.show = () => {
    registration.timer = undefined;
    if (registration.disposed || registration.text.trim() === "") return;
    // Un ridisegno può rimuovere il bersaglio mentre il ritardo è ancora in
    // corso. Quel nodo non riceverà più `mouseleave`, quindi il suo timer non
    // verrà cancellato: senza questo cancello aprirebbe un tooltip senza
    // coordinate nell'angolo della finestra. Un bersaglio staccato non è più
    // una superficie della shell e porta via con sé anche la registrazione.
    if (!target.isConnected) {
      registration.dispose();
      return;
    }
    if (current && current.target !== target) current.registration.hide();
    const element = tooltipElement();
    element.textContent = registration.text;
    element.hidden = false;
    element.style.left = "0px";
    element.style.top = "0px";
    target.setAttribute("aria-describedby", element.id);
    position(element, target);
    current = { target, registration, element };
  };
  registration.hide = () => {
    if (current?.target !== target) return;
    current.element.hidden = true;
    target.removeAttribute("aria-describedby");
    current = null;
  };
  registration.update = (next: string) => {
    registration.text = next;
    if (current?.target === target) {
      current.element.textContent = next;
      if (next.trim() === "") registration.hide();
      else position(current.element, target);
    }
  };
  registration.dispose = () => {
    if (registration.disposed) return;
    registration.disposed = true;
    window.clearTimeout(registration.timer);
    registration.timer = undefined;
    registration.hide();
    target.removeEventListener("focus", schedule);
    target.removeEventListener("mouseenter", schedule);
    target.removeEventListener("blur", cancel);
    target.removeEventListener("mouseleave", cancel);
    target.removeEventListener("keydown", escape);
    if (registrations.get(target) === registration) registrations.delete(target);
  };
  function escape(event: KeyboardEvent): void {
    if (event.key === "Escape") cancel();
  }

  target.addEventListener("focus", schedule);
  target.addEventListener("mouseenter", schedule);
  target.addEventListener("blur", cancel);
  target.addEventListener("mouseleave", cancel);
  target.addEventListener("keydown", escape);
  registrations.set(target, registration);
  return registration.dispose;
}

/** Aggiorna o crea il suggerimento di un elemento già montato. */
export function setTooltip(target: HTMLElement, text: string): void {
  const existing = registrations.get(target);
  if (existing) existing.update(text);
  else attachTooltip(target, text);
}

function tooltipElement(): HTMLElement {
  let element = document.getElementById(TOOLTIP_ID);
  if (!element) {
    element = document.createElement("div");
    element.id = TOOLTIP_ID;
    element.className = "shell-tooltip";
    element.setAttribute("role", "tooltip");
    element.hidden = true;
    document.body.appendChild(element);
  }
  // Un id stabile è utile a chi già aveva un riferimento, ma ogni apertura
  // resta comunque annunciabile perché il contenuto cambia prima del fuoco.
  return element;
}

function position(element: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const width = element.offsetWidth || 0;
  const height = element.offsetHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const centered = rect.left + (rect.width - width) / 2;
  const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewportWidth - width - EDGE));
  const below = rect.bottom + GAP;
  const top = below + height <= viewportHeight - EDGE || rect.top < height + GAP
    ? below
    : rect.top - height - GAP;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(Math.max(EDGE, top))}px`;
}

/** Solo per i banchi: chiude il suggerimento attivo senza conoscere il DOM. */
export function closeTooltip(): void {
  current?.registration.hide();
}

/** Solo per i banchi: rende unico l'id in un documento che ricrea il body. */
export function resetTooltips(): void {
  current?.registration.hide();
  document.getElementById(TOOLTIP_ID)?.remove();
  current = null;
  serial += 1;
}
