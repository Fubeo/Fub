// Le pagine web incorporate in una nota (E7, D6 A). Sul disco resta
// `![](https://…)`, la stessa forma che Obsidian incorpora a sua volta per i
// video. Un indirizzo di un sito dell'elenco chiuso (`WEB_EMBED_SITES`) si vede
// come un segnaposto col nome del sito e «Carica»; il clic apre la pagina nel
// visore web isolato (`ui/web-viewer.ts`), col consenso di oggi
// (`viewer.hosts`). Mai un iframe nella shell, e nessuna richiesta parte
// finché la persona non preme «Carica»: il segnaposto non ha icone del sito né
// anteprime. Un indirizzo fuori dall'elenco resta ciò che era: l'immagine
// remota che non si carica da sola, un link, una scheda.
import { icon } from "../../../../ui/icons";
import type { Lifetime } from "../../../../ui/lifetime";
import { openWebEmbed, viewerSite, type EmbedOpening } from "../../../../ui/web-viewer";
import { keepButtonKeys } from "./button-keys";
import { liveStrings } from "./strings";

/// Che cosa mostra un sito dell'elenco: dà la parola e l'icona del segnaposto.
export type WebEmbedKind = "video" | "map" | "drawing";

/// Un sito che si può incorporare.
export interface WebEmbedSite {
  /// Stabile: finisce in `data-web-embed-site`, lo leggono temi e test.
  readonly id: string;
  /// Il nome che il segnaposto mostra; è un marchio, non si traduce.
  readonly name: string;
  readonly kind: WebEmbedKind;
  /// Gli host esatti, in minuscolo: niente sottodomini impliciti.
  readonly hosts: readonly string[];
  /// Il percorso che fa di una pagina del sito un contenuto da incorporare
  /// (un video, una mappa, un disegno), non la home o una pagina qualunque.
  readonly path: RegExp;
  /// I parametri di tracciamento propri del sito, oltre a quelli di tutti.
  readonly tracking?: readonly string[];
}

/// L'elenco chiuso dei siti che una nota incorpora (D6 A): video, mappe,
/// disegni. È l'unico posto che lo dice; `docs/product/editor-writing.md` lo
/// riporta. Un sito entra soltanto se la sua pagina regge da sola nel visore e
/// se il suo indirizzo dice già che cosa mostra.
export const WEB_EMBED_SITES: readonly WebEmbedSite[] = [
  {
    id: "youtube",
    name: "YouTube",
    kind: "video",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"],
    path: /^\/(?:watch$|embed\/[\w-]+|shorts\/[\w-]+|live\/[\w-]+|playlist$)/,
    tracking: ["si", "feature", "pp"],
  },
  {
    id: "youtu-be",
    name: "YouTube",
    kind: "video",
    hosts: ["youtu.be"],
    path: /^\/[\w-]+$/,
    tracking: ["si", "feature"],
  },
  {
    id: "vimeo",
    name: "Vimeo",
    kind: "video",
    hosts: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
    path: /^\/(?:video\/)?\d+(?:\/[\w-]+)?$/,
    tracking: ["share"],
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    kind: "map",
    hosts: ["openstreetmap.org", "www.openstreetmap.org"],
    path: /^\/(?:$|(?:node|way|relation|directions)(?:\/|$))/,
  },
  {
    id: "google-maps",
    name: "Google Maps",
    kind: "map",
    hosts: ["www.google.com", "google.com", "maps.google.com"],
    path: /^\/maps(?:\/|$)/,
  },
  {
    id: "figma",
    name: "Figma",
    kind: "drawing",
    hosts: ["figma.com", "www.figma.com"],
    path: /^\/(?:file|design|board|proto)\/[\w-]+/,
  },
  {
    id: "excalidraw",
    name: "Excalidraw",
    kind: "drawing",
    hosts: ["excalidraw.com"],
    path: /^\/$/,
  },
  {
    id: "tldraw",
    name: "tldraw",
    kind: "drawing",
    hosts: ["www.tldraw.com", "tldraw.com"],
    path: /^\/(?:r|f|p|s|ro|v)\/[\w-]+/,
  },
];

/// I parametri che seguono chi apre la pagina, su ogni sito: non entrano
/// nell'indirizzo che il segnaposto apre né in quello che «Incorpora» scrive.
const TRACKING = new Set(["fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "mc_cid", "mc_eid", "igshid", "yclid", "_ga", "_gl"]);
const TRACKING_PREFIX = /^utm_/i;

/// Oltre questa lunghezza un indirizzo non è un embed: lo stesso tetto della
/// scheda dei collegamenti.
const MAX_URL = 2048;

/// Un indirizzo riconosciuto: il sito, l'host e l'indirizzo da aprire, sempre
/// `https`, senza parametri di tracciamento.
export interface WebEmbed {
  readonly site: WebEmbedSite;
  readonly host: string;
  readonly url: string;
}

/// La pagina che un indirizzo incorpora, o `null` se il sito non è
/// nell'elenco. Un `http:` di un sito dell'elenco si apre in `https`, l'unico
/// che il visore apre; credenziali e porte diverse dalla solita lo escludono.
export function webEmbedOf(address: string): WebEmbed | null {
  const raw = address.trim();
  if (raw.length > MAX_URL || !/^https?:\/\//i.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const standard = parsed.protocol === "https:" ? "443" : "80";
  if (parsed.port !== "" && parsed.port !== standard) return null;
  const host = parsed.hostname.toLowerCase();
  const site = WEB_EMBED_SITES.find((each) => each.hosts.includes(host) && each.path.test(parsed.pathname));
  if (!site) return null;
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING.has(name.toLowerCase()) || TRACKING_PREFIX.test(name) || site.tracking?.includes(name)) {
      parsed.searchParams.delete(name);
    }
  }
  const url = `https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  // La regola del visore decide che cosa si apre: un indirizzo che lei non
  // apre non diventa un segnaposto che promette di farlo.
  if (viewerSite(url) !== host) return null;
  return { site, host, url };
}

/// Che cosa si aspetta il segnaposto da chi apre la pagina.
export type WebEmbedOpener = (url: string) => Promise<EmbedOpening>;

const KIND_ICON: Record<WebEmbedKind, string> = {
  video: "monitor",
  map: "publish",
  drawing: "format-drawing",
};

/// Il segnaposto di una pagina incorporata. Riposo: icona della specie, nome
/// del sito, specie e host, «Carica». Il clic chiede al visore; un sito
/// rifiutato dalla persona lo dice e offre di chiedere di nuovo, un visore che
/// non c'è lo dice. Non carica niente da sé.
export function webEmbedPlaceholder(embed: WebEmbed, life: Lifetime, open: WebEmbedOpener = openWebEmbed): HTMLElement {
  const t = liveStrings.t;
  const kind = t(`webembed.kind.${embed.site.kind}`);
  const box = document.createElement("span");
  box.className = "web-embed";
  box.dataset.webEmbedSite = embed.site.id;
  box.dataset.webEmbedUrl = embed.url;
  box.dataset.state = "rest";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", t("webembed.label", { kind, site: embed.site.name }));

  const mark = document.createElement("span");
  mark.className = "web-embed-icon";
  mark.innerHTML = icon(KIND_ICON[embed.site.kind]);

  const text = document.createElement("span");
  text.className = "web-embed-text";
  const name = document.createElement("span");
  name.className = "web-embed-name";
  name.textContent = embed.site.name;
  const detail = document.createElement("span");
  detail.className = "web-embed-detail";
  detail.title = embed.url;
  text.append(name, detail);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "web-embed-load";

  const show = (state: "rest" | "pending" | "refused" | "unavailable") => {
    box.dataset.state = state;
    detail.textContent = state === "refused"
      ? t("webembed.refused", { host: embed.host })
      : state === "unavailable"
        ? t("webembed.unavailable")
        : t("webembed.detail", { kind, host: embed.host });
    const again = state === "refused";
    button.textContent = t(again ? "webembed.retry" : "webembed.load");
    button.setAttribute("aria-label", t(again ? "webembed.retry.named" : "webembed.load.named", { site: embed.site.name }));
    button.title = t("webembed.load.title", { site: embed.site.name });
    button.disabled = state === "pending";
    if (state === "pending") button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  };
  show("rest");

  life.listen(button, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    show("pending");
    void open(embed.url).then(
      (outcome) => {
        if (life.closed) return;
        show(outcome === "opened" ? "rest" : outcome);
      },
      () => {
        if (!life.closed) show("unavailable");
      },
    );
  });
  // Il gesto è del pulsante: il puntatore non porta il cursore dentro la
  // sorgente dell'immagine, e non apre la lightbox. Anche i tasti
  // (`button-keys.ts`).
  life.listen(button, "mousedown", (event) => event.stopPropagation());
  keepButtonKeys(button, life);

  box.append(mark, text, button);
  return box;
}
