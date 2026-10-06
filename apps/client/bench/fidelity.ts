// La pagina del banco di fedeltà: una scena del corpus disegnata dalle tre
// strade che la mostrano, una accanto all'altra. `#surface` è il foglio vivo,
// col painter; `#read` è la Lettura, la copia che si vede da sola in un
// `img`; `#export` è il PNG che il browser ne fa, come quando si copia.
//
// `?variant=` mette apposta una differenza in una strada sola, perché il
// banco dimostri di vederla: `colore` cambia un colore nella Lettura,
// `carattere` toglie i caratteri dell'app alla Lettura, `tratteggio` toglie i
// tratteggi all'export.

// Gli strati del foglio stanno uno sopra l'altro con le regole del tema, come
// nell'app.
import "../src/theme/structure.css";
import { PaintBuilder } from "../src/editors/spatial/painter/paint";
import { createSvgPainter } from "../src/editors/spatial/painter/svg-dom";
import { appFonts, selfContained, type FontSheets } from "../src/editors/spatial/picture";
import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { rasterize } from "../src/editors/spatial/tools/png";
import { ensureTextFont, FONT_FILES } from "../src/editors/spatial/tools/text";
import { openLifetime } from "../src/ui/lifetime";
import { FIDELITY } from "./fidelity-corpus";

const params = new URLSearchParams(location.search);
const found = FIDELITY.find((scene) => scene.id === params.get("scene"));
const variant = params.get("variant");
document.documentElement.dataset.scenes = FIDELITY.map((scene) => scene.id).join(" ");

const NO_FONTS: FontSheets = { now: () => "", load: async () => "" };

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
  if (found === undefined) return;
  ensureTextFont();
  await Promise.all(FONT_FILES.map(([family]) => document.fonts.load(`16px "${family}"`)));
  await appFonts.load(found.text);

  const host = document.getElementById("surface")!;
  const painter = createSvgPainter(host, openLifetime(), { fonts: appFonts });
  painter.setView({ scale: 1, angle: 0, tx: 0, ty: 0 });
  painter.update(new PaintBuilder().build(SceneEngine.open(found.text)));

  const read = variant === "colore" ? found.text.replace("#2b6cb0", "#4a90d9") : found.text;
  const shown = await selfContained(read, async () => null, 0, variant === "carattere" ? NO_FONTS : appFonts);
  await picture("read", new Blob([shown], { type: "image/svg+xml" }));

  const out = variant === "tratteggio" ? found.text.replace(/ ?stroke-dasharray(="[^"]*"|:[^;"]*;?)/g, "") : found.text;
  const png = await rasterize(await selfContained(out, async () => null, 0));
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
