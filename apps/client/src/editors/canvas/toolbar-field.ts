// Il campo della colonna della lavagna nelle Impostazioni (`canvas.toolbar`).
//
// L'impostazione è un elenco di nomi di strumenti, e il pannello sa soltanto
// mostrarlo: quali strumenti ci sono e come si chiamano lo dice la lavagna. Il
// pannello carica questo modulo con un `import()` quando la riga c'è, come per
// `draw.toolbar`, e scrive ciò che il campo sceglie.

import type { SettingEntry } from "../../host/contract";
import { catalog, t } from "../../i18n/strings";

/// Le stringhe che la lavagna non ha ancora nel catalogo della shell. Penna,
/// evidenziatore e gomma ci sono già (`canvas.ink.tool.*`) e si usano quelle.
const IT = {
  "canvas.toolbar.select": "Selezione",
  "canvas.toolbar.hand": "Mano",
  "canvas.toolbar.text": "Testo",
  "canvas.toolbar.connect": "Collega",
  "canvas.toolbar.default": "Quelli di serie",
} as const;

const EN = {
  "canvas.toolbar.select": "Select",
  "canvas.toolbar.hand": "Hand",
  "canvas.toolbar.text": "Text",
  "canvas.toolbar.connect": "Connect",
  "canvas.toolbar.default": "The default ones",
} as const;

const strings = catalog(IT, { en: EN });

/// Gli strumenti della colonna, nell'ordine del piano (T48) e come nel
/// prototipo approvato. La colonna di serie arriva con T49: quando c'è, la lista
/// di serie si prende da lì.
export const CANVAS_TOOLS = ["select", "hand", "pen", "highlighter", "eraser", "text", "connect"] as const;

type CanvasTool = (typeof CANVAS_TOOLS)[number];

const LABEL: Readonly<Record<CanvasTool, () => string>> = {
  select: () => strings.t("canvas.toolbar.select"),
  hand: () => strings.t("canvas.toolbar.hand"),
  pen: () => t("canvas.ink.tool.pen"),
  highlighter: () => t("canvas.ink.tool.highlighter"),
  eraser: () => t("canvas.ink.tool.eraser"),
  text: () => strings.t("canvas.toolbar.text"),
  connect: () => strings.t("canvas.toolbar.connect"),
};

function isCanvasTool(name: string): name is CanvasTool {
  return (CANVAS_TOOLS as readonly string[]).includes(name);
}

/// Chi riceve una scelta: l'elenco intero da scrivere, lo strumento cambiato col
/// suo nome, e se ora è scelto.
export type ToolbarWrite = (value: string[], part: string, checked: boolean) => void;

/// Il campo: una casella per strumento. Un valore vuoto vuol dire la colonna di
/// serie, e le caselle mostrano quella, tutte accese, così si vede che cosa c'è.
/// Cambiata una casella, la lista si scrive nel suo ordine, e un nome che la
/// lavagna non conosce resta in fondo.
export function canvasToolbarField(entry: SettingEntry, id: string, write: ToolbarWrite): HTMLElement {
  const value = Array.isArray(entry.value) ? entry.value : [];
  const shown: readonly string[] = value.length === 0 ? CANVAS_TOOLS : value;
  const unknown = value.filter((name) => !isCanvasTool(name));
  const root = document.createElement("div");
  root.className = "setting-features";
  root.id = id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);
  const group = document.createElement("fieldset");
  group.className = "setting-features-group";
  for (const tool of CANVAS_TOOLS) {
    const name = LABEL[tool]();
    const item = document.createElement("label");
    item.className = "setting-feature";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `${id}-${tool}`;
    box.checked = shown.includes(tool);
    box.addEventListener("change", () => {
      const kept = shown.filter((each) => isCanvasTool(each) && each !== tool);
      write([...(box.checked ? [...kept, tool] : kept), ...unknown], name, box.checked);
    });
    item.append(box, document.createTextNode(name));
    group.append(item);
  }
  root.append(group);
  return root;
}

/// Gli strumenti di `value` nel loro ordine; vuoto, «quelli di serie». Un nome
/// che la lavagna non conosce si dice com'è.
export function describeCanvasToolbar(value: readonly string[]): string {
  if (value.length === 0) return strings.t("canvas.toolbar.default");
  return value.map((name) => (isCanvasTool(name) ? LABEL[name]() : name)).join(", ");
}
