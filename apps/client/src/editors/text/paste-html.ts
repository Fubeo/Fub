import { Facet } from "@codemirror/state";

/// Se l'HTML incollato si converte in Markdown (impostazione
/// `editor.paste-html`). Spenta, entra il testo semplice degli appunti.
export const pasteHtml = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});
