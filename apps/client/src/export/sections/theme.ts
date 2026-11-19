// La sezione «Tema» dello spazio «Esporta in PDF» (E28, T71; il prototipo
// `.px-themes`, `.px-th`, `.px-thp`, passo 28).
//
// Otto temi di stampa in una griglia di quattro: ogni tema è una paginetta
// coi suoi colori e il carattere dei suoi titoli. Il passaggio del puntatore
// su un tema lo mostra sulle pagine prima di sceglierlo (coi tuoi colori
// sopra, come uscirebbe); uscendo dalla griglia le pagine tornano al tema
// scelto. Sotto, ciò che il tema è, e se hai regolazioni tue il pulsante che
// le toglie tutte e torna al tema.

import { plural, t, type Key } from "../../i18n/strings";
import { ownCount, printTheme, PRINT_FONTS, THEME_IDS, withoutOwn } from "../themes";
import { themeName, type SectionContext } from "./index";

const ABOUT: Readonly<Record<string, Key>> = {
  fub: "pdf_export.theme.fub.about",
  classico: "pdf_export.theme.classico.about",
  relazione: "pdf_export.theme.relazione.about",
  rivista: "pdf_export.theme.rivista.about",
  accademico: "pdf_export.theme.accademico.about",
  quaderno: "pdf_export.theme.quaderno.about",
  essenziale: "pdf_export.theme.essenziale.about",
  notte: "pdf_export.theme.notte.about",
};

/// Ciò che un tema è, in una riga: «Verde, testo con grazie».
export function themeAbout(id: string): string {
  return t(ABOUT[id] ?? ABOUT["fub"]);
}

function themeCard(id: string, chosen: boolean): HTMLButtonElement {
  const entry = printTheme(id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-theme";
  button.id = `export-theme-${id}`;
  button.dataset["theme"] = id;
  button.setAttribute("aria-pressed", String(chosen));
  button.title = themeAbout(id);
  // La paginetta: la carta, un titolo «Aa», tre righe di testo e un riquadro
  // col filo d'accento. I colori sono quelli del tema, come dati: la pelle li
  // legge da queste variabili.
  const preview = document.createElement("span");
  preview.className = "export-theme-preview";
  preview.setAttribute("aria-hidden", "true");
  const { colors } = entry;
  preview.style.setProperty("--export-theme-paper", colors.carta);
  preview.style.setProperty("--export-theme-ink", colors.testo);
  preview.style.setProperty("--export-theme-heading", colors.titoli);
  preview.style.setProperty("--export-theme-accent", colors.accento);
  preview.style.setProperty("--export-theme-rule", colors.linee);
  preview.style.setProperty("--export-theme-fill", colors.riquadri);
  preview.style.setProperty("--export-theme-font", PRINT_FONTS[entry.text.carattere_titoli]?.stack ?? "inherit");
  const heading = document.createElement("b");
  heading.className = "export-theme-heading";
  heading.textContent = "Aa";
  const lines = [0, 1, 2].map((index) => {
    const line = document.createElement("i");
    line.className = index === 2 ? "export-theme-line export-theme-line-short" : "export-theme-line";
    return line;
  });
  const box = document.createElement("u");
  box.className = "export-theme-box";
  preview.append(heading, ...lines, box);
  const name = document.createElement("span");
  name.className = "export-theme-name";
  name.textContent = themeName(id);
  button.append(preview, name);
  return button;
}

export function themeBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-theme-section";
  const chosen = context.profile.tema;
  const grid = document.createElement("div");
  grid.className = "export-themes";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("pdf_export.theme.group"));
  // Un tema che questa versione non conosce si mostra come Fub: nessuna
  // carta è premuta, e il nome in testa dice Fub.
  for (const id of THEME_IDS) grid.append(themeCard(id, id === chosen));

  const about = document.createElement("p");
  about.className = "export-note";
  about.id = "export-theme-about";
  const restAbout = () => {
    about.textContent = `${themeAbout(chosen)}. ${t("pdf_export.theme.hover")}`;
  };
  restAbout();

  let previewing: string | null = null;
  grid.addEventListener("pointerover", (event) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(".export-theme");
    const id = card?.dataset["theme"];
    if (!id || id === previewing) return;
    previewing = id;
    about.textContent = `${themeAbout(id)}.`;
    context.preview(id === context.profile.tema ? null : { ...context.profile, tema: id });
  });
  grid.addEventListener("pointerleave", () => {
    if (previewing === null) return;
    previewing = null;
    restAbout();
    context.preview(null);
  });
  grid.addEventListener("click", (event) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(".export-theme");
    const id = card?.dataset["theme"];
    if (!id) return;
    previewing = null;
    if (id === context.profile.tema) {
      context.preview(null);
      return;
    }
    context.change({ ...context.profile, tema: id });
  });

  body.append(grid, about);
  const own = ownCount(context.profile);
  if (own > 0) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "export-link";
    reset.id = "export-theme-reset";
    reset.textContent = plural(own, "pdf_export.theme.reset.one", "pdf_export.theme.reset.other");
    reset.addEventListener("click", () => context.change(withoutOwn(context.profile)));
    body.append(reset);
  }
  return body;
}
