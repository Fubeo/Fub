// L'anteprima dell'aspetto, in testa alla sezione che lo regola.
//
// Una finestra in piccolo fatta coi token che la shell monta davvero: la
// scrivania, un foglio col carattere di lettura, una riga scelta, un bottone.
// Non c'è niente da tenere allineato: quando una preferenza cambia, cambiano i
// token, e l'anteprima con loro — prima ancora che la persona chiuda la
// finestra per guardare il foglio vero.
import "./preferences.css";
import { t } from "../../../i18n/strings";
import { THEME_KEY } from "../../../theme/theme";
import type { Lifetime } from "../../../ui/lifetime";
import { byId } from "../frame/dom";
import { rowFor, setAttr, setText, type Piece } from "./rows";

function part(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/// Torna il gesto da ripetere a ogni riscrittura del corpo.
export function appearancePreview(lifetime: Lifetime, body: HTMLElement): Piece {
  // Un'immagine, per chi ascolta: ciò che mostra lo dicono già le righe sotto.
  const preview = part("div", "prefs-preview");
  preview.setAttribute("role", "img");

  const side = part("div", "prefs-preview-side");
  const plain = part("div", "prefs-preview-row");
  const selected = part("div", "prefs-preview-row prefs-preview-row--selected");
  const action = part("div", "prefs-preview-action");
  side.append(plain, selected, action);

  const sheet = part("div", "prefs-preview-sheet");
  const heading = part("div", "prefs-preview-title");
  const text = part("div", "prefs-preview-text");
  const before = document.createTextNode("");
  const link = part("span", "prefs-preview-link");
  const after = document.createTextNode("");
  text.append(before, link, after);
  sheet.append(heading, text);
  preview.append(side, sheet);
  lifetime.add(() => preview.remove());

  return () => {
    const card = rowFor(body, THEME_KEY)?.closest<HTMLElement>(".settings-card") ?? null;
    if (!card) {
      if (preview.isConnected) preview.remove();
      return false;
    }
    const placed = card.firstElementChild !== preview;
    if (placed) card.prepend(preview);
    // Sotto un filtro si cercano righe: l'anteprima non è una di loro.
    const filtering = (byId<HTMLInputElement>("settings-search")?.value.trim() ?? "") !== "" ||
      byId("settings-modified")?.getAttribute("aria-pressed") === "true";
    if (preview.hidden !== filtering) preview.hidden = filtering;
    setAttr(preview, "aria-label", t("prefs.preview.label"));
    setText(plain, t("prefs.preview.row"));
    setText(selected, t("prefs.preview.selected"));
    setText(action, t("prefs.preview.action"));
    setText(heading, t("prefs.preview.title"));
    const lead = `${t("prefs.preview.body")} `;
    if (before.data !== lead) before.data = lead;
    setText(link, t("prefs.preview.link"));
    const tail = ` ${t("prefs.preview.body_end")}`;
    if (after.data !== tail) after.data = tail;
    return placed;
  };
}
