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

/// Un SVG inline 16×16, stroke 1.6, `currentColor`, pronto da inserire in un
/// bottone. Restituisce una stringa, non un elemento: così chi la usa può
/// scrivere `innerHTML` o `setAttribute` senza allocare un nodo per ogni
/// icona — e i test la possono confrontare senza un browser.
///
/// I nomi sono minuscoli e fissi: sono il contratto fra chi chiede un'icona
/// e chi la disegna, e chi ne aggiunge una la dichiara qui dentro.
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
  backup: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M7 12l2.5-2.5L12 12M9.5 9.5v6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 5"/><path d="M3 3v2.5h2.5"/><path d="M12 8v4l3 2"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  palette: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="16" r="1.2"/>',

  // --- i controlli finestra -----------------------------------------------
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M5 16V5a1 1 0 0 1 1-1h11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',

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
export function icon(name: string): string {
  const body = SVG[name];
  if (!body) return "";
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
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
  return Object.keys(SVG);
}