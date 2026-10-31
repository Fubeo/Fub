import { Facet } from "@codemirror/state";

/// Quanto della sintassi Markdown si vede in Live (impostazione
/// `editor.live-reveal`). `mai` scrive come in Word: i segni non si vedono,
/// nemmeno col cursore dentro, e lo stato si legge nella barra. `elemento`
/// mostra i segni degli elementi che contengono il cursore e il prefisso di un
/// blocco col cursore nel prefisso. `riga` mostra ogni segno della riga del
/// cursore. Una faccetta, come `propertiesDisplay`: il motore la cambia in un
/// compartimento, così selezione e undo restano. Vince il valore di
/// precedenza più alta: i Blocchi lo fissano a `mai` sopra le Preferenze.
export type RevealPolicy = "mai" | "elemento" | "riga";

export const liveReveal = Facet.define<RevealPolicy, RevealPolicy>({
  combine: (values) => values[0] ?? "mai",
});

export function revealPolicyOf(value: unknown): RevealPolicy {
  return value === "elemento" || value === "riga" ? value : "mai";
}

/// La guida della Live (impostazione `editor.live-guide`, accesa): lo stile in
/// sospeso, la chiusura in grigio e lo spazio che chiude apice e pedice
/// (`profiles/markdown/pending.ts`). Spenta, un segno resta testo finché non
/// si chiude.
export const liveGuide = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});
