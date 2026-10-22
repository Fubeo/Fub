// Un foglio `.fubsheet`, formato che Fub non modifica più (ADR 0218): la
// superficie lo dice e offre il comando che lo converte in una cartella di
// Excel accanto a lui. Il testo della sessione resta quello del file, e niente
// lo cambia: il foglio non si sporca e non si salva.

import { textButton } from "../../kit";
import { onLanguage, t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { EditorSurface, SurfaceMountContext } from "../core/registry";

/// Il comando di `fub-format-xlsx` che converte il foglio.
export const CONVERT_COMMAND = "xlsx.convert";

/// Il profilo della famiglia `grid` che mostra un `.fubsheet`.
export const RETIRED_PROFILE = "retired";

export interface RetiredSheetDeps {
  /// Avvia un comando come la palette, con i parametri già noti.
  readonly runCommand?: (id: string, prefill: Readonly<Record<string, string>>) => void;
}

export function mountRetiredSheet(
  context: SurfaceMountContext,
  modes: EditorSurface["modes"],
  deps: RetiredSheetDeps,
): EditorSurface {
  const element = document.createElement("div");
  element.className = "document-surface grid-retired";
  element.tabIndex = 0;
  element.setAttribute("role", "document");
  context.parent.replaceChildren(element);
  let text = "";
  let content: Lifetime | null = null;

  const draw = () => {
    content?.close();
    const lifetime = openLifetime();
    content = lifetime;
    const message = document.createElement("p");
    message.className = "grid-retired-message";
    message.textContent = t("grid.retired.message");
    element.setAttribute("aria-label", t("grid.retired.label"));
    element.replaceChildren(message);
    const runCommand = deps.runCommand;
    if (runCommand) {
      element.append(textButton({
        label: t("grid.retired.convert"),
        kind: "primary",
        lifetime,
        onPress: () => runCommand(CONVERT_COMMAND, { doc: context.documentId }),
      }));
    }
  };
  draw();
  const stopLanguage = onLanguage(draw);

  return {
    family: "grid",
    profile: RETIRED_PROFILE,
    surfaceId: context.paneId,
    modes,
    setMode(mode) {
      if (!modes.some((candidate) => candidate.id === mode)) {
        throw new RangeError(`surface mode ${mode} is not supported`);
      }
      context.parent.dataset.surfaceMode = mode;
    },
    buffer: {
      setDoc: (source) => { text = source; },
      syncDoc: (update) => { text = typeof update === "string" ? update : update.text; },
      getDoc: () => text,
    },
    focus: () => element.focus(),
    setReadOnly: () => {},
    setTheme: (theme) => { element.dataset.theme = theme; },
    destroy() {
      stopLanguage();
      content?.close();
      content = null;
      element.remove();
    },
  };
}
