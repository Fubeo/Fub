// Il file Craft delle scene `craft-*` (`?craft-scheda=<caso>`): un disegno di
// VectorCraft senza anteprima, con ciò che il bundle `fub.craft` dice nei
// casi della scheda (N7, T23) come le schermate del prototipo
// `PLAN-ui/craft-anteprime.html`: la domanda, le anteprime spente, l'app che
// prepara l'anteprima, il file oltre il peso massimo, il file che non si
// legge, l'app che non ce l'ha fatta. Soltanto le sue scene lo hanno.

import type { FakeCraft } from "../src/host/fake";
import type { CraftImageType, CraftPreview, CraftPreviewSize, CraftPreviewSubject } from "../src/host/craft";
import type { ExternalEditor } from "../src/host/ipc";
import { LIGHTHOUSE_STORED } from "./raw-fixture";

export const CRAFT_SCENE_DOC = "Disegni/logo-studio.vectorcraft";

export type CraftSceneCase = "domanda" | "spente" | "prepara" | "peso" | "rotto" | "fallita";

const CASES: readonly CraftSceneCase[] = ["domanda", "spente", "prepara", "peso", "rotto", "fallita"];

export function craftSceneCase(value: string | null): CraftSceneCase | null {
  return CASES.find((name) => name === value) ?? null;
}

export function craftSceneResources(): Record<string, { bytes: Uint8Array }> {
  return { [CRAFT_SCENE_DOC]: { bytes: new TextEncoder().encode("{\"vectorcraft\":3}") } };
}

const APP = { app: "VectorCraft" } as const;

/// Ciò che il bundle finto dice del disegno, caso per caso.
export function craftSceneCraft(kind: CraftSceneCase): FakeCraft {
  const info = { format_version: "3", bytes: 2_516_582 };
  const doc = {
    domanda: { info, render: { ...APP, consent: "ask" as const } },
    spente: { info, render: { ...APP, consent: "off" as const } },
    prepara: { info, render: { ...APP, consent: "on" as const } },
    peso: { info: { ...info, bytes: 187_432_960 }, missing: "over_limit" as const, limit_bytes: 64 * 1024 * 1024, render: { ...APP, consent: "on" as const } },
    rotto: { info: { bytes: info.bytes }, missing: "unreadable" as const },
    fallita: { info, missing: "failed" as const },
  }[kind];
  return { docs: { [CRAFT_SCENE_DOC]: doc } };
}

/// `craft_render` del caso `prepara`: il job parte e la risposta dice che è
/// in coda; il `job_done` non arriva, e la scheda resta su «Preparo
/// l'anteprima…».
export function craftSceneRender(
  preview: (doc: string, size: CraftPreviewSize) => Promise<CraftPreview>,
): (doc: string, size: CraftPreviewSize) => Promise<CraftPreview> {
  return async (doc, size) => ({ ...(await preview(doc, size)), queued: true });
}

// ── PDF e documenti (T31) ───────────────────────────────────────────────
//
// Le scene `nota-pdf`, `nota-pdf-senza`, `pdf-domanda` e `docx-due-righe`
// (`?pdf-scena=<caso>`), come le schermate T31 del prototipo: una nota che
// incorpora il contratto d'affitto in PDF, con la prima pagina fatta da
// PdfCraft o senza anteprima (il link); il PDF aperto con la domanda sulle
// anteprime nella riga d'avviso; un Word prestato a WordCraft con la domanda
// sotto la riga del prestito. L'host finto non sa dire l'anteprima di un PDF
// o di un Word (la dice il bundle vero): `pdfScenePreview` risponde al suo
// posto a `craft.preview`, senza toccare `src/host/fake.ts`.

export type PdfSceneCase = "nota" | "nota-senza" | "domanda" | "due-righe";

const PDF_CASES: readonly PdfSceneCase[] = ["nota", "nota-senza", "domanda", "due-righe"];

export function pdfSceneCase(value: string | null): PdfSceneCase | null {
  return PDF_CASES.find((name) => name === value) ?? null;
}

export const PDF_SCENE_DOC = "Casa/contratto-affitto.pdf";
export const PDF_SCENE_NOTE = "Casa/Affitto di via Roma.md";
export const DOCX_SCENE_DOC = "Documenti/relazione.docx";

/// WordCraft, l'app a cui la scena `docx-due-righe` presta il Word dal menu
/// dell'albero.
export const PDF_SCENE_WORDCRAFT: ExternalEditor = { id: "wordcraft", name: "WordCraft", opens: ["docx"], installed: true, running: false };

const NOTE = [
  "# Affitto di via Roma",
  "",
  "Firmato il 1° novembre: la caparra è di due mensilità, il primo affitto si paga entro il 5 dicembre. Qui sotto il contratto, così com'è arrivato dall'agenzia.",
  "",
  "![[contratto-affitto.pdf]]",
  "",
  "Da chiedere all'agenzia: chi paga la manutenzione della caldaia.",
  "",
].join("\n");

/// Il Word della scena `docx-due-righe`, nella proiezione `fub-rich` che il
/// finto mostra.
function relazione(): string {
  const para = (x: string) => ({ t: "para", role: { kind: "body" }, c: [{ t: "text", x }] });
  return JSON.stringify({
    format: "fub-rich",
    version: 1,
    blocks: [
      { t: "para", role: { kind: "heading", level: 1 }, c: [{ t: "text", x: "Relazione sul trimestre" }] },
      para("Il trimestre chiude con le vendite in crescita del 12% rispetto allo stesso periodo dell'anno scorso, trainate dai negozi del nord."),
      para("I costi di spedizione sono saliti di due punti; la sezione 3 propone come rientrare entro marzo."),
    ],
  });
}

/// I testi della scena: la nota col PDF, o il Word.
export function pdfSceneFiles(kind: PdfSceneCase): Record<string, string> {
  if (kind === "due-righe") return { [DOCX_SCENE_DOC]: relazione() };
  return kind === "domanda" ? {} : { [PDF_SCENE_NOTE]: NOTE };
}

/// Un PDF vero di una pagina, il contratto dei disegni del prototipo: il
/// titolo, la riga sotto, le righe grigie del testo e le due firme. pdf.js
/// lo legge come uno qualunque.
function contractPdf(): Uint8Array {
  const lines = Array.from({ length: 22 }, (_, i) => `64 ${842 - (180 + i * 26) - 8} ${i % 6 === 5 ? 280 : 467} 8 re f`).join("\n");
  const content = [
    "1 g 0 0 595 842 re f",
    "0.1 g BT /F1 26 Tf 64 732 Td (Contratto di locazione) Tj ET",
    "0.33 g BT /F1 13 Tf 64 702 Td (Via Roma 12, Bologna - 1 novembre 2026) Tj ET",
    "0.85 g",
    lines,
    "0.6 g 64 80.5 180 1.5 re f 351 80.5 180 1.5 re f",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/// I byte della scena: il PDF (anche nella scena del Word, che non lo apre).
export function pdfSceneResources(): Record<string, { bytes: Uint8Array; mime: string }> {
  return { [PDF_SCENE_DOC]: { bytes: contractPdf(), mime: "application/pdf" } };
}

/// La prima pagina del contratto come la fa PdfCraft (`--dpi 36`), 256×362:
/// gli stessi disegni del PDF.
const PDF_PAGE =
  "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";

/// L'anteprima `small` di `craft.preview` per il PDF o il Word della scena:
/// la prima pagina nella scena `nota`, altrimenti l'app che può farla col
/// consenso da chiedere. `null` per ogni altro documento.
export function pdfScenePreview(kind: PdfSceneCase, doc: string, size: CraftPreviewSize): CraftPreview | null {
  const pdf = doc === PDF_SCENE_DOC;
  if (!pdf && doc !== DOCX_SCENE_DOC) return null;
  const image = kind === "nota" && pdf && size === "small";
  const app = pdf ? "PdfCraft" : "WordCraft";
  return {
    version: 2,
    doc,
    revision: null,
    size,
    origin: image ? "cli" : "none",
    queued: false,
    image: image ? { media_type: "image/png", data: PDF_PAGE, width: 256, height: 362, orientation: 1 } : null,
    missing: image ? null : "absent",
    limit_bytes: null,
    info: { app: pdf ? "pdf" : "document", editor: app, format_version: null, bytes: pdf ? 184_320 : 48_128, photo: null, edits: [], xmp: null },
    render: image ? null : { app, consent: "ask" },
  };
}

// ── L'albero (T26) ──────────────────────────────────────────────────────
//
// Le scene `albero-miniature` e `albero-xmp` (`?albero=miniature|xmp`), come
// i modi omonimi del prototipo: la cartella «Foto 2026» con due RAW, i loro
// XMP e una foto comune, e la cartella «Progetti» con i file Craft, i
// documenti e il contratto in PDF, con le miniature accese e gli XMP
// mostrati o nascosti. Le miniature sono i disegni del prototipo; il faro è
// quello del RAW girato, la pagina del PDF quella della nota. L'host finto
// non sa dire l'anteprima di questi file: `treeScenePreview` risponde al suo
// posto a `craft.preview`.

export type TreeSceneCase = "miniature" | "xmp";

const TREE_CASES: readonly TreeSceneCase[] = ["miniature", "xmp"];

export function treeSceneCase(value: string | null): TreeSceneCase | null {
  return TREE_CASES.find((name) => name === value) ?? null;
}

/// Il disegno di VectorCraft, 64×48.
const TREE_DRAWING =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAE2klEQVR4AexZe2xTVRj/3XvbdVc3tlG2TjFKgM4tuI3xELeogQyNISZGEsA/FE18YDDBDJQw" +
  "A39MCYtmlIHMGREEJPiAkLCEqbgtRAwSFh8YEh9xgJgtc+lmH6yv2/Z6z8Uw2rXunN57Z7Ft8p2ex/f9vu/8znfOPbflpZBfzmThkeGfLAEZngDIZkA2AzKc" +
  "gewWyPAEyB6Cum6BcP9ljHbsh2fvNrhaGuByvALPB2/C99lhRJyDaZls2gmIhOE/dRzDm1apcvVIu9oOnj+D4Pen4e85Bu/hnXA2PIaRpmcRONcDyNG0ISNl" +
  "AuSgH76Tn8C54XF1xcnqTzQr6bcLcL/dqBD1BPxfdwLRyEQmho+nTIC/S1nZQ62IDA8xBxke+B3egy0gWcJsrLNBSgQEznwB78e7oCWVZf8oXDs3Qbr8s85T" +
  "YoNjJoCkOjnk2Nwk0VbOD3frRkTdI0kU9O+OR2QmwHtoO+RQIB6Hud05dR7W2l/AitInsfT906hv+5JaHnm3G02fn0cwHGH2G2/AREDg7EmELpyLx2BuS8r1" +
  "49OSOozk5Ku2shQEy4EoRaL4qm8IP/T/pdprKZgI8HUf0+Lruq3TPAUBwXK9TSpySCGBVBjkotPLoJ1YlZ4AKQTyGEsMo0Ovch7ogMIMQU1AeGgACEvMDmgN" +
  "ZPVOINOq66ZHTUDUM6yb06RAcjoT4J4EAqJpTABfYE26cLoN8JxuULRA1FuAn2I0AcrkOUVoI9dJj5oAk206ODFPk9vcCjf43HBCDI4noaQxATCZYam6L2Hw" +
  "NJ2CNQBLmQditSuxuoKfeMDYXkI7tQexfjm1bowiH4VYo0xcSXHTbQHk2dwxw6TBmWMvRqRvMoSJgJyK+TCX1zDHlVt2FULeWOrb5gxC5MbeJ9TJq1uAGVqz" +
  "ARMBxFvBi03g8wtJlUqEPAkWuydG1yxKeG5ah9rH8QI4i6jW/4uCmQDBakNhQwtgpktZsVp5YRHGT21Z4TeoFPvA3aIcrMrWGK8xOT18Km7M9kpMfa0NfOG0" +
  "fzXPuVNJ/eJQUp11pUdg5rW/0iZ1AGCisZQIIKDm2ZWwvr4fOVW1pDlOyOPOMmf8YXej4h2mP7Hy1hM3djHVq6cXMeknUk6ZAALGFxWj6NVWFK5vgWlGOcCN" +
  "wZHHHW+Z+Gq7Kv8EXpprwuoFM6nlmXtnYcvDlSi3FUDrZyxiDUiWmgdgfeMASvb0KFujHfkrlsCkPO5oIAVZwqPh3Xh60SxqeWrhTCy2l4LntF+ceJogaXU4" +
  "5TQ328sgmLpoTVS9qPMsIhcPqvXJLnQlgAQf6e8ElzcDfHEtk0QGu5Wfxdh/FSI+tYjuBAh3rUTOg0fZpe4AwNM9WrVMON5WdwLiHaR7O0tAuq+Q0fEZlgGt" +
  "7fuwes0GNf7yBfWYPXcxgsFrh1yz4x18dLQDfZeu4Pl1jaiuW4Zf+y6pumSMVDZv3Y7apcvR+92PpGmYGEbAlT8GIP/zN/i+trfQvmMrLJZrh5wgCHDs3ovb" +
  "S0vUiQUUYkKh2Cuzb9QHlzv2JUpV1rkwjADHts348L0darh1i+bjoSX3q3VSbHx5DXpPHYco5mLPrmb88m037qm4mwyhcf1a9dvRvAU/9XZh4bwqtW1UwRsF" +
  "fLPgZgm4WVbKqDj/dxnAStTfAAAA//8T+DbAAAAABklEQVQDACO8cD9R+DgBAAAAAElFTkSuQmCC";
/// La copertina di PhotoCraft, 64×40.
const TREE_PCRAFT =
  "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";
/// La pianta di FigCraft, 64×40.
const TREE_FIGCRAFT =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAYAAABOzvzpAAACMklEQVR4AexZO07DQBB960AIiK+goACJAgrOQMeBoKQAUSAQouRzBM5BxxEQICgAIYEIIT8S" +
  "kpDYzJLGa03Ix+t4ie3si3bX6zczbyZSMrE+8iUnyrAQ8SsWwF0AghaOA1gCgQCSnPjJDDsE7coj/bSvVECDnJueSGFyfDQQTE2MkQYNCpMfYdhXBEhQCoQQ" +
  "ECIYWDK1QjGpKBGGfdabdAY4OAH2jzvH4RlQ/lLi6X3RqAPpJ+DtUQ8kl02cjEesAPkicH0H3Nx3jqtboFZjLPSy1fgGKiWgWtYDyVUnTsYXVoDlJeD8tHtM" +
  "TzEWDN9iBZA+VymblSqgA5JLcpoIVoASfZZf0sDrux5IrnLFxPABVoChhH5nE6wl/Xa6ZTTUrW7D6P18LEDv2g3Gk5GrAG/aYgG8ikRtHVdA1DLujTeuAK8i" +
  "cp0cBubn9GIkKZnNA1sB1A9BagRaYV7oTY9YAZq3wnwX+o3LrDKsZgqQTAGLq3oxTJz/RgByNJNtdqVkZ4rDwzOowUoHfQ4jKyCXBzZ38duXlL1JDjtHwMWl" +
  "z+jpcSMFoO48udafYaQAM9RbPN4DtjdaY38LWF/zL5KRAsiwZmeA1ZXWWFoA/X8B35exAviOrEOCgRegnQ6xAO0UGvT7cQW4M+zYjpZvV25O99y2bQh6uffc" +
  "8zDsqxVAPxiyhU/kCqVAkC9WSGDbHbM6D8G+RwDAshJwKEtBgGghLNWkooBA3+3/4Y3i2sAuIi/ADwAAAP//OqEFDQAAAAZJREFUAwDUee4vL1j1RAAAAABJ" +
  "RU5ErkJggg==";
/// La prima pagina della relazione, 48×68.
const TREE_DOCX_PAGE =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAABECAYAAADHsbZQAAACiUlEQVR4AeyZT0orQRDG6w3PJBPHvEyefxJURHDlzo07F+49imdw7QXEnRcQQfACXkDBrboR" +
  "lESFMdEkGhW0S0Rm8S0ap9qpYDcUNA2Z+X5dXemqmuBtyEdAQz48QN4O9B5Q6YH9w1Pa2j1yZhfNjhg3PEI7Bye0vXfszE7ObtwCbK6v0s7GmjNbWZp1C7A4" +
  "P07Liw1nFo+V3AKIPf0HHhSgdzRv2nR+0VJlrAlphQCNySotzNVVGWuyBngavFC3/6TKWJM1wIf4ngFQZL3+AOmnAK2Ox2NUn6iqsv9xhKRigOatwiA2mhAB" +
  "9EDD7L66IDaarAHaD31qGWJNxpqsAYojfykaLaky1mQNEJYKFJUNgCILjSYCIwBrdNlKwC38vZu5fd9HrxBbgwAz9ZrYLVytlMnlgAB3nZ66IGZNaCMgQDks" +
  "kLYgZk0EBgQg+kP6BtYEAXqcyCnKg7pGC2tCmwoBatWItOVCrInAgACSf6NShdHVdQLkE07mJP9GpXKq6amaPQAXDx81AceCEmNNiAAeocfBM3HgaDLWZA0Q" +
  "V0bVBTFrsgbgDoBU8N13H9F7xdbgEeIOgFTwVaJQTCx6EARIOl11uVBi8jNrgLBYUJcLhcURQgN6IDTFw1AXNL4r4aAtyZ0S6yPExYOmjgRrYU3WAPE/hReZ" +
  "0WQNMHh+zdbYdZA/sSZrAC4eNOVBrIU1WQNw8eALms8vPL4vhM5Nag3exFw8+ILGdBI4+KTMFzRSBc53n8NFVurof01hDEgWNFKFEWv6Up2aQIDEFzTm44jw" +
  "F57fVdCkjpj6KYwB9apTAj1AajNymXoP5LLtqZd6D6Q2I5dp7h7ISu0Bsu5g1t97D2Tdway/fwcAAP//ljkrVQAAAAZJREFUAwB20YBftCofBwAAAABJRU5E" +
  "rkJggg==";

const TREE_RAW = "Foto 2026/IMG_0412.CR3";

/// Le miniature della scena, per documento: il formato, i byte, le misure e
/// l'orientamento dell'immagine che il file ha già.
interface TreeThumb {
  readonly app: CraftPreviewSubject;
  readonly editor: string;
  readonly media: CraftImageType;
  readonly data: string;
  readonly width: number;
  readonly height: number;
  readonly orientation: number;
}

const png = (app: CraftPreviewSubject, editor: string, data: string, width: number, height: number): TreeThumb =>
  ({ app, editor, media: "image/png", data, width, height, orientation: 1 });

const TREE_THUMBS: Readonly<Record<string, TreeThumb>> = {
  [TREE_RAW]: { app: "raw", editor: "LightCraft", media: "image/jpeg", data: LIGHTHOUSE_STORED, width: 600, height: 400, orientation: 6 },
  "Progetti/copertina.pcraft": png("photocraft", "PhotoCraft", TREE_PCRAFT, 64, 40),
  "Progetti/logo-studio.vectorcraft": png("vectorcraft", "VectorCraft", TREE_DRAWING, 64, 48),
  "Progetti/Un nome lunghissimo per il progetto della nuova sede di via Garibaldi.figcraft": png("figcraft", "FigCraft", TREE_FIGCRAFT, 64, 40),
  "Progetti/relazione.docx": png("document", "WordCraft", TREE_DOCX_PAGE, 48, 68),
  "Progetti/contratto-affitto.pdf": png("pdf", "PdfCraft", PDF_PAGE, 256, 362),
};

/// La nota alla radice.
export function treeSceneFiles(): Record<string, string> {
  return { "Affitto di via Roma.md": NOTE };
}

/// I file della scena, coi pochi byte che bastano all'albero.
export function treeSceneResources(): Record<string, { bytes: Uint8Array }> {
  const bytes = (text: string) => ({ bytes: new TextEncoder().encode(text) });
  const xmp = bytes("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"/>");
  return {
    "Foto 2026/IMG_0412.xmp": xmp,
    "Foto 2026/spiaggia.xmp": xmp,
    [TREE_RAW]: bytes("RAW"),
    "Foto 2026/IMG_0413.CR3": bytes("RAW"),
    "Foto 2026/spiaggia.jpg": bytes("JPG"),
    "Progetti/copertina.pcraft": bytes("{\"photocraft\":1}"),
    "Progetti/logo-studio.vectorcraft": bytes("{\"vectorcraft\":3}"),
    "Progetti/Un nome lunghissimo per il progetto della nuova sede di via Garibaldi.figcraft": bytes("{\"figcraft\":1}"),
    "Progetti/bilancio.xlsx": bytes("PK"),
    "Progetti/relazione.docx": bytes("PK"),
    "Progetti/bozza.odt": bytes("PK"),
    "Progetti/contratto-affitto.pdf": { bytes: contractPdf() },
  };
}

/// I due interruttori dell'albero come la scena li vuole: miniature accese,
/// XMP mostrati o nascosti.
export function treeSceneSetting(kind: TreeSceneCase, key: string): boolean | null {
  if (key === "craft.tree-thumbnails") return true;
  if (key === "craft.tree-show-xmp") return kind !== "xmp";
  return null;
}

/// L'anteprima `small` di `craft.preview` per un file della scena che ha
/// una miniatura; `null` per ogni altro documento, che resta al finto.
export function treeScenePreview(doc: string, size: CraftPreviewSize): CraftPreview | null {
  const thumb = TREE_THUMBS[doc];
  if (thumb === undefined || size !== "small") return null;
  return {
    version: 2,
    doc,
    revision: null,
    size,
    origin: "file",
    queued: false,
    image: { media_type: thumb.media, data: thumb.data, width: thumb.width, height: thumb.height, orientation: thumb.orientation },
    missing: null,
    limit_bytes: null,
    info: { app: thumb.app, editor: thumb.editor, format_version: null, bytes: 0, photo: null, edits: [], xmp: null },
    render: null,
  };
}
