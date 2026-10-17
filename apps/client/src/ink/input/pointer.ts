// Il campione del puntatore: ciò che un adattatore di piattaforma (gli eventi
// del puntatore del browser, un altro toolkit) consegna al nucleo.
//
// È l'unico tipo che attraversa il confine fra la piattaforma e il nucleo.
// L'adattatore lo riempie dal suo evento, già nello spazio in cui il tratto
// deve vivere (la scena, non i pixel del client), e il nucleo non sa da dove
// viene: niente DOM, niente camera, niente prodotto. È la copia TypeScript di
// `crates/fub-ink/src/pointer.rs`.

/// Che puntatore è. Un tipo che il motore non sa dire si comporta come il
/// mouse: meglio un puntatore che disegna di uno che non fa niente.
export type InkPointerType = "pen" | "mouse" | "touch";

/// Il tipo di un `pointerType` qualunque: `pen` e `touch` si riconoscono, ogni
/// altro valore è il mouse.
export function pointerTypeOf(type: string): InkPointerType {
  return type === "pen" || type === "touch" ? type : "mouse";
}

/// Un campione del puntatore.
export interface PointerSample {
  /// L'identità del puntatore, stabile finché è giù.
  readonly pointerId: number;
  readonly pointerType: InkPointerType;
  /// La posizione nello spazio del tratto. Un valore non finito scarta il
  /// campione.
  readonly x: number;
  readonly y: number;
  /// Il tempo dell'evento in millisecondi, su un orologio monotono.
  readonly timeStamp: number;
  /// La pressione come la dà il dispositivo, da 0 a 1. Pointer Events vuole
  /// 0,5 per un dispositivo che non la misura; un valore non finito vale 0,5.
  readonly pressure: number;
  /// L'inclinazione come la dà il dispositivo, nelle due forme di Pointer
  /// Events; un campo che manca è `undefined`.
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  /// La rotazione della penna sul suo asse, in gradi. Il nucleo la tiene ma il
  /// formato dei tratti non la scrive.
  readonly twist: number;
  /// I tasti premuti ora (`PointerEvent.buttons`: il bit 1 è il principale).
  readonly buttons: number;
  /// Il tasto che ha causato l'evento (`PointerEvent.button`).
  readonly button: number;
  /// L'angolo della vista, in gradi in senso orario.
  readonly turn: number;
  /// I pixel dello schermo per unità della scena.
  readonly scale: number;
}

/// Un campione del tipo `pointerType` in `(x, y)` al tempo `timeStamp`, col tasto
/// principale giù e tutto il resto ai valori di un dispositivo senza sensori:
/// serve a chi costruisce i campioni a mano, come le prove.
export function pointerSample(
  init: Pick<PointerSample, "pointerId" | "pointerType" | "x" | "y" | "timeStamp"> & Partial<PointerSample>,
): PointerSample {
  return { pressure: 0.5, twist: 0, buttons: 1, button: 0, turn: 0, scale: 1, ...init };
}
