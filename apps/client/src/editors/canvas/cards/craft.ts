// La scheda dei file Craft della lavagna (N6 T18, C8 di `lavagna.md`): un
// disegno di VectorCraft, un progetto di FigCraft o un'immagine di PhotoCraft
// mostra l'anteprima che N7 dà (`craft.preview`, misura `large`), intera e con
// le sue proporzioni, e in basso «Apri» e «Apri con…».
//
// L'anteprima la chiede la porta (`preview`, cioè `previewOf` di
// `state/craft-previews.ts`), che non avvia mai l'app. L'immagine diventa
// un'immagine ferma larga al più il doppio della scheda, come quella della
// scheda d'immagine, e va nella cache con la parte `craft@<larghezza>`:
// tornando sulla scheda c'è subito, e la scheda ferma la mostra.
//
// Senza immagine la scheda è una scheda di file: il nome, la riga dei dati e
// perché l'anteprima manca (con le frasi della scheda di N7). Il consenso alle
// anteprime fatte dalle app (`craft.cli-previews`) si rispetta: solo acceso la
// scheda offre «Crea l'anteprima con …», e la chiede soltanto il clic, che è
// il gesto; spento o da chiedere, lo dice e non chiede niente. Un file rotto
// lo dice, e «Apri» resta.
//
// Col componente «File delle app Craft» spento (`served()` falso) la scheda
// non chiede anteprime: dice che il componente è spento e offre «Accendi…» e
// «Apri con…». «Accendi…» apre la riga del componente nella pagina Componenti
// (`showComponent`, col fuoco sul suo interruttore): non accende niente, lo
// accende l'utente. Se nessuno apre la riga (`showComponent` dà falso, le
// impostazioni non sono montate), il clic lo ritira e il fuoco va su «Apri
// con…». Quando il componente si accende o si spegne con la scheda viva, la
// scheda si rifà (`onServed`).
//
// «Apri» apre il file nella modalità di Fub (il riquadro di N7); «Apri con…»
// apre il menu delle app di N7 (`panels/open-with.ts`, dalla shell); il doppio
// clic apre come «Apri». La scheda non scrive mai il file. Ogni domanda ha una
// generazione: una risposta che arriva dopo `destroy`, dopo un cambio di modo
// o dopo che il file è cambiato non tocca il DOM.

import type { CraftPreview, CraftPreviewImage } from "../../../host/craft";
import { errorText, isErrorKind } from "../../../host/errors";
import { t, type Key } from "../../../i18n/strings";
import type { CraftPreviewAnswer } from "../../../state/craft-previews";
import type { Lifetime } from "../../../ui/lifetime";
import { formatTagOf } from "../../../ui/format-kind";
import { craftInfoText, fileName } from "../../craft/index";
import { snapshotPart, type CardContext, type CardMode, type CardRenderer, type CardSnapshot, type CardView } from "../cards";

/// La riga del componente spento che il file richiede (`offRowFor` della
/// mappa): l'id per aprirla in «Accendi…», il nome nella lingua del vault
/// (può essere vuoto, e allora la scheda lo dice senza nome).
export interface CraftOffComponent {
  readonly id: string;
  readonly name: string;
}

/// Le porte della scheda Craft. In T12 le dà la shell
/// (`state/document-controller.ts`): le anteprime di N7, il componente, i due
/// modi di aprire.
export interface CraftCardPort {
  /// Il componente «File delle app Craft» serve il vault (il kernel elenca
  /// `craft.preview`): solo allora si chiedono anteprime.
  served(): boolean;
  /// La riga del componente spento che servirebbe; `null` se la mappa non ne
  /// nomina una (un componente che non c'è in questa build).
  offComponent(): CraftOffComponent | null;
  /// Apre la riga `id` nella pagina Componenti (`showComponent` di
  /// `ui/commands.ts`); falso se nessuno la sa aprire.
  showComponent(id: string): boolean;
  /// Avvisa quando ciò che è acceso può essere cambiato; restituisce come
  /// smettere.
  onServed(changed: () => void): () => void;
  /// L'anteprima `large` del file (`previewOf`): `null` se nel frattempo il
  /// vault è cambiato; un rifiuto se il comando non risponde.
  preview(path: string): Promise<CraftPreviewAnswer | null>;
  /// Ascolta i cambi delle anteprime finché `lifetime` è vivo; il documento
  /// `""` vuol dire tutti.
  watchPreviews(lifetime: Lifetime, watcher: (doc: string) => void): void;
  /// Chiede l'anteprima `large` all'app (`renderPreview`): soltanto dopo un
  /// clic, e soltanto col consenso acceso.
  render(path: string): Promise<CraftPreviewAnswer | null>;
  /// Apre il file nella modalità di Fub.
  open(path: string): void;
  /// Apre il menu «Apri con…» di N7 sotto `anchor`.
  openWith(path: string, anchor: HTMLElement): void;
  /// Ascolta i cambi del file; restituisce come smettere.
  watch(path: string, changed: () => void): () => void;
}

/// Il prefisso della parte in cache: l'anteprima intera.
export const CRAFT_SNAPSHOT_PREFIX = "craft";

/// Quante volte la larghezza della scheda può essere larga l'immagine ferma.
const DENSITY = 2;

/// Che cosa mostra la scheda, in `data-card-state`. `unreadable` è il nome
/// che la tela conosce (T93): il doppio clic apre il file.
type CraftCardState = "placeholder" | "loading" | "picture" | "card" | "off" | "unreadable" | "missing";

/// La specie del file e l'app, dall'estensione, finché il bundle non ha
/// risposto (o col componente spento): come `CraftApp::editor_name`.
const KINDS: Readonly<Record<string, { readonly key: Key; readonly app: string }>> = {
  vectorcraft: { key: "craft.kind.vectorcraft", app: "VectorCraft" },
  figcraft: { key: "craft.kind.figcraft", app: "FigCraft" },
  pcraft: { key: "craft.kind.photocraft", app: "PhotoCraft" },
};

export function craftCardRenderer(port: CraftCardPort): CardRenderer {
  return {
    kinds: ["craft"],
    mount: (_node, host, mode, context) => mountCraftCard(port, host, mode, context),
  };
}

/// La specie del file detta dall'estensione: «Disegno di VectorCraft».
function kindText(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const kind = KINDS[extension];
  return kind ? t(kind.key, { app: kind.app }) : t("canvas.kind.craft");
}

/// L'anteprima manca e un'app installata può farla (come `offersRender` della
/// scheda di N7, che sta nel suo modulo pigro).
function offersRender(preview: CraftPreview): boolean {
  return preview.image === null && !preview.queued && preview.render !== null && preview.missing !== "over_limit";
}

/// Il peso massimo come lo dice l'impostazione, come `limitText` della
/// scheda di N7: i MiB interi.
function limitText(bytes: number | null): string {
  return bytes === null ? "—" : `${Math.floor(bytes / 1048576)} MiB`;
}

/// Perché l'immagine non c'è, con le frasi della scheda di N7.
function missingText(answer: CraftPreviewAnswer): string {
  const preview = answer.preview;
  if (preview.queued) return t("craft.queued");
  if (answer.renderError !== null) return t("craft.render_failed", { reason: errorText(answer.renderError) });
  switch (preview.missing) {
    case "over_limit":
      return t("craft.over_limit", { limit: limitText(preview.limit_bytes) });
    case "unreadable":
      return t("craft.unreadable");
    case "failed":
      return t("craft.cli_failed", { app: preview.render?.app ?? preview.info.editor });
    default:
      return t("craft.no_preview");
  }
}

/// I byte dell'immagine in base64, col suo tipo; `null` se non si leggono.
function imageBlob(image: CraftPreviewImage): Blob | null {
  try {
    const binary = atob(image.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: image.media_type });
  } catch {
    return null;
  }
}

function mountCraftCard(port: CraftCardPort, host: HTMLElement, initial: CardMode, context: CardContext): CardView {
  const { path, lifetime } = context;
  const name = fileName(path);
  const root = document.createElement("div");
  root.className = "canvas-card-craft";
  root.dataset.cardKind = "craft";
  host.append(root);

  let mode: CardMode = initial;
  /// Cresce a ogni domanda nuova, cambio di modo, cambio del file e `destroy`.
  let generation = 0;
  /// La parte dipinta ora nel `<canvas>` della scheda, se c'è.
  let painted: string | null = null;
  /// La proporzione dell'anteprima mostrata; `null` se non se ne vede una.
  let aspect: number | null = null;
  /// Il componente serviva l'ultima volta che la scheda si è disegnata.
  let served = port.served();
  /// Ciò che il disegno di adesso accende (gli ascolti dei pulsanti): il
  /// disegno dopo lo spegne.
  let drawn = new AbortController();
  lifetime.add(() => drawn.abort());

  const seeAspect = (next: number | null): void => {
    const value = next !== null && Number.isFinite(next) && next > 0 ? next : null;
    if (value === aspect) return;
    aspect = value;
    if (!lifetime.closed) context.contentShown?.();
  };

  /// Disegna lo stato `state`: prima spegne gli ascolti del disegno di prima,
  /// poi `build` fa i figli, che ascoltano col disegno nuovo.
  const show = (state: CraftCardState, build: () => Node[]): void => {
    drawn.abort();
    drawn = new AbortController();
    const children = build();
    if (state !== "picture") {
      painted = null;
      seeAspect(null);
    }
    root.dataset.cardState = state;
    root.replaceChildren(...children);
  };

  const listen = (target: HTMLElement, run: (event: MouseEvent) => void): void => {
    target.addEventListener("click", run as EventListener, { signal: drawn.signal });
  };

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /// «Accendi…» (solo col componente spento, con la riga `turnOn`), «Apri»
  /// (solo col componente acceso) e «Apri con…».
  const actions = (withOpen: boolean, turnOn: string | null): HTMLElement => {
    const bar = element("div", "canvas-card-craft-actions");
    if (turnOn !== null) {
      const turn = element("button", "canvas-card-craft-turn-on", t("canvas.card.craft_turn_on"));
      turn.type = "button";
      listen(turn, (event) => {
        event.stopPropagation();
        if (port.showComponent(turnOn)) return;
        // Nessuno apre la riga: «Accendi…» non si offre più, e il fuoco va su
        // «Apri con…», che resta.
        off(false);
        root.querySelector<HTMLButtonElement>(".canvas-card-craft-open-with")?.focus({ preventScroll: true });
      });
      bar.append(turn);
    }
    if (withOpen) {
      const open = element("button", "canvas-card-craft-open", t("canvas.card.open"));
      open.type = "button";
      listen(open, (event) => {
        event.stopPropagation();
        port.open(path);
      });
      bar.append(open);
    }
    const openWith = element("button", "canvas-card-craft-open-with", t("canvas.card.open_with"));
    openWith.type = "button";
    openWith.setAttribute("aria-haspopup", "menu");
    listen(openWith, (event) => {
      event.stopPropagation();
      port.openWith(path, openWith);
    });
    bar.append(openWith);
    return bar;
  };

  /// La specie e il percorso, come il segnaposto delle altre schede ferme.
  const placeholder = (state: "placeholder" | "missing" = "placeholder"): void => {
    const label = element("span", "canvas-media-placeholder", `${formatTagOf(path) ?? "CRAFT"} · ${path}`);
    show(state, () => [label]);
  };

  /// La scheda di file: il nome, la riga dei dati, perché l'anteprima non c'è
  /// e, sotto, i pulsanti. `turnOn` è la riga che «Accendi…» apre, se se ne
  /// offre.
  const fileCard = (
    state: "card" | "off" | "unreadable",
    info: string,
    reason: string,
    extra: () => Node[] = () => [],
    turnOn: string | null = null,
  ): void => {
    show(state, () => {
      const text = element("div", "canvas-card-craft-file");
      const status = element("p", "canvas-card-craft-state", reason);
      status.setAttribute("role", "status");
      text.append(element("p", "canvas-card-craft-name", name), element("p", "canvas-card-craft-info", info), status, ...extra());
      return [text, actions(state !== "off", turnOn)];
    });
  };

  /// Col componente spento: la ragione col nome della riga, e «Accendi…» se la
  /// riga ha un id. `offer` è falso dopo un clic che nessuno ha ascoltato.
  const off = (offer = true): void => {
    const component = port.offComponent();
    const reason = component?.name ? t("file_only.note", { name: component.name }) : t("file_only.note_unnamed");
    fileCard("off", kindText(path), reason, undefined, offer && component?.id ? component.id : null);
  };

  /// Ciò che il consenso dice quando un'app saprebbe fare l'anteprima.
  const consent = (preview: CraftPreview): Node[] => {
    if (!offersRender(preview)) return [];
    const offer = preview.render!;
    switch (offer.consent) {
      case "on": {
        const render = element("button", "canvas-file-link canvas-card-craft-render", t("craft.render", { app: offer.app }));
        render.type = "button";
        listen(render, (event) => {
          event.stopPropagation();
          if (render.disabled) return;
          render.disabled = true;
          const mine = generation;
          // La risposta in coda arriva a chi guarda (`watchPreviews`), e la
          // scheda si rifà da lì.
          port.render(path).catch((error: unknown) => {
            if (lifetime.closed || mine !== generation) return;
            render.disabled = false;
            const status = root.querySelector(".canvas-card-craft-state");
            if (status) status.textContent = t("craft.render_failed", { reason: errorText(error) });
          });
        });
        return [render];
      }
      case "off":
        return [element("p", "canvas-card-craft-consent", t("craft.consent.off"))];
      case "ask":
        return [element("p", "canvas-card-craft-consent", t("canvas.card.craft_ask", { app: offer.app }))];
    }
  };

  const unreadable = (reason: string): void => {
    fileCard("unreadable", kindText(path), t("craft.failed", { reason }));
  };

  const part = (): string => snapshotPart(CRAFT_SNAPSHOT_PREFIX, context.size().width * DENSITY);

  const paint = (key: string, snapshot: CardSnapshot): boolean => {
    const canvas = document.createElement("canvas");
    canvas.className = "canvas-card-picture";
    canvas.width = snapshot.bitmap.width;
    canvas.height = snapshot.bitmap.height;
    const drawing = canvas.getContext("2d");
    if (!drawing) return false;
    drawing.drawImage(snapshot.bitmap, 0, 0);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("craft.figure.alt", { name }));
    show("picture", () => [canvas, actions(true, null)]);
    painted = key;
    seeAspect(snapshot.aspect ?? snapshot.bitmap.width / snapshot.bitmap.height);
    return true;
  };

  /// L'immagine in cache per la misura di adesso, se c'è e si dipinge.
  const fromCache = (): boolean => {
    const key = part();
    if (painted === key) return true;
    const cached = context.snapshots.get(path, key);
    return cached !== undefined && paint(key, cached);
  };

  const load = async (): Promise<void> => {
    const mine = ++generation;
    const current = (): boolean => mine === generation && !lifetime.closed;
    served = port.served();
    if (!served) {
      off();
      return;
    }
    if (fromCache()) return;
    if (painted === null) show("loading", () => [element("span", "canvas-card-loading", t("canvas.card.loading"))]);
    const key = part();

    let answer: CraftPreviewAnswer | null;
    try {
      answer = await port.preview(path);
    } catch (error) {
      if (!current()) return;
      if (isErrorKind(error, "not_found")) {
        placeholder("missing");
        context.missing();
        return;
      }
      // Il componente si è spento mentre si chiedeva: lo dice la scheda.
      if (!port.served()) {
        served = false;
        off();
        return;
      }
      unreadable(errorText(error));
      return;
    }
    if (!current()) return;
    if (answer === null) {
      placeholder();
      return;
    }
    const preview = answer.preview;
    const image = preview.image;
    if (image === null) {
      fileCard("card", craftInfoText(preview.info, path), missingText(answer), () => consent(preview));
      return;
    }
    const blob = imageBlob(image);
    let snapshot: CardSnapshot;
    try {
      if (blob === null) throw new Error(`craft preview of ${path} is not base64`);
      snapshot = await rasterize(blob, image, widthOf(key));
    } catch (error) {
      if (current()) unreadable(errorText(error));
      return;
    }
    if (!current()) {
      closeSnapshot(snapshot);
      return;
    }
    // Prima si dipinge, poi si dà alla cache: un'immagine più grande del suo
    // tetto la cache la chiude subito, e la scheda l'ha già copiata.
    if (!paint(key, snapshot)) {
      closeSnapshot(snapshot);
      unreadable(t("canvas.card.unreadable", { name }));
      return;
    }
    context.snapshots.put(path, key, snapshot);
  };

  const enterMode = (next: CardMode): void => {
    mode = next;
    if (next === "live") {
      void load();
      return;
    }
    generation++;
    if (root.dataset.cardState === "missing") return;
    served = port.served();
    if (served && (painted !== null || fromCache())) return;
    placeholder();
  };

  // Il doppio clic apre come «Apri»; la tela non lo prende (non è un campo
  // del percorso da scrivere).
  lifetime.listen(root, "dblclick", (event) => {
    if (root.dataset.cardState === "missing") return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.stopPropagation();
    port.open(path);
  });
  lifetime.add(
    port.watch(path, () => {
      context.snapshots.forget(path);
      painted = null;
      if (mode === "live") {
        void load();
      } else {
        generation++;
        placeholder();
      }
    }),
  );
  // Un'anteprima arrivata da un job, il consenso cambiato, il vault che
  // cambia: si richiede. Un'immagine già dipinta resta finché il file non
  // cambia (lo dice `watch`).
  port.watchPreviews(lifetime, (doc) => {
    if (lifetime.closed || mode !== "live" || painted !== null) return;
    if (doc === "" || doc === path) void load();
  });
  // Il componente acceso o spento con la scheda viva: la scheda si rifà.
  lifetime.add(
    port.onServed(() => {
      if (lifetime.closed || port.served() === served) return;
      served = port.served();
      if (mode === "live") void load();
      else enterMode("snapshot");
    }),
  );
  lifetime.add(() => {
    generation++;
    root.remove();
  });

  enterMode(initial);

  return {
    setMode: (next) => {
      if (lifetime.closed || next === mode) return;
      enterMode(next);
    },
    resize: () => {
      if (lifetime.closed || painted === null) return;
      if (mode === "live") {
        if (painted !== part()) void load();
      } else {
        fromCache();
      }
    },
    contentAspect: () => (lifetime.closed ? null : aspect),
    destroy: () => lifetime.close(),
  };
}

/// La larghezza della parte: `craft@640` → 640.
function widthOf(part: string): number {
  return Number(part.slice(part.lastIndexOf("@") + 1));
}

/// L'immagine ferma dell'anteprima, larga al più `target`, con una sola
/// decodifica. Le misure le dice l'anteprima.
async function rasterize(blob: Blob, image: CraftPreviewImage, target: number): Promise<CardSnapshot> {
  const create = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : undefined;
  const withAspect = (snapshot: CardSnapshot): CardSnapshot => (aspect === undefined ? snapshot : { ...snapshot, aspect });
  if (typeof create === "function") {
    const bitmap = image.width > target ? await create(blob, { resizeWidth: target, resizeQuality: "high" }) : await create(blob);
    return withAspect({ bitmap, bytes: bitmap.width * bitmap.height * 4 });
  }
  // Senza `createImageBitmap`: un `<img>` mai messo nel DOM, poi un canvas.
  const url = URL.createObjectURL(blob);
  try {
    const picture = document.createElement("img");
    picture.decoding = "async";
    picture.src = url;
    await picture.decode();
    const width = picture.naturalWidth || image.width;
    const height = picture.naturalHeight || image.height;
    if (!(width > 0) || !(height > 0)) throw new Error("craft preview decoded without a size");
    const scale = Math.min(1, target / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("craft card canvas has no 2d context");
    drawing.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return withAspect({ bitmap: canvas, bytes: canvas.width * canvas.height * 4 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/// Chiude un'immagine ferma che non entra in cache (risposta tardiva).
function closeSnapshot(snapshot: CardSnapshot): void {
  const bitmap = snapshot.bitmap as { close?: () => void; width: number; height: number };
  if (typeof bitmap.close === "function") {
    bitmap.close();
  } else {
    bitmap.width = 0;
    bitmap.height = 0;
  }
}
