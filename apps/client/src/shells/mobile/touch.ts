// Adattatori touch della shell mobile: gli stessi layout, pannelli e
// switcher del desktop, raggiunti dai gesti e dai link che il sistema apre.

import { layout, openIn } from "../../state/layout";
import { openDocument } from "../../panels/document";
import { openQuickSwitcher } from "../../panels/quick-switcher";
import { showPanel } from "../../panels/sidebar";
import type { Lifetime } from "../../ui/lifetime";

export function touchFirst(): boolean {
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
  if (typeof window !== "undefined" && "ontouchstart" in window) return true;
  return document.documentElement.dataset.clientShell === "mobile";
}

export function openMobileSearch(): void {
  showPanel("search");
  document.getElementById("search-input")?.focus();
}

export function openMobileSwitcher(): void {
  openQuickSwitcher();
}

export function openMobileDoc(id: string): Promise<void> {
  openIn(layout.focus, id);
  return openDocument(id);
}

export function mountMobileChrome(lifetime: Lifetime): void {
  lifetime.listen(window, "pagehide", () => {
    document.getElementById("quick-switcher")?.remove();
    document.getElementById("command-palette")?.remove();
  });
}
