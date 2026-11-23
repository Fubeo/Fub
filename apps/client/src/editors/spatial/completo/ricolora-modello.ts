// Il modello di Ricolora grafica (K6 T14, giro 3): i gruppi di colori della scelta, le proposte
// del motore (Riduci, Colori casuali) e la mappa da mandare a `recolor.apply`. Niente DOM e niente
// motore: la finestra li usa, i test li provano.

/// Un gruppo di colori che cambiano insieme: le chiavi del motore (`rgb 255 0 0`) e il colore
/// nuovo. Il motore dà un gruppo per colore; Riduci colori ne fa gruppi di più chiavi.
export interface GruppoColore {
  readonly chiavi: readonly string[];
  /// Il colore di ogni chiave in esadecimale (`#ff0000`), nell'ordine di `chiavi`.
  readonly attuali: readonly string[];
  /// Il colore nuovo in esadecimale; uguale a `attuali[0]` se non cambia.
  readonly nuovo: string;
}

/// Una riga della mappa che `recolor.apply` vuole: le chiavi del gruppo e il colore nuovo.
export interface VoceMappa {
  readonly from: readonly string[];
  readonly to: string;
}

/// I metodi di `recolor.apply`: come le tinte di un gruppo prendono il colore nuovo.
export const METODI = ["exact", "preserveTints", "scaleTints", "tintsShades", "hueShift"] as const;
export type Metodo = (typeof METODI)[number];

/// Vero se `testo` è un metodo che il motore conosce.
export function metodoValido(testo: unknown): testo is Metodo {
  return typeof testo === "string" && (METODI as readonly string[]).includes(testo);
}

/// Un colore esadecimale come `#rrggbb` minuscolo, o `null` se non lo è (`#rgb` si allarga).
export function normalizzaHex(testo: string): string | null {
  const pulito = testo.trim().toLowerCase();
  const corto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(pulito);
  if (corto !== null) return `#${corto[1]}${corto[1]}${corto[2]}${corto[2]}${corto[3]}${corto[3]}`;
  return /^#[0-9a-f]{6}$/u.test(pulito) ? pulito : null;
}

function esadecimale(r: number, g: number, b: number): string {
  const canale = (valore: number): string => Math.round(Math.min(255, Math.max(0, valore))).toString(16).padStart(2, "0");
  return `#${canale(r)}${canale(g)}${canale(b)}`;
}

/// Il colore di una chiave del motore (`rgb`, `gray`, `cmyk`, `lab`, con i valori come li scrive
/// il motore) in esadecimale, per mostrarlo; `null` per una chiave che non si legge.
export function chiaveAHex(chiave: string): string | null {
  const [modello, ...testi] = chiave.trim().split(/\s+/u);
  const valori = testi.map(Number);
  if (valori.length === 0 || valori.some((valore) => !Number.isFinite(valore))) return null;
  const [a, b, c, d] = valori as [number, number, number, number];
  switch (modello) {
    case "rgb":
      return valori.length === 3 ? esadecimale(a, b, c) : null;
    case "gray":
      return valori.length === 1 ? esadecimale((255 * a) / 100, (255 * a) / 100, (255 * a) / 100) : null;
    case "cmyk": {
      if (valori.length !== 4) return null;
      const [ciano, magenta, giallo, nero] = [a, b, c, d].map((valore) => valore / 100);
      return esadecimale(
        255 * (1 - ciano) * (1 - nero),
        255 * (1 - magenta) * (1 - nero),
        255 * (1 - giallo) * (1 - nero),
      );
    }
    case "lab":
      return valori.length === 3 ? labAEsadecimale(a, b, c) : null;
    default:
      return null;
  }
}

/// Lab (luce D65) in sRGB, con la curva di gamma; per mostrare il colore, non per stamparlo.
function labAEsadecimale(l: number, a: number, b: number): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inversa = (t: number): number => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  const x = 0.95047 * inversa(fx);
  const y = inversa(fy);
  const z = 1.08883 * inversa(fz);
  const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  return esadecimale(
    gamma(3.2406 * x - 1.5372 * y - 0.4986 * z),
    gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z),
    gamma(0.0557 * x - 0.204 * y + 1.057 * z),
  );
}

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

/// I gruppi iniziali dalla lettura `recolor.colors` (`{colors: [{key, hex, count}]}`): un gruppo per
/// colore, nel suo ordine (il più usato prima). `null` se la lettura non ha quella forma.
export function gruppiIniziali(lettura: unknown): readonly GruppoColore[] | null {
  if (!isRecord(lettura) || !Array.isArray(lettura.colors)) return null;
  const gruppi: GruppoColore[] = [];
  for (const colore of lettura.colors) {
    if (!isRecord(colore) || typeof colore.key !== "string" || typeof colore.hex !== "string") return null;
    const hex = normalizzaHex(colore.hex);
    if (hex === null) return null;
    gruppi.push({ chiavi: [colore.key], attuali: [hex], nuovo: hex });
  }
  return gruppi;
}

/// Le proposte del motore (`{map: [{from: [chiavi], to: chiave}]}`, che Riduci colori e Colori
/// casuali danno) applicate ai gruppi: le righe della proposta prendono il loro colore nuovo, e i
/// gruppi che la proposta non tocca restano come sono. `null` se la lettura non si capisce.
export function conProposta(gruppi: readonly GruppoColore[], lettura: unknown): readonly GruppoColore[] | null {
  if (!isRecord(lettura) || !Array.isArray(lettura.map)) return null;
  const hexDi = new Map<string, string>();
  for (const gruppo of gruppi) gruppo.chiavi.forEach((chiave, i) => hexDi.set(chiave, gruppo.attuali[i]!));
  const nuovi: GruppoColore[] = [];
  const toccate = new Set<string>();
  for (const riga of lettura.map) {
    if (!isRecord(riga) || !Array.isArray(riga.from) || typeof riga.to !== "string") return null;
    const chiavi = riga.from.filter((chiave): chiave is string => typeof chiave === "string");
    if (chiavi.length === 0 || chiavi.length !== riga.from.length) return null;
    const attuali: string[] = [];
    for (const chiave of chiavi) {
      const hex = hexDi.get(chiave) ?? chiaveAHex(chiave);
      if (hex === undefined || hex === null) return null;
      attuali.push(normalizzaHex(hex) ?? hex);
    }
    const nuovo = chiaveAHex(riga.to);
    if (nuovo === null) return null;
    for (const chiave of chiavi) toccate.add(chiave);
    nuovi.push({ chiavi, attuali, nuovo });
  }
  const resto = gruppi.filter((gruppo) => !gruppo.chiavi.some((chiave) => toccate.has(chiave)));
  return [...nuovi, ...resto];
}

/// La mappa da mandare: solo i gruppi che cambiano, con tutte le loro chiavi.
export function mappaDeiGruppi(gruppi: readonly GruppoColore[]): readonly VoceMappa[] {
  return gruppi
    .filter((gruppo) => gruppo.attuali.some((hex) => hex !== gruppo.nuovo))
    .map((gruppo) => ({ from: [...gruppo.chiavi], to: gruppo.nuovo }));
}

/// La mappa completa, tutti i gruppi: è quella che Colori casuali riceve.
export function mappaCompleta(gruppi: readonly GruppoColore[]): readonly VoceMappa[] {
  return gruppi.map((gruppo) => ({ from: [...gruppo.chiavi], to: gruppo.nuovo }));
}
