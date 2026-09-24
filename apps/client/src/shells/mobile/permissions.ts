// Permessi e tastiera mobile: stati puri, niente rami globali.
// Virtuale vs fisica da capacità shell; selezione/zoom/drag dove disponibile.

export type MobilePermission = "unknown" | "granted" | "denied" | "revoked";

export interface PermissionRequest {
  kind: "storage" | "microphone" | "camera" | "notifications";
  state: MobilePermission;
}

export function needsExplicitAsk(state: MobilePermission): boolean {
  return state === "unknown";
}

export function isLostAccess(state: MobilePermission): boolean {
  return state === "denied" || state === "revoked";
}

export type KeyboardKind = "virtual" | "physical" | "unknown";

export function keyboardKind(physicalKeyboard: boolean): KeyboardKind {
  return physicalKeyboard ? "physical" : "virtual";
}

export interface TouchEditing {
  touchFirst: boolean;
  keyboard: KeyboardKind;
  selectionHandles: boolean;
  pinchZoom: boolean;
  dragReorder: boolean;
}

export function touchEditing(options: {
  touchFirst: boolean;
  physicalKeyboard: boolean;
}): TouchEditing {
  return {
    touchFirst: options.touchFirst,
    keyboard: keyboardKind(options.physicalKeyboard),
    selectionHandles: options.touchFirst,
    pinchZoom: options.touchFirst,
    dragReorder: options.touchFirst,
  };
}
