// La regola del posto (E2, «Il trascinamento»), senza DOM.
//
// Il blocco in mano resta compatto (al più `HELD_MAX` px) e dove cadrà si
// apre un posto alto quanto lui: i fratelli scivolano per aprirlo. Qui si
// decide soltanto con dei numeri, misurati una volta alla presa: dove sono i
// fratelli come se il blocco in mano non ci fosse, quanto è alto il posto,
// di quanto scivola ciascuno. Il posto cambia quando il centro del blocco in
// mano supera il centro di un vicino, e per tornare bisogna ripassare quel
// centro: un margine alto quanto il posto, così il posto non trema sui
// confini, nemmeno accanto a un blocco alto.
//
// In orizzontale il blocco segue il puntatore per un terzo, fino a
// `SIDEWAYS_MAX`; in un elenco `NEST_PX` a destra annidano la voce sotto
// quella sopra e altrettanti a sinistra la portano fuori; sull'ultimo ottavo
// a destra o a sinistra di un blocco il posto diventa «Accanto» (le colonne).

/// Il blocco in mano non è mai più alto di così (px): tre righe di testo.
export const HELD_MAX = 104;
/// Di quanto il blocco segue il puntatore di lato: un terzo, fino a 28 px.
export const SIDEWAYS_SHARE = 1 / 3;
export const SIDEWAYS_MAX = 28;
/// Quanti px di lato annidano o portano fuori una voce d'elenco.
export const NEST_PX = 24;
/// La parte del blocco, a destra o a sinistra, dove il posto diventa «Accanto».
export const BESIDE_SHARE = 1 / 8;
/// Di quanto (px) il puntatore va oltre il bordo sinistro per «Accanto» a sinistra.
export const BESIDE_LEFT_PX = 48;
/// Entro quanti px dal posto la calamita accosta il blocco in mano.
export const MAGNET_PX = 36;

/// Un fratello del blocco in mano, come se il blocco non ci fosse: dove
/// comincia (px, nelle coordinate dello scorrimento) e quanto è alto.
export interface Neighbour {
  readonly top: number;
  readonly height: number;
}

/// Ciò che si misura alla presa.
export interface PlaceGeometry {
  /// I fratelli fuori dalla tratta in mano, in ordine.
  readonly neighbours: readonly Neighbour[];
  /// Il posto d'origine: quanti fratelli stavano prima della tratta.
  readonly origin: number;
  /// Dove cominciava la tratta in mano, e quanto era alta davvero.
  readonly top: number;
  readonly height: number;
  /// Lo spazio fra la tratta e il fratello vicino (px): il posto lo tiene.
  readonly gap: number;
  /// Il primo posto possibile: 1 quando il primo fratello è il frontmatter,
  /// che resta sempre il primo blocco.
  readonly floor: number;
  /// La tratta non si sposta (il frontmatter): il posto resta l'origine.
  readonly fixed?: boolean;
}

/// L'altezza del blocco in mano, e del posto.
export function heldHeight(height: number): number {
  return Math.min(Math.max(0, height), HELD_MAX);
}

/// Quanto spazio occupa il posto, col suo margine.
function slotSpan(geo: PlaceGeometry): number {
  return heldHeight(geo.height) + geo.gap;
}

/// Il posto nuovo per il centro `centre` del blocco in mano, partendo da
/// `current`. Un passo alla volta, finché il centro non sta fra il centro
/// del vicino sopra e quello (scostato) del vicino sotto.
export function nextPlace(geo: PlaceGeometry, current: number, centre: number): number {
  if (geo.fixed) return geo.origin;
  const n = geo.neighbours.length;
  const span = slotSpan(geo);
  let s = Math.min(Math.max(current, geo.floor), n);
  for (let guard = 0; guard <= n + 1; guard++) {
    const below = geo.neighbours[s];
    const above = geo.neighbours[s - 1];
    if (below && centre > below.top + span + below.height / 2) s++;
    else if (above && s > geo.floor && centre < above.top + above.height / 2) s--;
    else break;
  }
  return s;
}

/// Dove comincia il posto `s` (px, nello scorrimento).
export function slotTop(geo: PlaceGeometry, s: number): number {
  const n = geo.neighbours.length;
  if (n === 0) return geo.top;
  if (s < n) return geo.neighbours[s]!.top;
  const last = geo.neighbours[n - 1]!;
  return last.top + last.height + geo.gap;
}

/// Di quanto (px) scivola il fratello `k` col posto in `s`: chi stava sotto
/// la tratta sale di quanto era alta (col suo margine), chi sta dal posto in
/// giù scende di quanto è alto il posto. A posto d'origine, sotto la tratta
/// resta soltanto la differenza fra il blocco vero e quello compatto.
export function shiftOf(geo: PlaceGeometry, k: number, s: number): number {
  return (k >= geo.origin ? -(geo.height + geo.gap) : 0) + (k >= s ? slotSpan(geo) : 0);
}

/// Di quanto scivola ciò che sta dopo l'ultimo fratello (il resto della nota).
export function tailShift(geo: PlaceGeometry): number {
  return slotSpan(geo) - (geo.height + geo.gap);
}

/// Di quanto il blocco in mano segue di lato il puntatore spostato di `dx`.
export function sideways(dx: number): number {
  return Math.max(-SIDEWAYS_MAX, Math.min(SIDEWAYS_MAX, dx * SIDEWAYS_SHARE));
}

/// La calamita: vicino al posto il blocco in mano ci si accosta da solo, così
/// spazio e blocco coincidono. `gap` è la distanza (px) dal posto.
export function magnet(gap: number): number {
  if (Math.abs(gap) > MAGNET_PX) return 0;
  return gap * 0.42 * (1 - (gap / MAGNET_PX) ** 2);
}

/// Che cosa farebbe il rilascio, oltre al posto fra i fratelli.
export type Lean = "none" | "nest" | "outdent";

/// In un elenco: `NEST_PX` a destra annidano sotto la voce sopra il posto (se
/// c'è e se è una voce), altrettanti a sinistra portano fuori una voce
/// annidata quando il posto è in fondo ai fratelli.
export function leanOf(dx: number, options: { readonly list: boolean; readonly canNest: boolean; readonly canOutdent: boolean }): Lean {
  if (!options.list) return "none";
  if (dx >= NEST_PX && options.canNest) return "nest";
  if (dx <= -NEST_PX && options.canOutdent) return "outdent";
  return "none";
}

/// Il bordo di un blocco dove il posto diventa «Accanto»: a destra, il
/// puntatore `x` nell'ultimo ottavo della colonna `[left, right]`; a sinistra,
/// il puntatore oltre il bordo sinistro della colonna e oltre la presa
/// (`startX`, la maniglia, che sta già nel margine) di almeno `BESIDE_LEFT_PX`.
/// Una deriva di lato mentre si porta il blocco su o giù non basta. A
/// sinistra non vale per le voci d'elenco, dove quel gesto porta fuori.
export function besideSide(x: number, startX: number, left: number, right: number, list: boolean): "left" | "right" | null {
  const width = right - left;
  if (width <= 0) return null;
  if (x >= right - width * BESIDE_SHARE) return "right";
  if (!list && x <= Math.min(left, startX) - BESIDE_LEFT_PX) return "left";
  return null;
}

/// Dove si vede il fratello `k` col posto in `s`.
export function shownTop(geo: PlaceGeometry, k: number, s: number): number {
  return geo.neighbours[k]!.top + (k >= s ? slotSpan(geo) : 0);
}

/// Il fratello (indice fra i vicini) che si vede all'altezza `y`, o -1.
export function neighbourAt(geo: PlaceGeometry, s: number, y: number): number {
  for (let k = 0; k < geo.neighbours.length; k++) {
    const top = shownTop(geo, k, s);
    if (y >= top && y <= top + geo.neighbours[k]!.height) return k;
  }
  return -1;
}
