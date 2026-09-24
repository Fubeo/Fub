// Only shell chrome belongs here. The document layout (including focused pane)
// is saved separately; a workspace may restore either half independently.
export interface ShellGeometry {
  sidebar?: { visible?: boolean; width?: number };
  inspector?: { visible?: boolean; width?: number };
  panel?: string;
  railOrder?: string[];
  hiddenPanels?: string[];
}

const limits = { sidebar: [200, 360], inspector: [240, 400] } as const;

export function parseShellGeometry(raw: unknown): { geometry: ShellGeometry; rejected: Record<string, unknown> } {
  const geometry: ShellGeometry = {};
  const rejected: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { geometry, rejected: { geometry: raw } };
  const fields = raw as Record<string, unknown>;
  for (const side of ["sidebar", "inspector"] as const) {
    const value = fields[side];
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      rejected[side] = value;
      continue;
    }
    const record = value as Record<string, unknown>;
    const valid: { visible?: boolean; width?: number } = {};
    const bad: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (key !== "visible" && key !== "width") bad[key] = item;
    }
    if (record.visible !== undefined) {
      if (typeof record.visible === "boolean") valid.visible = record.visible;
      else bad.visible = record.visible;
    }
    if (record.width !== undefined) {
      if (typeof record.width === "number" && Number.isFinite(record.width)
        && record.width >= limits[side][0] && record.width <= limits[side][1]) valid.width = record.width;
      else bad.width = record.width;
    }
    if (Object.keys(valid).length) geometry[side] = valid;
    if (Object.keys(bad).length) rejected[side] = bad;
  }
  if (fields.panel !== undefined) {
    if (typeof fields.panel === "string" && fields.panel.length > 0) geometry.panel = fields.panel;
    else rejected.panel = fields.panel;
  }
  for (const field of ["railOrder", "hiddenPanels"] as const) {
    if (fields[field] === undefined) continue;
    const value = fields[field];
    if (Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0)
      && new Set(value).size === value.length) geometry[field] = [...value];
    else rejected[field] = value;
  }
  for (const [key, item] of Object.entries(fields)) {
    if (key !== "sidebar" && key !== "inspector" && key !== "panel"
      && key !== "railOrder" && key !== "hiddenPanels") rejected[key] = item;
  }
  return { geometry, rejected };
}

export function captureShellGeometry(): ShellGeometry {
  const side = (id: string, divider: string): { visible: boolean; width?: number } => {
    const el = document.getElementById(id);
    const bar = document.getElementById(divider);
    const width = Number(bar?.getAttribute("aria-valuenow"));
    return { visible: !!el && !el.hidden, ...(Number.isFinite(width) && width > 0 ? { width } : {}) };
  };
  const ribbon = document.getElementById("views-ribbon");
  const panels = [...(ribbon?.querySelectorAll<HTMLElement>("[data-panel]") ?? [])];
  const active = panels.find((button) => button.getAttribute("aria-pressed") === "true");
  return {
    sidebar: side("sidebar", "divider-sidebar"),
    inspector: side("right-pane", "divider-inspector"),
    ...(active?.dataset.panel ? { panel: active.dataset.panel } : {}),
    railOrder: panels.map((button) => button.dataset.panel!),
    hiddenPanels: panels.filter((button) => button.hidden).map((button) => button.dataset.panel!),
  };
}

export function restoreShellGeometry(geometry: ShellGeometry): void {
  // The adaptive controller owns visibility preferences and resize observers;
  // it applies this event just as it applies a user's divider gesture.
  window.dispatchEvent(new CustomEvent("shell:restore-geometry", { detail: geometry }));
}
