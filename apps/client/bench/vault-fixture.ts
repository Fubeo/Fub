// Il vault del banco dell'albero (`tree.mjs`): cinquemila file in cinque
// cartelle, come lo trova chi ha anni di note nello stesso vault.
//
// Il piano chiede due cose che il vault deve avere davvero. La prima è una
// cartella da milleecinquecento note: è il caso del fotogramma più lungo, quando
// si apre. La seconda sono i casi ai margini che il piano nomina: un nome di
// cento caratteri (la scheda S252) e una catena di dieci cartelle annidate, con
// una nota per livello e la nota in fondo. Tutti i file sono note Markdown, e
// ogni nota ha un nome che nessun'altra ha: una ricerca di nome ne trova una
// sola.
//
// Ogni cartella della catena ha una nota sua. Il finto dell'indice
// (`src/host/fake.ts`) conta le sottocartelle solo fra quelle che la domanda
// elenca, quindi una cartella che ha soltanto sottocartelle risulta vuota, e
// l'albero non la apre. Una nota per livello è anche come sta un vault vero.
//
// Il vault è lo stesso a ogni chiamata, e `digest` dice quale si è misurato.

/// Quanti file ha il vault del banco.
export const TREE_TOTAL = 5_000;

/// Le cinque cartelle di primo livello e quanti file ha ciascuna. La prima è
/// la cartella da milleecinquecento note che il banco apre. In `Bozze` le
/// note della catena (una per livello) sono comprese nel conto.
export const TREE_FOLDERS = [
  ["Archivio", 1_500],
  ["Clienti", 1_204],
  ["Progetti", 1_312],
  ["Diario", 860],
  ["Bozze", 124],
] as const;

/// La cartella che ha la catena di dieci livelli, e i livelli.
const CHAIN_FOLDER = "Bozze";
const CHAIN = Array.from({ length: 10 }, (_, i) => `Livello ${i + 1}`);

/// Un nome di cento caratteri, col titolo del caso S252 del prototipo.
const LONG_TITLE = "Verbale della riunione di condominio di via Roma 12 con le decisioni sul tetto e sulla caldaia";

/// La nota che il banco cerca col lanciatore: a metà del vault, in
/// `Progetti`, con un nome che nessun'altra nota ha.
const TARGET = "Progetti/Nota 03517.md";

export interface TreeFixture {
  /// I file del vault, per path relativo alla radice, col loro testo.
  readonly files: Readonly<Record<string, string>>;
  /// Quanti file: sono `TREE_TOTAL`.
  readonly total: number;
  /// Le cartelle di primo livello, con i file che ci sono dentro.
  readonly folders: readonly { readonly path: string; readonly notes: number }[];
  /// La cartella che il banco apre: quella da milleecinquecento note.
  readonly big: string;
  /// Le dieci cartelle annidate, dalla prima alla decima.
  readonly chain: readonly string[];
  /// La nota in fondo alla catena.
  readonly deepest: string;
  /// La nota col nome lungo.
  readonly longName: string;
  /// La nota che il banco cerca.
  readonly target: string;
  /// FNV-1a del contenuto, in esadecimale: dice quale vault si è misurato.
  readonly digest: string;
}

/// FNV-1a a 32 bit di `text`.
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/// Il vault dei cinquemila file. Lo stesso a ogni chiamata.
export function treeFixture(): TreeFixture {
  const files: Record<string, string> = {};
  const put = (path: string, title: string): void => {
    files[path] = `# ${title}\n\nUna nota del banco dell'albero.\n`;
  };
  const numbered = (serial: number): string => `Nota ${String(serial).padStart(5, "0")}`;
  const chain: string[] = CHAIN.map((_, i) => [CHAIN_FOLDER, ...CHAIN.slice(0, i + 1)].join("/"));
  let serial = 0;
  let deepest = "";
  for (const [folder, notes] of TREE_FOLDERS) {
    // In `Bozze` una nota per livello della catena, e le altre sono piatte: la
    // prima di queste ha il nome lungo.
    const inChain = folder === CHAIN_FOLDER ? CHAIN.length : 0;
    for (let i = 0; i < notes - inChain; i++) {
      serial += 1;
      const title = folder === CHAIN_FOLDER && i === 0 ? LONG_TITLE : numbered(serial);
      put(`${folder}/${title}.md`, title);
    }
    if (folder === CHAIN_FOLDER) {
      CHAIN.forEach((level, i) => {
        if (i < CHAIN.length - 1) {
          const title = `Appunti del ${level.toLowerCase()}`;
          put(`${chain[i]}/${title}.md`, title);
          return;
        }
        serial += 1;
        deepest = `${chain[i]}/${numbered(serial)}.md`;
        put(deepest, numbered(serial));
      });
    }
  }
  const total = Object.keys(files).length;
  if (total !== TREE_TOTAL) throw new RangeError(`il vault del banco ha ${total} file invece di ${TREE_TOTAL}`);
  if (files[TARGET] === undefined) throw new RangeError(`manca la nota «${TARGET}» che il banco cerca`);

  return {
    files,
    total,
    folders: TREE_FOLDERS.map(([path, notes]) => ({ path, notes })),
    big: TREE_FOLDERS[0][0],
    chain,
    deepest,
    longName: `${CHAIN_FOLDER}/${LONG_TITLE}.md`,
    target: TARGET,
    digest: fnv(JSON.stringify(files)),
  };
}
