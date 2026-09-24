import "../../theme/structure.css";
import "../../theme/serie/skin.css";
import { TextEngine } from "../../editors/text/engine";
import { t } from "../../i18n/strings";
import { attachChildBridge, type ChildBridge, type DocumentWindowRequest } from "../../state/document-bridge";
import { openLifetime } from "../../ui/lifetime";

function params(): DocumentWindowRequest | null {
  const query = new URLSearchParams(window.location.search);
  const surface = query.get("surface");
  const channel = query.get("channel");
  const document = query.get("document");
  const vault = query.get("vault");
  const session = query.get("session");
  const surfaceId = query.get("surfaceId");
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (surface !== "document" || !channel || !document || !vault || !session || !surfaceId
    || !new RegExp(`^docwin-${uuid}$`).test(channel)
    || !new RegExp(`^${uuid}$`).test(session)
    || !new RegExp(`^remote:${uuid}$`).test(surfaceId)) return null;
  return { surface, channel, document, vault, session, surfaceId };
}

function mountAppearance(): () => void {
  const dark = document.getElementById("document-theme-dark") as HTMLLinkElement | null;
  const light = document.getElementById("document-theme-light") as HTMLLinkElement | null;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    let choice: unknown;
    try {
      choice = JSON.parse(localStorage.getItem("fub.appearance.theme") ?? "null")?.light;
    } catch {
      choice = null;
    }
    const darkMode = choice === "dark" || (choice !== "light" && system.matches);
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    if (dark) dark.media = darkMode ? "all" : "not all";
    if (light) light.media = darkMode ? "not all" : "all";
  };
  apply();
  const storage = (event: StorageEvent): void => {
    if (event.key === "fub.appearance.theme") apply();
  };
  const life = openLifetime();
  life.listen(window, "storage", storage);
  life.listen(system, "change", apply);
  return () => life.close();
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
  const unmountAppearance = mountAppearance();
  keep.textContent = t("windows.keep_local");
  discard.textContent = t("windows.discard_local");
  document.title = request.document;
  const host = document.createElement("section");
  host.className = "document-window-editor pane-editor";
  host.setAttribute("aria-label", request.document);
  root.appendChild(host);
  let bridge: ChildBridge;
  const editor = new TextEngine(host, {
    onChange: (change) => {
      try {
        bridge.sendEdit(change.text, change.operation);
      } catch (error) {
        editor.setReadOnly(true);
        state.textContent = t("windows.local_error", { reason: String(error) });
        choices.hidden = false;
      }
    },
    onSelectionChange: () => {},
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
  );
  const controls = new AbortController();
  keep.addEventListener("click", () => bridge.resolveConflict("mine"), { signal: controls.signal });
  discard.addEventListener("click", () => bridge.resolveConflict("theirs"), { signal: controls.signal });
  // La finestra documento vive quanto la pagina: il suo proprietario è questo
  // `Lifetime`, chiuso dallo stesso `pagehide` che smonta tutto il resto.
  const page = openLifetime();
  page.listen(window, "pagehide", () => {
    controls.abort();
    unmountAppearance();
    if (bridge.dispose()) {
      editor.destroy();
    }
    page.close();
  }, { once: true });
}

boot();
