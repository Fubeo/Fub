// Il file Craft delle scene `craft-*` (`?craft-scheda=<caso>`): un disegno di
// VectorCraft senza anteprima, con ciò che il bundle `fub.craft` dice nei
// casi della scheda (N7, T23) come le schermate del prototipo
// `PLAN-ui/craft-anteprime.html`: la domanda, le anteprime spente, l'app che
// prepara l'anteprima, il file oltre il peso massimo, il file che non si
// legge, l'app che non ce l'ha fatta. Soltanto le sue scene lo hanno.

import type { FakeCraft } from "../src/host/fake";
import type { CraftPreview, CraftPreviewSize } from "../src/host/craft";
import type { ExternalEditor } from "../src/host/ipc";

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
