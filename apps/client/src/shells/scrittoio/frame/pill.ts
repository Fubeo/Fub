// La pillola: premuta apre il lanciatore.
//
// Sul computer (`data-pill="command"` in `index.html`) è sempre il campo dei
// comandi: il nome della nota lo dice già la testata del foglio, e la pillola
// non lo ripete. Sul telefono la testata è stretta, e a riposo la pillola dice
// dove sei: il documento del foglio a fuoco, la cartella in grafite, il titolo
// in inchiostro; senza documento resta l'invito. I tasti accanto sono quelli
// veri del comando che la pillola preme.
import { t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import { on, state } from "../../../state/store";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { chordOf, keepLabelled, run } from "./commands";
import { byId } from "./dom";

/** Il comando che la pillola preme. */
export const PILL_COMMAND = "shell.switcher";
/** Senza un vault non c'è niente da aprire: restano i comandi. */
export const PILL_COMMAND_WITHOUT_VAULT = "shell.palette";

const SEPARATOR = " › ";

/** Il valore di `data-pill` che fa della pillola il solo campo dei comandi. */
export const PILL_KIND_COMMAND = "command";

/** La cartella di un documento come la si legge: `a/b/Nota.md` → `a › b`. */
export function pillPath(doc: string): string {
  const parts = doc.split("/").filter(Boolean);
  parts.pop();
  return parts.join(SEPARATOR);
}

export function mountPill(lifetime: Lifetime): void {
  const pill = byId<HTMLButtonElement>("pill");
  if (!pill) return;
  const path = byId("pill-path");
  const title = byId("pill-title");
  const key = byId("pill-key");
  const glyph = byId("pill-icon");
  if (glyph) glyph.innerHTML = icon("search");

  const draw = (): void => {
    // Il campo dei comandi non segue il documento: per lui non ce n'è mai uno.
    // L'attributo si rilegge a ogni disegno, come lo scrive l'HTML.
    const doc = pill.dataset.pill === PILL_KIND_COMMAND ? null : state.currentDoc;
    const folder = doc ? pillPath(doc) : "";
    if (path) {
      path.textContent = folder === "" ? "" : `${folder}${SEPARATOR}`;
      path.hidden = folder === "";
    }
    if (title) title.textContent = doc ? pageName(doc) : t("frame.pill.empty");
    pill.toggleAttribute("data-empty", !doc);
    const chord = chordOf(PILL_COMMAND);
    if (key) {
      key.textContent = chord;
      key.hidden = chord === "";
    }
    pill.setAttribute("aria-label", doc ? t("frame.pill.at", { title: pageName(doc) }) : t("frame.pill"));
    setTooltip(pill, chord ? `${t("frame.pill.hint")} (${chord})` : t("frame.pill.hint"));
  };
  keepLabelled(lifetime, draw);
  lifetime.add(on("active-doc", draw));
  lifetime.add(on("vault", draw));
  lifetime.add(on("documents", draw));

  lifetime.listen(pill, "click", (event) => {
    event.stopPropagation();
    run(state.vaultRoot ? PILL_COMMAND : PILL_COMMAND_WITHOUT_VAULT);
  });
}
