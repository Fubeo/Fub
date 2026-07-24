// Renderer del protocollo di UI dichiarativa (UiNode) in elementi DOM nativi.
// È lo stesso percorso che useranno i plugin: il core descrive, il frontend
// disegna con i suoi componenti e il suo tema.
import type { UiNode } from "./api";

export type ActionHandler = (action: string) => void;

export function renderUiNode(node: UiNode, onAction: ActionHandler): HTMLElement {
  switch (node.node) {
    case "stack": {
      const el = document.createElement("div");
      el.className = "ui-stack";
      el.style.display = "flex";
      el.style.flexDirection = node.dir === "row" ? "row" : "column";
      el.style.gap = `${node.gap}px`;
      for (const child of node.children) el.appendChild(renderUiNode(child, onAction));
      return el;
    }
    case "text": {
      const el = document.createElement("div");
      el.className = "ui-text";
      el.textContent = node.content;
      return el;
    }
    case "heading": {
      const el = document.createElement(`h${Math.min(Math.max(node.level, 1), 6)}`);
      el.className = "ui-heading";
      el.textContent = node.content;
      return el;
    }
    case "list": {
      const el = document.createElement("div");
      el.className = "ui-list";
      for (const item of node.items) el.appendChild(renderUiNode(item, onAction));
      return el;
    }
    case "list_item": {
      const el = document.createElement("div");
      el.className = "ui-list-item";
      if (node.action) {
        el.classList.add("clickable");
        el.addEventListener("click", () => onAction(node.action!));
      }
      const title = document.createElement("div");
      title.className = "ui-list-item-title";
      title.textContent = node.title;
      el.appendChild(title);
      if (node.subtitle) {
        const sub = document.createElement("div");
        sub.className = "ui-list-item-subtitle";
        sub.textContent = node.subtitle;
        el.appendChild(sub);
      }
      return el;
    }
    case "button": {
      const el = document.createElement("button");
      el.className = `ui-button intent-${node.intent}`;
      el.textContent = node.label;
      el.addEventListener("click", () => onAction(node.action));
      return el;
    }
    case "html": {
      const el = document.createElement("div");
      el.className = "ui-html";
      el.innerHTML = node.html;
      return el;
    }
    case "web_view": {
      const el = document.createElement("iframe");
      el.className = "ui-webview";
      el.src = node.url;
      el.style.height = `${node.height}px`;
      el.setAttribute("sandbox", "allow-scripts");
      return el;
    }
  }
}
