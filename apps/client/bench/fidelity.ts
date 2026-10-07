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
// `?variant=` mette apposta una differenza in una strada sola, perché il
// banco dimostri di vederla: `colore` cambia un colore nella Lettura,
// `carattere` toglie i caratteri dell'app alla Lettura, `corsivo` le toglie
// i soli corsivi, che il browser fa allora inclinando il tondo, `tratteggio`
// toglie i tratteggi all'export, `ripiego` toglie le risorse alla Lettura,
// che mostra allora i colori di ripiego, `carta` toglie le carte delle
// tavole all'export, `ritaglio` mostra nella Lettura il disegno intero al
// posto della sua tavola, come un embed che non la ritagliasse.
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
import { appFonts, section, selfContained, type FontSheets } from "../src/editors/spatial/picture";
import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { boardsOf } from "../src/editors/spatial/tools/boards";
import { rasterize } from "../src/editors/spatial/tools/png";
import { browserMeasure, estimate } from "../src/editors/spatial/tools/measure";
import { ensureTextFont, FONT_FILES } from "../src/editors/spatial/tools/text";
import { openLifetime } from "../src/ui/lifetime";
import { FIDELITY } from "./fidelity-corpus";
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
  await appFonts.load(found.text);

  // La tavola che la scena mostra, e il disegno che ne fa il suo embed.
  const engine = SceneEngine.open(found.text);
  const board = found.board === undefined ? null : boardsOf(engine.model!).find((each) => each.name === found.board) ?? null;
  const text = found.board === undefined ? found.text : section(found.text, found.board);
  if (text === null || (found.board !== undefined && board === null)) throw new Error(`${found.id} non ha la tavola ${found.board}`);

  const host = document.getElementById("surface")!;
  const painter = createSvgPainter(host, openLifetime(), { fonts: appFonts });
  painter.setView({ scale: 1, angle: 0, tx: -(board?.rect[0] ?? 0), ty: -(board?.rect[1] ?? 0) });
  painter.update(new PaintBuilder().build(engine));

  const read = variant === "colore"
    ? text.replace("#2b6cb0", "#4a90d9")
    : variant === "ripiego"
      ? text.replace(/<defs id="fub-defs">[\s\S]*?<\/defs>/, "")
      : variant === "ritaglio"
        ? found.text
        : text;
  const shown = await selfContained(read, async () => null, 0, variant === "carattere" ? NO_FONTS : variant === "corsivo" ? UPRIGHT : appFonts);
  await picture("read", new Blob([shown], { type: "image/svg+xml" }));

  const out = variant === "tratteggio"
    ? text.replace(/ ?stroke-dasharray(="[^"]*"|:[^;"]*;?)/g, "")
    : variant === "carta"
      ? text.replace(/<rect [^>]*fub:role="paper"[^>]*\/>/g, "")
      : text;
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
