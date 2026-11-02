// La scheda dei file delle app Craft (N7): la registrazione della famiglia
// `craft` nel registro delle superfici.
//
// Un disegno di VectorCraft, un'immagine di PhotoCraft e un progetto di
// FigCraft si aprono col profilo `craft` (l'anteprima e la riga dei dati), un
// XMP di LightCraft col profilo `xmp` (voto, etichetta, scelta, parole chiave,
// la foto). La scheda è in sola lettura: Fub non scrive mai un file Craft.
//
// Questo modulo è leggero di proposito: il registro lo carica con la shell,
// mentre la superficie (`surface.ts`, con `xmp-view.ts`) arriva con un
// `import()` alla prima scheda che si apre, come la barra della griglia.

import type { EditorSurface, SurfaceMode, SurfaceMountContext } from "../core/registry";
import { openLifetime } from "../../ui/lifetime";
import { t, type Key } from "../../i18n/strings";
import type { CraftPreviewInfo } from "../../host/craft";
import { formatBytes } from "../media/media-types";

/// Il proprietario: il bundle che risponde all'anteprima.
export const CRAFT_OWNER = "fub.craft";
export const CRAFT_FAMILY = "craft";
/// Il profilo dei file delle tre app.
export const CRAFT_PROFILE = "craft";
/// Il profilo degli XMP.
export const XMP_PROFILE = "xmp";
/// Gli id dei formati di `fub-format-craft` (`apps.rs`) e il loro profilo.
export const CRAFT_FORMATS: Readonly<Record<string, string>> = {
  "craft-vectorcraft": CRAFT_PROFILE,
  "craft-photocraft": CRAFT_PROFILE,
  "craft-figcraft": CRAFT_PROFILE,
  "craft-xmp": XMP_PROFILE,
};

/// Una modalità sola, di lettura: il contenuto è ciò che il file dice.
export const CRAFT_MODES: readonly SurfaceMode[] = [
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading", looks: ["file"] },
];

/// Ciò che la scheda chiede alla shell.
export interface CraftSurfaceDeps {
  /// Apre un documento del vault: la foto di un XMP, una copia `-Edit.psd`.
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  /// Cerca un tag, come un clic su un tag della nota.
  readonly onSearchTag: (tag: string) => void;
}

/// Monta la scheda di un file Craft o di un XMP dentro `context.parent`.
///
/// La superficie torna subito; il suo contenuto arriva con il modulo. Chiusa
/// prima che il modulo arrivi, non monta niente.
export function mountCraftSurface(profile: string, context: SurfaceMountContext, deps: CraftSurfaceDeps): EditorSurface {
  if (profile !== CRAFT_PROFILE && profile !== XMP_PROFILE) {
    throw new Error(`craft surface profile ${profile} is not registered`);
  }
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = "document-surface document-surface-craft media-surface craft-surface";
  root.dataset.profile = profile;
  root.tabIndex = 0;
  root.setAttribute("role", "document");
  root.setAttribute("aria-busy", "true");
  context.parent.replaceChildren(root);
  life.add(() => root.remove());

  void import("./surface").then(
    ({ mountCraftContent }) => mountCraftContent(profile, root, context, deps, life),
    () => {
      if (life.closed) return;
      root.removeAttribute("aria-busy");
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = t("surface.unavailable");
      root.replaceChildren(status);
    },
  );

  return {
    family: CRAFT_FAMILY,
    profile,
    surfaceId: context.paneId,
    modes: CRAFT_MODES,
    setMode(mode) {
      if (!CRAFT_MODES.some((each) => each.id === mode)) throw new RangeError(`surface mode ${mode} is not supported`);
      root.dataset.mode = mode;
    },
    focus() {
      root.focus();
    },
    // Sempre in sola lettura: non c'è niente da bloccare.
    setReadOnly() {},
    setTheme(theme) {
      root.dataset.theme = theme;
    },
    destroy() {
      life.close();
    },
  };
}

const KIND_KEYS: Readonly<Record<CraftPreviewInfo["app"], Key>> = {
  vectorcraft: "craft.kind.vectorcraft",
  photocraft: "craft.kind.photocraft",
  figcraft: "craft.kind.figcraft",
  xmp: "craft.kind.xmp",
};

/// Il nome del file, senza le cartelle.
export function fileName(doc: string): string {
  return doc.slice(doc.lastIndexOf("/") + 1) || doc;
}

/// La riga dei dati: «Disegno di VectorCraft · formato 4 · 178.1 KiB». Il
/// nome dell'app si mostra come il bundle lo scrive, anche se il catalogo non
/// lo conosce.
export function craftInfoText(info: CraftPreviewInfo): string {
  const parts = [t(KIND_KEYS[info.app], { app: info.editor })];
  if (info.format_version !== null) parts.push(t("craft.info.version", { version: info.format_version }));
  parts.push(formatBytes(info.bytes));
  return parts.join(" · ");
}
