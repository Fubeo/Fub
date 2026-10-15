// La porta di «Nuovo disegno» della shell mobile.
//
// Sul desktop un disegno si crea dal menu File, dal contestuale di una cartella
// o del titolo dell'albero. Su un telefono il contestuale è un gesto che non
// sempre c'è e la menubar sta dietro un tasto: il gesto che c'è sempre è il
// «+ Nuova» del titolo dell'albero. Qui gli si mette accanto «+ Disegno», che
// parte dallo stesso spazio attivo e apre lo stesso modulo (la galleria dei
// modelli, o la palette se nessuno l'ha registrata).
//
// Il bottone c'è soltanto se il kernel dichiara `drawing.create`: l'elenco dei
// comandi arriva dopo che il vault è aperto, e un componente acceso o spento lo
// cambia, quindi si segue il segnale `commands` invece di decidere una volta.
// Lo crea la shell mobile e non `mobile.html`, così il desktop non ha un
// controllo in più che non gli serve.
import { onLanguage, t } from "../../i18n/strings";
import { on, state } from "../../state/store";
import { canCreateDrawing, newDrawing } from "../../ui/commands";
import type { Lifetime } from "../../ui/lifetime";
import { attachTooltip, setTooltip } from "../../ui/tooltip";

/// Mette «+ Disegno» accanto a «+ Nuova». Senza il titolo dell'albero non fa
/// niente: è una shell che non ha quel pannello.
export function mountMobileCreations(lifetime: Lifetime): void {
  const anchor = document.getElementById("new-note");
  if (anchor === null) return;
  const button = document.createElement("button");
  button.id = "new-drawing";
  button.type = "button";
  button.className = "link-button";
  button.hidden = true;
  anchor.after(button);

  // Il suggerimento della shell, come quello di `#new-note`.
  lifetime.add(attachTooltip(button, t("explorer.new_drawing.hint")));
  const draw = (): void => {
    button.textContent = t("explorer.new_drawing");
    setTooltip(button, t("explorer.new_drawing.hint"));
    button.hidden = !canCreateDrawing();
  };
  // Lo spazio attivo come `#new-note`: il disegno nasce dove si guarda.
  lifetime.listen(button, "click", () => void newDrawing(state.activeSpace ?? ""));
  lifetime.add(on("commands", draw));
  lifetime.add(onLanguage(draw));
  lifetime.add(() => button.remove());
  draw();
}
