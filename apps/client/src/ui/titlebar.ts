// I controlli finestra della titlebar custom: min, max, close.
//
// La titlebar sostituisce la barra di sistema (§Fase 0 del piano), e i tre
// bottoni a destra — a sinistra su macOS — parlano con la finestra attraverso
// la cucitura di `host/ipc.ts`. Niente `@tauri-apps` qui dentro: la regola
// §1.3 passa di là, e il presidio la tiene ferma.
//
// Il doppio click sulla barra alterna la massimizzazione, come ogni barra di
// sistema che l'utente abbia mai usato: è il gesto che chi non trova i
// controlli fa d'istinto, e non bisogna insegnarglielo. I controlli stessi
// non lo fanno — chi clicca un bottone vuole quel bottone, non l'intera barra.
//
// `isMaximized` decide l'icona del bottone: quadrato piccolo quando è
// massimizzata (premi per ripristinare), quadrato grande quando no (premi
// per ingrandire). `onResize` la ridisegna quando lo stato cambia da fuori —
// un tasto della tastiera, una scorciatoia di sistema — perché la titlebar è
// il posto in cui lo stato della finestra si legge, e un'icona vecchia
// sarebbe una bugia.
import { window } from "../host/ipc";
import { $ } from "./dom";
import { icon } from "./icons";
import type { Lifetime } from "./lifetime";
import { t, onLanguage } from "../i18n/strings";

/// Monta i controlli finestra e il doppio click della titlebar.
///
/// Prende la `Lifetime` della finestra: gli ascoltori che attacca vivono quanto
/// lei, e quando la shell smonta non restano appesi. L'unlistener di
/// `onResize` è l'altro capo — la shell lo tiene nella vita, e chiudi.
export function mountTitlebar(lifetime: Lifetime): void {
  const topbar = $("#topbar");
  const min = $("#win-min") as HTMLButtonElement;
  const max = $("#win-max") as HTMLButtonElement;
  const close = $("#win-close") as HTMLButtonElement;

  // macOS: i controlli a sinistra, la menubar dopo. È la convenzione che chi
  // usa un Mac si aspetta, e non una scelta estetica — il cursore va a
  // sinistra per chiudere, come ha sempre fatto. La classe da sola non basta:
  // `#window-controls` vive in `#titlebar-right`, e `order` non lo porta
  // fuori dalla sua zona. Si sposta il nodo in cima a `#titlebar-left`.
  if (macPlatform()) {
    topbar.classList.add("titlebar--darwin");
    const controls = document.getElementById("window-controls");
    const left = document.getElementById("titlebar-left");
    if (controls && left) left.prepend(controls);
  }

  // Le icone: i tre controlli e i due bottoni a destra nascono vuoti
  // (l'HTML non porta SVG, così `mountStrings` non li sovrascrive).
  min.innerHTML = icon("minus");
  close.innerHTML = icon("close");
  const palette = document.getElementById("open-palette");
  if (palette) palette.innerHTML = icon("palette");
  const settings = document.getElementById("open-settings");
  if (settings) settings.innerHTML = icon("settings");

  min.addEventListener("click", (e) => {
    e.stopPropagation();
    void window.minimize();
  });
  max.addEventListener("click", (e) => {
    e.stopPropagation();
    void window.toggleMaximize();
  });
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    void window.close();
  });

  // Doppio click sulla barra (non sui controlli): alterna la massimizzazione.
  // I controlli fermano la propagazione sopra, quindi un doppio click su di
  // essi non arriva qui — ed è ciò che si vuole: chi clicca il bottone vuole
  // il bottone.
  topbar.addEventListener("dblclick", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
    void window.toggleMaximize();
  });

  // L'icona del max segue lo stato. La si ridisegna adesso e a ogni cambio:
  // un'icona vecchia direbbe «premi per ingrandire» quando la finestra è già
  // piena, ed è la bugia più stupida che una titlebar possa dire.
  void updateMaxIcon(max);
  // `onResize` restituisce la promessa di un unlisten: la si affida alla vita
  // quando arriva, e se la vita si chiude prima non resta appesa — `aggiungi`
  // su una vita chiusa smonta subito, e l'unlisten non ancora arrivato è un
  // no-op di là dal confine.
  window
    .onResize(() => void updateMaxIcon(max))
    .then((unlisten) => lifetime.add(unlisten))
    .catch(() => {});

  // L'aria-label seguono la lingua, come ogni testo della shell. Si
  // iscrivono qui perché la titlebar non ha un `render`: è fissa, e i suoi
  // testi si rinfrescano quando la lingua cambia e non a ogni ridisegno.
  applyControlLabels(min, max, close);
  lifetime.add(onLanguage(() => applyControlLabels(min, max, close)));
}

/// Disegna l'icona del bottone max in base allo stato della finestra.
///
/// Restituisce la promessa perché `isMaximized` è async — chiede alla
/// finestra il suo stato, che è di là dal confine — e chi la chiama può
/// attendere o meno.
async function updateMaxIcon(btn: HTMLButtonElement): Promise<void> {
  const maximized = await window.isMaximized();
  btn.innerHTML = icon(maximized ? "restore" : "square");
  btn.setAttribute("aria-pressed", String(maximized));
  btn.setAttribute("aria-label", t(maximized ? "window.restore" : "window.max"));
}

/// Applica gli aria-label dei tre controlli, nella lingua corrente.
function applyControlLabels(
  min: HTMLButtonElement,
  max: HTMLButtonElement,
  close: HTMLButtonElement,
): void {
  min.setAttribute("aria-label", t("window.min"));
  max.setAttribute(
    "aria-label",
    t(max.getAttribute("aria-pressed") === "true" ? "window.restore" : "window.max"),
  );
  close.setAttribute("aria-label", t("window.close"));
}

/// È un Mac? `navigator.platform` lo dice, e con la tolleranza che si deve a
/// un dato che in un Tauri mobile non ci sarà.
function macPlatform(): boolean {
  return (
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "")
  );
}