// Che cosa fa un puntatore che si appoggia sulla superficie: disegna, muove la
// vista o niente. La decisione è pura e sta qui; la pipeline della penna la
// applica a ogni `pointerdown` e la rivede quando arriva una penna, e gli
// strumenti e la camera leggono lo stesso esito invece di ripeterlo.
//
// La politica, pensata per chi scrive con la mano appoggiata:
//
// - la punta della penna disegna; la gomma della penna girata fa un tratto
//   da gomma, e il tasto laterale un tratto che gli strumenti usano come
//   hanno scelto (radiale, lazo, gomma o niente);
// - il mouse disegna con il tasto principale e muove la vista con quello
//   centrale;
// - un dito non disegna mai mentre una penna tocca lo schermo o è sospesa
//   sopra la superficie: è il palmo. Quando la penna arriva, le dita già giù
//   diventano palmo anche loro e un loro tratto si annulla;
// - con un secondo dito giù il gesto è di navigazione (pizzico, due dita), e
//   un tratto del primo dito si annulla;
// - altrimenti decide la politica del tocco: `ink` disegna sempre, `navigate`
//   muove sempre la vista, `auto` (il default) disegna finché su questa
//   superficie non si è vista una penna e poi muove la vista, come fanno le
//   buone app per tablet. Chi non ha una penna disegna col dito; chi ce l'ha
//   scrive con quella e sposta il foglio con le dita.

/// Il ruolo di un puntatore appoggiato. `erase` è la gomma della penna
/// girata, `barrel` la penna col tasto laterale premuto.
export type PointerRole = StrokeRole | "navigate" | "ignore";

/// Chi fa un tratto: la punta, la gomma della penna o il tasto laterale.
export type StrokeRole = "ink" | "erase" | "barrel";

/// Che cosa fa un dito quando nessuna penna è vicina.
export type TouchPolicy = "auto" | "ink" | "navigate";

/// Lo stato della superficie che la decisione guarda.
export interface RoleContext {
  readonly touch: TouchPolicy;
  /// Su questa superficie si è vista una penna, anche solo sospesa.
  readonly penSeen: boolean;
  /// Una penna tocca la superficie o è sospesa sopra di lei.
  readonly penNear: boolean;
  /// Le dita già giù che non sono palmo.
  readonly touchesDown: number;
}

/// I tasti di Pointer Events (`PointerEvent.button`).
const PRIMARY = 0;
const MIDDLE = 1;
/// Il tasto laterale della penna (il secondario del mouse).
const BARREL = 2;
/// La gomma della penna girata.
const ERASER = 5;

/// Il ruolo fa un tratto.
export function strokes(role: PointerRole): role is StrokeRole {
  return role === "ink" || role === "erase" || role === "barrel";
}

/// Il bit di `PointerEvent.buttons` che tiene vivo il tratto di `role`:
/// rilasciato, il tratto finisce.
export function buttonMask(role: StrokeRole): number {
  return role === "ink" ? 1 : role === "erase" ? 32 : 2;
}

/// Il ruolo di un puntatore nel momento in cui si appoggia.
export function classifyPointer(
  event: { readonly pointerType: string; readonly button: number },
  context: RoleContext,
): PointerRole {
  switch (event.pointerType) {
    case "pen":
      return event.button === PRIMARY ? "ink" : event.button === ERASER ? "erase" : event.button === BARREL ? "barrel" : "ignore";
    case "touch":
      if (context.penNear) return "ignore";
      if (context.touchesDown > 0) return "navigate";
      if (context.touch === "auto") return context.penSeen ? "navigate" : "ink";
      return context.touch;
    default:
      // Il mouse, e un tipo che il motore non sa dire (`""`), che si comporta
      // come lui: meglio un puntatore che disegna di uno che non fa niente.
      return event.button === PRIMARY ? "ink" : event.button === MIDDLE ? "navigate" : "ignore";
  }
}
