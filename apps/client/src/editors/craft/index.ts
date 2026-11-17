// La scheda dei file delle app Craft (N7): la registrazione della famiglia
// `craft` nel registro delle superfici.
//
// Un disegno di VectorCraft, un'immagine di PhotoCraft e un progetto di
// FigCraft si aprono col profilo `craft` (l'anteprima e la riga dei dati), un
// XMP di LightCraft col profilo `xmp` (voto, etichetta, scelta, parole chiave,
// la foto). Una foto RAW col profilo `raw` (il JPEG che ha dentro, dritto,
// e i dati del suo XMP): un RAW non ha un formato del vault, arriva dai byte,
// e il registro lo dà alla famiglia `viewer` col profilo `media-raw`, che
// monta questa stessa scheda. La scheda è in sola lettura: Fub non scrive mai
// un file Craft.
//
// Questo modulo è leggero di proposito: il registro lo carica con la shell,
// mentre la superficie (`surface.ts`, con `xmp-view.ts`) arriva con un
// `import()` alla prima scheda che si apre, come la barra della griglia.

import type { EditorSurface, SurfaceMode, SurfaceMountContext } from "../core/registry";
import { openLifetime } from "../../ui/lifetime";
import { t, type Key } from "../../i18n/strings";
import type { CraftPreviewInfo } from "../../host/craft";
import { formatBytes } from "../media/media-types";
import { formatTagOf } from "../../ui/format-kind";

/// Il proprietario: il bundle che risponde all'anteprima.
export const CRAFT_OWNER = "fub.craft";
export const CRAFT_FAMILY = "craft";
/// Il profilo dei file delle tre app.
export const CRAFT_PROFILE = "craft";
/// Il profilo degli XMP.
export const XMP_PROFILE = "xmp";
/// Il profilo delle foto RAW.
export const RAW_PROFILE = "raw";
/// Il profilo della famiglia `viewer` che porta un RAW a questa scheda: il
/// registro ha un solo legame per i byte, ed è del `viewer`.
export const MEDIA_RAW_PROFILE = "media-raw";
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
  /// Apre le impostazioni sul gruppo della riga `key`: «App esterne» per il
  /// consenso e il peso massimo. Senza, la scheda non offre il link.
  readonly onOpenSettings?: (key: string) => void;
}

/// La famiglia e il profilo con cui la scheda si presenta al registro: quelli
/// di `craft`, o quelli del `viewer` per un RAW.
export interface CraftSurfaceIdentity {
  readonly family: string;
  readonly profile: string;
}

/// Monta la scheda di un file Craft, di un XMP o di un RAW dentro
/// `context.parent`.
///
/// La superficie torna subito; il suo contenuto arriva con il modulo. Chiusa
/// prima che il modulo arrivi, non monta niente.
export function mountCraftSurface(
  profile: string,
  context: SurfaceMountContext,
  deps: CraftSurfaceDeps,
  identity: CraftSurfaceIdentity = { family: CRAFT_FAMILY, profile },
): EditorSurface {
  if (profile !== CRAFT_PROFILE && profile !== XMP_PROFILE && profile !== RAW_PROFILE) {
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
    family: identity.family,
    profile: identity.profile,
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

/// La specie di ogni soggetto che il catalogo sa dire; un soggetto senza
/// frase (un PDF, un documento: le frasi arrivano coi task che li mostrano)
/// si dice col nome dell'app.
const KIND_KEYS: Readonly<Partial<Record<CraftPreviewInfo["app"], Key>>> = {
  vectorcraft: "craft.kind.vectorcraft",
  photocraft: "craft.kind.photocraft",
  figcraft: "craft.kind.figcraft",
  xmp: "craft.kind.xmp",
  raw: "craft.kind.raw",
};

/// Il nome del file, senza le cartelle.
export function fileName(doc: string): string {
  return doc.slice(doc.lastIndexOf("/") + 1) || doc;
}

/// La riga dei dati: «Disegno di VectorCraft · formato 4 · 178.1 KiB». Il
/// nome dell'app si mostra come il bundle lo scrive, anche se il catalogo non
/// lo conosce. Una foto RAW dice la sigla della sua estensione invece
/// dell'app: «Foto RAW · CR3 · 24.2 MiB».
export function craftInfoText(info: CraftPreviewInfo, doc?: string): string {
  const key = KIND_KEYS[info.app];
  const parts = [key ? t(key, { app: info.editor }) : info.editor];
  const tag = info.app === "raw" && doc ? formatTagOf(doc) : null;
  if (tag) parts.push(tag);
  if (info.format_version !== null) parts.push(t("craft.info.version", { version: info.format_version }));
  parts.push(formatBytes(info.bytes));
  return parts.join(" · ");
}
