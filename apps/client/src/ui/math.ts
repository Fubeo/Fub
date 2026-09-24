import type katex from "katex";
import { onLanguage, t } from "../i18n/strings";
import { openLifetime, type Teardown } from "./lifetime";
import { attachTooltip, setTooltip } from "./tooltip";

const MAX_SOURCE_LENGTH = 20_000;
let library: Promise<{ default: typeof katex }> | undefined;
let styles: Promise<unknown> | undefined;

function reasonText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1200);
}

/** Hydrates inert TeX placeholders with KaTeX. The library and its stylesheet
 * are fetched only when a rendered document actually contains a formula. */
export function mountMathBlocks(container: HTMLElement): Teardown {
  const life = openLifetime();
  for (const element of container.querySelectorAll<HTMLElement>(".math-inline[data-tex], .math-block[data-tex]")) {
    if (element.closest("[data-ui-slot]")) continue;
    const source = element.dataset.tex ?? element.textContent ?? "";
    let phase: "loading" | "ready" | "error" = "loading";
    life.add(attachTooltip(element, ""));
    let reason = "";
    const labels = () => {
      element.dataset.state = phase;
      element.setAttribute("aria-busy", String(phase === "loading"));
      element.setAttribute("aria-label", phase === "error"
        ? t("math.error", { reason })
        : phase === "loading" ? t("math.loading") : t("math.formula"));
      setTooltip(element, phase === "error" ? t("math.error", { reason }) : "");
    };
    const fail = (error: unknown) => {
      if (life.closed) return;
      phase = "error";
      reason = reasonText(error);
      element.textContent = source;
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    };
    life.add(onLanguage(labels));
    labels();
    if (source.length > MAX_SOURCE_LENGTH) {
      fail(new Error(t("math.too_large", { limit: MAX_SOURCE_LENGTH })));
      continue;
    }
    void Promise.all([
      library ??= import("katex").catch((error) => {
        library = undefined;
        throw error;
      }),
      styles ??= import("katex/dist/katex.min.css").catch((error) => {
        styles = undefined;
        throw error;
      }),
    ]).then(([module]) => {
      if (life.closed) return;
      const staging = document.createElement(element.classList.contains("math-block") ? "div" : "span");
      module.default.render(source, staging, {
        displayMode: element.classList.contains("math-block"),
        output: "htmlAndMathml",
        throwOnError: true,
        strict: "error",
        trust: false,
        maxExpand: 1_000,
        maxSize: 20,
      });
      if (life.closed) return;
      element.replaceChildren(...staging.childNodes);
      phase = "ready";
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }).catch(fail);
  }
  return () => life.close();
}
