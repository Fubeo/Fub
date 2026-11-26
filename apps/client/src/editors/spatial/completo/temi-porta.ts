// La porta dei temi del colore nel pannello «Temi di colore» della scheda Risorse (K6 T14, temi): la
// lista, Salva tema dai colori scelti e Togli tema passano dal motore, con la famiglia `colore`
// (`crates/fub-disegno/src/famiglie/colore.rs`). Niente salvataggio nuovo: la libreria sta nelle
// preferenze del motore (`draw.motore`), che l'host salva da sé dopo ogni comando.
//
// - **Letture, non passi.** Elencare, salvare e togliere un tema sono letture: il file del disegno non
//   cambia e non c'è un passo d'annulla.
// - **Mai una richiesta che il motore rifiuta come sbagliata.** Un errore della richiesta ferma la
//   sessione del motore (`motore/sessione.ts`): il nome vuoto o già preso, e il tema che non c'è, li
//   controlla il pannello prima (`problemaDelTema`), come le sfumature.

import type { Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { Caricatore } from "./carica";

/// Quanto una richiesta aspetta la sessione del motore, come in `esegui.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Un tema della libreria: il nome e i colori `#rrggbb`, nell'ordine in cui il motore li tiene.
export interface Tema {
  readonly nome: string;
  readonly colori: readonly string[];
}

/// La lista dei temi, o perché non c'è (il motore non risponde).
export type EsitoTemi = { readonly kind: "pronti"; readonly temi: readonly Tema[] } | { readonly kind: "assente" };

/// Com'è andato Salva o Togli: `fatto` col nome; `rifiuto` se il motore non ha fatto niente;
/// `argomenti` se il motore non prende il nome o i colori, con la sua frase; `assente` se non ha
/// risposto.
export type EsitoTema =
  | { readonly kind: "fatto"; readonly nome: string }
  | { readonly kind: "rifiuto" }
  | { readonly kind: "argomenti"; readonly frase: string }
  | { readonly kind: "assente" };

/// La porta dei temi del pannello.
export interface PortaTemi {
  elenco(): Promise<EsitoTemi>;
  /// Salva un tema col nome `nome` (già controllato) e i colori `colori` (`#rrggbb`).
  salva(nome: string, colori: readonly string[]): Promise<EsitoTema>;
  /// Toglie il tema `nome` (che c'è nell'elenco di adesso).
  togli(nome: string): Promise<EsitoTema>;
}

export interface DipendenzeTemi {
  readonly motore: MotoreDelDisegno | null;
  readonly carica: Pick<Caricatore, "famiglia">;
  readonly vita: Lifetime;
}

/// I temi di una lettura di `colorTheme.list`; quelli che non si leggono si saltano.
export function temiDi(lettura: unknown): Tema[] {
  const righe = (lettura as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(righe)) return [];
  const fuori: Tema[] = [];
  for (const riga of righe as unknown[]) {
    if (typeof riga !== "object" || riga === null) continue;
    const { name, colors } = riga as { name?: unknown; colors?: unknown };
    if (typeof name !== "string" || name.trim() === "") continue;
    if (!Array.isArray(colors) || !colors.every((c) => typeof c === "string")) continue;
    fuori.push({ nome: name, colori: colors as string[] });
  }
  return fuori;
}

/// Che cosa non va nel nome per salvare un tema: vuoto, o già di un altro tema (senza badare alle
/// maiuscole, come il motore). `null` se va bene.
export function problemaDelTema(nome: string, temi: readonly Tema[]): "vuoto" | "preso" | null {
  const pulito = nome.trim();
  if (pulito === "") return "vuoto";
  const minuscolo = pulito.toLocaleLowerCase();
  return temi.some((tema) => tema.nome.trim().toLocaleLowerCase() === minuscolo) ? "preso" : null;
}

/// La porta dei temi sul motore di `dipendenze`.
export function creaPortaTemi(dipendenze: DipendenzeTemi): PortaTemi {
  /// La sessione del motore con la famiglia `colore` pronta, o `null`.
  const sessione = async () => {
    const motore = dipendenze.motore;
    if (motore === null || motore.assente() !== null || dipendenze.vita.closed) return null;
    const stato = await dipendenze.carica.famiglia("colore");
    if (dipendenze.vita.closed || stato.kind !== "pronta") return null;
    const pronta = await motore.pronta(ATTESA_MOTORE_MS);
    return pronta === null || dipendenze.vita.closed ? null : pronta;
  };
  return {
    async elenco() {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      const esito = await s.comando({ id: "disegno.colorTheme.list", selection: [], value: {}, preview: false });
      if (esito === null || "kind" in esito || dipendenze.vita.closed || esito.refused !== null) return { kind: "assente" };
      return { kind: "pronti", temi: temiDi(esito.reading) };
    },
    async salva(nome, colori) {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      const esito = await s.comando({ id: "disegno.colorTheme.save", selection: [], value: { name: nome.trim(), colors: [...colori] }, preview: false });
      if (esito === null || dipendenze.vita.closed) return { kind: "assente" };
      if ("kind" in esito) return esito.kind === "argomenti" ? { kind: "argomenti", frase: esito.message } : { kind: "assente" };
      if (esito.refused !== null) return { kind: "rifiuto" };
      const salvato = (esito.reading as { name?: unknown } | null)?.name;
      return typeof salvato === "string" ? { kind: "fatto", nome: salvato } : { kind: "rifiuto" };
    },
    async togli(nome) {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      const esito = await s.comando({ id: "disegno.colorTheme.delete", selection: [], value: { name: nome }, preview: false });
      if (esito === null || dipendenze.vita.closed) return { kind: "assente" };
      if ("kind" in esito) return esito.kind === "argomenti" ? { kind: "argomenti", frase: esito.message } : { kind: "assente" };
      if (esito.refused !== null) return { kind: "rifiuto" };
      const tolto = (esito.reading as { deleted?: unknown } | null)?.deleted;
      return typeof tolto === "string" ? { kind: "fatto", nome: tolto } : { kind: "rifiuto" };
    },
  };
}
