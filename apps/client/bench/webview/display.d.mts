/// Il motivo per cui il banco non parte con `WAYLAND_DISPLAY` senza `--x11` né
/// `--wayland`, o `null`. Vedi `display.mjs`.
export function waylandProblem(
  env: Record<string, string | undefined>,
  args: Record<string, string>,
): string | null;
