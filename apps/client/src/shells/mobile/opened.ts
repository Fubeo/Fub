import { api } from "../../host/ipc";
import { notify } from "../../ui/notify";
import type { Lifetime } from "../../ui/lifetime";
import { createNote } from "../../state/vault";
import { openMobileDoc, openMobileSearch, openMobileSwitcher } from "./touch";
import { searchFor } from "../../panels/search";
import { submitCaptureViaBridge, type CaptureDraft } from "./capture";
import { registerPersistedGrant, type GrantStore } from "./storage";
import type { MobileBridge, MobileOpenedUrl, MobileTreeGrant } from "./bridge";
import { t } from "../../i18n/strings";
import { errorText } from "../../host/errors";

export interface MobileExternalPorts {
  grantStore?: GrantStore;
  /** Must launch a native folder picker and verify a persistent OS grant. */
  requestTreeGrant?: () => Promise<MobileTreeGrant | null>;
}

/** No external action runs on delivery. Every item needs a fresh user tap. */
export function mountMobileOpenedActions(
  lifetime: Lifetime,
  bridge: MobileBridge,
  ports: MobileExternalPorts = {},
): void {
  const sheet = document.createElement("section");
  sheet.className = "mobile-incoming";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("mobile.opened.sheet"));
  sheet.hidden = true;
  const label = document.createElement("p");
  const title = document.createElement("input");
  title.setAttribute("aria-label", t("mobile.opened.title"));
  const body = document.createElement("textarea");
  body.setAttribute("aria-label", t("mobile.opened.body"));
  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = t("mobile.opened.approve");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("mobile.opened.dismiss");
  sheet.append(label, title, body, approve, dismiss);
  document.body.append(sheet);
  lifetime.add(() => sheet.remove());

  const queue: MobileOpenedUrl[] = [];
  let busy = false;
  function showNext(): void {
    if (lifetime.closed || busy) return;
    const next = queue[0];
    sheet.hidden = !next;
    if (!next) return;
    const url = new URL(next.raw);
    const action = next.kind === "fub" ? url.hostname : next.kind;
    label.textContent = url.searchParams.get("vault")
      ? t("mobile.opened.action_vault", { action, vault: url.searchParams.get("vault")! })
      : t("mobile.opened.action", { action });
    const capture = action === "capture" || action === "http_share";
    title.hidden = body.hidden = !capture;
    if (capture) {
      title.value = next.kind === "http_share" ? url.hostname : (url.searchParams.get("title") ?? "");
      body.value = next.kind === "http_share" ? next.raw : (url.searchParams.get("markdown") ?? "");
    }
    sheet.scrollIntoView({ block: "nearest" });
    approve.focus();
  }
  lifetime.listen(dismiss, "click", () => {
    queue.shift();
    showNext();
  });
  lifetime.listen(approve, "click", () => {
    const incoming = queue[0];
    if (!incoming || busy) return;
    busy = true;
    approve.disabled = true;
    void (async () => {
      // The Rust classifier owns the URI grammar; never trust the event bus.
      const validated = await bridge.classifyOpenedUrl(incoming.raw);
      if (validated.kind !== incoming.kind) throw new Error("URI esterno cambiato");
      const url = new URL(validated.raw);
      const action = validated.kind === "fub" ? url.hostname : validated.kind;
      if (validated.kind === "fub" && action !== "capture" && url.searchParams.has("vault")) {
        throw new Error("Selezione di un altro vault non disponibile: aprilo esplicitamente");
      }
      switch (action) {
        case "open": {
          const doc = url.searchParams.get("note");
          if (["heading", "block", "split", "window"].some((key) => url.searchParams.has(key))) {
            throw new Error("Ancora, split e finestra esterni non disponibili");
          }
          if (!doc) throw new Error("Nota non indicata");
          await openMobileDoc(doc);
          break;
        }
        case "new": {
          if (["folder", "title", "template"].some((key) => url.searchParams.has(key))) {
            throw new Error("Cartella, titolo e template esterni non disponibili in questa azione");
          }
          const doc = await createNote(url.searchParams.get("name") ?? undefined);
          if (doc) await openMobileDoc(doc);
          break;
        }
        case "daily": {
          if (url.searchParams.has("date")) {
            throw new Error("Data giornaliera esterna non disponibile in questa azione");
          }
          const outcome = await api.invokeCommand("note.daily", {});
          if (outcome.effect.kind === "navigate") await openMobileDoc(outcome.effect.doc);
          break;
        }
        case "search":
          if (url.searchParams.has("tag") || url.searchParams.has("folder")) {
            throw new Error("Filtri di ricerca esterni non disponibili");
          }
          openMobileSearch();
          searchFor(url.searchParams.get("q") ?? "");
          break;
        case "mobile_search":
          openMobileSearch();
          break;
        case "mobile_switcher":
          openMobileSwitcher();
          break;
        case "capture":
        case "http_share": {
          if (url.searchParams.has("success_callback") || url.searchParams.has("error_callback")) {
            throw new Error("Callback esterne negate per impostazione predefinita");
          }
          const draft: CaptureDraft = {
            title: title.value,
            markdown: body.value,
            mode: (url.searchParams.get("mode") as CaptureDraft["mode"] | null) ?? "create",
            folder: url.searchParams.get("folder") ?? undefined,
            note: url.searchParams.get("note") ?? undefined,
            sourceUrl: validated.kind === "http_share"
              ? validated.raw
              : url.searchParams.get("source_url") ?? undefined,
          };
          const doc = await submitCaptureViaBridge(bridge, draft, url.searchParams.get("vault") ?? undefined);
          await openMobileDoc(doc);
          break;
        }
        case "tree_grant": {
          if (!ports.requestTreeGrant || !ports.grantStore) {
            throw new Error("Selettore cartella nativo non disponibile");
          }
          // Never turn a URL parameter into a grant. Only the native picker
          // can prove an OS permission that survives a process restart.
          const grant = await ports.requestTreeGrant();
          if (!grant) return;
          await registerPersistedGrant(bridge, ports.grantStore, grant);
          notify(t("mobile.opened.folder_registered"), "info");
          break;
        }
        default:
          throw new Error(`Azione non supportata: ${action}`);
      }
      queue.shift();
    })().catch((error: unknown) => notify(errorText(error), "guasto"))
      .finally(() => {
        busy = false;
        approve.disabled = false;
        showNext();
      });
  });
  void bridge.onOpenedUrl((event) => {
    if (lifetime.closed) return;
    void bridge.classifyOpenedUrl(event.raw).then((checked) => {
      if (lifetime.closed || checked.kind !== event.kind || checked.raw !== event.raw) return;
      queue.push(checked);
      if (queue.length === 1) showNext();
    }).catch((error: unknown) => notify(errorText(error), "guasto"));
  }).then((off) => lifetime.add(off)).catch((error: unknown) => notify(errorText(error), "guasto"));
}
