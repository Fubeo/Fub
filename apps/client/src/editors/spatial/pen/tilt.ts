// L'inclinazione della penna, dagli eventi del puntatore ai gradi di `fub:ink`.
//
// Pointer Events la dà in due forme: `altitudeAngle` e `azimuthAngle` in
// radianti, che sono quelle di `fub:ink`, e `tiltX`/`tiltY` in gradi, che sono
// le sole su alcuni motori. Si preferiscono gli angoli; altrimenti si
// convertono le inclinazioni con le formule della specifica Pointer Events 3.
//
// Un dispositivo senza sensore riporta i valori di default — altitudine π/2,
// azimut 0, `tiltX` e `tiltY` a 0 — che sono anche quelli di una penna tenuta
// perfettamente dritta. Per questo l'inclinazione di un tratto si conserva
// solo se almeno un campione ha dato un valore diverso dal default
// (`reportsTilt`): un tratto di una penna senza sensore non scrive `a` e `z`.

const DEGREES = 180 / Math.PI;
const RIGHT = Math.PI / 2;

/// Gli angoli di un evento: altitudine (0…90) e azimut (0…360), in gradi.
export interface PenAngles {
  readonly a: number;
  readonly z: number;
}

/// La parte dell'evento che serve, così le prove non devono costruire un
/// `PointerEvent` intero.
export interface TiltSource {
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
}

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/// `tiltX`/`tiltY` (gradi, −90…90) in altitudine e azimut (gradi), con le
/// formule di Pointer Events 3, casi di bordo compresi.
export function anglesFromTilt(tiltX: number, tiltY: number): PenAngles {
  const x = (tiltX * Math.PI) / 180;
  const y = (tiltY * Math.PI) / 180;
  const edge = Math.abs(tiltX) === 90 || Math.abs(tiltY) === 90;
  const tanX = Math.tan(x);
  const tanY = Math.tan(y);
  let azimuth = 0;
  if (tiltX === 0) {
    if (tiltY > 0) azimuth = RIGHT;
    else if (tiltY < 0) azimuth = 3 * RIGHT;
  } else if (tiltY === 0) {
    if (tiltX < 0) azimuth = Math.PI;
  } else if (!edge) {
    azimuth = Math.atan2(tanY, tanX);
    if (azimuth < 0) azimuth += 2 * Math.PI;
  }
  let altitude: number;
  if (edge) altitude = 0;
  else if (tiltX === 0) altitude = RIGHT - Math.abs(y);
  else if (tiltY === 0) altitude = RIGHT - Math.abs(x);
  else altitude = Math.atan(1 / Math.sqrt(tanX * tanX + tanY * tanY));
  return { a: altitude * DEGREES, z: azimuth * DEGREES };
}

/// Gli angoli di un evento, in gradi; `null` se l'evento non ne porta.
export function penAngles(event: TiltSource): PenAngles | null {
  if (finiteNumber(event.altitudeAngle) && finiteNumber(event.azimuthAngle)) {
    return { a: event.altitudeAngle * DEGREES, z: event.azimuthAngle * DEGREES };
  }
  if (finiteNumber(event.tiltX) && finiteNumber(event.tiltY)) return anglesFromTilt(event.tiltX, event.tiltY);
  return null;
}

/// Vero se l'evento porta un'inclinazione diversa dal default di Pointer
/// Events, cioè se il dispositivo ha davvero un sensore.
export function reportsTilt(event: TiltSource): boolean {
  return (finiteNumber(event.tiltX) && event.tiltX !== 0)
    || (finiteNumber(event.tiltY) && event.tiltY !== 0)
    || (finiteNumber(event.altitudeAngle) && event.altitudeAngle !== RIGHT)
    || (finiteNumber(event.azimuthAngle) && event.azimuthAngle !== 0);
}
