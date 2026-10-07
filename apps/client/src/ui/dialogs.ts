// Le domande che la shell fa da sé: un nome, una scelta in un elenco lungo.
//
// Prima erano `window.prompt` in segnalibri, workspace e gruppi di tab: un
// dialogo del browser, fuori dal tema e dalla lingua, che nelle webview di
// Tauri non è garantito su ogni piattaforma. E la scelta di una cartella era un
// menu contestuale con duecento voci aperto in (0,0). Qui c'è una forma sola,
// la `.modale` della palette: stesso fuoco intrappolato, stesso Esc, stessa
// pelle.
//
// Una conferma sì/no invece non sta qui: è una sola in tutta l'app, quella di
// `host/dialog.ts`, la superficie che la piattaforma disegna e che una shell
// sostituisce in un file.
import { t } from "../i18n/strings";
import { trapFocus } from "./a11y";
import { openLifetime, type Lifetime } from "./lifetime";
import { enterSurface, exitSurface } from "./motion";

/// Una finestra aperta: la `.modale` col suo titolo, il fuoco intrappolato
/// ed Esc. Il contenuto va in `box`.
export interface Frame {
  readonly overlay: HTMLElement;
  readonly box: HTMLElement;
  close(): void;
}

let dialogCount = 0;

/// Apre la forma comune delle domande: `onDismiss` quando l'utente la chiude
/// con Esc o col clic fuori. Per i moduli che fanno domande loro, come le
/// proprietà di un disegno o la nota delle annotazioni.
export function openFrame(title: string, onDismiss: () => void): Frame {
  const life = openLifetime();
  const overlay = document.createElement("div");
  overlay.className = "modale shell-dialog";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.tabIndex = -1;
  const box = document.createElement("div");
  box.className = "palette-box";
  const heading = document.createElement("h2");
  heading.className = "palette-heading";
  heading.id = `shell-dialog-title-${++dialogCount}`;
  heading.textContent = title;
  overlay.setAttribute("aria-labelledby", heading.id);
  box.append(heading);
  overlay.append(box);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    life.close();
  };
  life.listen(overlay, "mousedown", (event) => {
    if (event.target === overlay) {
      close();
      onDismiss();
    }
  });
  document.body.append(overlay);
  enterSurface(overlay, { viewTransition: false });
  life.add(() => exitSurface(overlay, () => overlay.remove(), { viewTransition: false }));
  life.add(trapFocus(overlay, () => {
    close();
    onDismiss();
  }));
  return { overlay, box, close };
}

/// La riga dei pulsanti: conferma, che invia il modulo, e Annulla.
export function actions(okLabel: string, onCancel: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "palette-actions";
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.className = "primary";
  ok.textContent = okLabel;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("app.cancel");
  cancel.addEventListener("click", onCancel);
  row.append(ok, cancel);
  return row;
}

export interface PromptOptions {
  readonly title: string;
  readonly label: string;
  readonly value?: string;
  readonly okLabel?: string;
  readonly placeholder?: string;
}

/// Un testo chiesto all'utente: `null` se ha annullato, la stringa (anche
/// vuota) se ha confermato.
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(options.title, () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.className = "palette-label";
    name.textContent = options.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = options.value ?? "";
    if (options.placeholder) input.placeholder = options.placeholder;
    label.append(name, input);
    const row = actions(options.okLabel ?? t("app.ok"), () => settle(null));
    form.append(label, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle(input.value);
    });
    frame.box.append(form);
    input.focus();
    input.select();
  });
}

export interface PickItem<T> {
  readonly label: string;
  readonly detail?: string;
  readonly value: T;
  /// La miniatura della voce, per chi sceglie un'immagine: il suo URL, aperto
  /// nella vita della finestra, o `null` se non si apre. Si chiede la prima
  /// volta che la voce si vede.
  readonly thumbnail?: (life: Lifetime) => Promise<string | null>;
}

export interface PickOptions<T> {
  readonly title: string;
  readonly placeholder: string;
  readonly items: readonly PickItem<T>[];
  /// Quante voci esistono oltre a quelle elencate, da dire in fondo.
  readonly more?: number;
  /// Il valore scelto finora: se è fra le voci, l'elenco parte da lui.
  readonly current?: T;
}

/// Una scelta in un elenco filtrabile: `null` se l'utente ha annullato.
export function pickFromList<T>(options: PickOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    // Le miniature vivono quanto la finestra.
    const life = openLifetime();
    const settle = (value: T | null): void => {
      if (settled) return;
      settled = true;
      life.close();
      frame.close();
      resolve(value);
    };
    const frame = openFrame(options.title, () => settle(null));
    const listId = `shell-dialog-list-${dialogCount}`;
    const input = document.createElement("input");
    input.className = "palette-input";
    input.placeholder = options.placeholder;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", options.placeholder);
    input.setAttribute("aria-controls", listId);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    const list = document.createElement("ul");
    list.id = listId;
    list.className = "plain-list palette-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.title);
    const more = document.createElement("p");
    more.className = "palette-help";
    more.hidden = !options.more;
    if (options.more) more.textContent = t("dialog.more", { n: options.more });
    let visible: PickItem<T>[] = [];
    let selected = Math.max(0, options.items.findIndex((item) => options.current !== undefined && item.value === options.current));
    // Una miniatura per voce, fatta una volta: l'elenco si ridisegna a ogni
    // tasto, e l'immagine non si richiede. L'URL si chiede quando la voce
    // entra nell'elenco che si vede, così cinquecento immagini non si aprono
    // tutte insieme.
    const thumbnails = new Map<PickItem<T>, HTMLImageElement>();
    const owners = new Map<Element, PickItem<T>>();
    const load = (item: PickItem<T>, image: HTMLImageElement): void => {
      void item.thumbnail!(life).then(
        (url) => {
          if (url !== null && !life.closed) image.src = url;
        },
        () => {},
      );
    };
    let watcher: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      watcher = new IntersectionObserver((entries, self) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          self.unobserve(entry.target);
          const item = owners.get(entry.target);
          if (item !== undefined) load(item, entry.target as HTMLImageElement);
        }
      }, { root: list });
      life.add(() => watcher?.disconnect());
    }
    const thumbnailOf = (item: PickItem<T>): HTMLImageElement => {
      let image = thumbnails.get(item);
      if (image === undefined) {
        image = document.createElement("img");
        image.className = "palette-thumb";
        // Il ritaglio nel quadrato è la forma del componente: un tema dipinge
        // la miniatura, ma non decide come l'immagine riempie il riquadro.
        image.style.objectFit = "cover";
        // Il nome della voce dice già che cosa è.
        image.alt = "";
        image.decoding = "async";
        thumbnails.set(item, image);
        owners.set(image, item);
        if (watcher !== null) watcher.observe(image);
        else load(item, image);
      }
      return image;
    };
    const render = (): void => {
      const query = input.value.trim().toLocaleLowerCase();
      visible = options.items.filter((item) =>
        query === "" || `${item.label} ${item.detail ?? ""}`.toLocaleLowerCase().includes(query));
      selected = Math.min(selected, Math.max(0, visible.length - 1));
      list.replaceChildren();
      visible.forEach((item, index) => {
        const li = document.createElement("li");
        li.id = `${listId}-${index}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(index === selected));
        const row = document.createElement("div");
        row.className = "palette-row";
        if (item.thumbnail !== undefined) row.append(thumbnailOf(item));
        const title = document.createElement("span");
        title.className = "palette-title";
        title.textContent = item.label;
        row.append(title);
        if (item.detail) {
          const detail = document.createElement("span");
          detail.className = "palette-scope";
          detail.textContent = item.detail;
          row.append(detail);
        }
        li.append(row);
        li.addEventListener("click", () => settle(item.value));
        list.append(li);
      });
      if (visible.length === 0) {
        const empty = document.createElement("li");
        empty.className = "palette-empty";
        empty.setAttribute("role", "option");
        empty.setAttribute("aria-disabled", "true");
        empty.setAttribute("aria-selected", "false");
        empty.textContent = t("dialog.empty");
        list.append(empty);
        input.removeAttribute("aria-activedescendant");
      } else {
        input.setAttribute("aria-activedescendant", `${listId}-${selected}`);
        list.children[selected]?.scrollIntoView?.({ block: "nearest" });
      }
    };
    input.addEventListener("input", () => {
      selected = 0;
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (visible.length === 0) return;
        selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = visible[selected];
        if (item) settle(item.value);
      }
    });
    frame.box.append(input, list, more);
    render();
    input.focus();
  });
}
