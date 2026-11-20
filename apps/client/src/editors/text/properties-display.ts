import { Facet } from "@codemirror/state";

/// Come Live mostra il frontmatter (impostazione `editor.properties`):
/// `visible` è una tabella di proprietà, `hidden` una riga che si apre,
/// `source` lo YAML di sempre. Una faccetta, come `smartLists`: il motore la
/// cambia in un compartimento e il profilo Markdown la legge dallo stato.
export type PropertiesDisplay = "visible" | "hidden" | "source";

export const propertiesDisplay = Facet.define<PropertiesDisplay, PropertiesDisplay>({
  combine: (values) => (values.length ? values[values.length - 1]! : "source"),
});

/// Il valore dell'impostazione; uno che manca, o che non è dei tre, vale il
/// default dell'host (`visible`, `crates/fub-host/src/settings.rs`). La
/// faccetta senza nessun valore resta `source`: un editor che non la
/// configura (un campo di testo, una prova) mostra lo YAML.
export function propertiesDisplayOf(value: unknown): PropertiesDisplay {
  return value === "hidden" || value === "source" ? value : "visible";
}
