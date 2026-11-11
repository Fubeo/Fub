// La scheda d'immagine della lavagna (N6 T5, C5 di `lavagna.md`): foto e
// schermate si vedono nella scheda, intere e con le loro proporzioni.
//
// I byte arrivano dalla porta (`read`), con un tetto di 64 MiB; la firma la
// verifica `decodeImage` della vista immagine, che si usa così com'è. Un
// raster non entra mai intero nel DOM: diventa un'immagine ferma larga al più
// il doppio della scheda (`createImageBitmap` con `resizeWidth`, una sola
// decodifica; se il motore non sa ridurre, un `<canvas>` 2D), che va nella
// cache delle immagini ferme con la parte `whole@<larghezza>` e si dipinge in
// un `<canvas>` della scheda. Tornando sulla scheda, l'immagine in cache c'è
// subito, senza rileggere il file.
//
// Un SVG resta un'immagine: un `<img>` con l'URL del blob, mai l'SVG nel DOM
// (niente script, niente disegno vivo). L'URL si revoca appena non serve più,
// e comunque con la `Lifetime` della scheda.
//
// La zona di un'immagine (T78): con le parti `image` (`CardContext.parts`,
// `fub:parts` di T73) la scheda mostra solo quella zona, ruotata, e prende
// `data-card-crop`. La zona si taglia dall'immagine vera, decodificata alla
// risoluzione che serve perché la zona sia larga quanto l'immagine ferma (il
// doppio della scheda): un pezzo dell'originale, non un ingrandimento di
// un'immagine ridotta. L'immagine ferma ha la zona nel nome della parte
// (`zone-0.45,0.1,0.5,0.8-r90@640`, `zoneKey` di `crop.ts`): due tagli dello
// stesso file non si confondono. Un SVG resta vivo e vettoriale anche
// tagliato: l'`<img>` si mostra a pezzi col CSS (`canvas-card-zone`), nitido
// a ogni zoom. Una GIF animata si taglia nel primo fotogramma, come la
// scheda ferma. Il file non si scrive mai.
//
// L'inchiostro sul contenuto (T39): l'immagine sta intera nella scheda, al
// centro, e `contentAspect()` dice la sua proporzione (della zona, se c'è),
// così i tratti seguono l'immagine e non la scheda. Ogni volta che cambia
// (l'immagine arriva, il file cambia, non si vede più) la scheda lo dice con
// `contentShown`.
//
// Ferma, la scheda non tiene niente di aperto: mostra l'immagine in cache se
// c'è, sennò titolo e specie come il segnaposto di oggi. Il doppio clic apre
// il visore (`port.open`). Ogni lettura ha una generazione: una risposta che
// arriva dopo `destroy`, dopo un cambio di modo o dopo che il file è cambiato
// non tocca il DOM, e ciò che aveva aperto si chiude.

import { t } from "../../../i18n/strings";
import type { ResourceDescriptor } from "../../media/media-types";
import { decodeImage, type DecodedImage } from "../../media/image-view";
import { isWholeZone, zoneKey, zoneOf, type ImageZone } from "../crop";
import {
  snapshotPart,
  type CardContext,
  type CardMode,
  type CardRenderer,
  type CardSnapshot,
  type CardView,
} from "../cards";

/// Ciò che la porta legge: i byte del file e il suo descrittore (il tipo MIME
/// decide come si decodifica, non il nome).
export interface ImageCardRead {
  readonly bytes: Uint8Array;
  readonly descriptor: ResourceDescriptor;
}

/// Le porte della scheda d'immagine. In T12: la `ResourceTransport` di
/// `options.media` con `openResourcePort`, e il visore.
export interface ImageCardPort {
  /// I byte del file, o `null` se il file non c'è.
  read(path: string): Promise<ImageCardRead | null>;
  /// Apre il file nel visore.
  open(path: string): void;
  /// Ascolta i cambi del file; restituisce come smettere.
  watch(path: string, changed: () => void): () => void;
}

/// Il tetto del lettore: un file più grande non si legge nella scheda.
export const IMAGE_CARD_MAX_BYTES = 64 * 1024 * 1024;

/// Il prefisso della parte in cache: l'immagine intera.
export const IMAGE_SNAPSHOT_PREFIX = "whole";

/// Quante volte la larghezza della scheda può essere larga l'immagine ferma.
const DENSITY = 2;

/// Che cosa mostra la scheda, in `data-card-state`.
type ImageCardState = "placeholder" | "loading" | "picture" | "vector" | "unreadable" | "too-large" | "missing";

export function imageCardRenderer(port: ImageCardPort): CardRenderer {
  return {
    kinds: ["image"],
    // Il file viene dal contesto (senza `subpath`): il nodo non serve.
    mount: (_node, host, mode, context) => mountImageCard(port, host, mode, context),
  };
}

function mountImageCard(
  port: ImageCardPort,
  host: HTMLElement,
  initial: CardMode,
  context: CardContext,
): CardView {
  const { path, lifetime } = context;
  const name = path.split("/").pop() || path;
  const root = document.createElement("div");
  root.className = "canvas-card-image";
  root.dataset.cardKind = "image";
  /// La zona che la scheda mostra (T78): l'immagine intera se non ha parti.
  const zone = zoneOf(context.parts);
  const cropped = !isWholeZone(zone);
  if (cropped) root.dataset.cardCrop = "";
  /// Il nome per il lettore di schermo: il file, e se è una zona lo dice.
  const label = cropped
    ? t(zone.turn === 0 ? "canvas.crop.picture_zone" : "canvas.crop.picture_turned", { name })
    : name;
  host.append(root);

  let mode: CardMode = initial;
  /// Cresce a ogni lettura nuova, cambio di modo, cambio del file e `destroy`:
  /// una risposta con una generazione vecchia non tocca niente.
  let generation = 0;
  /// La parte dipinta ora nel `<canvas>` della scheda, se c'è.
  let painted: string | null = null;
  /// Gli URL di blob aperti e non ancora revocati.
  const urls = new Set<string>();
  /// L'URL dell'SVG mostrato, se la scheda mostra un SVG.
  let vectorUrl: string | null = null;
  /// La proporzione del contenuto mostrato (T39): dell'immagine ferma dipinta,
  /// o dell'SVG (la zona, se c'è); `null` se non si vede un'immagine.
  let aspect: number | null = null;

  /// Tiene la proporzione del contenuto; se è cambiata, la tela ridisegna
  /// l'inchiostro della scheda.
  const seeAspect = (next: number | null): void => {
    const value = next !== null && Number.isFinite(next) && next > 0 ? next : null;
    if (value === aspect) return;
    aspect = value;
    if (!lifetime.closed) context.contentShown?.();
  };

  const revoke = (url: string): void => {
    if (!urls.delete(url)) return;
    URL.revokeObjectURL(url);
  };

  const show = (state: ImageCardState, ...children: Node[]): void => {
    if (state !== "vector" && vectorUrl !== null) {
      revoke(vectorUrl);
      vectorUrl = null;
    }
    if (state !== "picture") painted = null;
    if (state !== "picture" && state !== "vector") seeAspect(null);
    root.dataset.cardState = state;
    root.replaceChildren(...children);
  };

  /// Titolo e specie, come il segnaposto di oggi della tela.
  const placeholder = (state: "placeholder" | "missing" = "placeholder"): void => {
    const label = document.createElement("span");
    label.className = "canvas-media-placeholder";
    label.textContent = `IMAGE · ${path}`;
    show(state, label);
  };

  const message = (state: "unreadable" | "too-large", text: string): void => {
    const line = document.createElement("p");
    line.className = "canvas-card-message";
    line.textContent = text;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "canvas-card-open";
    open.textContent = t("canvas.card.open");
    lifetime.listen(open, "click", () => port.open(path));
    show(state, line, open);
  };

  const part = (): string => snapshotPart(cropped ? zoneKey(zone) : IMAGE_SNAPSHOT_PREFIX, context.size().width * DENSITY);

  const paint = (key: string, snapshot: CardSnapshot): boolean => {
    const canvas = document.createElement("canvas");
    canvas.className = "canvas-card-picture";
    canvas.width = snapshot.bitmap.width;
    canvas.height = snapshot.bitmap.height;
    const drawing = canvas.getContext("2d");
    if (!drawing) return false;
    drawing.drawImage(snapshot.bitmap, 0, 0);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    show("picture", canvas);
    painted = key;
    // La proporzione che si vede: quella dell'immagine ferma (il canvas sta
    // intero nella scheda, `object-fit: contain`), o quella scritta con lei.
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
    const key = part();
    const vector = isSvgPath(path);
    if (!vector && fromCache()) return;
    if (painted === null && vectorUrl === null) {
      const line = document.createElement("span");
      line.className = "canvas-card-loading";
      line.textContent = t("canvas.card.loading");
      show("loading", line);
    }

    let read: ImageCardRead | null;
    try {
      read = await port.read(path);
    } catch {
      if (current()) message("unreadable", t("canvas.card.unreadable", { name }));
      return;
    }
    if (!current()) return;
    if (read === null) {
      placeholder("missing");
      context.missing();
      return;
    }
    if (Math.max(read.bytes.byteLength, read.descriptor.len) > IMAGE_CARD_MAX_BYTES) {
      message("too-large", t("canvas.card.too_large", { name }));
      return;
    }

    let image: DecodedImage;
    try {
      image = decodeImage(read.descriptor, read.bytes);
    } catch {
      message("unreadable", t("canvas.card.unreadable", { name }));
      return;
    }
    urls.add(image.url);

    if (image.format === "SVG") {
      showVector(image, key, current);
      return;
    }

    let snapshot: CardSnapshot;
    try {
      snapshot = cropped
        ? await rasterizeZone(image, naturalSize(image, read.bytes), widthOf(key), zone)
        : await rasterize(image, naturalWidth(image, read.bytes), widthOf(key));
    } catch {
      if (current()) message("unreadable", t("canvas.card.unreadable", { name }));
      return;
    } finally {
      revoke(image.url);
    }
    if (!current()) {
      closeSnapshot(snapshot);
      return;
    }
    // Prima si dipinge, poi si dà alla cache: un'immagine più grande del suo
    // tetto la cache la chiude subito, e la scheda l'ha già copiata.
    if (!paint(key, snapshot)) {
      closeSnapshot(snapshot);
      message("unreadable", t("canvas.card.unreadable", { name }));
      return;
    }
    context.snapshots.put(path, key, snapshot);
  };

  const showVector = (image: DecodedImage, key: string, current: () => boolean): void => {
    const picture = document.createElement("img");
    picture.className = "canvas-card-picture";
    picture.alt = label;
    picture.draggable = false;
    picture.decoding = "async";
    picture.src = image.url;
    // Tagliato, l'SVG resta vivo: si mostra a pezzi, senza farne un raster.
    const piece = cropped ? zonePiece(picture, zone) : null;
    piece?.measured(image.width ?? 0, image.height ?? 0);
    show("vector", piece?.element ?? picture);
    vectorUrl = image.url;
    seeAspect(shownAspect(image.width ?? 0, image.height ?? 0, zone));
    // L'immagine ferma dell'SVG, per quando la scheda sarà ferma: se il motore
    // non sa dipingerlo, la scheda ferma mostra titolo e specie.
    void picture
      .decode()
      .then(() => {
        if (!current() || vectorUrl !== image.url) return;
        const width = picture.naturalWidth || image.width || 0;
        const height = picture.naturalHeight || image.height || 0;
        piece?.measured(width, height);
        const shown = shownAspect(width, height, zone);
        seeAspect(shown);
        const snapshot = rasterizeVector(picture, image, widthOf(key), zone);
        // L'immagine ferma porta la proporzione dell'SVG: da ferma la scheda
        // dà lo stesso `contentAspect` che da viva.
        if (snapshot !== null) context.snapshots.put(path, key, shown === null ? snapshot : { ...snapshot, aspect: shown });
      })
      .catch(() => {
        // Un SVG che non si dipinge resta l'`<img>` che è.
      });
  };

  const enterMode = (next: CardMode): void => {
    mode = next;
    if (next === "live") {
      void load();
      return;
    }
    generation++;
    if (root.dataset.cardState === "missing") return;
    if (painted !== null || fromCache()) return;
    placeholder();
  };

  lifetime.listen(root, "dblclick", () => {
    if (root.dataset.cardState === "missing") return;
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
  lifetime.add(() => {
    generation++;
    for (const url of [...urls]) revoke(url);
    vectorUrl = null;
    root.remove();
  });

  enterMode(initial);

  return {
    setMode: (next) => {
      if (lifetime.closed || next === mode) return;
      enterMode(next);
    },
    resize: () => {
      if (lifetime.closed) return;
      if (mode === "live") {
        if (root.dataset.cardState === "vector" || painted === part()) return;
        void load();
      } else {
        fromCache();
      }
    },
    contentAspect: () => (lifetime.closed ? null : aspect),
    destroy: () => lifetime.close(),
  };
}

/// La proporzione (larghezza su altezza) di ciò che la scheda mostra di
/// un'immagine larga `width` e alta `height`: l'immagine intera, o la zona
/// `zone` com'è ruotata (T78). `null` senza misure.
export function shownAspect(width: number, height: number, zone: ImageZone): number | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const [, , w, h] = zone.rect;
  const straight = (w * width) / (h * height);
  const ratio = zone.turn % 180 === 0 ? straight : 1 / straight;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/// Il nome dice SVG: anche con l'immagine in cache si rilegge, perché viva la
/// scheda mostra il disegno nitido e non la sua copia ridotta.
function isSvgPath(path: string): boolean {
  return /\.svg$/i.test(path);
}

/// La larghezza della parte: `whole@640` → 640.
function widthOf(part: string): number {
  return Number(part.slice(part.lastIndexOf("@") + 1));
}

/// La larghezza vera del raster, dai byte, quando si sa. Per un JPEG il lato
/// più lungo: l'orientamento EXIF può girarlo, e conta solo per non
/// ingrandire.
function naturalWidth(image: DecodedImage, bytes: Uint8Array): number | null {
  if (image.width !== null) return image.width;
  const size = rasterSize(image.format, bytes);
  if (size === null) return null;
  return image.format === "JPEG" ? Math.max(size[0], size[1]) : size[0];
}

/// L'immagine ferma di un raster, larga al più `target`, con una sola
/// decodifica.
async function rasterize(image: DecodedImage, natural: number | null, target: number): Promise<CardSnapshot> {
  const create = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof create !== "function") return rasterizeByElement(image.url, target);
  if (natural !== null && natural <= target) return bitmapSnapshot(await create(image.blob));
  if (natural !== null) {
    const bitmap = await create(image.blob, { resizeWidth: target, resizeQuality: "high" });
    if (bitmap.width === target) return bitmapSnapshot(bitmap);
    // Il motore non ha ridotto: si riduce una volta in un canvas.
    return shrinkInCanvas(bitmap, target);
  }
  // Larghezza ignota: si decodifica una volta, poi si riduce se serve.
  const whole = await create(image.blob);
  if (whole.width <= target) return bitmapSnapshot(whole);
  try {
    const bitmap = await create(whole, { resizeWidth: target, resizeQuality: "high" });
    if (bitmap.width === target) return bitmapSnapshot(bitmap);
    bitmap.close();
    return shrinkInCanvas(whole, target);
  } finally {
    whole.close();
  }
}

/// Senza `createImageBitmap`: l'immagine si decodifica in un `<img>` mai
/// messo nel DOM, poi si dipinge ridotta in un canvas (la zona, se c'è).
async function rasterizeByElement(url: string, target: number, zone?: ImageZone): Promise<CardSnapshot> {
  const picture = document.createElement("img");
  picture.decoding = "async";
  picture.src = url;
  await picture.decode();
  const width = picture.naturalWidth;
  const height = picture.naturalHeight;
  if (!(width > 0) || !(height > 0)) throw new Error(`image ${url} decoded without a size`);
  return zone ? zoneSnapshot(picture, width, height, zone, target) : canvasSnapshot(picture, width, height, target);
}

/// Le misure vere del raster, dai byte, quando si sanno. Di un JPEG si sa
/// solo il lato più lungo (l'orientamento EXIF può girarlo): l'altezza resta
/// ignota.
function naturalSize(image: DecodedImage, bytes: Uint8Array): { width: number | null; height: number | null } {
  if (image.width !== null) return { width: image.width, height: image.height };
  const size = rasterSize(image.format, bytes);
  if (size === null) return { width: null, height: null };
  return image.format === "JPEG" ? { width: Math.max(size[0], size[1]), height: null } : { width: size[0], height: size[1] };
}

/// L'immagine ferma della zona di un raster, larga al più `target`. Si
/// decodifica l'originale alla larghezza che dà alla zona `target` pixel
/// (mai più dell'originale): una sola decodifica quando le proporzioni si
/// sanno dai byte, una seconda solo se la prima, a proporzioni stimate, è
/// venuta troppo piccola.
async function rasterizeZone(
  image: DecodedImage,
  natural: { width: number | null; height: number | null },
  target: number,
  zone: ImageZone,
): Promise<CardSnapshot> {
  const create = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof create !== "function") return rasterizeByElement(image.url, target, zone);
  const turned = zone.turn % 180 !== 0;
  // La larghezza decodificata che dà alla zona, vista ruotata, `target`
  // pixel di larghezza, per un'immagine alta `aspect` volte la larghezza.
  const wanted = (aspect: number): number => Math.ceil(turned ? target / (zone.rect[3] * aspect) : target / zone.rect[2]);
  const decode = async (width: number | null): Promise<ImageBitmap> => {
    if (width === null || natural.width === null || width >= natural.width) return create(image.blob);
    return create(image.blob, { resizeWidth: Math.max(1, width), resizeQuality: "high" });
  };
  const guess = natural.width !== null && natural.height !== null ? natural.height / natural.width : 1;
  let bitmap = await decode(natural.width === null ? null : wanted(guess));
  try {
    if (natural.width !== null && bitmap.width < natural.width && bitmap.width > 0) {
      const need = wanted(bitmap.height / bitmap.width);
      if (need > bitmap.width + 1) {
        const again = await decode(need);
        bitmap.close();
        bitmap = again;
      }
    }
    return zoneSnapshot(bitmap, bitmap.width, bitmap.height, zone, target);
  } finally {
    bitmap.close();
  }
}

/// La zona `zone` di `source` (largo `width`, alto `height`), ruotata, in un
/// canvas largo al più `target` (o proprio `target` se `fit`, per un SVG).
function zoneSnapshot(
  source: CanvasImageSource,
  width: number,
  height: number,
  zone: ImageZone,
  target: number,
  fit = false,
): CardSnapshot {
  const [x, y, w, h] = zone.rect;
  const sx = x * width;
  const sy = y * height;
  const sw = Math.max(Number.MIN_VALUE, w * width);
  const sh = Math.max(Number.MIN_VALUE, h * height);
  const turned = zone.turn % 180 !== 0;
  const shownWidth = turned ? sh : sw;
  const shownHeight = turned ? sw : sh;
  const scale = fit ? target / shownWidth : Math.min(1, target / shownWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(shownWidth * scale));
  canvas.height = Math.max(1, Math.round(shownHeight * scale));
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("image card canvas has no 2d context");
  const dw = turned ? canvas.height : canvas.width;
  const dh = turned ? canvas.width : canvas.height;
  if (zone.turn === 0) {
    drawing.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  } else {
    drawing.translate(canvas.width / 2, canvas.height / 2);
    drawing.rotate((zone.turn * Math.PI) / 180);
    drawing.drawImage(source, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  }
  return { bitmap: canvas, bytes: canvas.width * canvas.height * 4 };
}

/// L'`<img>` di un SVG mostrato a pezzi (T78): un riquadro con le
/// proporzioni della zona ruotata (`canvas-card-zone`), che dentro ruota una
/// cornice grande quanto la zona dritta (`canvas-card-zone-frame`) e ci
/// sposta l'immagine intera. Le misure stanno in variabili CSS; le
/// proporzioni arrivano con `measured`, quando l'SVG le dice.
function zonePiece(picture: HTMLImageElement, zone: ImageZone): { element: HTMLElement; measured(width: number, height: number): void } {
  const [x, y, w, h] = zone.rect;
  const element = document.createElement("div");
  element.className = "canvas-card-zone";
  element.dataset.turn = String(zone.turn);
  const frame = document.createElement("div");
  frame.className = "canvas-card-zone-frame";
  element.style.setProperty("--zone-x", String(x));
  element.style.setProperty("--zone-y", String(y));
  element.style.setProperty("--zone-w", String(w));
  element.style.setProperty("--zone-h", String(h));
  frame.append(picture);
  element.append(frame);
  return {
    element,
    measured: (width, height) => {
      if (!(width > 0) || !(height > 0)) return;
      const ratio = zone.turn % 180 === 0 ? (w * width) / (h * height) : (h * height) / (w * width);
      element.style.setProperty("--zone-ratio", String(ratio));
      element.dataset.ratio = "";
    },
  };
}

/// L'SVG dipinto in un canvas largo `target`, o `null` se non ha misure o il
/// motore non lo sa dipingere.
function rasterizeVector(picture: HTMLImageElement, image: DecodedImage, target: number, zone: ImageZone): CardSnapshot | null {
  const width = picture.naturalWidth || image.width || 0;
  const height = picture.naturalHeight || image.height || 0;
  if (!(width > 0) || !(height > 0)) return null;
  try {
    return isWholeZone(zone) ? canvasSnapshot(picture, width, height, target, true) : zoneSnapshot(picture, width, height, zone, target, true);
  } catch {
    return null;
  }
}

function shrinkInCanvas(bitmap: ImageBitmap, target: number): CardSnapshot {
  try {
    return canvasSnapshot(bitmap, bitmap.width, bitmap.height, target);
  } finally {
    bitmap.close();
  }
}

/// Un canvas largo al più `target` (o proprio `target` se `fit`, per un SVG
/// che non ha una risoluzione sua), con le proporzioni della sorgente.
function canvasSnapshot(
  source: CanvasImageSource,
  width: number,
  height: number,
  target: number,
  fit = false,
): CardSnapshot {
  const scale = fit ? target / width : Math.min(1, target / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("image card canvas has no 2d context");
  drawing.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { bitmap: canvas, bytes: canvas.width * canvas.height * 4 };
}

function bitmapSnapshot(bitmap: ImageBitmap): CardSnapshot {
  return { bitmap, bytes: bitmap.width * bitmap.height * 4 };
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

/// Larghezza e altezza scritte nell'intestazione dei formati che
/// `decodeImage` non misura (JPEG, WebP, BMP), o `null`.
export function rasterSize(format: string, bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = (width: number, height: number): [number, number] | null =>
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? [width, height] : null;
  try {
    switch (format) {
      case "JPEG": {
        let at = 2;
        while (at + 9 <= bytes.byteLength) {
          if (bytes[at] !== 0xff) return null;
          const marker = bytes[at + 1]!;
          if (marker === 0xff) {
            at += 1;
            continue;
          }
          // SOF0…SOF15, fuori da DHT (C4), JPG (C8) e DAC (CC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return size(view.getUint16(at + 7), view.getUint16(at + 5));
          }
          if (marker === 0xd9 || marker === 0xda) return null;
          if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            at += 2;
            continue;
          }
          at += 2 + view.getUint16(at + 2);
        }
        return null;
      }
      case "WebP": {
        if (bytes.byteLength < 30) return null;
        const chunk = String.fromCharCode(...bytes.subarray(12, 16));
        if (chunk === "VP8 ") return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
        if (chunk === "VP8L") {
          const b0 = bytes[21]!;
          const b1 = bytes[22]!;
          const b2 = bytes[23]!;
          const b3 = bytes[24]!;
          return size(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
        }
        if (chunk === "VP8X") {
          const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
          const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
          return size(width, height);
        }
        return null;
      }
      case "BMP":
        if (bytes.byteLength < 26) return null;
        return size(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
      default:
        return null;
    }
  } catch {
    return null;
  }
}
