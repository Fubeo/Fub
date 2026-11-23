// Le sfumature preimpostate della sezione Sfumatura (K6 T15, giro 6): l'elenco, salvare la
// sfumatura mostrata e togliere una salvata passano dal motore, con la famiglia `aspetto`
// (`crates/fub-disegno/src/famiglie/aspetto.rs`). Applicarne una no: è un cambio del disegno, e va dal
// percorso unico dei comandi (`gradient.presets.apply`), col suo passo di Annulla.
//
// - **Dove stanno.** Le preimpostate del motore sono sue; le salvate stanno nelle preferenze del
//   motore, che l'host tiene nell'impostazione `draw.motore`: valgono per tutti i disegni, e il file
//   SVG non cambia. Elencare, salvare e togliere sono letture: niente va nella cronologia.
// - **Mai una richiesta che il motore rifiuta come sbagliata.** Un errore della richiesta ferma la
//   sessione del motore (`motore/sessione.ts`): il nome vuoto, già preso o di una del motore lo
//   controlla la sezione prima (`problemaDelNome`), e qui si toglie solo una salvata dell'elenco.
// - **Il lato.** Il motore salva la sfumatura del colore davanti (`paint.toggleActive`): la porta lo
//   porta davanti, salva, e rimette quello che c'era, perché i tasti del colore (X, /) restino sul lato
//   della sezione Colore.
// - Una lettura per clic (aprire l'elenco, Salva, Elimina): niente per tasto né per fotogramma.

import type { Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { Caricatore } from "./carica";
import type { Lato } from "./colore-sezione";
import type { PuntoSfumatura } from "./sezioni";
import { nomeDellaPreimpostata } from "./sfumature-nomi";

/// Le famiglie che servono: `aspetto` per le preimpostate, `colore` per il lato davanti.
const FAMIGLIE = ["aspetto", "colore"] as const;

/// Quanto una richiesta aspetta la sessione del motore, come in `esegui.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Una preimpostata dell'elenco.
export interface Preimpostata {
  /// Il nome per il motore: quello con cui si applica e si toglie.
  readonly nome: string;
  /// Il tema del motore da cui viene; `null` per una salvata.
  readonly tema: string | null;
  /// Del motore (non si toglie) o salvata.
  readonly delMotore: boolean;
  readonly tipo: "linear" | "radial";
  readonly punti: readonly PuntoSfumatura[];
}

/// L'elenco, o perché non c'è.
export type EsitoElenco = { readonly kind: "pronte"; readonly preimpostate: readonly Preimpostata[] } | { readonly kind: "assente" };

/// Com'è andato Salva o Elimina: `fatto` col nome; `vuoto` se il motore non aveva niente da fare (la
/// sfumatura mostrata non è una sola, la salvata non c'è più); `assente` se il motore non ha risposto.
export type EsitoPreimpostata =
  | { readonly kind: "fatto"; readonly nome: string }
  | { readonly kind: "vuoto" }
  /// Le preferenze del motore (`draw.motore`) vengono da un Fub più nuovo o non si leggono: l'host
  /// rifiuta di salvare o togliere, senza toccare il motore né il disco.
  | { readonly kind: "bloccato"; readonly perche: "nuove" | "rotte" }
  /// Il motore non prende il nome (`bad_args`): la sua frase.
  | { readonly kind: "argomenti"; readonly frase: string }
  | { readonly kind: "assente" };

/// Gli argomenti che il motore non prende (`bad_args`), con la sua frase: una lettura che non è un
/// valore del motore, e non si confonde con uno.
class ArgomentiDelMotore {
  constructor(readonly frase: string) {}
}

/// Il perché del rifiuto dell'host, da `reading` (`{"prefs": "newer" | "broken"}`), o `null`.
function bloccoDi(reading: unknown): "nuove" | "rotte" | null {
  const perche = (reading as { prefs?: unknown } | null | undefined)?.prefs;
  return perche === "newer" ? "nuove" : perche === "broken" ? "rotte" : null;
}

/// La porta delle preimpostate del Completo aperto.
export interface PortaPreimpostate {
  elenco(): Promise<EsitoElenco>;
  /// Salva la sfumatura di `lato` degli oggetti scelti col nome `nome` (già controllato), e rimette
  /// davanti `davanti`.
  salva(nome: string, lato: Lato, davanti: Lato): Promise<EsitoPreimpostata>;
  /// Toglie la salvata `nome`.
  togli(nome: string): Promise<EsitoPreimpostata>;
}

export interface DipendenzePreimpostate {
  readonly motore: MotoreDelDisegno | null;
  readonly carica: Pick<Caricatore, "famiglia">;
  readonly vita: Lifetime;
  /// Gli id della selezione di adesso, dall'editor.
  readonly selezione: () => readonly string[];
}

/// Un canale del motore (da 0 a 1) in due cifre esadecimali.
const canale = (valore: unknown): string =>
  Math.round(Math.min(1, Math.max(0, typeof valore === "number" && Number.isFinite(valore) ? valore : 0)) * 255)
    .toString(16)
    .padStart(2, "0");

/// Un punto della lettura del motore (`color: [r, g, b]` da 0 a 1), o `null` se non si legge.
function puntoDi(valore: unknown): PuntoSfumatura | null {
  if (typeof valore !== "object" || valore === null) return null;
  const { offset, color, opacity } = valore as { offset?: unknown; color?: unknown; opacity?: unknown };
  if (typeof offset !== "number" || !Array.isArray(color) || color.length < 3) return null;
  return {
    offset: Math.min(1, Math.max(0, offset)),
    color: `#${canale(color[0])}${canale(color[1])}${canale(color[2])}`,
    opacity: typeof opacity === "number" ? Math.min(1, Math.max(0, opacity)) : 1,
  };
}

/// Le preimpostate della lettura di `gradient.presets.list`; quelle che non si leggono si saltano.
export function preimpostateDi(lettura: unknown): Preimpostata[] {
  const righe = (lettura as { presets?: unknown } | null)?.presets;
  if (!Array.isArray(righe)) return [];
  const fuori: Preimpostata[] = [];
  for (const riga of righe as unknown[]) {
    if (typeof riga !== "object" || riga === null) continue;
    const { name, library, builtIn, gradient } = riga as { name?: unknown; library?: unknown; builtIn?: unknown; gradient?: unknown };
    if (typeof name !== "string" || name.trim() === "") continue;
    const sfumatura = (gradient ?? {}) as { kind?: unknown; stops?: unknown };
    const punti = Array.isArray(sfumatura.stops) ? sfumatura.stops.map(puntoDi) : [];
    if (punti.length < 2 || punti.some((p) => p === null)) continue;
    fuori.push({
      nome: name,
      tema: typeof library === "string" ? library : null,
      delMotore: builtIn === true,
      tipo: sfumatura.kind === "radial" ? "radial" : "linear",
      punti: punti as PuntoSfumatura[],
    });
  }
  return fuori;
}

/// Che cosa non va nel nome per salvare una preimpostata: vuoto, o già di un'altra (nel nome del motore
/// o in quello mostrato, senza badare alle maiuscole, come il motore). `null` se va bene.
export function problemaDelNome(nome: string, elenco: readonly Preimpostata[]): "vuoto" | "preso" | null {
  const pulito = nome.trim();
  if (pulito === "") return "vuoto";
  const minuscolo = pulito.toLocaleLowerCase();
  const preso = elenco.some(
    (p) => p.nome.trim().toLocaleLowerCase() === minuscolo || nomeDellaPreimpostata(p.nome, p.delMotore).toLocaleLowerCase() === minuscolo,
  );
  return preso ? "preso" : null;
}

/// La porta delle preimpostate sul motore di `dipendenze`.
export function creaPortaPreimpostate(dipendenze: DipendenzePreimpostate): PortaPreimpostate {
  /// La sessione del motore con le famiglie pronte, o `null`.
  const sessione = async () => {
    const motore = dipendenze.motore;
    if (motore === null || motore.assente() !== null || dipendenze.vita.closed) return null;
    const stati = await Promise.all(FAMIGLIE.map((famiglia) => dipendenze.carica.famiglia(famiglia)));
    if (dipendenze.vita.closed || stati.some((stato) => stato.kind !== "pronta")) return null;
    const pronta = await motore.pronta(ATTESA_MOTORE_MS);
    return pronta === null || dipendenze.vita.closed ? null : pronta;
  };
  /// Una lettura del motore: la lettura, `"vuoto"` se il motore non aveva niente da fare,
  /// `ArgomentiDelMotore` se non ne prende gli argomenti, `null` se non ha risposto.
  const leggi = async (
    s: NonNullable<Awaited<ReturnType<typeof sessione>>>,
    id: string,
    value: unknown,
    selection: readonly string[] = [],
  ): Promise<unknown> => {
    const esito = await s.comando({ id: `disegno.${id}`, selection: [...selection], value, preview: false });
    if (esito === null || dipendenze.vita.closed) return null;
    if ("kind" in esito) return esito.kind === "argomenti" ? new ArgomentiDelMotore(esito.message) : null;
    if (esito.refused !== null) {
      const perche = bloccoDi(esito.reading);
      return perche === null ? "vuoto" : { bloccato: perche };
    }
    return esito.reading ?? "vuoto";
  };
  const nomeDi = (lettura: unknown, campo: "name" | "deleted"): EsitoPreimpostata => {
    if (lettura === null) return { kind: "assente" };
    if (lettura instanceof ArgomentiDelMotore) return { kind: "argomenti", frase: lettura.frase };
    const perche = (lettura as { bloccato?: "nuove" | "rotte" }).bloccato;
    if (perche !== undefined) return { kind: "bloccato", perche };
    const nome = (lettura as Record<string, unknown> | "vuoto")[campo as never] as unknown;
    return typeof nome === "string" ? { kind: "fatto", nome } : { kind: "vuoto" };
  };
  return {
    async elenco() {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      const lettura = await leggi(s, "gradient.presets.list", {});
      if (lettura === null || lettura === "vuoto" || lettura instanceof ArgomentiDelMotore) return { kind: "assente" };
      return { kind: "pronte", preimpostate: preimpostateDi(lettura) };
    },
    async salva(nome, lato, davanti) {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      const selezione = dipendenze.selezione();
      if ((await leggi(s, "paint.toggleActive", { fill: lato === "fill" })) === null) return { kind: "assente" };
      const lettura = await leggi(s, "gradient.presets.save", { name: nome.trim() }, selezione);
      if (lato !== davanti && !dipendenze.vita.closed) await leggi(s, "paint.toggleActive", { fill: davanti === "fill" });
      return nomeDi(lettura, "name");
    },
    async togli(nome) {
      const s = await sessione();
      if (s === null) return { kind: "assente" };
      return nomeDi(await leggi(s, "gradient.presets.delete", { name: nome }), "deleted");
    },
  };
}
