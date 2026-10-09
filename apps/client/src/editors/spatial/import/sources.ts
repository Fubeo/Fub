// I file che si importano, dal nome: una parte piccola e senza dipendenze, che
// la shell legge per decidere dove offrire «Importa…» senza caricare i
// lettori, che arrivano con la finestra la prima volta che serve.

/// I programmi da cui si importa.
export type Source = "excalidraw" | "drawio";

/// Le estensioni dei file che si importano, per programma: le più lunghe
/// prima, perché il nome del disegno nuovo le tolga intere.
const EXTENSIONS: ReadonlyArray<readonly [suffix: string, source: Source]> = [
  [".excalidraw.json", "excalidraw"],
  [".excalidraw", "excalidraw"],
  [".drawio.xml", "drawio"],
  [".drawio.svg", "drawio"],
  [".drawio.png", "drawio"],
  [".drawio", "drawio"],
  [".dio", "drawio"],
];

/// Che cosa accetta la scelta di un file: le estensioni dei due programmi, e
/// quelle con cui li salvano anche, che si riconoscono dal contenuto.
export const IMPORT_ACCEPT = ".excalidraw,.json,.drawio,.dio,.xml,.svg,.png";

/// Il programma di un file dal suo nome; `null` se non è un file che si
/// importa.
export function sourceOf(name: string): Source | null {
  const lower = name.toLowerCase();
  return EXTENSIONS.find(([suffix]) => lower.endsWith(suffix))?.[1] ?? null;
}

/// Il nome del disegno che nasce da `path`: l'ultimo segmento, senza
/// l'estensione del programma, o senza l'ultima se il nome non ne ha una.
export function importedName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  const suffix = EXTENSIONS.find(([each]) => lower.endsWith(each))?.[0];
  const cut = suffix !== undefined ? name.length - suffix.length : name.lastIndexOf(".");
  return (cut > 0 ? name.slice(0, cut) : name).trim();
}
