// Il montaggio comune dei fogli scritti a pezzi: la pelle (`skin/`) e la
// struttura (`structure/`).
//
// In CSS l'ordine di due regole della stessa specificità decide chi vince,
// quindi l'ordine è **dichiarato** da chi chiama e non dedotto dalla cartella;
// e un pezzo scritto ma non elencato non si monta, quindi il montaggio lo
// rifiuta invece di uscire più corto in silenzio.

export interface Pieces {
  /// I pezzi, nell'ordine in cui si montano.
  readonly order: readonly string[];
  /// La testa del file montato, che dice che è generato.
  readonly header: string;
  /// La cartella dei pezzi, relativa a `src/theme/scrittoio/`: va nei filetti.
  readonly folder: string;
  /// Il nome del foglio negli errori («pelle», «struttura»).
  readonly label: string;
  /// Il testo di ogni pezzo, per nome.
  readonly content: Readonly<Record<string, string>>;
}

/// Il filetto che dice da quale pezzo viene ciò che segue.
function rule(folder: string, part: string): string {
  const prefix = `/* ── ${folder}/${part}.css `;
  return `${prefix}${"─".repeat(Math.max(3, 76 - prefix.length))} */\n`;
}

/// Monta un foglio dai suoi pezzi.
export function assemblePieces({ order, header, folder, label, content }: Pieces): string {
  const extraParts = Object.keys(content).filter((name) => !order.includes(name));
  if (extraParts.length > 0) {
    throw new Error(
      `${label}: ${extraParts.map((name) => `«${name}.css»`).join(", ")} non è nell'ordine, e un pezzo ` +
        "fuori dall'ordine non si monta: aggiungilo al punto in cui deve valere.",
    );
  }

  const out = [header];
  for (const part of order) {
    const text = content[part];
    if (text === undefined) throw new Error(`${label}: manca il pezzo «${part}.css»`);
    out.push(`\n${rule(folder, part)}\n${text.replace(/\n+$/, "\n")}`);
  }
  return out.join("");
}
