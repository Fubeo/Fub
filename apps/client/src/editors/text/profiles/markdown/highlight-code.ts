import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { Race } from "../../../../ui/race";
import type { Teardown } from "../../../../ui/lifetime";

/** The editing and rendered surfaces load the same language descriptions. */
export function highlightMarkdownCode(container: HTMLElement): Teardown {
  const race = new Race();
  void race.last(async (expected) => {
    await Promise.all(Array.from(container.querySelectorAll<HTMLElement>("pre > code")).map(async (code) => {
      if (code.closest("[data-ui-slot]")) return;
      const languageName = Array.from(code.classList).find((name) => name.startsWith("language-"))?.slice(9);
      if (!languageName || languageName.toLowerCase() === "mermaid") return;
      const description = LanguageDescription.matchLanguageName(languages, languageName, true);
      if (!description) return;
      const support = await expected(description.load().catch(() => null));
      // A missing optional language chunk leaves readable, unmodified code.
      if (!support) return;
      const source = code.textContent ?? "";
      const fragment = document.createDocumentFragment();
      let previous = 0;
      highlightTree(support.language.parser.parse(source), classHighlighter, (from, to, classes) => {
        if (from > previous) fragment.append(document.createTextNode(source.slice(previous, from)));
        const span = document.createElement("span");
        span.className = classes;
        span.textContent = source.slice(from, to);
        fragment.append(span);
        previous = to;
      });
      if (previous < source.length) fragment.append(document.createTextNode(source.slice(previous)));
      code.replaceChildren(fragment);
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }));
  });
  return () => race.cancel();
}
