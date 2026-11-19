// La sezione «Colori» dello spazio «Esporta in PDF» (E28, T71; il prototipo
// `.px-cols`, `.px-col`, `.px-pal`, `.px-con`, `.px-tog`, passo 28).
//
// Gli undici colori della pagina, uno per riga: il tondo, il nome, «tuo» se
// l'hai cambiato e il codice. Un clic apre la riga: i tondi pronti, il
// selettore libero e il codice scritto a mano; accanto a un colore tuo, il
// pulsante che lo riporta a quello del tema. Il passaggio su una riga
// contorna sulle pagine i punti dove quel colore è usato.
//
// Sotto, il contrasto del testo e dell'accento sulla carta, ricalcolato a
// ogni colore, e i due interruttori: bianco e nero, risparmio d'inchiostro.
//
// Mentre si trascina il selettore (o si scrive un codice valido) il colore
// arriva alle pagine «dal vivo» e la riga si aggiorna da sé; a gesto finito
// (`change`) il pannello si ridisegna col fuoco dov'era.

import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import {
  COLOR_KIND,
  contrastOf,
  ownColors,
  PAGE_COLORS,
  pageColorsOf,
  PALETTES,
  parseColor,
  withColor,
  type PageColor,
  type PageColors,
} from "../themes";
import type { ExportProfile } from "../profile";
import type { SectionContext } from "./index";

export const COLOR_NAMES: Readonly<Record<PageColor, Key>> = {
  carta: "pdf_export.color.carta",
  testo: "pdf_export.color.testo",
  titoli: "pdf_export.color.titoli",
  accento: "pdf_export.color.accento",
  link: "pdf_export.color.link",
  "testo-secondario": "pdf_export.color.testo_secondario",
  linee: "pdf_export.color.linee",
  evidenziato: "pdf_export.color.evidenziato",
  riquadri: "pdf_export.color.riquadri",
  codice: "pdf_export.color.codice",
  "intestazioni-tabella": "pdf_export.color.intestazioni_tabella",
};

/// Quale riga è aperta, fra un disegno del pannello e l'altro.
const OPEN_KEY = "colori.aperto";

function iconSpan(name: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "export-icon export-icon-small";
  span.setAttribute("aria-hidden", "true");
  const svg = iconEl(name);
  if (svg) span.append(svg);
  return span;
}

function ratio(value: number): string {
  return new Intl.NumberFormat(resolvedLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor(value * 10) / 10);
}

/// La frase del contrasto: il testo sulla carta sempre, l'accento solo
/// quando è troppo chiaro (`pxConText`).
export function fillContrast(element: HTMLElement, colors: PageColors): void {
  const report = contrastOf(colors);
  const verdict = report.textLow ? "pdf_export.contrast.low" : report.text < 7 ? "pdf_export.contrast.good" : "pdf_export.contrast.great";
  const strong = (text: string) => {
    const b = document.createElement("b");
    b.textContent = text;
    return b;
  };
  const parts: (Node | string)[] = [t("pdf_export.contrast.text"), " ", strong(t("pdf_export.contrast.ratio", { ratio: ratio(report.text) })), ` · ${t(verdict)}`];
  if (report.accentLow) {
    parts.push(document.createElement("br"), t("pdf_export.contrast.accent"), " ", strong(t("pdf_export.contrast.ratio", { ratio: ratio(report.accent) })), ` · ${t("pdf_export.contrast.accent_low")}`);
  }
  element.replaceChildren(...parts);
  element.classList.toggle("is-low", report.textLow || report.accentLow);
}

function toggle(id: string, label: Key, hint: Key, on: boolean, flip: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-toggle";
  button.id = id;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(on));
  const text = document.createElement("span");
  text.className = "export-toggle-text";
  text.textContent = t(label);
  const small = document.createElement("small");
  small.className = "export-toggle-hint";
  small.textContent = t(hint);
  text.append(small);
  const knob = document.createElement("i");
  knob.className = "export-toggle-knob";
  knob.setAttribute("aria-hidden", "true");
  button.append(text, knob);
  button.addEventListener("click", flip);
  return button;
}

export function colorsBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-color-section";
  const initial = context.profile;
  const colors = pageColorsOf(initial);
  const own = ownColors(context.profile);
  const openKey = context.memory.get(OPEN_KEY) as PageColor | undefined;

  const contrastLine = document.createElement("p");
  contrastLine.className = "export-contrast";
  contrastLine.id = "export-contrast";
  contrastLine.setAttribute("role", "status");
  fillContrast(contrastLine, colors);

  const list = document.createElement("div");
  list.className = "export-colors";

  /// Un colore scelto: dal vivo cambia le pagine, la riga e il contrasto;
  /// a gesto finito ridisegna il pannello.
  const apply = (key: PageColor, value: string, live: boolean, row: HTMLElement) => {
    const next: ExportProfile = withColor(context.profile, key, value);
    if (live) {
      const shown = pageColorsOf(next);
      const chip = row.querySelector<HTMLElement>(".export-color-chip");
      chip?.style.setProperty("--export-color", shown[key]);
      const code = row.querySelector(".export-color-code");
      if (code) code.textContent = shown[key];
      fillContrast(contrastLine, shown);
    }
    context.change(next, live ? { live: true } : undefined);
  };

  for (const key of PAGE_COLORS) {
    const name = t(COLOR_NAMES[key]);
    const value = colors[key];
    const mine = key in own;
    const open = openKey === key;
    const row = document.createElement("div");
    row.className = open ? "export-color is-open" : "export-color";
    row.dataset["color"] = key;

    const head = document.createElement("button");
    head.type = "button";
    head.className = "export-color-head";
    head.id = `export-color-${key}`;
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", `export-color-palette-${key}`);
    const chip = document.createElement("i");
    chip.className = "export-color-chip";
    chip.setAttribute("aria-hidden", "true");
    chip.style.setProperty("--export-color", value);
    const label = document.createElement("span");
    label.className = "export-color-name";
    label.textContent = name;
    head.append(chip, label);
    if (mine) {
      const badge = document.createElement("em");
      badge.className = "export-color-own";
      badge.textContent = t("pdf_export.colors.yours");
      head.append(badge);
    }
    const code = document.createElement("code");
    code.className = "export-color-code";
    code.textContent = value;
    head.append(code);
    head.addEventListener("click", () => {
      if (open) context.memory.delete(OPEN_KEY);
      else context.memory.set(OPEN_KEY, key);
      context.redraw();
    });
    row.append(head);

    if (mine) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "export-color-reset";
      reset.id = `export-color-reset-${key}`;
      reset.setAttribute("aria-label", t("pdf_export.colors.reset", { name }));
      reset.title = t("pdf_export.colors.reset_title");
      reset.append(iconSpan("history"));
      reset.addEventListener("click", () => {
        context.change(withColor(context.profile, key, null));
        document.getElementById(head.id)?.focus({ preventScroll: true });
      });
      row.append(reset);
    }

    if (open) row.append(palette(key, name, value, row));
    list.append(row);
  }

  function palette(key: PageColor, name: string, value: string, row: HTMLElement): HTMLElement {
    const box = document.createElement("div");
    box.className = "export-palette";
    box.id = `export-color-palette-${key}`;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", name);
    for (const swatch of PALETTES[COLOR_KIND[key]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "export-swatch";
      button.id = `export-swatch-${key}-${swatch.slice(1)}`;
      button.style.setProperty("--export-color", swatch);
      button.setAttribute("aria-label", t("pdf_export.colors.swatch", { color: swatch }));
      button.setAttribute("aria-pressed", String(value === swatch));
      button.addEventListener("click", () => apply(key, swatch, false, row));
      box.append(button);
    }
    const pick = document.createElement("label");
    pick.className = "export-pick";
    pick.title = t("pdf_export.colors.pick_title");
    const input = document.createElement("input");
    input.type = "color";
    input.className = "export-pick-input";
    input.id = `export-pick-${key}`;
    input.value = value;
    input.setAttribute("aria-label", t("pdf_export.colors.pick", { name }));
    input.addEventListener("input", () => {
      const color = parseColor(input.value);
      if (color) apply(key, color, true, row);
    });
    input.addEventListener("change", () => {
      const color = parseColor(input.value);
      if (color) apply(key, color, false, row);
    });
    pick.append(input, iconSpan("export-pick"));

    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "export-hex";
    hex.id = `export-hex-${key}`;
    hex.value = value;
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = "off";
    hex.setAttribute("aria-label", t("pdf_export.colors.hex", { name }));
    const error = document.createElement("p");
    error.className = "export-hex-error";
    error.id = `export-hex-error-${key}`;
    error.textContent = t("pdf_export.colors.hex_invalid");
    error.hidden = true;
    hex.setAttribute("aria-describedby", error.id);
    const mark = (valid: boolean) => {
      if (valid) hex.removeAttribute("aria-invalid");
      else hex.setAttribute("aria-invalid", "true");
      error.hidden = valid;
    };
    hex.addEventListener("input", () => {
      const color = parseColor(hex.value);
      // Un codice a metà non è ancora un errore: lo diventa se resta così.
      const partial = /^#?[0-9a-f]{0,5}$/iu.test(hex.value.trim());
      mark(color !== null || partial);
      if (color) apply(key, color, true, row);
    });
    hex.addEventListener("change", () => {
      const color = parseColor(hex.value);
      if (color) {
        mark(true);
        apply(key, color, false, row);
        return;
      }
      // Scritto male: il colore resta quello di prima, e la riga lo dice.
      mark(false);
    });
    hex.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || hex.value === value) return;
      // Esc nel campo rimette il colore di prima, senza chiudere lo spazio.
      event.preventDefault();
      event.stopPropagation();
      hex.value = value;
      mark(true);
      context.change(initial);
    });
    box.append(pick, hex, error);
    return box;
  }

  // Il passaggio su una riga (o il fuoco) contorna i punti dove quel colore
  // è usato sulle pagine.
  const rowKey = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>(".export-color")?.dataset["color"] as PageColor | undefined) : undefined) ?? null;
  let shown: PageColor | null = null;
  const show = (key: PageColor | null) => {
    if (key === shown) return;
    shown = key;
    context.highlight(key);
  };
  list.addEventListener("pointerover", (event) => show(rowKey(event.target)));
  list.addEventListener("pointerleave", () => show(list.contains(document.activeElement) ? rowKey(document.activeElement) : null));
  list.addEventListener("focusin", (event) => show(rowKey(event.target)));
  list.addEventListener("focusout", (event) => {
    if (!list.contains(event.relatedTarget as Node | null)) show(null);
  });

  const ink = context.profile.inchiostro;
  const gray = toggle("export-colors-gray", "pdf_export.colors.gray_toggle", "pdf_export.colors.gray_hint", ink.bianco_e_nero, () =>
    context.change({ ...context.profile, inchiostro: { ...context.profile.inchiostro, bianco_e_nero: !context.profile.inchiostro.bianco_e_nero } }),
  );
  const save = toggle("export-colors-save", "pdf_export.colors.save_toggle", "pdf_export.colors.save_hint", ink.risparmio, () =>
    context.change({ ...context.profile, inchiostro: { ...context.profile.inchiostro, risparmio: !context.profile.inchiostro.risparmio } }),
  );
  body.append(list, contrastLine, gray, save);
  return body;
}
