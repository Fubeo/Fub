import type katex from "katex";
import type { KatexOptions } from "katex";
import { errorText } from "../../../../host/errors";
import { onLanguage, t } from "../../../../i18n/strings";
import { lazyPart } from "../../../../ui/lazy-part";
import { openLifetime, type Teardown } from "../../../../ui/lifetime";
import { attachTooltip, setTooltip } from "../../../../ui/tooltip";

/// Le frasi degli errori delle formule (`math-errors.ts`, coi nomi dei
/// simboli): servono soltanto a una formula sbagliata, e arrivano con un
/// `import()` dopo KaTeX, fuori dal ponte dei documenti.
const mathErrors = lazyPart(() => import("./math-errors"));

const MAX_SOURCE_LENGTH = 20_000;
let library: Promise<{ default: typeof katex }> | undefined;
let styles: Promise<unknown> | undefined;

/// Le regole di KaTeX della resa di lettura: severo, senza fiducia (niente
/// `\\htmlData` né collegamenti), con i limiti di espansione e di misura. Il
/// riquadro di modifica (`math/caret.ts`) parte da qui e fida soltanto i suoi
/// segni.
export function readOptions(display: boolean): KatexOptions {
  return {
    displayMode: display,
    output: "htmlAndMathml",
    throwOnError: true,
    strict: "error",
    trust: false,
    maxExpand: 1_000,
    maxSize: 20,
  };
}

/// KaTeX e il suo foglio di stile, caricati una volta, alla prima formula.
export function loadKatex(): Promise<typeof katex> {
  return Promise.all([
    library ??= import("katex").catch((error) => {
      library = undefined;
      throw error;
    }),
    styles ??= import("katex/dist/katex.min.css").catch((error) => {
      styles = undefined;
      throw error;
    }),
  ]).then(([module]) => module.default);
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
    // Il perché dell'errore, detto nella lingua di adesso: `labels` lo rifà al
    // cambio di lingua. Il messaggio di KaTeX non esce mai: la frase viene da
    // `math/errors.ts`, la stessa del riquadro della formula.
    let reason: () => string = () => "";
    // Un nome su uno `span` o un `div` senza ruolo non vale (ARIA): il ruolo
    // `math` lo ammette, e lascia leggibile il MathML che KaTeX mette dentro.
    element.setAttribute("role", "math");
    const labels = () => {
      element.dataset.state = phase;
      element.setAttribute("aria-busy", String(phase === "loading"));
      // Il nome (per il lettore di schermo) e il suggerimento dicono la stessa frase.
      const failed = phase === "error" ? t("math.error", { reason: reason() }) : "";
      element.setAttribute("aria-label", phase === "error"
        ? failed
        : phase === "loading" ? t("math.loading") : t("math.formula"));
      setTooltip(element, failed);
    };
    const fail = (why: () => string) => {
      if (life.closed) return;
      phase = "error";
      reason = why;
      element.textContent = source;
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    };
    life.add(onLanguage(labels));
    labels();
    if (source.length > MAX_SOURCE_LENGTH) {
      fail(() => t("math.too_large", { limit: MAX_SOURCE_LENGTH }));
      continue;
    }
    void loadKatex().then((library) => {
      if (life.closed) return;
      const staging = document.createElement(element.classList.contains("math-block") ? "div" : "span");
      library.render(source, staging, readOptions(element.classList.contains("math-block")));
      if (life.closed) return;
      element.replaceChildren(...staging.childNodes);
      phase = "ready";
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }).catch((error: unknown) => mathErrors.load().then(({ diagnose, explain, problemSentence }) => {
      // `diagnose` legge l'errore una volta sola; `explain` scrive la frase nella
      // lingua di adesso, ogni volta che `labels` la chiede.
      const diagnosis = diagnose(error, source);
      fail(() => problemSentence(explain(diagnosis)));
    }, (missing: unknown) => fail(() => t("app.part_failed", { reason: errorText(missing) }))));
  }
  return () => life.close();
}
