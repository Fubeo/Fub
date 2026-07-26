// Il menu contestuale, e il selettore di icona: le due finestrelle che si
// aprono accanto al punto in cui si è cliccato.
//
// Sono primitive di UI, non pezzi dell'explorer: non sanno cosa sia una nota né
// cosa sia un'icona: ricevono delle voci con dei `run`, o un valore e un
// callback. Stavano in `main.ts` insieme a tutto il resto, ed è la ragione per
// cui un pannello nuovo non poteva averle senza copiarle.

export interface MenuItem {
  label: string;
  /// Voce distruttiva: la si distingue perché sia difficile sbagliarla.
  danger?: boolean;
  run: () => void;
}

export function showContextMenu(at: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.style.left = `${at.clientX}px`;
  menu.style.top = `${at.clientY}px`;
  for (const item of items) {
    const b = document.createElement("button");
    b.textContent = item.label;
    if (item.danger) b.className = "danger";
    b.addEventListener("click", () => {
      closeContextMenu();
      item.run();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  // Il primo click fuori chiude: `once` evita di dover disiscrivere a mano, e
  // il ritardo evita che sia questo stesso click ad attivarlo.
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0);
}

export function closeContextMenu(): void {
  document.getElementById("context-menu")?.remove();
}

const ICON_PRESETS = [
  "📝", "📁", "🗂️", "📌", "⭐", "🔥", "💡", "📚", "🎯", "✅",
  "🧠", "🛠️", "🎨", "🎵", "🏠", "💼", "🌱", "✈️", "❤️", "🧪",
];

/// Un piccolo selettore accanto al punto del click: qualche emoji pronta, un
/// campo per incollarne una qualsiasi, e il ritorno a "senza icona"
/// (`null` al callback).
export function pickIcon(at: MouseEvent, onPick: (icon: string | null) => void): void {
  document.getElementById("icon-picker")?.remove();
  const pop = document.createElement("div");
  pop.id = "icon-picker";
  pop.style.left = `${Math.min(at.clientX, window.innerWidth - 240)}px`;
  pop.style.top = `${at.clientY}px`;

  const chiudi = () => {
    pop.remove();
    document.removeEventListener("mousedown", fuori, true);
  };
  const fuori = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) chiudi();
  };
  const applica = (icon: string | null) => {
    chiudi();
    onPick(icon);
  };

  const grid = document.createElement("div");
  grid.className = "icon-grid";
  for (const emoji of ICON_PRESETS) {
    const b = document.createElement("button");
    b.textContent = emoji;
    b.addEventListener("click", () => applica(emoji));
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const input = document.createElement("input");
  input.placeholder = "un'emoji qualsiasi…";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) applica(input.value.trim());
    else if (e.key === "Escape") chiudi();
  });
  pop.appendChild(input);

  const rimuovi = document.createElement("button");
  rimuovi.className = "icon-none";
  rimuovi.textContent = "Senza icona";
  rimuovi.addEventListener("click", () => applica(null));
  pop.appendChild(rimuovi);

  document.body.appendChild(pop);
  input.focus();
  document.addEventListener("mousedown", fuori, true);
}
