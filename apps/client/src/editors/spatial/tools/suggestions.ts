// I suggerimenti brevi dell'editor del disegno: una riga sotto il foglio che
// dice un gesto quando serve, cioè subito dopo il gesto che gli somiglia.
//
// - **Uno alla volta, e una volta sola.** Un suggerimento mostrato non torna;
//   chi fa già il gesto da sé non lo vede mai. Un altro che arriva mentre uno
//   è a schermo aspetta la sua occasione dopo. Chi monta l'editor ricorda
//   quelli visti, e se i suggerimenti si mostrano.
// - **Mai sopra il disegno né sopra la barra.** È una riga dell'editor, sotto
//   il foglio: il foglio si accorcia, e il disegno resta dov'è.
// - **Non se ne va da solo** (WCAG 2.2.1): si chiude col suo pulsante, e il
//   fuoco torna al foglio. La casella «Non mostrare più suggerimenti» li
//   spegne tutti, come l'impostazione; tolto il segno, tornano. Quello a
//   schermo resta finché non lo si chiude, così si legge fino in fondo.
// - **Il lettore di schermo lo legge** quando compare, da una regione sua:
//   l'annuncio del gesto che l'ha fatto comparire non si perde.

import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";

/// I suggerimenti, per nome: due dita che spostano e avvicinano il foglio,
/// il tratto tenuto fermo che diventa forma, il testo dentro una forma.
export type SuggestionId = "two-fingers" | "hold-shape" | "label-shape";

/// Ciò che chi monta l'editor ricorda: se i suggerimenti si mostrano, e
/// quelli già visti o che non servono più, per nome. Un nome che l'editor
/// non conosce resta: una versione più nuova lo conosce.
export interface Suggested {
  readonly on: boolean;
  readonly seen: readonly string[];
}

export interface SuggestionsOptions {
  /// Il testo del suggerimento `id`, adesso e nella lingua di adesso.
  readonly text: (id: SuggestionId) => string;
  /// Un suggerimento è stato mostrato, o non serve più: tutti quelli di
  /// adesso, da ricordare.
  readonly onSeen: (seen: readonly string[]) => void;
  /// Chi disegna ha spento o riacceso i suggerimenti dalla casella.
  readonly onSwitch: (on: boolean) => void;
  /// Il suggerimento si è chiuso col fuoco dentro: dove va il fuoco.
  readonly onClose: () => void;
}

export interface Suggestions {
  /// La riga, con la regione che il lettore di schermo ascolta.
  readonly element: HTMLElement;
  /// Il suggerimento a schermo, se c'è.
  readonly showing: SuggestionId | null;
  /// Vero se `id` si mostrerebbe adesso: i suggerimenti sono accesi, `id`
  /// non è ancora stato visto e nessun altro è a schermo. Chi offre lo
  /// chiede prima di cercare se il gesto gli somiglia.
  wants(id: SuggestionId): boolean;
  /// Mostra `id`, se `wants`: da qui è visto. Vero se l'ha mostrato.
  offer(id: SuggestionId): boolean;
  /// Chi disegna ha fatto il gesto di `id`: non si mostrerà più, e se è a
  /// schermo si chiude.
  done(id: SuggestionId): void;
  /// Ciò che chi monta l'editor ricorda, letto o cambiato altrove; `null`
  /// finché non si sa, e intanto nessun suggerimento si mostra. Quello a
  /// schermo resta.
  remember(suggested: Suggested | null): void;
  /// Rilegge i testi: un'altra lingua, o un testo che dipende da ciò che
  /// l'editor offre adesso.
  relabel(): void;
  /// Chiude quello a schermo, se c'è.
  close(): void;
}

/// La lampadina, sul reticolo delle icone.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-suggestion": ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.8 10.6c.6.5.8 1.2.8 1.9V16h6v-.5c0-.7.2-1.4.8-1.9A6 6 0 0 0 12 3z"],
};

export function createSuggestions(life: Lifetime, options: SuggestionsOptions): Suggestions {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-suggestions";
  const row = document.createElement("div");
  row.className = "draw-suggestion";
  row.setAttribute("role", "group");
  row.hidden = true;
  const glyph = iconEl("draw-suggestion");
  if (glyph !== null) {
    glyph.setAttribute("aria-hidden", "true");
    glyph.classList.add("draw-suggestion-icon");
    row.append(glyph);
  }
  const text = document.createElement("p");
  text.className = "draw-suggestion-text";
  text.id = identifier("draw-suggestion-text");
  row.setAttribute("aria-describedby", text.id);
  const off = document.createElement("label");
  off.className = "draw-suggestion-off";
  const box = document.createElement("input");
  box.type = "checkbox";
  const offText = document.createElement("span");
  off.append(box, offText);
  const closer = document.createElement("button");
  closer.type = "button";
  closer.className = "draw-button draw-suggestion-close";
  const cross = iconEl("close");
  if (cross !== null) {
    cross.setAttribute("aria-hidden", "true");
    closer.append(cross);
  }
  row.append(text, off, closer);
  // La regione sta fuori dalla riga, che è nascosta quando non c'è niente:
  // una regione nascosta non parla.
  const live = document.createElement("span");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  element.append(row, live);

  let memory: Suggested | null = null;
  /// Quelli visti o fatti qui, finché chi monta l'editor non li ha nella sua
  /// memoria.
  const local = new Set<string>();
  let showing: SuggestionId | null = null;

  const seen = (id: string): boolean => local.has(id) || (memory?.seen.includes(id) ?? false);
  const all = (): readonly string[] => [...new Set([...(memory?.seen ?? []), ...local])];

  /// Aggiunge `id` a quelli visti e lo fa sapere; vero se non c'era.
  const see = (id: SuggestionId): boolean => {
    if (seen(id)) return false;
    local.add(id);
    if (memory !== null) options.onSeen(all());
    return true;
  };

  const relabel = (): void => {
    row.setAttribute("aria-label", t("draw.suggestion"));
    offText.textContent = t("draw.suggestion.off");
    const close = t("draw.suggestion.close");
    closer.setAttribute("aria-label", close);
    closer.title = close;
    if (showing !== null) text.textContent = options.text(showing);
  };

  const hide = (): void => {
    if (showing === null) return;
    const inside = row.contains(document.activeElement);
    showing = null;
    row.hidden = true;
    delete row.dataset.suggestion;
    if (inside) options.onClose();
  };

  const wants = (id: SuggestionId): boolean => memory !== null && memory.on && showing === null && !seen(id);

  life.listen(closer, "click", () => hide());
  life.listen(row, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  });
  life.listen(box, "change", () => {
    const on = !box.checked;
    if (memory !== null) memory = { ...memory, on };
    options.onSwitch(on);
  });
  relabel();

  return {
    element,
    get showing() {
      return showing;
    },
    wants,
    offer(id) {
      if (!wants(id)) return false;
      see(id);
      showing = id;
      row.dataset.suggestion = id;
      text.textContent = options.text(id);
      box.checked = false;
      row.hidden = false;
      live.textContent = t("draw.suggestion.said", { text: text.textContent });
      return true;
    },
    done(id) {
      see(id);
      if (showing === id) hide();
    },
    remember(suggested) {
      memory = suggested;
      if (suggested === null) return;
      box.checked = !suggested.on;
      // Quelli visti qui prima che la memoria arrivasse le mancano.
      if ([...local].some((id) => !suggested.seen.includes(id))) options.onSeen(all());
    },
    relabel,
    close: hide,
  };
}
