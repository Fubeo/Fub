// La finestra «Aggiorna dalla libreria»: il simbolo com'è nel disegno e
// com'è nella libreria, uno accanto all'altro, e a parole che cosa cambia:
// quante istanze lo mostrano, e che le modifiche fatte nel disegno si
// perdono, o che si perderebbero se ce ne sono. Si conferma o si rinuncia; il fuoco parte dalla conferma. Le due
// anteprime si guardano: la frase dice tutto anche a chi non le vede.

import { actions, openFrame } from "../../../ui/dialogs";
import { t } from "../strings";

export interface SymbolUpdateOptions {
  /// Il nome del simbolo, come lo si mostra.
  readonly name: string;
  /// Il nome della libreria.
  readonly library: string;
  /// Le istanze del simbolo nel disegno.
  readonly uses: number;
  /// Il simbolo è cambiato nel disegno da quando lo si è copiato; `null`
  /// se non si sa, perché è cambiata anche la libreria.
  readonly edited: boolean | null;
  /// Le anteprime, come URL: com'è nel disegno e com'è nella libreria;
  /// `null` dove non si fanno.
  readonly before: string | null;
  readonly after: string | null;
}

let dialogs = 0;

/// La frase della finestra: le istanze che cambiano, e le modifiche del
/// disegno che si perdono.
export function updateMessage(options: Pick<SymbolUpdateOptions, "library" | "uses" | "edited">): string {
  const { library, uses } = options;
  const count = uses === 0 ? t("draw.symbols.update.none", { library }) : t(uses === 1 ? "draw.symbols.update.one" : "draw.symbols.update.other", { count: uses, library });
  if (options.edited === false) return count;
  return `${count} ${t(options.edited === true ? "draw.symbols.update.edited" : "draw.symbols.update.edited_maybe")}`;
}

/// Apre la finestra: vero se chi disegna conferma.
export function symbolUpdateDialog(options: SymbolUpdateOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(t("draw.symbols.update.title", { name: options.name }), () => settle(false));
    const form = document.createElement("form");
    form.className = "palette-form";
    const message = document.createElement("p");
    message.id = `draw-symbol-update-${++dialogs}`;
    message.className = "draw-symbol-update-message";
    message.textContent = updateMessage(options);
    frame.overlay.setAttribute("aria-describedby", message.id);

    const side = (label: string, url: string | null): HTMLElement => {
      const figure = document.createElement("figure");
      figure.className = "draw-symbol-update-side";
      const holder = document.createElement("span");
      holder.className = "draw-symbol-update-frame";
      if (url !== null) {
        const image = document.createElement("img");
        image.className = "draw-symbol-update-preview";
        image.alt = "";
        image.draggable = false;
        image.src = url;
        holder.append(image);
      }
      const caption = document.createElement("figcaption");
      caption.className = "draw-symbol-update-caption";
      caption.textContent = label;
      figure.append(holder, caption);
      return figure;
    };
    const pair = document.createElement("div");
    pair.className = "draw-symbol-update-pair";
    pair.setAttribute("aria-hidden", "true");
    pair.append(side(t("draw.symbols.update.before"), options.before), side(t("draw.symbols.update.after", { library: options.library }), options.after));

    const row = actions(t("draw.symbols.update.ok"), () => settle(false));
    form.append(message, pair, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle(true);
    });
    frame.box.append(form);
    row.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  });
}
