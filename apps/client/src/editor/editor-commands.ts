// Compatibilità temporanea per i chiamanti dell'editor Markdown corrente.
//
// I comandi condivisi vivono in `editors/text/commands.ts`; i gesti che
// interpretano la sintassi vivono nel profilo Markdown. Questo entry point
// mantiene soltanto i nomi storici finché l'adapter in `editor.ts` viene
// sostituito dal profilo.
export { duplicateLines } from "../editors/text/commands";
export {
  autoPairDecision,
  dedentListItem,
  indentListItem,
  obsidianKeymap,
  smartListEnter,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleWikilink,
} from "../editors/text/profiles/markdown/commands";
export type { PairDecision } from "../editors/text/profiles/markdown/commands";
export { markdownEditingExtensions as editingExtensions } from "../editors/text/profiles/markdown/commands";
