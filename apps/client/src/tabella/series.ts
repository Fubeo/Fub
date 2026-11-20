// Il riempimento di serie, come la maniglia dei fogli di calcolo: dai valori
// di partenza, quelli che seguono. Numeri in progressione (col passo degli
// ultimi due), un testo che finisce con un numero che cresce («Voce 1»,
// «Voce 2»), i giorni della settimana e i mesi («lun», «mar»…; «gennaio»,
// «febbraio»…, anche in inglese), il resto ripetuto in ciclo. Qui sta anche
// la data di oggi che Ctrl+; scrive in una cella.

import { readNumbers, writeNumber } from "./sum";

/// Una serie che gira: i giorni della settimana o i mesi, interi o corti.
interface Cycle {
  readonly language: "it" | "en";
  readonly names: readonly string[];
}

const IT_DAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
const IT_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const short = (names: readonly string[]) => names.map((name) => name.slice(0, 3));

/// Le serie che girano, nell'ordine in cui si provano dentro una lingua: i
/// giorni prima dei mesi, così «mar» da solo è martedì, come nei fogli di
/// calcolo italiani; con «gen», «feb», «mar» la serie è dei mesi.
const CYCLES: readonly Cycle[] = [
  { language: "it", names: short(IT_DAYS) },
  { language: "it", names: IT_DAYS },
  { language: "it", names: short(IT_MONTHS) },
  { language: "it", names: IT_MONTHS },
  { language: "en", names: short(EN_DAYS) },
  { language: "en", names: EN_DAYS },
  { language: "en", names: short(EN_MONTHS) },
  { language: "en", names: EN_MONTHS },
];

/// Un nome confrontato senza maiuscole né accenti: «Lunedi» è «lunedì».
function plain(text: string): string {
  return text.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const PLAIN_CYCLES = CYCLES.map((cycle) => ({ ...cycle, plain: cycle.names.map(plain) }));

/// I `count` valori dopo `source`, nell'ordine in cui la maniglia li scrive.
/// `backward` riempie all'indietro (in su o a sinistra): la serie scende.
/// `language` è la lingua della tabella (quella della nota, altrimenti
/// quella di Fub). Sceglie fra due serie che dicono la stessa parola (in
/// italiano «mar» è martedì, in inglese è marzo) e legge i numeri che non
/// dicono il loro segno dei decimali: all'italiana «1.000» è mille, come
/// nella somma (`readNumbers`).
export function fillSeries(source: readonly string[], count: number, backward = false, language = "it"): string[] {
  if (count <= 0 || source.length === 0) return [];
  const seed = backward ? [...source].reverse() : [...source];
  const group = readNumbers(seed, language);
  if (group) {
    const numbers = group.numbers.map((reading) => reading.value);
    const step = seed.length > 1 ? numbers[numbers.length - 1]! - numbers[numbers.length - 2]! : 1;
    const signed = backward && seed.length === 1 ? -step : step;
    const places = Math.max(...group.numbers.map((reading) => reading.places));
    const grouped = group.numbers.some((reading) => reading.grouped);
    const last = numbers[numbers.length - 1]!;
    return Array.from({ length: count }, (_, i) => writeNumber(last + signed * (i + 1), places, group.decimal, grouped));
  }
  const tail = seed.map((text) => /^(.*?)(\d+)$/u.exec(text));
  if (tail.every((match) => match !== null) && tail.every((match) => match![1] === tail[0]![1])) {
    const values = tail.map((match) => Number(match![2]));
    const step = values.length > 1 ? values[values.length - 1]! - values[values.length - 2]! : backward ? -1 : 1;
    const width = tail[tail.length - 1]![2]!.length;
    const prefix = tail[0]![1]!;
    const last = values[values.length - 1]!;
    return Array.from({ length: count }, (_, i) => {
      const value = last + step * (i + 1);
      if (value < 0) return seed[i % seed.length]!;
      return `${prefix}${String(value).padStart(width, "0")}`;
    });
  }
  const cycled = cycleSeries(seed, count, backward, language);
  if (cycled) return cycled;
  return Array.from({ length: count }, (_, i) => seed[i % seed.length]!);
}

/// I giorni e i mesi: la serie dove stanno tutti i valori di partenza, col
/// passo degli ultimi due (dopo «dom» viene «lun»), e le maiuscole del
/// primo («Lun», «LUN», «lun»). `null` se non è una serie che gira.
function cycleSeries(seed: readonly string[], count: number, backward: boolean, language: string): string[] | null {
  const wanted = language.toLowerCase().startsWith("en") ? "en" : "it";
  const order = [...PLAIN_CYCLES.filter((cycle) => cycle.language === wanted), ...PLAIN_CYCLES.filter((cycle) => cycle.language !== wanted)];
  const keys = seed.map(plain);
  for (const cycle of order) {
    const indexes = keys.map((key) => cycle.plain.indexOf(key));
    if (indexes.some((index) => index < 0)) continue;
    const length = cycle.names.length;
    // Il passo più corto fra i due ultimi: da «dom» a «lun» è uno avanti, non
    // sei indietro.
    let step = indexes.length > 1 ? indexes[indexes.length - 1]! - indexes[indexes.length - 2]! : backward ? -1 : 1;
    step = ((step % length) + length) % length;
    if (step > length / 2) step -= length;
    if (step === 0 && indexes.length > 1) return null;
    const last = indexes[indexes.length - 1]!;
    const shape = caseOf(seed[seed.length - 1]!.trim());
    return Array.from({ length: count }, (_, i) => {
      const name = cycle.names[(((last + step * (i + 1)) % length) + length) % length]!;
      return shape === "upper" ? name.toLocaleUpperCase(cycle.language) : shape === "title" ? name[0]!.toLocaleUpperCase(cycle.language) + name.slice(1) : name;
    });
  }
  return null;
}

function caseOf(text: string): "upper" | "title" | "lower" {
  if (text.length > 1 && text === text.toLocaleUpperCase() && text !== text.toLocaleLowerCase()) return "upper";
  const first = text[0] ?? "";
  return first !== first.toLocaleLowerCase() ? "title" : "lower";
}

/// La data di oggi come la scrive Ctrl+; in una cella: il giorno, il mese
/// corto e l'anno nella lingua di Fub («15 nov 2026», «Nov 15, 2026»).
export function todayText(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(date);
}
