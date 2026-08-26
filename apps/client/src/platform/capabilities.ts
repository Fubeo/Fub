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
