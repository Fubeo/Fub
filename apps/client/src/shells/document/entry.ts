import "../../theme/structure.css";
import fonts from "../../theme/serie/fonts.css?raw";
import sheetDark from "../../theme/serie/sheet-dark.css?raw";
import sheetLight from "../../theme/serie/sheet-light.css?raw";
import skin from "../../theme/serie/skin.css?raw";
import { TextEngine } from "../../editors/text/engine";
import { textProfileExtensions } from "../../editors/text/profiles/by-id";
import { t } from "../../i18n/strings";
import { pageName } from "../../rules/mirrored";
import { attachChildBridge, type ChildBridge, type DocumentWindowRequest } from "../../state/document-bridge";
import { mount, mountMirroredTheme, type MirroredTheme } from "../../theme/loader";
import { openLifetime } from "../../ui/lifetime";
import { errorText } from "../../host/errors";

function params(): DocumentWindowRequest | null {
  const query = new URLSearchParams(window.location.search);
  const surface = query.get("surface");
  const channel = query.get("channel");
  const document = query.get("document");
  const vault = query.get("vault");
  const session = query.get("session");
  const surfaceId = query.get("surfaceId");
  const profile = query.get("profile");
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (surface !== "document" || !channel || !document || !vault || !session || !surfaceId || !profile
    || !new RegExp(`^docwin-${uuid}$`).test(channel)
    || !new RegExp(`^${uuid}$`).test(session)
    || !new RegExp(`^remote:${uuid}$`).test(surfaceId)
    || !/^[a-z0-9-]{1,64}$/.test(profile)) return null;
  return { surface, channel, document, vault, session, surfaceId, profile };
}

/// Questa finestra non ha IPC: il tema è quello della finestra principale, che
/// lo manda dal bridge come strati già montati. Finché non arriva vale la
/// serie con la luce del sistema, per non mostrare una pagina nuda a chi trova
/// la sessione già chiusa.
function mountSeriesFallback(): "light" | "dark" {
  const light = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = light;
  mount(fonts, "caratteri");
  mount(light === "dark" ? sheetDark : sheetLight, "foglio");
  mount(skin, "pelle");
  return light;
}

function boot(): void {
  const request = params();
  const root = document.getElementById("document-window");
  const state = document.getElementById("document-window-state");
  const choices = document.getElementById("document-window-conflict");
  const keep = document.getElementById("document-window-keep");
  const discard = document.getElementById("document-window-discard");
  if (!request || !root || !state || !choices || !keep || !discard) {
    if (root) root.textContent = t("windows.invalid_request");
    return;
  }
  const light = mountSeriesFallback();
  keep.textContent = t("windows.keep_local");
  discard.textContent = t("windows.discard_local");
  document.title = pageName(request.document);
  const host = document.createElement("section");
  host.className = "document-window-editor pane-editor";
  host.setAttribute("aria-label", request.document);
  root.appendChild(host);
  let bridge: ChildBridge;
  // Il profilo lo ha risolto il registro della finestra principale: qui si
  // monta com'è. Un id che il testo non possiede è una richiesta non valida,
  // come una senza canale.
  const extensions = textProfileExtensions(request.profile, {
    documentId: request.document,
    openWikilink: (page, heading, block) => bridge.navigate({ kind: "wikilink", page, heading, block }),
    openPath: (path) => bridge.navigate({ kind: "path", path }),
    searchTag: (tag) => bridge.navigate({ kind: "tag", tag }),
  });
  if (!extensions) {
    host.remove();
    root.textContent = t("windows.invalid_request");
    return;
  }
  const editor = new TextEngine(host, {
    onChange: (change) => {
      try {
        bridge.sendEdit(change.text, change.operation);
      } catch (error) {
        editor.setReadOnly(true);
        state.textContent = t("windows.local_error", { reason: errorText(error) });
        choices.hidden = false;
      }
    },
    onSelectionChange: () => {},
    extensions,
    theme: light,
  });
  editor.setReadOnly(true);
  let bootstrapped = false;
  bridge = attachChildBridge(
    request,
    (text, operation) => {
      if (!bootstrapped) {
        bootstrapped = true;
        editor.setDoc(text);
      } else {
        editor.syncDoc({ text, operation });
      }
    },
    () => editor.getDoc(),
    (status) => {
      editor.setReadOnly(status.kind !== "ready");
      choices.hidden = status.kind !== "error" || !bootstrapped;
      state.textContent = status.kind === "error"
        ? t("windows.local_error", { reason: status.reason ?? "" })
        : status.kind === "frozen" ? t("windows.saving") : "";
    },
    (theme: MirroredTheme) => {
      mountMirroredTheme(theme);
      editor.setTheme(theme.light === "light" ? "light" : "dark");
    },
  );
  const controls = new AbortController();
  keep.addEventListener("click", () => bridge.resolveConflict("mine"), { signal: controls.signal });
  discard.addEventListener("click", () => bridge.resolveConflict("theirs"), { signal: controls.signal });
  // La finestra documento vive quanto la pagina: il suo proprietario è questo
  // `Lifetime`, chiuso dallo stesso `pagehide` che smonta tutto il resto.
  const page = openLifetime();
  page.listen(window, "pagehide", () => {
    controls.abort();
    if (bridge.dispose()) {
      editor.destroy();
    }
    page.close();
  }, { once: true });
}

boot();
