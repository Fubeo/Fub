// Il cassetto «Tutti gli strumenti» del Disegno completo (piano K6, T8;
// `docs/product/drawing.md`, «La colonna»): un popover del kit con la ricerca,
// gli strumenti per gruppo, il tasto di ciascuno, e «Modifica la colonna».
//
// Il cassetto non sceglie niente da sé: `pick` riceve l'id dello strumento e
// lo usa (come la casella della colonna), `edit` apre la colonna da
// modificare. Chiuso il cassetto, il fuoco torna alla casella che l'ha aperto.
//
// Sta nel chunk del Completo: lo chiama `completo/index.ts` con `import()`, e
// il chrome principale non lo importa.

import { textField } from "../../../../../kit/field";
import { openPopover, type PopoverHandle } from "../../../../../kit/popover";
import { identifier } from "../../../../../ui/a11y";
import { iconEl } from "../../../../../ui/icons";
import type { Lifetime } from "../../../../../ui/lifetime";
import { t, type DrawKey } from "../../../strings";

/// La famiglia di uno strumento nel cassetto: l'ordine dei gruppi.
export type FamigliaCassetto = "pick" | "ink" | "shape" | "text";

/// Uno strumento nel cassetto: il suo nome, la sua figura e il suo tasto.
export interface StrumentoCassetto {
  readonly id: string;
  readonly label: DrawKey;
  /// Un nome di `ui/icons.ts`.
  readonly icon: string;
  /// Il tasto come si legge, «V» o «Maiusc+L»; vuoto se non ne ha.
  readonly keys: string;
  readonly famiglia: FamigliaCassetto;
}

export interface CassettoOptions {
  /// La casella che apre il cassetto.
  readonly anchor: HTMLElement;
  readonly strumenti: readonly StrumentoCassetto[];
  /// Lo strumento in uso: è segnato come premuto.
  readonly corrente: string | null;
  /// Sceglie uno strumento: il cassetto si chiude.
  readonly scegli: (id: string) => void;
  /// «Modifica la colonna…»: il cassetto si chiude e si apre la colonna.
  readonly modifica: () => void;
  readonly lifetime: Lifetime;
}

/// I gruppi del cassetto, nell'ordine in cui si leggono.
const FAMIGLIE: readonly FamigliaCassetto[] = ["pick", "ink", "shape", "text"];

/// Il nome di un gruppo del cassetto.
const NOME_FAMIGLIA: Readonly<Record<FamigliaCassetto, DrawKey>> = {
  pick: "draw.chrome.drawer.group.pick",
  ink: "draw.chrome.drawer.group.ink",
  shape: "draw.chrome.drawer.group.shape",
  text: "draw.chrome.drawer.group.text",
};

/// Il testo di ricerca di un nome, senza maiuscole né accenti: così «penna»
/// trova «Penna».
function cerca(testo: string): string {
  return testo.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/// Apre il cassetto: il popover col titolo, la ricerca, i gruppi e la
/// modifica della colonna. Il ritorno lo chiude.
export function apriCassetto(options: CassettoOptions): PopoverHandle {
  const { lifetime } = options;
  const titolo = identifier("draw-drawer-title");
  const root = document.createElement("div");
  root.className = "draw-drawer";

  const head = document.createElement("div");
  head.className = "draw-drawer-head";
  const h2 = document.createElement("h2");
  h2.className = "draw-drawer-title";
  h2.id = titolo;
  h2.textContent = t("draw.chrome.drawer.title");
  const note = document.createElement("p");
  note.className = "draw-drawer-note";
  note.textContent = t("draw.chrome.drawer.note");
  head.append(h2, note);

  const field = textField({ label: t("draw.chrome.drawer.search"), labelHidden: true, placeholder: t("draw.chrome.drawer.search"), lifetime });
  field.element.classList.add("draw-drawer-field");

  const groups = document.createElement("div");
  groups.className = "draw-drawer-groups";
  const empty = document.createElement("p");
  empty.className = "draw-drawer-empty";
  empty.textContent = t("draw.chrome.drawer.empty");
  empty.hidden = true;

  const buttons: { button: HTMLButtonElement; section: HTMLElement; name: string }[] = [];
  const sections: { section: HTMLElement; buttons: HTMLButtonElement[] }[] = [];
  for (const famiglia of FAMIGLIE) {
    const elencati = options.strumenti.filter((strumento) => strumento.famiglia === famiglia);
    if (elencati.length === 0) continue;
    const section = document.createElement("section");
    section.className = "draw-drawer-group";
    const heading = document.createElement("h3");
    heading.className = "draw-drawer-heading";
    heading.id = identifier(`draw-drawer-heading-${famiglia}`);
    heading.textContent = t(NOME_FAMIGLIA[famiglia]);
    section.setAttribute("aria-labelledby", heading.id);
    const grid = document.createElement("div");
    grid.className = "draw-drawer-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", heading.id);
    const inGruppo: HTMLButtonElement[] = [];
    for (const strumento of elencati) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draw-drawer-tool";
      button.dataset.tool = strumento.id;
      button.setAttribute("aria-pressed", String(strumento.id === options.corrente));
      const icon = document.createElement("span");
      icon.className = "draw-drawer-icon";
      icon.setAttribute("aria-hidden", "true");
      const svg = iconEl(strumento.icon);
      if (svg !== null) icon.append(svg);
      const name = document.createElement("span");
      name.className = "draw-drawer-name";
      name.textContent = t(strumento.label);
      button.append(icon, name);
      if (strumento.keys !== "") {
        const keys = document.createElement("kbd");
        keys.className = "draw-drawer-keys";
        keys.textContent = strumento.keys;
        button.append(keys);
      }
      button.addEventListener("click", () => {
        options.scegli(strumento.id);
        popover.close("manual");
      });
      grid.append(button);
      inGruppo.push(button);
      buttons.push({ button, section, name: cerca(t(strumento.label)) });
    }
    section.append(heading, grid);
    groups.append(section);
    sections.push({ section, buttons: inGruppo });
  }

  // La ricerca nasconde i nomi che non contengono il testo, e i gruppi vuoti.
  field.input.addEventListener("input", () => {
    const query = cerca(field.value().trim());
    for (const { button, name } of buttons) button.hidden = query !== "" && !name.includes(query);
    let visibili = 0;
    for (const { section, buttons: inGruppo } of sections) {
      const quanti = inGruppo.filter((button) => !button.hidden).length;
      section.hidden = quanti === 0;
      visibili += quanti;
    }
    empty.hidden = visibili > 0;
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "draw-drawer-edit";
  edit.textContent = t("draw.chrome.drawer.edit");
  edit.addEventListener("click", () => {
    popover.close("manual");
    options.modifica();
  });

  root.append(head, field.element, groups, empty, edit);
  const popover = openPopover({
    anchor: options.anchor,
    content: root,
    placement: "right",
    align: "start",
    labelledBy: titolo,
    className: "kit-rail-popover draw-drawer-popover",
    lifetime,
  });
  return popover;
}
