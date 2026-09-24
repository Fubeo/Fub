import type { Lifetime } from "../../ui/lifetime";
import "./mobile.css";

/** DOM-only adapter: no editor/panel imports in pure mobile storage tests. */
export function mountMobileViewport(lifetime: Lifetime): void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const isEditing = () => {
    const element = document.activeElement;
    return element instanceof HTMLElement &&
      (element.isContentEditable || element.matches("input, textarea, [role='textbox']"));
  };
  const update = () => {
    const inset = isEditing() && viewport
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    root.style.setProperty("--mobile-keyboard-inset", `${inset}px`);
    root.dataset.mobileKeyboard = inset > 100 ? "visible" : "hidden";
    root.dataset.mobileFormFactor = window.innerWidth >= 600 ? "tablet" : "phone";
    root.dataset.mobileOrientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    if (inset > 100) document.activeElement?.scrollIntoView?.({ block: "nearest" });
  };
  lifetime.listen(window, "resize", update);
  lifetime.listen(window, "orientationchange", update);
  lifetime.listen(document, "focusin", update);
  lifetime.listen(document, "focusout", update);
  if (viewport) {
    lifetime.listen(viewport, "resize", update);
    lifetime.listen(viewport, "scroll", update);
  }
  lifetime.add(() => {
    root.style.removeProperty("--mobile-keyboard-inset");
    delete root.dataset.mobileKeyboard;
    delete root.dataset.mobileFormFactor;
    delete root.dataset.mobileOrientation;
  });
  update();
}
