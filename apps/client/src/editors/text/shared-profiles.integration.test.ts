// @vitest-environment happy-dom
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { TextEngine } from "./engine";
import {
  mountSharedProfiles,
  PROFILE_CASES,
  type MountedProfile,
  type SharedProfilesFixture,
} from "./__fixtures__/shared-profiles";

function hasSyntaxNode(view: EditorView, name: string): boolean {
  let found = false;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === name) found = true;
    },
  });
  return found;
}

function runKey(view: EditorView, key: string, handled: () => boolean): void {
  const bindings = view.state.facet(keymap).flat().filter((candidate) => candidate.key === key);
  if (bindings.length === 0) throw new Error(`il comando ${key} non è montato`);
  for (const binding of bindings) {
    binding.run?.(view);
    if (handled()) return;
  }
  expect(handled()).toBe(true);
}

function exerciseGenericCapabilities(surface: MountedProfile): void {
  surface.engine.setDoc("base");
  expect(surface.engine.getDoc()).toBe("base");

  const view = surface.view();
  view.dispatch({ selection: EditorSelection.range(1, 3) });
  expect(surface.engine.selections().primary).toEqual({ start: 1, end: 3, text: "as" });

  view.dispatch({
    changes: { from: 0, to: 0, insert: "X" },
    userEvent: "input.type",
  });
  expect(surface.engine.getDoc()).toBe("Xbase");

  surface.engine.syncDoc("Xbase?");
  expect(surface.engine.getDoc()).toBe("Xbase?");
  expect(surface.engine.undo()).toBe(true);
  expect(surface.engine.getDoc()).toBe("base?");

  surface.engine.setTheme("dark");
  expect(view.state.facet(EditorView.darkTheme)).toBe(true);
}

function assertDomainDifferences(fixture: SharedProfilesFixture): void {
  const markdown = fixture.markdown;
  markdown.engine.setDoc("**titolo**\ncorpo");
  const markdownView = markdown.view();
  markdownView.dispatch({ selection: EditorSelection.cursor(markdownView.state.doc.length) });
  expect(hasSyntaxNode(markdownView, "StrongEmphasis")).toBe(true);
  expect(markdownView.dom.querySelector(".cm-fub-strong")).not.toBeNull();

  const plain = fixture.plain;
  const literal = "[[Nota]] #tag **titolo**";
  plain.engine.setDoc(literal);
  expect(plain.engine.getDoc()).toBe(literal);
  expect(hasSyntaxNode(plain.view(), "StrongEmphasis")).toBe(false);
  expect(plain.view().dom.querySelector("[class*='cm-fub-']")).toBeNull();

  const formula = fixture.formula;
  formula.engine.setDoc("=A1");
  const formulaView = formula.view();
  formulaView.dispatch({ selection: EditorSelection.cursor(formulaView.state.doc.length) });
  formulaView.dispatch({
    changes: { from: formulaView.state.doc.length, insert: "\n+B2" },
    userEvent: "input.type",
  });
  expect(formula.engine.getDoc()).toBe("=A1+B2");
  expect(formula.engine.getDoc()).not.toContain("\n");
  expect(hasSyntaxNode(formulaView, "formulaReference")).toBe(true);

  expect(fixture.events.markdown.wikilinks).toEqual([]);
  expect(fixture.events.markdown.tags).toEqual([]);
  expect(fixture.events.markdown.notePrefixes).toEqual([]);
  expect(fixture.events.markdown.tagCompletionRequests).toEqual([]);
  expect(fixture.events.formula.functionPrefixes).toEqual([]);
  expect(fixture.events.formula.sheetPrefixes).toEqual([]);
  expect(fixture.events.formula.namePrefixes).toEqual([]);

  runKey(formulaView, "Escape", () => fixture.events.formula.cancels.length > 0);
  runKey(formulaView, "Enter", () => fixture.events.formula.commits.length > 0);
  expect(fixture.events.formula.cancels).toEqual(["=A1+B2"]);
  expect(fixture.events.formula.commits).toEqual(["=A1+B2"]);
}

describe.each(PROFILE_CASES)("TextEngine con i profili reali", ({ key, label }) => {
  it(`monta contemporaneamente Markdown, PlainText e Formula e isola ${label}`, () => {
    const fixture = mountSharedProfiles();
    try {
      const surfaces = PROFILE_CASES.map(({ key: profileKey }) => fixture.surfaces[profileKey]);
      expect(new Set(surfaces.map((surface) => surface.parent)).size).toBe(3);
      for (const surface of surfaces) {
        expect(surface.engine).toBeInstanceOf(TextEngine);
        expect(surface.view()).toBeInstanceOf(EditorView);
      }

      exerciseGenericCapabilities(fixture.surfaces[key]);
      assertDomainDifferences(fixture);

      const selected = fixture.surfaces[key];
      const peers = PROFILE_CASES.filter(({ key: peerKey }) => peerKey !== key).map(
        ({ key: peerKey }) => fixture.surfaces[peerKey],
      );
      const peerDocs = peers.map((peer) => ({ peer, text: peer.engine.getDoc() }));

      selected.engine.destroy();
      expect(EditorView.findFromDOM(selected.parent)).toBeNull();
      for (const { peer, text } of peerDocs) {
        expect(EditorView.findFromDOM(peer.parent)).not.toBeNull();
        expect(peer.engine.getDoc()).toBe(text);
      }
    } finally {
      fixture.destroy();
    }
  });
});
