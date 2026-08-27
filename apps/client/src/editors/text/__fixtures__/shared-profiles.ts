import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createTextEngine,
  type EditorChange,
  type TextEngine,
} from "../engine";
import {
  createFormulaProfile,
  type FormulaProfile,
} from "../profiles/formula";
import {
  createMarkdownProfile,
  type MarkdownProfile,
} from "../profiles/markdown/profile";
import {
  createPlainTextProfile,
  type PlainTextProfile,
} from "../profiles/plain-text";

export type SharedProfileKey = "markdown" | "plain" | "formula";

type TextProfile = { extensions(): Extension };

export const PROFILE_CASES = [
  { key: "markdown", label: "Markdown" },
  { key: "plain", label: "PlainText" },
  { key: "formula", label: "Formula" },
] as const satisfies readonly { key: SharedProfileKey; label: string }[];

export interface ProfileCallbackEvents {
  readonly markdown: {
    readonly wikilinks: Array<{
      page: string;
      heading: string | null;
      block: string | null;
    }>;
    readonly tags: string[];
    readonly notePrefixes: string[];
    readonly tagCompletionRequests: number[];
  };
  readonly formula: {
    readonly commits: string[];
    readonly cancels: string[];
    readonly functionPrefixes: string[];
    readonly sheetPrefixes: string[];
    readonly namePrefixes: string[];
  };
}

export interface MountedProfile<P extends TextProfile = TextProfile> {
  readonly profile: P;
  readonly engine: TextEngine;
  readonly parent: HTMLElement;
  readonly changes: EditorChange[];
  view(): EditorView;
}

export interface SharedProfilesFixture {
  readonly markdown: MountedProfile<MarkdownProfile>;
  readonly plain: MountedProfile<PlainTextProfile>;
  readonly formula: MountedProfile<FormulaProfile>;
  readonly surfaces: {
    readonly markdown: MountedProfile<MarkdownProfile>;
    readonly plain: MountedProfile<PlainTextProfile>;
    readonly formula: MountedProfile<FormulaProfile>;
  };
  readonly events: ProfileCallbackEvents;
  destroy(): void;
}

function mount<P extends TextProfile>(profile: P, changes: EditorChange[]): MountedProfile<P> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const engine = createTextEngine(parent, {
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
    theme: "light",
  });
  return {
    profile,
    engine,
    parent,
    changes,
    view() {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

export function mountSharedProfiles(): SharedProfilesFixture {
  const events: ProfileCallbackEvents = {
    markdown: {
      wikilinks: [],
      tags: [],
      notePrefixes: [],
      tagCompletionRequests: [],
    },
    formula: {
      commits: [],
      cancels: [],
      functionPrefixes: [],
      sheetPrefixes: [],
      namePrefixes: [],
    },
  };

  const markdown = createMarkdownProfile({
    callbacks: {
      openWikilink: (page, heading, block) => {
        events.markdown.wikilinks.push({ page, heading, block });
      },
      searchTag: (tag) => {
        events.markdown.tags.push(tag);
      },
    },
    completions: {
      searchNotes: async (prefix) => {
        events.markdown.notePrefixes.push(prefix);
        return ["Alpha.md"];
      },
      listTags: async () => {
        events.markdown.tagCompletionRequests.push(1);
        return [{ name: "area/lavoro", count: 1 }];
      },
    },
  });
  const plain = createPlainTextProfile();
  const formula = createFormulaProfile({
    singleLine: true,
    completions: {
      functions: (prefix) => {
        events.formula.functionPrefixes.push(prefix);
        return ["SUM"];
      },
      sheets: (prefix) => {
        events.formula.sheetPrefixes.push(prefix);
        return ["Budget 2026"];
      },
      names: (prefix) => {
        events.formula.namePrefixes.push(prefix);
        return ["taxRate"];
      },
    },
    callbacks: {
      commit: (value) => {
        events.formula.commits.push(value);
      },
      cancel: (value) => {
        events.formula.cancels.push(value);
      },
    },
  });

  const markdownChanges: EditorChange[] = [];
  const plainChanges: EditorChange[] = [];
  const formulaChanges: EditorChange[] = [];
  const surfaces = {
    markdown: mount(markdown, markdownChanges),
    plain: mount(plain, plainChanges),
    formula: mount(formula, formulaChanges),
  };

  return {
    ...surfaces,
    surfaces,
    events,
    destroy() {
      for (const surface of Object.values(surfaces)) {
        surface.engine.destroy();
        surface.parent.remove();
      }
    },
  };
}
