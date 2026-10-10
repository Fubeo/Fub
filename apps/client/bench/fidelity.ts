// La pagina del banco di fedeltà: una scena del corpus disegnata dalle tre
// strade che la mostrano, una accanto all'altra. `#surface` è il foglio vivo,
// col painter; `#read` è la Lettura, la copia che si vede da sola in un
// `img`; `#export` è il PNG che il browser ne fa, come quando si copia.
//
// Una scena con una tavola (`board`) si vede come il suo embed,
// `![[disegno#nome]]`: la Lettura e l'export sono del disegno ritagliato
// sulla tavola (`section`), e il foglio la guarda al 100%, col suo angolo in
// alto a sinistra in quello dell'elemento.
//
// Una scena con una finestra (`view`) è un disegno più grande della resa che
// si guarda tutto, rimpicciolito: il foglio ha la camera sulla finestra, e la
// Lettura e l'export sono del disegno con la radice sulla finestra, larga
// quanto la resa (`windowed`). I modelli di «Nuovo disegno» si guardano così.
//
// `?variant=` mette apposta una differenza in una strada sola, perché il
// banco dimostri di vederla: `colore` cambia un colore nella Lettura,
// `carattere` toglie i caratteri dell'app alla Lettura, `corsivo` le toglie
// i soli corsivi, che il browser fa allora inclinando il tondo, `tratteggio`
// toglie i tratteggi all'export, `ripiego` toglie le risorse alla Lettura,
// che mostra allora i colori di ripiego, `carta` toglie le carte delle
// tavole all'export, `ritaglio` mostra nella Lettura il disegno intero al
// posto della sua tavola, come un embed che non la ritagliasse, `fusione`
// toglie le fusioni all'export, `sfocatura` vi sfoca gli effetti un decimo
// di meno, `angolo` vi gira di 5° le righe diagonali di una campitura,
// `finestra` mostra nella Lettura il disegno intero al posto della sua
// finestra, `vault` toglie alla Lettura i caratteri del vault, `taglio`
// toglie ai simboli dell'export `overflow="visible"`, e il browser li taglia
// al riquadro dell'istanza.
//
// Una scena coi caratteri del vault (`vault`) li ha da una porta del banco:
// la famiglia «Banco» coi file variabili di JetBrains Mono che l'app
// distribuisce, il tondo e il corsivo, come se il vault li avesse con
// quel nome. Il foglio li registra, la Lettura e l'export li portano dentro.
//
// `?wrap=check` prova invece gli a capo dei testi in area contro il browser
// (`wrap-check.ts`), e ne mette gli esiti in `data-wrap`; `?wrap=zwnj` li
// prova con la spaziatura che la misura mette da sé, come dove il canvas non
// la sa mettere; con `&variant=stima` gli a capo li misura la stima, e la
// prova deve vederlo.

// Gli strati del foglio stanno uno sopra l'altro con le regole del tema, come
// nell'app.
import "../src/theme/structure.css";
import { PaintBuilder } from "../src/editors/spatial/painter/paint";
import { createSvgPainter } from "../src/editors/spatial/painter/svg-dom";
import { DrawingFonts, markupFonts, VaultFonts, type VaultFontPort } from "../src/editors/spatial/fonts/vault";
import type { FaceInfo } from "../src/editors/spatial/fonts/faces";
import { appFonts, fontSheets, section, selfContained, type FontSheets } from "../src/editors/spatial/picture";
import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { boardsOf } from "../src/editors/spatial/tools/boards";
import { rasterize } from "../src/editors/spatial/tools/png";
import { browserMeasure, estimate } from "../src/editors/spatial/tools/measure";
import { ensureTextFont, FONT_FILES } from "../src/editors/spatial/tools/text";
import { openLifetime } from "../src/ui/lifetime";
import { FIDELITY, FIDELITY_SIZE, type FidelityScene } from "./fidelity-corpus";
import { wrapCases } from "./wrap-check";

const params = new URLSearchParams(location.search);
const found = FIDELITY.find((scene) => scene.id === params.get("scene"));
const variant = params.get("variant");
document.documentElement.dataset.scenes = FIDELITY.map((scene) => scene.id).join(" ");

const NO_FONTS: FontSheets = { now: () => "", load: async () => "" };
const UPRIGHT: FontSheets = {
  now: () => null,
  load: async (svg) => (await appFonts.load(svg)).split("\n").filter((rule) => !rule.includes("font-style:italic")).join("\n"),
};

/// I file della famiglia «Banco» del banco: le facce che l'host direbbe se si
/// chiamassero così.
const BANCO: readonly { readonly id: string; readonly url: string; readonly style: "normal" | "italic" }[] = [
  { id: "Caratteri/Banco.woff2", url: "/fonts/jetbrains-mono-latin-wght-normal.woff2", style: "normal" },
  { id: "Caratteri/Banco-Italic.woff2", url: "/fonts/jetbrains-mono-latin-wght-italic.woff2", style: "italic" },
];

/// I caratteri del vault del banco. L'istanza di una faccia è il file
/// stesso: il browser lo fissa nel peso della faccia registrata, come
/// l'istanza dell'host, e le tre strade lo leggono uguale.
async function benchVault(): Promise<DrawingFonts> {
  const bytes = await Promise.all(BANCO.map(async (file) => new Uint8Array(await (await fetch(file.url)).arrayBuffer())));
  const face = (style: "normal" | "italic"): FaceInfo => ({
    index: 0,
    family: "Banco",
    names: ["Banco"],
    generic: "monospace",
    weight: [100, 800],
    stretch: [100, 100],
    styles: [{ style, fixed: [] }],
    axes: [{ tag: "wght", min: 100, default: 400, max: 800 }],
  });
  const port: VaultFontPort = {
    files: async () => BANCO.map((file, i) => ({ id: file.id, size: bytes[i]!.length, mtime: 1 })),
    read: async (id) => bytes[BANCO.findIndex((file) => file.id === id)] ?? null,
    ask: async (query) => {
      const { kind, data } = query as { kind: string; data: string };
      if (kind === "font_instance") return { data };
      const raw = atob(data);
      const i = bytes.findIndex((each) => each.length === raw.length && each.every((byte, k) => byte === raw.charCodeAt(k)));
      return { faces: [face(BANCO[i]!.style)] };
    },
  };
  return new DrawingFonts(new VaultFonts(port));
}

/// Il disegno `text` con la radice sulla finestra di `scene`, come la resa
/// lo mostra: il `viewBox` è la finestra, la larghezza e l'altezza sono quelle
/// della resa, e le unità del disegno restano quelle del file.
function windowed(text: string, view: NonNullable<FidelityScene["view"]>): string {
  const [x, y, width] = view;
  const height = (width * FIDELITY_SIZE.height) / FIDELITY_SIZE.width;
  const open = /^<svg\b[^>]*>/.exec(text)?.[0];
  if (open === undefined) throw new Error("la scena non comincia con la radice");
  const set = (tag: string, name: string, value: string): string =>
    new RegExp(`\\s${name}="[^"]*"`).test(tag) ? tag.replace(new RegExp(`(\\s${name}=)"[^"]*"`), `$1"${value}"`) : tag.replace(/>$/, ` ${name}="${value}">`);
  let tag = open;
  tag = set(tag, "viewBox", `${x} ${y} ${width} ${height}`);
  tag = set(tag, "width", String(FIDELITY_SIZE.width));
  tag = set(tag, "height", String(FIDELITY_SIZE.height));
  return tag + text.slice(open.length);
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/// Un `img` in `#id`, decodificato.
async function picture(id: string, blob: Blob): Promise<void> {
  const img = document.createElement("img");
  img.alt = "";
  img.src = URL.createObjectURL(blob);
  document.getElementById(id)!.append(img);
  await img.decode();
}

async function main(): Promise<void> {
  const wrap = params.get("wrap") === "check" || params.get("wrap") === "zwnj";
  if (found === undefined && !wrap) return;
  ensureTextFont();
  await Promise.all(FONT_FILES.map(([family, , , style]) => document.fonts.load(`${style} 16px "${family}"`)));
  if (wrap) {
    const measure = variant === "stima" ? estimate : browserMeasure(params.get("wrap") === "check");
    document.documentElement.dataset.wrap = JSON.stringify(wrapCases(measure));
    return;
  }
  if (found === undefined) return;
  const vault = found.vault === true ? await benchVault() : null;
  const fonts = vault === null ? appFonts : fontSheets(vault);
  if (vault !== null) {
    const { fonts: wanted } = markupFonts(found.text);
    vault.useFonts(wanted);
    await vault.ready(wanted);
  }
  await fonts.load(found.text);

  // La tavola che la scena mostra, e il disegno che ne fa il suo embed.
  const engine = SceneEngine.open(found.text);
  const board = found.board === undefined ? null : boardsOf(engine.model!).find((each) => each.name === found.board) ?? null;
  const sectioned = found.board === undefined ? found.text : section(found.text, found.board);
  if (sectioned === null || (found.board !== undefined && board === null)) throw new Error(`${found.id} non ha la tavola ${found.board}`);
  const view = found.view;
  const text = view === undefined ? sectioned : windowed(sectioned, view);
  const zoom = view === undefined ? 1 : FIDELITY_SIZE.width / view[2];

  const host = document.getElementById("surface")!;
  const painter = createSvgPainter(host, openLifetime(), { fonts, ...(vault === null ? {} : { families: vault }) });
  painter.setView({ scale: zoom, angle: 0, tx: -(board?.rect[0] ?? view?.[0] ?? 0) * zoom, ty: -(board?.rect[1] ?? view?.[1] ?? 0) * zoom });
  painter.update(new PaintBuilder().build(engine));

  // Un'immagine SVG che porta i caratteri come data URI può disegnarsi, la
  // prima volta che il browser li legge, col testo ancora invisibile, e
  // restare così: dalla seconda i caratteri sono pronti. Un testo grande come
  // quello di una diapositiva lo mostra sempre. La scena si disegna una volta
  // a vuoto, perché la Lettura e l'export partano dagli stessi caratteri.
  await rasterize(await selfContained(text, async () => null, 0, fonts));

  const read = variant === "colore"
    ? text.replace("#2b6cb0", "#4a90d9")
    : variant === "ripiego"
      ? text.replace(/<defs id="fub-defs">[\s\S]*?<\/defs>/, "")
      : variant === "ritaglio"
        ? found.text
        : variant === "finestra"
          ? sectioned
          : text;
  const shown = await selfContained(read, async () => null, 0, variant === "carattere" ? NO_FONTS : variant === "corsivo" ? UPRIGHT : variant === "vault" ? appFonts : fonts);
  await picture("read", new Blob([shown], { type: "image/svg+xml" }));

  const out = variant === "tratteggio"
    ? text.replace(/ ?stroke-dasharray(="[^"]*"|:[^;"]*;?)/g, "")
    : variant === "carta"
      ? text.replace(/<rect [^>]*fub:role="paper"[^>]*\/>/g, "")
      : variant === "fusione"
        ? text.replace(/ style="mix-blend-mode: [^"]*"/g, "")
        : variant === "sfocatura"
          ? text.replace(/stdDeviation="([^"]*)"/g, (_, value: string) => `stdDeviation="${Number(value) * 0.9}"`)
          : variant === "angolo"
            ? text.replace('patternTransform="rotate(-45)"', 'patternTransform="rotate(-40)"')
            : variant === "taglio"
              ? text.replace(/ overflow="visible"/g, "")
              : text;
  const png = await rasterize(await selfContained(out, async () => null, 0, fonts));
  if (png === null) throw new Error(`il PNG di ${found.id} non si fa`);
  await picture("export", png);

  // Gli strati immagine del foglio si decodificano da soli.
  for (let i = 0; i < 50; i++) {
    const images = [...host.querySelectorAll("img")];
    if (images.every((img) => img.complete)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await Promise.all([...host.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  await frame();
  await frame();
}

main().then(
  () => (document.documentElement.dataset.fidelity = "ready"),
  (error: unknown) => {
    document.documentElement.dataset.fidelity = "failed";
    document.documentElement.dataset.error = String(error);
  },
);
