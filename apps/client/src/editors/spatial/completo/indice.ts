// L'indice dei comandi del Disegno completo (piano K6, T5;
// `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// Che cosa c'è e dove, senza un elenco scritto a mano: `indice.generated.json`
// lo scrive `crates/fub-disegno/tests/ts_indice.rs` dalla mappa del motore,
// una voce per riga fatta e una per riga di Fub che ha un posto. Il JSON
// arriva con un `import()`, una volta sola: Vite lo mette con questo file
// nel chunk `drawing-indice`, che nessuna pagina carica all'avvio.

/// Da dove viene una voce: un comando del motore, uno strumento, un effetto,
/// o un pezzo dell'interfaccia di Fub.
export type FonteVoce = "motore" | "interfaccia" | "effetto" | "strumento" | "pannello";

/// Che cosa fa una voce al disegno: lo cambia, lo legge, o cambia solo la vista.
export type EffettoVoce = "cambia" | "legge" | "mostra";

/// Come si chiama una voce: un comando dell'host (col suo valore fisso, per un
/// effetto), uno strumento del motore, o un pezzo del client.
export type ChiamataVoce =
  | { readonly comando: string; readonly valore?: unknown }
  | { readonly strumento: string }
  | { readonly client: string };

export interface VoceIndice {
  readonly fonte: FonteVoce;
  readonly id: string;
  readonly chiamata: ChiamataVoce;
  readonly etichetta: { readonly it: string; readonly en: string };
  /// `scheda/gruppo` (per esempio `ispettore/design`).
  readonly posto: string;
  /// Una delle `DRAWING_FAMILIES`.
  readonly famiglia: string;
  /// Il tasto del motore, come lo scrive il motore: `Cmd+K`, `Cmd+Shift+]`,
  /// `Ctrl+/` (`Cmd` è il tasto di Fub, `Mod`; `Ctrl` resta Control). `null`:
  /// nessuno. Lo porta nella forma della shell (`Mod-k`) `tastoFub` in `tasti.ts`.
  readonly tasto: string | null;
  readonly effetto: EffettoVoce;
  /// Se la voce apre una finestra (lo schema è nella sua famiglia).
  readonly finestra: boolean;
  /// La feature del motore senza cui la voce non c'è.
  readonly sotto?: string;
}

/// Il file generato, com'è su disco.
export interface FileIndice {
  readonly voci: readonly VoceIndice[];
}

export interface Indice {
  readonly voci: readonly VoceIndice[];
  /// Le voci di un posto (`scheda/gruppo`), o di una scheda intera
  /// (`scheda`), nell'ordine dell'indice.
  perPosto(posto: string): readonly VoceIndice[];
  perFamiglia(famiglia: string): readonly VoceIndice[];
  /// Le voci la cui etichetta (italiana o inglese), id o tasto contengono
  /// ogni parola di `testo`, senza badare a maiuscole e accenti. Un testo
  /// vuoto non trova niente.
  cerca(testo: string): readonly VoceIndice[];
}

/// Le lettere senza accenti e minuscole, per cercare «modifica» e trovare
/// «Modìfica».
function piana(testo: string): string {
  return testo.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// L'indice sopra le voci di un file.
export function indiceDi(file: FileIndice): Indice {
  const voci = file.voci;
  const perPosto = new Map<string, VoceIndice[]>();
  const perFamiglia = new Map<string, VoceIndice[]>();
  const aggiungi = (mappa: Map<string, VoceIndice[]>, chiave: string, voce: VoceIndice) => {
    const gia = mappa.get(chiave);
    if (gia) gia.push(voce);
    else mappa.set(chiave, [voce]);
  };
  for (const voce of voci) {
    aggiungi(perPosto, voce.posto, voce);
    const scheda = voce.posto.split("/")[0];
    if (scheda && scheda !== voce.posto) aggiungi(perPosto, scheda, voce);
    aggiungi(perFamiglia, voce.famiglia, voce);
  }
  const testi = voci.map((voce) => piana([voce.etichetta.it, voce.etichetta.en, voce.id, voce.tasto ?? ""].join("\n")));
  return {
    voci,
    perPosto: (posto) => perPosto.get(posto) ?? [],
    perFamiglia: (famiglia) => perFamiglia.get(famiglia) ?? [],
    cerca(testo) {
      const parole = piana(testo).split(/\s+/).filter(Boolean);
      if (parole.length === 0) return [];
      return voci.filter((_, i) => parole.every((parola) => testi[i].includes(parola)));
    },
  };
}

/// Chi porta il file dell'indice: di serie l'`import()` del JSON generato.
export type CaricaIndice = () => Promise<FileIndice>;

/// `indice()` con un caricatore suo: una sola `import()` per tutte le
/// chiamate finché riesce; se fallisce, chi aspetta riceve l'errore e la
/// chiamata dopo («Riprova») ci prova di nuovo.
export function creaIndice(carica: CaricaIndice): () => Promise<Indice> {
  let promessa: Promise<Indice> | null = null;
  return () => {
    if (promessa) return promessa;
    const questa = carica().then(indiceDi);
    promessa = questa;
    questa.catch(() => {
      if (promessa === questa) promessa = null;
    });
    return questa;
  };
}

/// L'indice dei comandi del Completo, memorizzato.
export const indice: () => Promise<Indice> = creaIndice(
  () => import("./indice.generated.json").then((m) => m.default as unknown as FileIndice),
);
