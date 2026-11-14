// La finestra del banco su una sessione Wayland. Con `WAYLAND_DISPLAY` GTK apre
// la finestra in Wayland, cioè sullo schermo di chi misura, e non nel display di
// Xvfb dove il driver muove il puntatore: S3 allora dà «move target out of
// bounds» (misura del 13 novembre, T46). Il banco si ferma prima di avviare
// l'app, a meno che non si scelga: `--x11` (sotto Xvfb, con la variabile tolta)
// o `--wayland` (per lo schermo vero).

/// Il motivo per cui il banco non parte, o `null` se può partire.
export function waylandProblem(env, args) {
  if (!env.WAYLAND_DISPLAY || "x11" in args || "wayland" in args) return null;
  return [
    "WAYLAND_DISPLAY è impostato: GTK aprirebbe la finestra del banco in Wayland,",
    "cioè sullo schermo di chi misura, e non in Xvfb. Il banco non parte.",
    "Per il banco sotto Xvfb aggiungi --x11 e togli la variabile al comando:",
    "  xvfb-run -a env -u WAYLAND_DISPLAY npm run bench:webview -- … --x11",
    "Per misurare sullo schermo vero, su questa sessione Wayland, aggiungi --wayland.",
  ].join("\n");
}
