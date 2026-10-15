// La finestra documento sui ganci dello Scrittoio.
//
// È la stessa finestra di `shells/document/entry.ts`, con lo stesso ponte e le
// stesse garanzie: non ha IPC, resta in sola lettura finché la finestra
// principale non risponde, le manda ogni battuta, mostra le due scelte quando
// qualcosa resta in sospeso, rispecchia il suo tema e alla chiusura distrugge
// l'editor soltanto se il ponte non ha più niente da consegnare.
//
// Cambia ciò che si vede: il testo sta su un foglio con la sua linguetta e la
// sua testata, e lo stato è detto nella testata col punto e la parola dello
// stato di salvataggio. Le parole sono quelle che questa finestra sa: non
// conosce lo stato del salvataggio — lo possiede la sessione, di là dal ponte —
// ma sa se è collegata, se la finestra principale sta salvando, se qualcosa è
// rimasto in sospeso.
import { TextEngine } from "../../../editors/text/engine";
import { textProfileExtensions } from "../../../editors/text/profiles/by-id";
import { errorText } from "../../../host/errors";
import { t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import {
  attachChildBridge,
  type ChildBridge,
  type DocumentWindowRequest,
} from "../../../state/document-bridge";
import { mount, mountMirroredTheme, type MirroredTheme } from "../../../theme/loader";
import { openLifetime } from "../../../ui/lifetime";

/// Gli strati della serie, per quando il tema della finestra principale non è
/// ancora arrivato.
export interface SeriesFallback {
  readonly fonts: string;
  readonly sheetLight: string;
  readonly sheetDark: string;
  readonly skin: string;
}

/// Ciò che la testata dice della finestra. I nomi di `data-state` sono quelli
/// dello stato di salvataggio, perché la pelle li conosce già: il punto spento
/// a riposo, acceso mentre qualcosa è in corso, rosso quando serve una scelta.
type Link = "waiting" | "linked" | "saving" | "held";

const LINK_STATE: Record<Link, string> = {
  waiting: "in_corso",
  linked: "salvato",
  saving: "in_corso",
  held: "fallito",
};

export function documentWindowRequest(search: string): DocumentWindowRequest | null {
  const query = new URLSearchParams(search);
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
/// lo manda dal ponte come strati già montati. Finché non arriva vale la serie
/// con la luce del sistema, per non mostrare una pagina nuda a chi trova la
/// sessione già chiusa.
function mountSeriesFallback(series: SeriesFallback): "light" | "dark" {
  const light = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = light;
  mount(series.fonts, "caratteri");
  mount(light === "dark" ? series.sheetDark : series.sheetLight, "foglio");
  mount(series.skin, "pelle");
  return light;
}

export function bootDocumentWindow(series: SeriesFallback): void {
  const request = documentWindowRequest(window.location.search);
  const root = document.getElementById("document-window");
  const sheet = document.getElementById("document-window-sheet");
  const state = document.getElementById("document-window-state");
  const choices = document.getElementById("document-window-conflict");
  const keep = document.getElementById("document-window-keep");
  const discard = document.getElementById("document-window-discard");
  // La serie prima di tutto: anche la finestra che non ha un documento da
  // mostrare lo dice vestita, non su una pagina nuda.
  const light = mountSeriesFallback(series);
  /// Il titolo della pagina, per chi ascolta: non si vede.
  const heading = document.getElementById("document-window-heading");
  /// La finestra non ha un documento valido: lo dice, e non monta altro. Il
  /// titolo resta: una pagina che dice una frase sola ha comunque un nome.
  const invalid = (): void => {
    if (!root) return;
    root.classList.add("document-window-invalid");
    root.textContent = t("windows.invalid_request");
    if (heading) root.prepend(heading);
  };
  if (!request || !root || !sheet || !state || !choices || !keep || !discard) {
    invalid();
    return;
  }
  keep.textContent = t("windows.keep_local");
  discard.textContent = t("windows.discard_local");
  const name = pageName(request.document);
  document.title = name;
  if (heading) heading.textContent = name;

  // La linguetta e la testata: il nome sulla linguetta, il percorso nella
  // testata, come sul foglio della finestra principale.
  const tabs = document.getElementById("document-window-tabs");
  const tabName = document.getElementById("document-window-name");
  const path = document.getElementById("document-window-path");
  const link = document.getElementById("document-window-link");
  tabs?.setAttribute("aria-label", t("region.document"));
  if (tabName) tabName.textContent = name;
  if (path) path.textContent = request.document;
  const say = (next: Link, detail: string): void => {
    if (!link) return;
    link.dataset.state = LINK_STATE[next];
    link.textContent = t(
      next === "linked" ? "windows.linked"
        : next === "waiting" ? "windows.waiting"
        : next === "held" ? "windows.held"
        : "windows.saving",
    );
    link.title = detail;
  };
  /// Qualcosa è rimasto in sospeso: il motivo sta sotto la testata, a parole, e
  /// la regione viva lo annuncia. È lo stesso testo della finestra di sempre.
  const hold = (reason: string): void => {
    const text = t("windows.local_error", { reason });
    state.dataset.kind = "error";
    state.textContent = text;
    say("held", text);
  };
  say("waiting", t("windows.waiting.detail"));

  const host = document.createElement("section");
  host.id = "document-window-panel";
  host.className = "document-window-editor pane-editor";
  host.setAttribute("role", "tabpanel");
  host.setAttribute("aria-label", request.document);
  // La finestra staccata scrive il sorgente (`profiles/by-id.ts`): detto qui,
  // il foglio prende la colonna e il margine della modalità Sorgente.
  if (request.profile === "markdown") host.dataset.markdownMode = "source";
  sheet.appendChild(host);
  let bridge: ChildBridge;
  // Il profilo lo ha risolto il registro della finestra principale: qui si
  // monta com'è. Un id che il testo non possiede è una richiesta non valida,
  // come una senza canale.
  const extensions = textProfileExtensions(request.profile, {
    documentId: request.document,
    openWikilink: (page, heading, block) => bridge.navigate({ kind: "wikilink", page, heading, block }),
    openPath: (target) => bridge.navigate({ kind: "path", path: target }),
    searchTag: (tag) => bridge.navigate({ kind: "tag", tag }),
  });
  if (!extensions) {
    invalid();
    return;
  }
  const editor = new TextEngine(host, {
    onChange: (change) => {
      try {
        bridge.sendEdit(change.text, change.operation);
      } catch (error) {
        editor.setReadOnly(true);
        hold(errorText(error));
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
      if (status.kind === "error") {
        hold(status.reason ?? "");
        return;
      }
      state.dataset.kind = status.kind;
      state.textContent = status.kind === "frozen" ? t("windows.saving") : "";
      if (status.kind === "frozen") say("saving", t("windows.saving"));
      else say("linked", t("windows.linked.detail"));
    },
    (theme: MirroredTheme) => {
      mountMirroredTheme(theme);
      editor.setTheme(theme.light === "light" ? "light" : "dark");
    },
  );
  // La finestra documento vive quanto la pagina: il suo proprietario è questo
  // `Lifetime`, chiuso dallo stesso `pagehide` che smonta tutto il resto.
  const page = openLifetime();
  page.listen(keep, "click", () => bridge.resolveConflict("mine"));
  page.listen(discard, "click", () => bridge.resolveConflict("theirs"));
  page.listen(window, "pagehide", () => {
    // Il ponte dice se ha consegnato tutto: se no, l'editor resta, col testo
    // che la finestra principale non ha ancora ricevuto.
    if (bridge.dispose()) editor.destroy();
    page.close();
  }, { once: true });
}
