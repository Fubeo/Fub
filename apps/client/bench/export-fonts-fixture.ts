// I caratteri del vault della scena «esporta-pdf-caratteri» (T72,
// `?esporta-caratteri=1`): tre famiglie nella cartella «Caratteri», una col
// corsivo, una senza, una che la licenza non lascia incorporare. Il finto
// non sa leggere un carattere: il comando `pdf.vault_fonts` risponde qui, e
// i byte sono due caratteri dell'app (JetBrains Mono e Inter) scritti nel
// vault alla prima domanda, perché i pulsanti si vedano nel loro carattere.

import type { VaultFontList } from "../src/export/sections/fonts";

/// Il comando del core che elenca i caratteri del vault per la stampa.
export const VAULT_FONTS_COMMAND = "pdf.vault_fonts";
const VAULT_FONTS_NS = "fub.pdf.vault_fonts";

const FILES: readonly (readonly [string, string])[] = [
  ["Caratteri/Macchina.woff2", "/fonts/jetbrains-mono-latin-wght-normal.woff2"],
  ["Caratteri/Macchina Corsivo.woff2", "/fonts/jetbrains-mono-latin-wght-italic.woff2"],
  ["Caratteri/Diritta.woff2", "/fonts/inter-latin-wght-normal.woff2"],
];

export const EXPORT_FONTS: VaultFontList = {
  caratteri: [
    {
      famiglia: "Diritta",
      file: "Caratteri/Diritta.woff2",
      facce: [{ file: "Caratteri/Diritta.woff2", corsivo: false, pesi: [100, 900], incorporabile: true }],
      corsivo: false,
      incorporabile: true,
    },
    {
      famiglia: "Macchina",
      file: "Caratteri/Macchina.woff2",
      facce: [
        { file: "Caratteri/Macchina Corsivo.woff2", corsivo: true, pesi: [100, 800], incorporabile: true },
        { file: "Caratteri/Macchina.woff2", corsivo: false, pesi: [100, 800], incorporabile: true },
      ],
      corsivo: true,
      incorporabile: true,
    },
    {
      famiglia: "Riservata",
      file: "Caratteri/Riservata.otf",
      facce: [{ file: "Caratteri/Riservata.otf", corsivo: false, pesi: [400, 400], incorporabile: false }],
      corsivo: false,
      incorporabile: false,
    },
  ],
  illeggibili: [],
  tralasciati: 0,
};

/// Scrive i file della scena nel vault finto, una volta sola.
export function exportFontsWriter(write: (id: string, bytes: Uint8Array) => Promise<unknown>): () => Promise<void> {
  let done: Promise<void> | null = null;
  return () => {
    done ??= (async () => {
      for (const [id, url] of FILES) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`banco: ${url} non si legge (${response.status})`);
        await write(id, new Uint8Array(await response.arrayBuffer()));
      }
    })();
    return done;
  };
}

/// La risposta del comando, com'è quella del core.
export function exportFontsOutcome() {
  return { notify: null, effect: { kind: "custom" as const, ns: VAULT_FONTS_NS, payload: EXPORT_FONTS }, undo: null, partial: null };
}
