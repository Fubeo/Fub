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
// `eMassimizzata` decide l'icona del bottone: quadrato piccolo quando è
// massimizzata (premi per ripristinare), quadrato grande quando no (premi
// per ingrandire). `onCambio` la ridisegna quando lo stato cambia da fuori —
// un tasto della tastiera, una scorciatoia di sistema — perché la titlebar è
// il posto in cui lo stato della finestra si legge, e un'icona vecchia
// sarebbe una bugia.
import { finestra } from "../host/ipc";
import { $ } from "./dom";
import { icon } from "./icons";
import type { Vita } from "./vita";
import { t, onLingua } from "../i18n/strings";

/// Monta i controlli finestra e il doppio click della titlebar.
///
/// Prende la `Vita` della finestra: gli ascoltori che attacca vivono quanto
/// lei, e quando la shell smonta non restano appesi. L'unlistener di
/// `onCambio` è l'altro capo — la shell lo tiene nella vita, e chiudi.
export function mountTitlebar(vita: Vita): void {
  const topbar = $("#topbar");
  const min = $("#win-min") as HTMLButtonElement;
  const max = $("#win-max") as HTMLButtonElement;
  const close = $("#win-close") as HTMLButtonElement;

  // macOS: i controlli a sinistra, la menubar dopo. È la convenzione che chi
  // usa un Mac si aspetta, e non una scelta estetica — il cursore va a
  // sinistra per chiudere, come ha sempre fatto. La classe da sola non basta:
  // `#window-controls` vive in `#titlebar-right`, e `order` non lo porta
  // fuori dalla sua zona. Si sposta il nodo in cima a `#titlebar-left`.
  if (piattaformaMac()) {
    topbar.classList.add("titlebar--darwin");
    const controlli = document.getElementById("window-controls");
    const sinistra = document.getElementById("titlebar-left");
    if (controlli && sinistra) sinistra.prepend(controlli);
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
    void finestra.minimizza();
  });
  max.addEventListener("click", (e) => {
    e.stopPropagation();
    void finestra.alternaMassimizza();
  });
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    void finestra.chiudi();
  });

  // Doppio click sulla barra (non sui controlli): alterna la massimizzazione.
  // I controlli fermano la propagazione sopra, quindi un doppio click su di
  // essi non arriva qui — ed è ciò che si vuole: chi clicca il bottone vuole
  // il bottone.
  topbar.addEventListener("dblclick", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
    void finestra.alternaMassimizza();
  });

  // L'icona del max segue lo stato. La si ridisegna adesso e a ogni cambio:
  // un'icona vecchia direbbe «premi per ingrandire» quando la finestra è già
  // piena, ed è la bugia più stupida che una titlebar possa dire.
  void aggiornaIconaMax(max);
  // `onCambio` restituisce la promessa di un unlisten: la si affida alla vita
  // quando arriva, e se la vita si chiude prima non resta appesa — `aggiungi`
  // su una vita chiusa smonta subito, e l'unlisten non ancora arrivato è un
  // no-op di là dal confine.
  finestra
    .onCambio(() => void aggiornaIconaMax(max))
    .then((unlisten) => vita.aggiungi(unlisten))
    .catch(() => {});

  // L'aria-label seguono la lingua, come ogni testo della shell. Si
  // iscrivono qui perché la titlebar non ha un `render`: è fissa, e i suoi
  // testi si rinfrescano quando la lingua cambia e non a ogni ridisegno.
  applicaLabelControlli(min, max, close);
  vita.aggiungi(onLingua(() => applicaLabelControlli(min, max, close)));
}

/// Disegna l'icona del bottone max in base allo stato della finestra.
///
/// Restituisce la promessa perché `eMassimizzata` è async — chiede alla
/// finestra il suo stato, che è di là dal confine — e chi la chiama può
/// attendere o meno.
async function aggiornaIconaMax(btn: HTMLButtonElement): Promise<void> {
  const massimizzata = await finestra.eMassimizzata();
  btn.innerHTML = icon(massimizzata ? "restore" : "square");
  btn.setAttribute("aria-pressed", String(massimizzata));
  btn.setAttribute("aria-label", t(massimizzata ? "window.restore" : "window.max"));
}

/// Applica gli aria-label dei tre controlli, nella lingua corrente.
function applicaLabelControlli(
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
function piattaformaMac(): boolean {
  return (
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "")
  );
}