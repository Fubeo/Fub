// Le frasi di CodeMirror nella lingua della shell (§12.4).
//
// I pannelli di CodeMirror (trova e sostituisci, vai alla riga, ripiegamento,
// completamenti, diagnostica) scrivono in inglese finché lo stato non porta
// `EditorState.phrases`: qui la chiave inglese che CodeMirror chiede incontra
// la stringa del catalogo della shell. `$` resta il segnaposto di CodeMirror.
import { EditorState, type Extension } from "@codemirror/state";
import { t, type Key } from "../../i18n/strings";

const PHRASES: Readonly<Record<string, Key>> = {
  "Find": "editor.cm.find",
  "Replace": "editor.cm.replace_field",
  "next": "editor.cm.next",
  "previous": "editor.cm.previous",
  "all": "editor.cm.all",
  "match case": "editor.cm.match_case",
  "by word": "editor.cm.by_word",
  "regexp": "editor.cm.regexp",
  "replace": "editor.cm.replace",
  "replace all": "editor.cm.replace_all",
  "close": "editor.cm.close",
  "current match": "editor.cm.current_match",
  "replaced $ matches": "editor.cm.replaced_all",
  "replaced match on line $": "editor.cm.replaced_line",
  "on line": "editor.cm.on_line",
  "Go to line": "editor.cm.goto",
  "go": "editor.cm.go",
  "Selection deleted": "editor.cm.selection_deleted",
  "folded code": "editor.cm.folded_code",
  "unfold": "editor.cm.unfold",
  "Folded lines": "editor.cm.folded_lines",
  "Unfolded lines": "editor.cm.unfolded_lines",
  "Fold line": "editor.cm.fold_line",
  "Unfold line": "editor.cm.unfold_line",
  "to": "editor.cm.to",
  "Completions": "editor.cm.completions",
  "Diagnostics": "editor.cm.diagnostics",
  "No diagnostics": "editor.cm.no_diagnostics",
  "Control character": "editor.cm.control_character",
};

/// Le frasi nella lingua corrente; si rifanno quando la lingua cambia.
export function editorPhrases(): Extension {
  const out: Record<string, string> = {};
  for (const [phrase, key] of Object.entries(PHRASES)) out[phrase] = t(key);
  return EditorState.phrases.of(out);
}

/// Le frasi che CodeMirror chiede e questa tabella traduce: per il test.
export const TRANSLATED_PHRASES: readonly string[] = Object.keys(PHRASES);
