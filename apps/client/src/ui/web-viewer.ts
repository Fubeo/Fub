// Il visore web, visto dalla finestra principale.
//
// La pagina gira in una finestra sua (`fub-viewer`, in `fub-app`): profilo
// isolato, nessun ponte verso l'host, soltanto https e soltanto i siti che
// l'utente ha approvato su questa macchina (`viewer.hosts`). Qui stanno le tre
// cose che a quella finestra mancano:
//
// - **il consenso.** Un sito che non è nella lista si apre soltanto dopo il sì,
//   e il sì lo aggiunge alla lista: le impostazioni lo mostrano e lo tolgono.
//   Una pagina che porta su un altro sito viene fermata dalla finestra, e qui
//   diventa la stessa domanda invece di un clic che non fa niente;
// - **la barra**, con l'indirizzo della pagina e i gesti: indietro, avanti,
//   ricarica, porta davanti, chiudi;
// - **il salvataggio come nota**: `web.clip` dell'host riscarica la pagina, la
//   converte in Markdown col clipper e la scrive con la fonte. Rilegge lui i
//   siti approvati: la shell non gli dice che cosa è stato concesso.
//
// Un indirizzo che non è https va al browser di sistema, come prima.
import { api } from "../host/ipc";
import type { SettingValue, ViewerAction, ViewerEvent } from "../host/contract";
import { errorText } from "../host/errors";
import { settings } from "../host/query";
import { t } from "../i18n/strings";
import { textButton } from "../kit/button";
import { onEvent } from "../state/kernel";
import type { ConfirmOptions } from "../platform/confirm";
import type { Lifetime } from "./lifetime";

export const VIEWER_HOSTS = "viewer.hosts";
export const VIEWER_LINKS = "viewer.links";
export const WEB_CLIP = "web.clip";

/// L'host di un indirizzo che il visore può aprire: https, senza credenziali,
/// sulla porta 443. In minuscolo. La stessa regola di
/// `fub_host::web_clip::viewer_host`, che decide il salvataggio.
export function viewerSite(url: string): string | null {
  const match = /^https:\/\/([^/?#]*)/i.exec(url.trim());
  if (!match) return null;
  const authority = match[1];
  if (!authority || authority.includes("@") || authority.startsWith("[")) return null;
  const [host, port, ...rest] = authority.split(":");
  if (rest.length > 0 || !host || (port !== undefined && port !== "443")) return null;
  if (/[\s\\%]/.test(host)) return null;
  return host.toLowerCase();
}

export interface WebViewerPorts {
  confirm(message: string, opts: ConfirmOptions): Promise<boolean>;
  notify(message: string, level: "info" | "guasto"): void;
  /// Apre la nota appena salvata.
  show(doc: string): Promise<void>;
  /// Il browser di sistema, per ciò che il visore non apre.
  openExternal(url: string): void;
}

export interface WebViewer {
  /// Apre `url` nel visore, dopo il consenso se il sito è nuovo. `false` se non
  /// si è aperto: rifiutato, non https, o la finestra non c'è.
  open(url: string): Promise<boolean>;
  /// Un link web di una nota: nel visore se la preferenza lo vuole o se lo
  /// chiede l'Alt, altrimenti nel browser di sistema.
  openLink(url: string, viaViewer: boolean): void;
}

/// Il visore della finestra, finché è montato.
let declared: WebViewer | null = null;

/// Apre una pagina nel visore della finestra; senza visore montato, nel
/// browser di sistema.
export function openWebPage(url: string): Promise<boolean> {
  if (declared) return declared.open(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve(true);
}

/// Un link web cliccato in una nota. `viaViewer` è l'Alt del clic.
export function openWebLink(url: string, viaViewer: boolean): void {
  if (declared) declared.openLink(url, viaViewer);
  else window.open(url, "_blank", "noopener,noreferrer");
}

const listOf = (value: SettingValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export function mountWebViewer(life: Lifetime, parent: HTMLElement, ports: WebViewerPorts): WebViewer {
  let sites: string[] = [];
  let linksInViewer = false;
  /// Le domande sui siti nuovi non si accavallano, e un sito rifiutato non si
  /// richiede a ogni redirect della stessa pagina.
  let asking: Promise<boolean> | null = null;
  const refused = new Set<string>();
  let current = "";

  const bar = document.createElement("div");
  bar.className = "web-viewer-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("viewer.bar"));
  bar.hidden = true;
  const address = document.createElement("span");
  address.className = "web-viewer-address";
  const control = (action: ViewerAction) => {
    api.viewerControl(action).catch((error: unknown) => {
      if (!life.closed) ports.notify(t("viewer.failed", { reason: errorText(error) }), "guasto");
    });
  };
  const gesture = (label: string, onPress: () => void) => textButton({ label, onPress, lifetime: life });
  bar.append(
    address,
    gesture(t("viewer.back"), () => control("back")),
    gesture(t("viewer.forward"), () => control("forward")),
    gesture(t("viewer.reload"), () => control("reload")),
    gesture(t("viewer.focus"), () => control("focus")),
    textButton({ label: t("viewer.save"), kind: "primary", onPress: () => void save(), lifetime: life }),
    gesture(t("viewer.close"), () => control("close")),
  );
  parent.append(bar);
  life.add(() => bar.remove());

  const showAt = (url: string) => {
    current = url;
    address.textContent = url;
    bar.hidden = false;
  };

  async function reread(): Promise<void> {
    try {
      const entries = await settings();
      if (life.closed) return;
      sites = listOf(entries.find((entry) => entry.spec.key === VIEWER_HOSTS)?.value);
      linksInViewer = entries.find((entry) => entry.spec.key === VIEWER_LINKS)?.value === true;
    } catch {
      // Senza impostazioni il visore chiede per ogni sito: la lista vuota è la
      // risposta prudente, non un guasto da dire.
    }
  }

  /// Il sì per `site`, chiesto una volta sola alla volta e ricordato.
  function consent(site: string, url: string, leaving: boolean): Promise<boolean> {
    if (sites.includes(site)) return Promise.resolve(true);
    if (asking) return asking.then((yes) => (yes && sites.includes(site)));
    asking = (async () => {
      const yes = await ports.confirm(
        t(leaving ? "viewer.consent.leaving" : "viewer.consent.message", { site, url }),
        { title: t("viewer.consent.title"), okLabel: t("viewer.consent.ok") },
      );
      if (!yes || life.closed) {
        refused.add(site);
        return false;
      }
      const next = [...sites, site];
      try {
        await api.setSetting(VIEWER_HOSTS, next);
      } catch (error) {
        // Senza la lista scritta la finestra si apre lo stesso: il sì è stato
        // detto. Il salvataggio come nota, che la rilegge, lo dirà.
        ports.notify(t("viewer.remember_failed", { site, reason: errorText(error) }), "guasto");
      }
      sites = next;
      return true;
    })().finally(() => {
      asking = null;
    });
    return asking;
  }

  async function open(url: string, leaving = false): Promise<boolean> {
    const site = viewerSite(url);
    if (!site) {
      ports.openExternal(url);
      return false;
    }
    await reread();
    if (life.closed || !(await consent(site, url, leaving)) || life.closed) return false;
    try {
      await api.viewerOpen(url, site, { allowRemote: true, allowlist: sites });
    } catch (error) {
      if (!life.closed) ports.notify(t("document.viewer_unavailable", { reason: errorText(error) }), "guasto");
      return false;
    }
    if (!life.closed) showAt(url);
    return true;
  }

  async function save(): Promise<void> {
    if (!current) return;
    try {
      const done = await api.invokeCommand(WEB_CLIP, { url: current }, "apply");
      if (life.closed) return;
      if (done.notify) ports.notify(done.notify, "info");
      if (done.effect.kind === "navigate") await ports.show(done.effect.doc);
    } catch (error) {
      if (!life.closed) ports.notify(t("viewer.save_failed", { reason: errorText(error) }), "guasto");
    }
  }

  function heard(event: ViewerEvent): void {
    if (life.closed) return;
    if (event.kind === "closed") {
      bar.hidden = true;
      current = "";
      return;
    }
    if (event.kind === "navigated") {
      if (event.url !== "about:blank") showAt(event.url);
      return;
    }
    // Fermata dalla finestra: un sito nuovo si chiede, uno rifiutato tace, e
    // un indirizzo che il visore non apre mai va al browser solo se lo si vuole.
    const site = viewerSite(event.url);
    if (!site) {
      ports.notify(t("viewer.blocked", { url: event.url }), "guasto");
      return;
    }
    // Un sito già approvato ma fermato è una finestra aperta con la lista di
    // prima: si riapre con quella di adesso, senza domande.
    if (refused.has(site)) return;
    void open(event.url, true);
  }

  void api.onViewer(heard).then(
    (off) => (life.closed ? off() : life.add(off)),
    () => {
      // Un host senza visore non ha niente da raccontare.
    },
  );
  life.add(onEvent("setting_changed", ({ key }) => {
    if (key === VIEWER_HOSTS || key === VIEWER_LINKS) void reread();
  }));
  void reread();

  const viewer: WebViewer = {
    open: (url) => open(url),
    openLink: (url, viaViewer) => {
      if ((viaViewer || linksInViewer) && viewerSite(url)) void open(url);
      else ports.openExternal(url);
    },
  };
  declared = viewer;
  life.add(() => {
    if (declared === viewer) declared = null;
  });
  return viewer;
}
