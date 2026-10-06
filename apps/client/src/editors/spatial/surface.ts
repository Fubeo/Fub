// La superficie del disegno: il profilo `vector` della famiglia `canvas`
// (ADR 0203). Monta l'editor degli strumenti su un file .svg di FubDraw e lo
// tiene allineato alla `DocumentSession` come ogni superficie col buffer: un
// gesto esce come `{ text, operation, origin }`, e un testo che arriva da
// fuori ricostruisce la scena senza perdere annulla e ripeti.
//
// Due modalità, Disegno (`draw`, col ruolo `live_preview`) e Lettura (`read`,
// `reading`). In Lettura il documento intero è un `<img>` da un blob, e niente
// del file entra nel DOM vivo.
//
// La Lettura dice anche a parole che cosa c'è: la descrizione del disegno
// accanto all'immagine, e l'elenco degli oggetti in albero, chiuso finché non
// lo si apre e costruito soltanto allora (`describe.ts`). I collegamenti, che
// nell'immagine non si toccano, sono una riga di pulsanti che aprono le note.
//
// I collegamenti del disegno sono `a` con un `href` relativo al disegno: la
// shell sceglie la nota e la apre (`onPickLink`, `onOpenPath`), e la
// superficie scrive il riferimento come lo scrive il kernel quando lo
// riscrive dopo un rename.
//
// Le immagini del vault sono `image` con un `href` scritto allo stesso modo:
// la shell le risolve, le apre e ne sceglie una da inserire (`images`). Sul
// foglio il painter le mostra con l'URL che la shell apre; in Lettura, dove
// l'`<img>` non carica niente da fuori, entrano nell'immagine coi loro byte
// (`read-images.ts`).
//
// Il livello dell'editor è l'impostazione del vault `draw.level`, con le parti
// del Personalizzato in `draw.custom`, e la griglia l'ultima scelta su questa
// macchina (`preferences.ts`): la superficie li legge quando nasce, segue il
// livello finché vive, e ricorda la griglia che chi disegna sceglie.
//
// In Disegno il documento può non essere modificabile, e la modalità del
// riquadro non cambia per questo (`docs/product/drawing.md`):
// - un SVG estraneo è l'immagine inerte del documento intero, con «Modifica»,
//   che applica `adopt` nell'editor: l'editor c'è già, nascosto, così
//   l'adozione è un passo di annulla, e annullarla riporta all'immagine;
// - un documento in sola lettura (un DOCTYPE, una versione futura, un file
//   troppo grande) è l'immagine inerte del documento intero, col motivo;
// - un file che non si legge come scena è il motivo e basta: il testo lo
//   mostra «Apri come sorgente».

import { errorText } from "../../host/errors";
import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import { relativeRef, resolveAgainst } from "../../rules/mirrored";
import { identifier } from "../../ui/a11y";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import type { EditorRange, EditorSelections, EditorSurface, SelectedText, SurfaceMountContext } from "../core/registry";
import type { EditorChange } from "../core/text-operation";
import { imageInfo, svgSize } from "../media/image-view";
import { mountZoomView, type ZoomView } from "../media/zoom-view";
import { countObjects, describe, keyOf, linkName, outline, sceneTargets, type LinkTargets, type OutlineNode } from "./describe";
import { VECTOR_MODES, VECTOR_PROFILE } from "./modes";
import { currentCustom, currentGrid, currentLevel, readGrid, saveGrid, watchLevel } from "./preferences";
import type { ElementItem } from "./scene/classify";
import { SceneEngine } from "./scene/engine";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, readScene, ReadError, type ReadOnly } from "./scene/read";
import { href as parseHref } from "./scene/values";
import { linkTarget, nodeOf } from "./tools/arrange";
import { createDrawEditor, type DrawEditor, type DrawImages, type DrawLinks, type DrawPlace } from "./tools/editor";
import { imageDataUri, imageRefs, READ_IMAGE_BYTES, withImages, type ImageRef } from "./read-images";
import { appFonts, withStyle, type FontSheets } from "./picture";

type VectorMode = "draw" | "read";

export interface VectorSurfaceOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
  /// Apre il percorso `path` com'è scritto nel disegno, relativo al disegno o
  /// dalla radice del vault: la shell lo risolve. Lancia se non ci riesce.
  onOpenPath?(path: string): Promise<void>;
  /// Chiede il documento del vault a cui porta un collegamento; `current` è
  /// l'`href` di quello che si cambia, `null` per uno nuovo. Torna il suo
  /// `DocId`, o `null` se chi disegna rinuncia.
  onPickLink?(current: string | null): Promise<string | null>;
  /// Le immagini del vault, che la shell risolve dal disegno.
  images?: VectorImages;
  /// I caratteri dell'app per la Lettura, che da un `img` non li caricherebbe;
  /// di partenza quelli dell'app stessa.
  fonts?: FontSheets;
}

/// Le immagini del vault di un disegno: `path` è l'`href` com'è scritto nel
/// disegno, relativo al disegno o dalla radice del vault.
export interface VectorImages {
  /// L'URL dell'immagine `path`, aperto nella vita che riceve; `null` se non
  /// si risolve.
  url(path: string, life: Lifetime): Promise<string | null>;
  /// I byte dell'immagine `path`, col loro tipo; `null` se non si risolve, o
  /// se pesa più di `limit` byte, che allora non si leggono.
  read(path: string, limit?: number): Promise<Blob | null>;
  /// Chiede un'immagine del vault da mettere nel disegno; torna il suo
  /// `DocId`, o `null` se chi disegna rinuncia.
  pick?(): Promise<string | null>;
}

/// L'`href` con cui il disegno `drawing` porta al documento `doc`: relativo
/// alla cartella del disegno, come lo scrive il kernel. Se il primo segmento
/// si leggerebbe come uno schema (`nota:1.md`), con `./` davanti, che non
/// cambia la destinazione.
export function linkHref(drawing: string, doc: string): string {
  const ref = relativeRef(drawing, doc);
  return parseHref(ref).kind === "vault" ? ref : `./${ref}`;
}

/// Come si apre un testo: una scena da modificare (anche estranea), un
/// documento da guardare soltanto, o un file che non è una scena.
type Opened =
  | { readonly kind: "scene"; readonly engine: SceneEngine }
  | { readonly kind: "inert"; readonly engine: SceneEngine }
  | { readonly kind: "unreadable"; readonly error: ReadError };

function open(text: string): Opened {
  try {
    const engine = SceneEngine.open(text);
    return engine.model === null ? { kind: "inert", engine } : { kind: "scene", engine };
  } catch (error) {
    if (error instanceof ReadError) return { kind: "unreadable", error };
    throw error;
  }
}

const READ_ONLY: Readonly<Record<ReadOnly, Key>> = {
  doctype: "vector.read_only.doctype",
  encoding: "vector.read_only.encoding",
  "invalid-version": "vector.read_only.invalid_version",
  "future-version": "vector.read_only.future_version",
  "duplicate-id": "vector.read_only.duplicate_id",
  "too-large": "vector.read_only.too_large",
  "too-many-elements": "vector.read_only.too_many_elements",
};

/// Perché il documento si guarda soltanto, a parole: il primo motivo, che la
/// scena elenca in un ordine fisso.
function readOnlyText(reason: ReadOnly): string {
  const numbers = new Intl.NumberFormat(resolvedLanguage());
  if (reason === "too-large") return t(READ_ONLY[reason], { limit: `${numbers.format(MAX_EDIT_BYTES / (1024 * 1024))} MiB` });
  if (reason === "too-many-elements") return t(READ_ONLY[reason], { limit: numbers.format(MAX_ELEMENTS) });
  return t(READ_ONLY[reason]);
}

function unreadableText(error: ReadError): string {
  const reason = error.kind === "malformed"
    ? t("vector.unreadable.malformed", { offset: new Intl.NumberFormat(resolvedLanguage()).format(error.offset) })
    : t("vector.unreadable.not_svg");
  return t("vector.unreadable", { reason, command: t("commands.doc.source.open") });
}

function fileName(id: string): string {
  return id.split("/").pop() || id;
}

/// Dove portano i collegamenti di `engine`: dal modello, se c'è; da una
/// lettura del testo per un documento in sola lettura.
function targetsOf(engine: SceneEngine): LinkTargets {
  const model = engine.model;
  if (model !== null) return (item) => linkTarget(nodeOf(model, item));
  return sceneTargets(readScene(engine.text));
}

/// I percorsi dei collegamenti di `nodes`, una volta ciascuno, nell'ordine
/// del disegno.
function linkTargetsIn(nodes: readonly OutlineNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.target !== null && !out.includes(node.target)) out.push(node.target);
    linkTargetsIn(node.children, out);
  }
  return out;
}

/// Gli oggetti in elenchi annidati, come l'albero dell'editor.
function objectList(nodes: readonly OutlineNode[]): HTMLUListElement {
  const list = document.createElement("ul");
  for (const node of nodes) {
    const item = document.createElement("li");
    item.textContent = describe(node);
    if (node.children.length > 0) item.append(objectList(node.children));
    list.append(item);
  }
  return list;
}

export function mountVectorSurface(context: SurfaceMountContext, options: VectorSurfaceOptions): EditorSurface {
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = "vector-surface";
  const notice = document.createElement("div");
  notice.className = "vector-notice";
  // Cortese: dice com'è il documento appena aperto, non è un allarme.
  notice.setAttribute("role", "status");
  const noticeText = document.createElement("p");
  noticeText.className = "vector-notice-text";
  const adoptButton = document.createElement("button");
  adoptButton.type = "button";
  adoptButton.className = "primary vector-notice-action";
  notice.append(noticeText, adoptButton);
  const drawHost = document.createElement("div");
  drawHost.className = "vector-draw";
  const readHost = document.createElement("div");
  readHost.className = "vector-read";
  // Sotto l'immagine, il disegno a parole.
  const about = document.createElement("div");
  about.className = "vector-about";
  const aboutDesc = document.createElement("p");
  aboutDesc.className = "vector-about-desc";
  aboutDesc.id = identifier("vector-desc");
  const aboutObjects = document.createElement("details");
  aboutObjects.className = "vector-about-objects";
  const aboutSummary = document.createElement("summary");
  aboutObjects.append(aboutSummary);
  // I collegamenti, che nell'immagine non si toccano: un pulsante per nota.
  const aboutLinks = document.createElement("nav");
  aboutLinks.className = "vector-about-links";
  aboutLinks.hidden = true;
  const aboutLinksTitle = document.createElement("span");
  aboutLinksTitle.className = "vector-about-links-title";
  aboutLinksTitle.id = identifier("vector-links");
  aboutLinks.setAttribute("aria-labelledby", aboutLinksTitle.id);
  const aboutLinksList = document.createElement("ul");
  aboutLinks.append(aboutLinksTitle, aboutLinksList);
  about.append(aboutDesc, aboutLinks, aboutObjects);
  root.append(notice, drawHost, readHost);
  context.parent.append(root);

  let mode: VectorMode = "draw";
  let readOnly = false;
  /// Il testo grezzo del documento, coi terminatori del file.
  let text = "";
  let opened: Opened | null = null;
  let editor: DrawEditor | null = null;
  let editorLife: Lifetime | null = null;
  let view: ZoomView | null = null;
  let shownUrl: string | null = null;
  /// Il testo che l'immagine mostra: non si ridisegna uguale.
  let shownText: string | null = null;
  /// I byte del testo, per le selezioni: si ricavano una volta per testo.
  let encoded: { readonly text: string; readonly bytes: Uint8Array } | null = null;
  /// Il testo di cui l'elenco degli oggetti è disegnato.
  let listedText: string | null = null;
  /// I collegamenti della Lettura, e il testo e la lingua di cui sono
  /// disegnati.
  let linkedText: string | null = null;
  let linkedLanguage: string | null = null;
  /// Il livello, le parti del Personalizzato e la griglia dell'editor: quelli
  /// dell'ultima lettura, finché non arriva quella di questa superficie.
  let level = currentLevel();
  let custom = currentCustom();
  let grid = currentGrid();
  /// Chi disegna ha già scelto la griglia qui: la lettura non la riporta
  /// indietro.
  let gridChosen = false;

  // --- I collegamenti -------------------------------------------------------

  /// Apre il collegamento `href`; se non si apre, lo dice.
  const openLink = (href: string): void => {
    const open = options.onOpenPath;
    if (open === undefined) return;
    void Promise.resolve()
      .then(() => open(href))
      .catch((error: unknown) => notify(t("preview.open_failed", { page: linkName(href), reason: errorText(error) }), "guasto"));
  };

  /// Chi sceglie e apre le note dei collegamenti dell'editor, se la shell lo
  /// sa fare.
  const pick = options.onPickLink;
  const links: DrawLinks | undefined =
    pick === undefined || options.onOpenPath === undefined
      ? undefined
      : {
          choose: async (current) => {
            try {
              const doc = await pick(current);
              return doc === null ? null : linkHref(context.documentId, doc);
            } catch (error) {
              notify(errorText(error), "guasto");
              return null;
            }
          },
          open: openLink,
        };

  /// Le immagini del vault per l'editor: le apre e le legge la shell, e
  /// quella scelta si scrive relativa al disegno, come un collegamento.
  const imagePort = options.images;
  const pickImage = imagePort?.pick;
  const images: DrawImages | undefined = imagePort === undefined
    ? undefined
    : {
        url: (path, owner) => imagePort.url(path, owner),
        read: (path) => imagePort.read(path),
        ...(pickImage === undefined
          ? {}
          : {
              choose: async () => {
                try {
                  const doc = await pickImage();
                  return doc === null ? null : linkHref(context.documentId, doc);
                } catch (error) {
                  notify(errorText(error), "guasto");
                  return null;
                }
              },
            }),
      };

  /// Dove sta il disegno nel vault: gli `href` che gli appunti portano da un
  /// disegno all'altro si leggono e si riscrivono da qui.
  const place: DrawPlace = {
    locate: (href) => resolveAgainst(context.documentId, href),
    refer: (doc) => linkHref(context.documentId, doc),
  };

  life.listen(aboutLinksList, "click", (event) => {
    const control = event.target instanceof Element ? event.target.closest("button") : null;
    if (control instanceof HTMLButtonElement && control.dataset.href !== undefined) openLink(control.dataset.href);
  });

  // --- L'editor -------------------------------------------------------------

  const mountEditor = (engine: SceneEngine): DrawEditor => {
    const owner = openLifetime();
    const mounted = createDrawEditor(drawHost, engine, owner, {
      level,
      custom,
      grid,
      onGridChange: (next) => {
        grid = next;
        gridChosen = true;
        saveGrid(next);
      },
      links,
      ...(images === undefined ? {} : { images }),
      place,
      onChange: (change) => {
        text = change.text;
        opened = { kind: "scene", engine: mounted.engine };
        options.onChange(change);
        paint();
      },
      onSelectionChange: () => options.onSelectionChange(),
    });
    mounted.setReadOnly(readOnly);
    editorLife = owner;
    editor = mounted;
    return mounted;
  };

  const unmountEditor = (): void => {
    const had = editor !== null && editor.selection.length > 0;
    editorLife?.close();
    editorLife = null;
    editor = null;
    if (had) options.onSelectionChange();
  };

  /// Mostra `next`: in un editor che c'è già la scena si ricostruisce, e con
  /// `fresh` il documento è un altro e la cronologia riparte.
  const show = (next: Opened, fresh: boolean): void => {
    opened = next;
    if (next.kind === "scene") {
      if (editor === null) mountEditor(next.engine);
      else if (fresh) editor.load(next.engine);
      else editor.setEngine(next.engine);
    } else {
      unmountEditor();
    }
    paint();
  };

  // --- L'immagine -----------------------------------------------------------

  /// Il nome del disegno: il titolo del documento, figlio della radice, o il
  /// nome del file.
  const shownEngine = (): SceneEngine | null => (opened !== null && opened.kind !== "unreadable" ? opened.engine : null);

  /// Il `title` o la `desc` del disegno, figli della radice; `null` se non
  /// ci sono o sono vuoti.
  const rootText = (role: "title" | "desc"): string | null => {
    for (const item of shownEngine()?.scene() ?? []) {
      if (item.kind === "element" && item.role === role && item.path.length === 1 && item.text?.trim()) return item.text.trim();
    }
    return null;
  };

  const drawingName = (): string => rootText("title") ?? fileName(context.documentId);

  /// La descrizione e il conteggio sotto l'immagine; l'elenco si costruisce
  /// quando lo si apre, e ogni volta che il testo cambia mentre è aperto.
  /// Il disegno in albero, una volta per testo: coi collegamenti, se la
  /// shell li sa aprire.
  let outlined: { readonly text: string; readonly nodes: readonly OutlineNode[] } | null = null;
  const outlineShown = (): readonly OutlineNode[] => {
    const engine = shownEngine();
    if (engine === null) return [];
    if (outlined?.text !== text) outlined = { text, nodes: outline(engine.scene(), options.onOpenPath === undefined ? undefined : targetsOf(engine)) };
    return outlined.nodes;
  };

  const showAbout = (): void => {
    const nodes = outlineShown();
    const desc = rootText("desc");
    aboutDesc.textContent = desc ?? "";
    aboutDesc.hidden = desc === null;
    if (desc === null) view?.stage.removeAttribute("aria-describedby");
    else view?.stage.setAttribute("aria-describedby", aboutDesc.id);
    aboutSummary.textContent = t("vector.read.objects", { count: countObjects(nodes) });
    aboutObjects.hidden = nodes.length === 0;
    showLinks(nodes);
    if (!aboutObjects.open) {
      aboutObjects.querySelector("ul")?.remove();
      listedText = null;
    } else if (listedText !== text) {
      listedText = text;
      aboutObjects.querySelector("ul")?.remove();
      aboutObjects.append(objectList(nodes));
    }
  };
  life.listen(aboutObjects, "toggle", () => showAbout());

  /// La riga dei collegamenti, ridisegnata quando cambia il testo o la
  /// lingua.
  const showLinks = (nodes: readonly OutlineNode[]): void => {
    const language = resolvedLanguage();
    if (linkedText === text && linkedLanguage === language) return;
    linkedText = text;
    linkedLanguage = language;
    const targets = linkTargetsIn(nodes);
    aboutLinks.hidden = targets.length === 0;
    aboutLinksTitle.textContent = t("vector.read.links");
    aboutLinksList.replaceChildren(
      ...targets.map((target) => {
        const item = document.createElement("li");
        const control = document.createElement("button");
        control.type = "button";
        control.className = "vector-about-link";
        control.dataset.href = target;
        control.textContent = linkName(target);
        control.title = t("vector.link.open", { note: linkName(target) });
        item.append(control);
        return item;
      }),
    );
  };

  /// Le immagini del vault che la Lettura ha letto, per percorso: il data URI
  /// e quanti byte pesa. Restano quelle del testo che si mostra; una che non
  /// si è aperta si riprova al testo dopo.
  const readImages = new Map<string, { readonly uri: string; readonly bytes: number }>();
  /// Il giro della lettura delle immagini: uno più recente rende vecchi gli
  /// altri.
  let imagesRound = 0;

  const imageSources = (): Map<string, string> => new Map([...readImages].map(([path, entry]) => [path, entry.uri]));

  const fonts = options.fonts ?? appFonts;

  /// Ciò che l'immagine mostra di `shown`: coi caratteri che nomina, se già
  /// letti, e con le immagini lette. Lo stile va subito dopo l'apertura della
  /// radice, prima di ogni immagine: gli indici di `refs` si spostano di
  /// quanto è lungo.
  const picture = (shown: string, refs: readonly ImageRef[]): string => {
    const styled = withStyle(shown, fonts.now(shown) ?? "");
    const shift = styled.length - shown.length;
    const moved = shift === 0 ? refs : refs.map((ref) => ({ ...ref, start: ref.start + shift, end: ref.end + shift }));
    return withImages(styled, moved, imageSources());
  };

  /// Legge i caratteri che `shown` nomina, e mostra di nuovo l'immagine se è
  /// ancora quella di `shown`.
  const readFonts = async (shown: string, refs: readonly ImageRef[]): Promise<void> => {
    if (fonts.now(shown) !== null) return;
    await fonts.load(shown);
    if (life.closed || shownText !== shown || view === null || fonts.now(shown) === null) return;
    display(picture(shown, refs));
  };

  /// Mostra `source`, il testo di adesso con le immagini al loro posto. La
  /// riga sotto dice il peso del file, non quello delle immagini.
  const display = (source: string): void => {
    const label = t("vector.read.label", { name: drawingName() });
    const file = new Blob([text], { type: "image/svg+xml" });
    const blob = source === text ? file : new Blob([source], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const size = svgSize(text);
    const info = imageInfo({ format: "SVG", blob: file }, size?.width ?? null, size?.height ?? null);
    const previous = shownUrl;
    shownUrl = url;
    if (view === null) {
      // La carta è bianca anche dove il disegno non ne ha una.
      view = mountZoomView(url, { label, size, backdrop: "light", vector: true, info }, life);
      readHost.append(view.element, about);
    } else {
      view.replace(url, size);
      view.info(info);
      view.stage.setAttribute("aria-label", label);
      view.image.alt = label;
    }
    if (previous !== null) URL.revokeObjectURL(previous);
  };

  /// Legge le immagini del vault di `refs` che mancano, e mostra di nuovo
  /// l'immagine se è ancora quella di `shown`. Oltre il tetto della Lettura
  /// un'immagine resta un segnaposto, e la si riprova al testo dopo.
  const readVaultImages = async (shown: string, refs: readonly ImageRef[]): Promise<void> => {
    const port = options.images;
    if (port === undefined) return;
    const paths = [...new Set(refs.flatMap((ref) => (ref.path === null || readImages.has(ref.path) ? [] : [ref.path])))];
    if (paths.length === 0) return;
    const round = ++imagesRound;
    let spent = 0;
    for (const entry of readImages.values()) spent += entry.bytes;
    let added = false;
    // Una alla volta, col tetto che resta: un'immagine che non ci sta non si
    // legge nemmeno.
    for (const path of paths) {
      const room = READ_IMAGE_BYTES - spent;
      const blob = await port.read(path, room).catch(() => null);
      const uri = blob === null || blob.size > room ? null : await imageDataUri(blob);
      if (life.closed || round !== imagesRound) return;
      if (uri === null) continue;
      readImages.set(path, { uri, bytes: blob!.size });
      spent += blob!.size;
      added = true;
    }
    if (!added || life.closed || round !== imagesRound || shownText !== shown || view === null) return;
    display(picture(shown, refs));
  };

  const showImage = (): void => {
    if (shownText === text && view !== null) {
      const label = t("vector.read.label", { name: drawingName() });
      view.stage.setAttribute("aria-label", label);
      view.image.alt = label;
      showAbout();
      return;
    }
    const refs = imageRefs(text);
    // Restano lette soltanto le immagini che il testo ha ancora.
    const kept = new Set(refs.map((ref) => ref.path));
    for (const path of [...readImages.keys()]) if (!kept.has(path)) readImages.delete(path);
    shownText = text;
    display(picture(text, refs));
    showAbout();
    void readFonts(text, refs);
    void readVaultImages(text, refs);
  };

  // --- Lo stato a vista -----------------------------------------------------

  /// Il fuoco nella parte che si vede: il foglio, «Modifica», o l'immagine.
  const focusShown = (): void => {
    if (!drawHost.hidden && editor !== null) editor.focus();
    else if (!notice.hidden && !adoptButton.hidden) adoptButton.focus();
    else if (!readHost.hidden && view !== null) view.stage.focus({ preventScroll: true });
  };

  /// Porta la superficie a modalità, documento e scrittura di adesso.
  const paint = (): void => {
    root.dataset.mode = mode;
    const state = opened;
    const foreign = state?.kind === "scene" && state.engine.status === "foreign";
    let message: string | null = null;
    let canAdopt = false;
    if (state?.kind === "unreadable") {
      message = unreadableText(state.error);
    } else if (mode === "draw" && state?.kind === "inert") {
      message = t("vector.read_only", { reason: readOnlyText(state.engine.readOnly[0]!), command: t("commands.doc.source.open") });
    } else if (mode === "draw" && foreign) {
      message = t("vector.foreign");
      canAdopt = !readOnly;
    }
    // Chi annulla l'adozione dal foglio non resta col fuoco su un nodo
    // nascosto: passa a «Modifica».
    const hadFocus = drawHost.contains(document.activeElement);
    if (noticeText.textContent !== (message ?? "")) noticeText.textContent = message ?? "";
    notice.hidden = message === null;
    adoptButton.textContent = t("vector.foreign.edit");
    adoptButton.hidden = !canAdopt;
    drawHost.hidden = !(mode === "draw" && state?.kind === "scene" && !foreign);
    const image = state !== null && state.kind !== "unreadable" && (mode === "read" || state.kind === "inert" || foreign);
    readHost.hidden = !image;
    if (image) showImage();
    if (hadFocus && drawHost.hidden) focusShown();
  };

  life.listen(adoptButton, "click", () => {
    if (editor?.adopt()) editor.focus();
  });
  life.add(onLanguage(paint));

  // --- Il livello e la griglia ----------------------------------------------

  life.add(watchLevel((next, parts) => {
    level = next;
    custom = parts;
    editor?.setLevel(next, parts);
  }));
  void readGrid().then((next) => {
    if (life.closed || gridChosen) return;
    grid = next;
    editor?.setGrid(next);
  });

  // --- Le selezioni ---------------------------------------------------------

  /// Gli elementi degli oggetti scelti, in ordine di documento.
  const selectedItems = (): ElementItem[] => {
    if (drawHost.hidden || editor === null || editor.selection.length === 0) return [];
    const keys = new Set(editor.selection);
    return editor.engine.scene().filter((item): item is ElementItem => item.kind === "element" && keys.has(keyOf(item)));
  };

  const rangeOf = (item: ElementItem): EditorRange => {
    if (encoded === null || encoded.text !== text) encoded = { text, bytes: new TextEncoder().encode(text) };
    const [start, end] = item.bytes;
    return { start, end, text: new TextDecoder().decode(encoded.bytes.subarray(start, end)) };
  };

  life.add(() => {
    unmountEditor();
    if (shownUrl !== null) URL.revokeObjectURL(shownUrl);
    shownUrl = null;
    root.remove();
  });

  paint();

  return {
    family: "canvas",
    profile: VECTOR_PROFILE,
    surfaceId: context.paneId,
    modes: VECTOR_MODES,
    defaultMode: "draw",
    setMode(next) {
      if (next !== "draw" && next !== "read") throw new RangeError(`surface mode ${next} is not supported`);
      if (next === mode) return;
      mode = next;
      paint();
      options.onSelectionChange();
    },
    buffer: {
      setDoc: (next) => {
        text = next;
        show(open(next), true);
      },
      syncDoc: (update) => {
        const next = typeof update === "string" ? update : update.text;
        if (next === text) return;
        text = next;
        show(open(next), false);
      },
      getDoc: () => text,
    },
    focus: focusShown,
    reveal: ({ span }) => !drawHost.hidden && editor !== null && editor.reveal(span.start),
    selections: (): EditorSelections | undefined => {
      const items = selectedItems();
      if (items.length === 0) return undefined;
      const [first, ...rest] = items.map(rangeOf);
      return { primary: first!, secondary: rest };
    },
    selectedText: (): SelectedText | null => {
      const items = selectedItems();
      if (items.length === 0) return null;
      const [first, ...rest] = items.map((item) => rangeOf(item).text);
      return { primary: first!, secondary: rest };
    },
    setReadOnly: (next) => {
      readOnly = next;
      editor?.setReadOnly(next);
      paint();
    },
    destroy: () => life.close(),
  };
}
