export type ShellId = "desktop" | "mobile";

export interface PlatformCapabilities {
  readonly multipleWindows: boolean;
  readonly nativeWindowControls: boolean;
  readonly nativeMenus: boolean;
  readonly systemTray: boolean;
  readonly finePointer: boolean;
  readonly hover: boolean;
  readonly physicalKeyboard: boolean;
  readonly fileDrop: boolean;
  readonly touchFirst: boolean;
}

export interface ClientShell {
  readonly id: ShellId;
  readonly capabilities: Readonly<PlatformCapabilities>;
}

function capabilities(
  value: PlatformCapabilities,
): Readonly<PlatformCapabilities> {
  return Object.freeze({ ...value });
}

export const DESKTOP_CAPABILITIES = capabilities({
  multipleWindows: true,
  nativeWindowControls: true,
  nativeMenus: true,
  systemTray: true,
  finePointer: true,
  hover: true,
  physicalKeyboard: true,
  fileDrop: true,
  touchFirst: false,
});

export const MOBILE_CAPABILITIES = capabilities({
  multipleWindows: false,
  nativeWindowControls: false,
  nativeMenus: false,
  systemTray: false,
  finePointer: false,
  hover: false,
  physicalKeyboard: false,
  fileDrop: false,
  touchFirst: true,
});

export function supports(
  shell: ClientShell,
  capability: keyof PlatformCapabilities,
): boolean {
  return shell.capabilities[capability];
}

// La shell comune (`desktop-shell.ts`) è la stessa per desktop e mobile: le
// differenze le chiede qui, per capacità, invece di confrontare l'id della
// shell. Il bootstrap di ogni shell la dichiara prima di montare quella comune.
const DEFAULT_SHELL: ClientShell = Object.freeze({
  id: "desktop",
  capabilities: DESKTOP_CAPABILITIES,
});
let declared: ClientShell | null = null;

/** Dichiara la shell attiva e ne rende osservabile l'id nel DOM. */
export function declareShell(shell: ClientShell): void {
  declared = shell;
  if (typeof document !== "undefined") document.documentElement.dataset.clientShell = shell.id;
}

/** La shell attiva. Senza dichiarazione è il desktop, la shell di serie. */
export function activeShell(): ClientShell {
  return declared ?? DEFAULT_SHELL;
}

/** La shell attiva ha questa capacità di piattaforma? */
export function platformSupports(capability: keyof PlatformCapabilities): boolean {
  return supports(activeShell(), capability);
}
