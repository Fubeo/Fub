// **La forma delle regole pure del banco dell'accessibilità, dal lato dei
// tipi.**
//
// Come `large-rules.d.mts`: `a11y-rules.mjs` gira in Node, il suo presidio
// (`a11y-rules.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata.

export interface Look {
  background: string;
  backgroundImage?: string;
  border?: string;
  outline?: string;
  boxShadow?: string;
}

export interface ActiveRow {
  exists: boolean;
  look?: Look;
  otherLook?: Look | null;
  highlight?: { hidden: boolean; look: Look; sameSize: boolean } | null;
}

export interface ComboboxFacts {
  tag: string;
  role: string | null;
  focusVisible: boolean;
  readOnly: boolean;
  disabled: boolean;
  caretColor: string;
  color: string;
  width: number;
  height: number;
  visibility: string;
  controls: string | null;
  dialog: { modal: string | null } | null;
  descendant: ActiveRow | null;
}

export declare function alpha(color: string): number | null;

export declare function modalComboboxGap(facts: ComboboxFacts | null): string | null;

export interface FrameAfter {
  content: string;
  display: string;
  position: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}

export interface EditorFrameFacts {
  focusVisible: boolean;
  frame: boolean;
  after: FrameAfter | null;
}

export declare function editorFrameRingGap(facts: EditorFrameFacts | null): string | null;
