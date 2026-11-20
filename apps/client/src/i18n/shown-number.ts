// Un numero come lo scrive una persona in una lingua: «1.240,50» in
// italiano, «1,240.50» in inglese. Lo leggono la somma nella banda (E24,
// `shells/scrittoio/frame/selection-sum.ts`) e il grafico da una tabella
// (T54, `editors/text/profiles/markdown/table-chart.ts`), con la stessa regola.
//
// La forma del computer («1240.5», senza separatori delle migliaia) vale
// soltanto dove il punto non separa le migliaia: in italiano «15.11» e
// «12.30» sono una data e un'ora, non numeri. Fra parentesi un numero è
// negativo, come nei conti: «(1.234)».

/// Un testo più lungo non è un numero da leggere: il controllo resta corto
/// anche su una cella lunga.
const MAX_NUMBER_LENGTH = 64;

interface NumberForm {
  readonly pattern: RegExp;
  readonly group: RegExp;
  readonly decimal: string;
  /// La forma del computer non si confonde con quella della lingua: il punto
  /// non vi separa le migliaia.
  readonly plainDot: boolean;
}

const forms = new Map<string, NumberForm>();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/// La lingua come la vuole `Intl`; una che non conosce vale l'inglese.
export function knownLocale(locale: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0 ? locale : "en";
  } catch {
    return "en";
  }
}

/// I separatori di `locale`, e la forma di un numero scritto con quelli.
function numberForm(locale: string): NumberForm {
  const cached = forms.get(locale);
  if (cached) return cached;
  const parts = new Intl.NumberFormat(knownLocale(locale), { useGrouping: true }).formatToParts(1234567.5);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  // Uno spazio delle migliaia (il francese ne usa uno stretto, che nessuno
  // scrive a mano) vale ogni spazio; l'apostrofo svizzero vale tutti e due.
  const groupClass = /^[\s  ]$/u.test(group) ? "[\\s\\u00a0\\u202f]" : group === "’" || group === "'" ? "['’]" : escapeRegExp(group);
  const form: NumberForm = {
    pattern: new RegExp(`^(?:(\\d{1,3}(?:${groupClass}\\d{3})+)|(\\d+))?(?:${escapeRegExp(decimal)}(\\d+))?$`, "u"),
    group: new RegExp(groupClass, "gu"),
    decimal,
    plainDot: group !== ".",
  };
  forms.set(locale, form);
  return form;
}

/// Un numero letto da una cella: il valore (una percentuale come frazione),
/// le cifre dopo la virgola che porta, e se era una percentuale.
export interface ShownNumber {
  readonly value: number;
  readonly decimals: number;
  readonly percent: boolean;
}

/// Il numero che una cella mostra, letto nella lingua `locale`, con le sue
/// cifre dopo la virgola; `null` se è testo. Il segno (anche «−»), le
/// parentesi dei conti («(1.234)» è negativo), la valuta (€ $ £ ¥) e la
/// percentuale («12%» vale 0,12) si capiscono.
export function readShownNumber(text: string, locale: string): ShownNumber | null {
  if (text.length > MAX_NUMBER_LENGTH) return null;
  let body = text.trim().replace(/[€$£¥]/gu, "").trim();
  if (body === "") return null;
  let sign = 1;
  const negative = body.startsWith("(") && body.endsWith(")");
  if (negative) {
    sign = -1;
    body = body.slice(1, -1).trim();
  }
  const percent = body.endsWith("%");
  if (percent) body = body.slice(0, -1).trim();
  if (/^[-−+]/u.test(body)) {
    // Un segno dentro le parentesi dice due volte la stessa cosa, o due
    // contrarie: non è un numero da indovinare.
    if (negative) return null;
    if (body[0] !== "+") sign = -1;
    body = body.slice(1).trim();
  }
  if (!/\d/u.test(body)) return null;
  const form = numberForm(locale);
  let whole: string;
  let fraction: string;
  const local = form.pattern.exec(body);
  if (local) {
    whole = (local[1] ?? local[2] ?? "").replace(form.group, "");
    fraction = local[3] ?? "";
  } else {
    // La forma del computer: nessun separatore delle migliaia, il punto per
    // la virgola. Dove il punto separa le migliaia (l'italiano) non vale:
    // «1.240» è milleduecentoquaranta, e «15.11» o «12.30» sono una data o
    // un'ora, non numeri da sommare.
    if (!form.plainDot) return null;
    const plain = /^(\d+)(?:\.(\d+))?$/u.exec(body);
    if (!plain) return null;
    whole = plain[1]!;
    fraction = plain[2] ?? "";
  }
  const value = sign * Number(`${whole || "0"}.${fraction || "0"}`);
  if (!Number.isFinite(value)) return null;
  return percent ? { value: value / 100, decimals: fraction.length + 2, percent } : { value, decimals: fraction.length, percent };
}
