// La barra in alto dello spazio «Esporta in PDF» (E28, T70; il prototipo
// `.px-top`, riga 1609).
//
// Da sinistra: «Torna alla nota», il nome dello spazio con quello della nota,
// lo zoom, le tre viste (una pagina, due affiancate, tutte in miniatura), il
// profilo, «Stampa…» ed «Esporta». La barra non decide niente: dice ciò che
// vale (`setZoom`, `setView`, `setProfile`) e passa i gesti a chi la monta.

import { t } from "../i18n/strings";
import { icon, iconEl, registerIcon } from "../ui/icons";

/// Quante pagine si vedono: una larga quanto lo spazio (`adatta`), due
/// affiancate, tutte in miniatura; `libera` è lo zoom scelto coi pulsanti.
export type ExportView = "adatta" | "due" | "tutte" | "libera";

export interface ToolbarActions {
  back(): void;
  zoom(step: -1 | 1): void;
  view(view: Exclude<ExportView, "libera">): void;
  profile(anchor: HTMLElement): void;
  print(): void;
  exportPdf(): void;
}

export interface Toolbar {
  readonly element: HTMLElement;
  setTitle(title: string): void;
  /// Lo zoom di adesso, in centesimi.
  setZoom(zoom: number): void;
  setView(view: ExportView): void;
  /// Il nome del profilo e se le regolazioni ne sono uscite.
  setProfile(name: string, modified: boolean): void;
}

/// Le figure della barra, sulla griglia di 24 delle icone di Fub: la
/// freccia indietro e la punta in giù del prototipo (`#i-arr-l`,
/// `#i-chev-d`), e la stampante di «Stampa…».
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "export-back": ["M19.5 12H5.25", "M11.25 6L5.25 12l6 6"],
  "export-open": ["M6.75 9.3L12 14.7l5.25-5.4"],
  "export-print": ["M7 9V4h10v5", "M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2", "M7 14h10v6H7z"],
};

function ensureIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

function figure(name: string, small = false): HTMLElement {
  const holder = document.createElement("span");
  holder.className = small ? "export-icon export-icon-small" : "export-icon";
  holder.setAttribute("aria-hidden", "true");
  const svg = iconEl(name);
  if (svg) holder.append(svg);
  return holder;
}

function button(className: string, label?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  if (label !== undefined) element.textContent = label;
  return element;
}

const VIEWS: readonly { readonly view: Exclude<ExportView, "libera">; readonly label: () => string }[] = [
  { view: "adatta", label: () => t("pdf_export.view.one") },
  { view: "due", label: () => t("pdf_export.view.two") },
  { view: "tutte", label: () => t("pdf_export.view.all") },
];

export function createToolbar(title: string, actions: ToolbarActions): Toolbar {
  ensureIcons();
  const element = document.createElement("header");
  element.className = "export-top";

  const back = button("export-back");
  const backLabel = document.createElement("span");
  backLabel.className = "export-back-label";
  backLabel.textContent = t("pdf_export.back");
  back.append(figure("export-back"), backLabel);
  back.setAttribute("aria-label", t("pdf_export.back"));
  back.addEventListener("click", () => actions.back());

  const heading = document.createElement("div");
  heading.className = "export-title";
  const name = document.createElement("b");
  name.className = "export-title-name";
  name.textContent = t("pdf_export.title");
  const note = document.createElement("span");
  note.className = "export-title-note";
  note.textContent = title;
  heading.append(name, note);

  const spacer = document.createElement("span");
  spacer.className = "export-spacer";

  const zoom = document.createElement("div");
  zoom.className = "export-zoom";
  zoom.setAttribute("role", "group");
  zoom.setAttribute("aria-label", t("pdf_export.zoom"));
  const zoomOut = button("export-zoom-button", "−");
  zoomOut.setAttribute("aria-label", t("pdf_export.zoom.out"));
  zoomOut.addEventListener("click", () => actions.zoom(-1));
  const zoomValue = document.createElement("output");
  zoomValue.className = "export-zoom-value";
  zoomValue.setAttribute("aria-live", "off");
  zoomValue.textContent = "100%";
  const zoomIn = button("export-zoom-button", "+");
  zoomIn.setAttribute("aria-label", t("pdf_export.zoom.in"));
  zoomIn.addEventListener("click", () => actions.zoom(1));
  zoom.append(zoomOut, zoomValue, zoomIn);

  const views = document.createElement("div");
  views.className = "export-segments export-views";
  views.setAttribute("role", "group");
  views.setAttribute("aria-label", t("pdf_export.views"));
  const viewButtons = VIEWS.map(({ view, label }) => {
    const option = button("export-segment", label());
    option.dataset["view"] = view;
    option.setAttribute("aria-pressed", String(view === "adatta"));
    option.addEventListener("click", () => actions.view(view));
    views.append(option);
    return option;
  });

  const profile = button("export-profile");
  profile.setAttribute("aria-haspopup", "menu");
  const profileName = document.createElement("span");
  profileName.className = "export-profile-name";
  profile.append(profileName, figure("export-open", true));
  profile.addEventListener("click", () => actions.profile(profile));

  const print = button("export-print");
  const printLabel = document.createElement("span");
  printLabel.className = "export-print-label";
  printLabel.textContent = t("pdf_export.print");
  print.append(figure("export-print"), printLabel);
  print.setAttribute("aria-label", t("pdf_export.print"));
  print.addEventListener("click", () => actions.print());

  const go = button("export-go", t("pdf_export.go"));
  go.addEventListener("click", () => actions.exportPdf());

  element.append(back, heading, spacer, zoom, views, profile, print, go);

  const toolbar: Toolbar = {
    element,
    setTitle(next) {
      note.textContent = next;
    },
    setZoom(value) {
      zoomValue.textContent = `${Math.round(value * 100)}%`;
    },
    setView(view) {
      for (const option of viewButtons) option.setAttribute("aria-pressed", String(option.dataset["view"] === view));
    },
    setProfile(nameText, modified) {
      const shown = modified ? t("pdf_export.profile.modified", { name: nameText }) : nameText;
      profileName.textContent = shown;
      profile.setAttribute("aria-label", t("pdf_export.profile.label", { name: shown }));
    },
  };
  return toolbar;
}
