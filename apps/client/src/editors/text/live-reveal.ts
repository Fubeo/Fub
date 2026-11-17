import { Facet } from "@codemirror/state";

/// Quanto della sintassi Markdown si vede in Live (impostazione
/// `editor.live-reveal`). `mai` scrive come in Word: i segni non si vedono,
/// nemmeno col cursore dentro, e lo stato si legge nella barra. `elemento`
/// mostra i segni degli elementi che contengono il cursore e il prefisso di un
/// blocco col cursore nel prefisso. `riga` mostra ogni segno della riga del
/// cursore. Una faccetta, come `propertiesDisplay`: il motore la cambia in un
/// compartimento, così selezione e undo restano. Vince il valore di
/// precedenza più alta. In Scrittura, coi Blocchi dentro, vale la preferenza.
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

/// Le formule di Scrittura mostrano il loro LaTeX (impostazione
/// `editor.math.source`, spenta di serie): accesa, la formula toccata ha sotto
/// di sé il campo del suo LaTeX, e il clic sulla formula porta soltanto agli
/// spazi vuoti (T63). Vince un valore acceso qualunque.
/// Le chiavi delle due preferenze delle formule (le possiede il programma,
/// `crates/fub-host/src/settings.rs`): le scrivono anche i tre puntini del
/// riquadro.
export const MATH_SOURCE_SETTING = "editor.math.source";
export const MATH_HELP_SETTING = "editor.math.help";

export const mathSource = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/// Le formule restano com'erano prima della formula che si modifica toccandola
/// (T60): il clic apre il riquadro col TeX e un blocco `$$` toccato mostra la
/// sorgente col disegno sotto. La accendono i tasti di Vim, che restano
/// com'erano. Vince un valore acceso qualunque.
export const mathClassic = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/// Quanto aiuta il campo del LaTeX (impostazione `editor.math.help`, T63).
/// `piene`: parentesi che si chiudono, completamento dopo `\`, scrittura
/// veloce e tavolozza; `discrete`: parentesi e completamento, la tavolozza a
/// richiesta; `spente`: il LaTeX e la sua anteprima, nient'altro. Senza il
/// campo (la formula che si tocca) gli aiuti sono sempre pieni.
export type MathHelp = "piene" | "discrete" | "spente";

export const MATH_HELP_LEVELS: readonly MathHelp[] = ["piene", "discrete", "spente"];

export const mathHelp = Facet.define<MathHelp, MathHelp>({
  combine: (values) => values[0] ?? "piene",
});

/// Un valore letto dalle impostazioni: uno che non conosco vale `piene`, il
/// valore di serie.
export function mathHelpOf(value: unknown): MathHelp {
  return value === "discrete" || value === "spente" ? value : "piene";
}
