// I disegni dell'host finto: modelli, strumento finto, comando di creazione
// (`fake.ts` li ri-esporta).
import type { CommandSpec, DrawingGesture, DrawingOutcome } from "./contract";
import type { DrawingFakeCopy } from "./fake-options";

/// I modelli di «Nuovo disegno» in italiano, per id: gli stessi file che il
/// comando vero distribuisce.
export const DRAWING_TEMPLATES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../../crates/fub-features/templates/*.it.svg", { query: "?raw", import: "default", eager: true }),
  ).map(([path, text]) => [path.split("/").pop()!.replace(/\.it\.svg$/, ""), text]),
);

/// Lo strumento del motore finto: in anteprima rende un `marquee` dal primo
/// all'ultimo puntatore della richiesta e un `anchor` sull'ultimo, con lo
/// strumento occupato; alla fine non cambia niente (`empty`). Serve ai banchi
/// che guardano i segni e lo stato senza il motore vero.
export function strumentoFinto(gesture: DrawingGesture, copia: DrawingFakeCopy): DrawingOutcome {
  const vuoto: DrawingOutcome = {
    revision: copia.revision,
    preview: null,
    ops: null,
    selection: gesture.selection,
    losses: [],
    refused: null,
    frame: null,
    state: null,
    reading: null,
  };
  const state = (busy: boolean) => ({
    busy,
    transforming: false,
    wants_text: false,
    composing: false,
    cursor: busy ? "crosshair" : "arrow",
    options: null,
  });
  if (gesture.phase !== "preview") return { ...vuoto, refused: gesture.phase === "commit" ? "empty" : null, state: state(false) };
  const primo = gesture.events[0];
  const ultimo = gesture.events[gesture.events.length - 1];
  if (primo === undefined || ultimo === undefined) return { ...vuoto, preview: { shape: null, matrix: null, marquee: null, overlays: [] }, state: state(true) };
  const [x0, x1] = primo.x <= ultimo.x ? [primo.x, ultimo.x] : [ultimo.x, primo.x];
  const [y0, y1] = primo.y <= ultimo.y ? [primo.y, ultimo.y] : [ultimo.y, primo.y];
  return {
    ...vuoto,
    preview: {
      shape: null,
      matrix: null,
      marquee: null,
      overlays: [
        { kind: "marquee", rect: [x0, y0, x1 - x0, y1 - y0] },
        { kind: "anchor", at: [ultimo.x, ultimo.y], role: "selection", filled: true, size: 7 },
      ],
    },
    state: state(true),
  };
}

/// La spec di `drawing.create` come la dichiara la feature `draw`, in
/// italiano: le prove della galleria e delle sue porte la danno all'host.
export function drawingCreateSpec(): CommandSpec {
  const choices: [string, string][] = [
    ["blank", "Vuoto"],
    ["a4-portrait", "A4 verticale"],
    ["a4-landscape", "A4 orizzontale"],
    ["slide", "Diapositiva 16:9"],
    ["diagram", "Diagramma di flusso"],
    ["lesson", "Lavagna per la lezione"],
    ["storyboard", "Storyboard"],
    ["concept-map", "Mappa concettuale"],
  ];
  return {
    id: "drawing.create",
    title: "Nuovo disegno",
    description: "Crea un disegno, vuoto o da un modello, e lo apre.",
    keybinding: null,
    params: [
      { name: "name", title: "Nome", description: "", kind: { kind: "text" }, required: false },
      { name: "folder", title: "Cartella", description: "", kind: { kind: "text" }, required: false },
      {
        name: "template",
        title: "Modello",
        description: "",
        kind: { kind: "choice", value: choices.map(([value, title]) => ({ value, title })) },
        required: false,
      },
      { name: "from", title: "Dal vault", description: "", kind: { kind: "document" }, required: false },
    ],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };
}

/// Il documento nuovo del provider dei disegni: radice, titolo, carta e
/// «Livello 1». Il nome della radice sta in una costante, come per le
/// annotazioni.
export function blankDrawing(): string {
  const root = "svg";
  return [
    `<${root} xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`,
    "  <title></title>",
    '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>',
    '  <g id="livello-1" fub:layer="Livello 1">',
    "  </g>",
    `</${root}>`,
    "",
  ].join("\n");
}

/// La sorgente col titolo della radice cambiato in `title`: il testo del
/// `<title>` che apre la radice, o un `<title>` nuovo in testa alla radice.
/// Il titolo di una forma più in basso resta suo.
export function titled(source: string, title: string): string {
  const text = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const root = new RegExp(`(<${"svg"}\\b[^>]*>)(\\s*<title>[\\s\\S]*?</title>)?`);
  return source.replace(root, (_, head: string, old: string | undefined) => (old === undefined ? `${head}\n  <title>${text}</title>` : `${head}${old.replace(/<title>[\s\S]*<\/title>/, () => `<title>${text}</title>`)}`));
}
