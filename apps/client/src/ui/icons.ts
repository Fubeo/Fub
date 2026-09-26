// Le icone della shell: SVG inline, stroke, `currentColor`.
//
// Niente dipendenze, niente font di icone: ogni icona è un `<path>` dentro un
// `viewBox` 0 0 24 24, e prende il colore dal `currentColor` di chi la ospita.
// È la forma più leggera che esista — un <svg> per icona, niente sprite da
// gestire, niente richieste di rete — e la più adatta a una titlebar e a una
// rail che vivono a ogni fotogramma.
//
// Il set è il minimo che la shell dichiara: i bottoni strutturali della
// titlebar, della rail e dell'inspector. Le view dichiarate possono portare
// la propria `spec.icon` (una stringa), e chi le disegna decide cosa farne —
// qui non si cabla niente di una feature.
//
// Il set è aperto: un modulo della shell che ha una figura sua la registra con
// `registerIcon`, e da quel momento la disegnano tutti — la rail, l'ispettore,
// il nodo `icon` delle view dichiarate — con lo stesso costrutto. Il teardown
// la ritira.
import type { Teardown } from "./lifetime";

/// Un SVG inline 16×16, stroke 1.6, `currentColor`, pronto da inserire in un
/// bottone. Restituisce una stringa, non un elemento: così chi la usa può
/// scrivere `innerHTML` o `setAttribute` senza allocare un nodo per ogni
/// icona — e i test la possono confrontare senza un browser.
///
/// Questi valori sono il costrutto del set: ogni icona usa la stessa griglia,
/// lo stesso tratto e gli stessi angoli, senza eccezioni disegnate nel chiamante.
export const ICON_GRID = 24;
export const ICON_SIZE = 16;
export const ICON_STROKE_WIDTH = 1.6;
export const ICON_FILL = "none";
export const ICON_STROKE = "currentColor";
export const ICON_LINECAP = "round";
export const ICON_LINEJOIN = "round";
const SVG: Record<string, string> = {
  // --- la rail e l'inspector: le view della shell -------------------------
  notes: '<path d="M4 5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M13 3v5h5"/>',
  search: '<path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z"/><path d="M21 21l-5-5"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.8 10 16M15.8 8.8 13.5 16M8 18.5l8-9"/>',
  tag: '<path d="M3 11.5 11.5 3h7.5v7.5L10.5 19z"/><circle cx="15" cy="8" r="1.2"/>',
  outline: '<path d="M4 6h16M4 12h12M4 18h16"/>',
  backlinks: '<path d="M9 15l-3 3a4 4 0 0 1 0-5.7l2-2a4 4 0 0 1 5.7 0"/><path d="M15 9l3-3a4 4 0 0 1 0 5.7l-2 2a4 4 0 0 1-5.7 0"/>',
  properties: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  query: '<path d="M5 5h14v10H9l-4 4z"/><path d="M8 9h8M8 12h6"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  template: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  // --- le view di sincronizzazione e pubblicazione (fub-host) -------------
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  publish: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  warning: '<path d="M12 4 21 20H3z"/><path d="M12 10v4M12 17h.01"/>',
  backup: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M7 12l2.5-2.5L12 12M9.5 9.5v6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 5"/><path d="M3 3v2.5h2.5"/><path d="M12 8v4l3 2"/>',
  footnote: '<path d="M4 7h9M4 12h9M4 17h6"/><path d="M17 5l2-1v6"/>',
  collection: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M6 6h12M8 3h8"/>',
  stats: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  // Il ripiego di una view che non dichiara un'icona conosciuta: un
  // pannello generico, distinto da ogni icona con un significato.
  view: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/>',

  // --- la titlebar ---------------------------------------------------------
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  palette: '<path d="M5 8l4 4-4 4"/><path d="M12 17h7"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',

  // --- i controlli finestra -----------------------------------------------
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M5 16V5a1 1 0 0 1 1-1h11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>',

  // --- la navigazione ----------------------------------------------------
  chevron: '<path d="M9 6l6 6-6 6"/>',

  // --- l'apri-vault, che è un menu item ma anche un bottone --------------
  vault: '<path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};

/// L'SVG di un'icona, come stringa HTML pronta per `innerHTML`.
///
/// Un nome sconosciuto restituisce stringa vuota e non lancia: un'icona che
/// manca è un buco che si vede, non un errore che ferma la shell, e chi la
/// chiede può `?? fallback` senza un `try`.
/// I nomi con cui le feature dichiarano un'icona che il set chiama in un
/// altro modo. Senza, `backlink` o `struttura` cadevano sul ripiego e più
/// schede dell'ispettore mostravano la stessa figura.
const ALIASES: Record<string, string> = {
  backlink: "backlinks",
  struttura: "outline",
  collections: "collection",
  footnotes: "footnote",
  "layout-dashboard": "dashboard",
};

/// Le icone registrate dai moduli della shell, sopra il set di serie.
const REGISTERED = new Map<string, string>();

/// Solo i comandi e i numeri di un tracciato SVG: niente markup, attributi o
/// riferimenti, quindi niente che una registrazione possa iniettare.
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/;

/// Registra un'icona col costrutto del set: soltanto tracciati (i `d` dei suoi
/// `<path>`), perché griglia, tratto e colore sono quelli di tutte le altre. Un
/// nome già disegnato (di serie, alias o registrato) non si ridefinisce: due
/// moduli che volessero la stessa figura se la contenderebbero in silenzio.
export function registerIcon(name: string, paths: readonly string[]): Teardown {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`icon name «${name}» is not a lowercase id`);
  if (SVG[name] || ALIASES[name] || REGISTERED.has(name)) throw new Error(`icon «${name}» is already drawn`);
  if (paths.length === 0 || paths.some((d) => !PATH_DATA.test(d))) {
    throw new Error(`icon «${name}» accepts only SVG path data`);
  }
  const body = paths.map((d) => `<path d="${d}"/>`).join("");
  REGISTERED.set(name, body);
  return () => {
    if (REGISTERED.get(name) === body) REGISTERED.delete(name);
  };
}

export function icon(name: string): string {
  const body = SVG[ALIASES[name] ?? name] ?? REGISTERED.get(name);
  if (!body) return "";
  return `<svg viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${ICON_FILL}" stroke="${ICON_STROKE}" stroke-width="${ICON_STROKE_WIDTH}" stroke-linecap="${ICON_LINECAP}" stroke-linejoin="${ICON_LINEJOIN}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/// L'elemento SVG di un'icona, per chi vuole attaccarci un ascoltore o
/// metterlo in un attributo. Restituisce `null` se il nome è sconosciuto.
export function iconEl(name: string): SVGElement | null {
  const html = icon(name);
  if (!html) return null;
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return (tpl.content.firstElementChild as SVGElement) ?? null;
}

/// I nomi che questa shell sa disegnare. Per chi costruisce un selettore
/// (la rail, l'inspector) e vuole sapere cosa c'è senza indovinare.
export function iconNames(): string[] {
  return [...Object.keys(SVG), ...REGISTERED.keys()];
}
/// Un bottone a icona con un contatore: la figura, il numero quando ce n'è
/// uno, e il nome intero come nome accessibile e suggerimento. Il numero è
/// decorativo (`aria-hidden`): il nome lo dice già per intero.
export function drawCountButton(button: HTMLElement, name: string, label: string, count: number): void {
  button.replaceChildren();
  const svg = iconEl(name);
  if (svg) button.append(svg);
  if (count > 0) {
    const badge = document.createElement("span");
    badge.className = "titlebar-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = count > 99 ? "99+" : String(count);
    button.append(badge);
  }
  button.setAttribute("aria-label", label);
}
