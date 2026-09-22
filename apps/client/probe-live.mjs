import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { computeDecorations } from "./src/editors/text/profiles/markdown/livepreview.ts";
