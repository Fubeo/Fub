// La riga dei suggerimenti (E6): al centro della banda, in grigio, i tasti
// utili per ciò che si sta facendo. «Ctrl+B grassetto · Ctrl+I corsivo ·
// Ctrl+K collega» con del testo scelto, «/ inserisce un blocco · @ persone e
// date» su una riga qualunque.
//
// La porta sta in `editors/core/hints.ts`: chi ha il fuoco (un editor, il suo
// «/») apre una fonte e dice che cosa sta facendo come elenco di voci: un id di
// comando con la frase che lo accompagna, o un tasto che non è un comando (le
// frecce di un elenco, il «/» che si scrive). Qui c'è la riga, che si abbona
// alla porta e scrive i comandi coi tasti **della persona**:
// l'accordo di `allCommands()`, cambiato nelle Preferenze o dichiarato, letto
// con `displayBinding`. Una scorciatoia tolta dalla persona toglie la voce; due
// comandi sullo stesso tasto lasciano la voce a quello che il tasto esegue.
//
// La riga cambia dopo una pausa breve, non a ogni battuta né a ogni freccia: la
// fonte avvisa (`changed`, che conta un cambiamento e basta), e la riga rilegge
// il contesto solo quando chi scrive si ferma. Nessuna IPC: l'impostazione
// `editor.hints` si legge al montaggio e quando cambia.
//
// È `aria-hidden`: i gesti si annunciano da sé (il grassetto messo, il blocco
// scelto), la riga no. Non c'è al telefono né sotto i 620 px (`frame.css`).
import { currentHints, type HintItem, onHintsChanged } from "../../../editors/core/hints";
import { settings } from "../../../host/query";
import { onLanguage } from "../../../i18n/strings";
import { onEvent } from "../../../state/kernel";
import {
  allCommands,
  type CommandEntry,
  displayBinding,
  foldedChord,
  keyboardPlatform,
  type KeyboardPlatform,
  keyName,
  modifierName,
  onKeyOverridesLoaded,
  parseChords,
} from "../../../ui/commands";
import type { Lifetime } from "../../../ui/lifetime";
import { Race } from "../../../ui/race";

/// L'impostazione che accende e spegne la riga (accesa di serie).
export const HINTS_SETTING = "editor.hints";

/// La pausa senza cambiamenti dopo la quale la riga si riscrive (ms).
export const HINTS_PAUSE_MS = 300;

/// Una voce come la riga la scrive: i tasti già letti e la frase.
export interface HintPart {
  readonly keys: readonly string[];
  readonly say: string;
}

/// Un tasto come si legge: `Mod` è Ctrl (⌘ sul Mac), `Shift-ArrowUp` è
/// «Shift+↑», `/` resta `/`, `Escape` è «Esc».
function keyLabel(key: string, platform: KeyboardPlatform): string {
  const held = modifierName(key, platform);
  if (held !== null) return held;
  return parseChords(key) ? displayBinding(key, platform) : keyName(key, platform);
}

/// La chiave con cui due tasti si riconoscono uguali nella stessa riga.
function sameKey(binding: string): string {
  return foldedChord(binding) ?? binding.toLowerCase();
}

/// Le voci scritte coi tasti della persona. Una voce senza tasti non c'è; un
/// tasto si dice una volta sola per riga (la prima voce che lo usa).
export function resolveHints(
  items: readonly HintItem[],
  entries: readonly CommandEntry[] = allCommands(),
  platform: KeyboardPlatform = keyboardPlatform(globalThis.navigator?.platform ?? ""),
): HintPart[] {
  const byId = new Map<string, CommandEntry>();
  // Il primo comando per accordo è quello che il tasto esegue: `allCommands`
  // è già nell'ordine dell'arbitrato della tastiera.
  const winner = new Map<string, string>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
    const binding = entry.binding;
    if (binding === null) continue;
    const chord = foldedChord(binding.split("||")[0]!.trim());
    if (chord !== null && !winner.has(chord)) winner.set(chord, entry.id);
  }
  const seen = new Set<string>();
  const out: HintPart[] = [];
  for (const item of items) {
    if ("command" in item) {
      const entry = byId.get(item.command);
      let binding: string | null;
      let mine = false;
      if (entry?.binding) {
        binding = entry.binding.split("||")[0]!.trim();
        mine = true;
      } else if (entry && entry.declared) {
        // Dichiarato e tolto dalla persona: la scorciatoia non c'è più.
        binding = null;
      } else binding = item.chord ?? null;
      if (!binding) continue;
      // Il tasto lo esegue un altro comando: non è il tasto di questo.
      const chord = foldedChord(binding);
      if (mine && chord !== null && winner.get(chord) !== item.command) continue;
      const key = sameKey(binding);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ keys: [displayBinding(binding, platform)], say: item.say });
    } else {
      const fresh = item.keys.filter((key) => !seen.has(sameKey(key)));
      if (fresh.length === 0 || fresh.length !== item.keys.length) continue;
      for (const key of fresh) seen.add(sameKey(key));
      out.push({ keys: fresh.map((key) => keyLabel(key, platform)), say: item.say });
    }
  }
  return out;
}

/// Disegna le voci: un `kbd` per tasto, la frase, un punto fra una voce e
/// l'altra.
function drawParts(element: HTMLElement, parts: readonly HintPart[]): void {
  const children: Node[] = [];
  parts.forEach((part, index) => {
    const item = document.createElement("span");
    item.className = "status-hints-item";
    for (const key of part.keys) {
      const kbd = document.createElement("kbd");
      kbd.className = "status-hints-key";
      kbd.textContent = key;
      item.append(kbd);
    }
    const say = document.createElement("span");
    say.className = "status-hints-say";
    say.textContent = part.say;
    item.append(say);
    if (index > 0) {
      const dot = document.createElement("span");
      dot.className = "status-hints-dot";
      dot.textContent = "·";
      children.push(dot);
    }
    children.push(item);
  });
  element.replaceChildren(...children);
}

/// Toglie dalla fine le voci che non ci stanno: una voce o c'è intera o non
/// c'è, mai «Ctrl+B gras…». La somma delle celle (T55) e le voci della
/// superficie prendono il loro posto, e la riga cede.
function fit(element: HTMLElement): void {
  while (element.lastElementChild && element.scrollWidth > element.clientWidth + 1) {
    element.lastElementChild.remove();
    // Il punto rimasto in fondo se ne va con la sua voce.
    if (element.lastElementChild?.classList.contains("status-hints-dot")) element.lastElementChild.remove();
  }
}

/// Monta la riga nella banda, prima di `before` (il lato destro). La banda ne
/// monta una per finestra; la riga ascolta la porta finché vive.
export function mountHintsRow(lifetime: Lifetime, band: HTMLElement, before: Element | null): HTMLElement {
  const element = document.createElement("span");
  element.id = "status-hints";
  element.className = "status-hints";
  element.setAttribute("aria-hidden", "true");
  if (before?.parentElement === band) band.insertBefore(element, before);
  else band.append(element);
  lifetime.add(() => element.remove());

  let on = true;
  let drawn = "";
  let parts: HintPart[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changes = 0;
  let seen = 0;

  const draw = (): void => {
    if (lifetime.closed) return;
    const context = on ? currentHints() : null;
    parts = context ? resolveHints(context.items) : [];
    element.hidden = !on;
    const id = context?.id ?? "";
    if (element.dataset.context !== id) {
      if (id) element.dataset.context = id;
      else delete element.dataset.context;
    }
    const signature = JSON.stringify(parts);
    if (signature === drawn) return;
    drawn = signature;
    drawParts(element, parts);
    fit(element);
  };
  // Un solo timer, che non si riarma a ogni battuta: una battuta conta e basta.
  // Alla scadenza, se nel frattempo è cambiato qualcosa, aspetta un'altra
  // pausa intera; se no ridisegna. Nessun orologio letto: la riga si ferma
  // dopo una pausa fra una e due volte `HINTS_PAUSE_MS`.
  const fire = (): void => {
    if (seen !== changes) {
      seen = changes;
      timer = setTimeout(fire, HINTS_PAUSE_MS);
      return;
    }
    timer = undefined;
    draw();
  };
  const schedule = (): void => {
    if (lifetime.closed) return;
    changes += 1;
    if (timer !== undefined) return;
    seen = changes;
    timer = setTimeout(fire, HINTS_PAUSE_MS);
  };
  lifetime.add(onHintsChanged(schedule));
  lifetime.add(() => clearTimeout(timer));

  // Una finestra più larga o più stretta rifà la misura con le voci di prima.
  if (typeof ResizeObserver !== "undefined") {
    let width = -1;
    const observer = new ResizeObserver(() => {
      const now = element.clientWidth;
      if (now === width) return;
      width = now;
      drawParts(element, parts);
      fit(element);
    });
    observer.observe(element);
    lifetime.add(() => observer.disconnect());
  }

  const reads = new Race();
  lifetime.add(() => reads.cancel());
  const readSetting = (): void => {
    void reads.last(async (expected) => {
      const entries = await expected(settings().catch(() => null));
      if (lifetime.closed || !entries) return;
      on = entries.find((entry) => entry.spec.key === HINTS_SETTING)?.value !== false;
      draw();
    });
  };
  readSetting();
  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (key === HINTS_SETTING) readSetting();
  }));
  // Una scorciatoia cambiata: la mappa degli accordi la rilegge
  // `mountKeyOverrides`, una volta sola; la riga si ridisegna quando quella
  // lettura arriva, non prima, o direbbe il tasto vecchio.
  lifetime.add(onKeyOverridesLoaded(schedule));
  lifetime.add(onLanguage(() => {
    drawn = "";
    schedule();
  }));
  draw();
  return element;
}
