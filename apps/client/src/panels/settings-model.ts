// **Come la shell rappresenta un'impostazione**, prima di disegnarla.
//
// Lo schema arriva dal canale dati (`SettingEntry`: specie, valore,
// provenienza) e dice *cosa* è un'impostazione; qui si decide *come* mostrarla —
// quale controllo, con che passo, che cosa dire del predefinito, se una ricerca
// la trova. Sono decisioni, e stanno in un modulo senza DOM perché una
// decisione che si prova solo aprendo il pannello non la prova nessuno.
//
// La regola è una: **il controllo si sceglie dalla forma del dato, non dalla
// chiave**. Due scelte da tre opzioni brevi sono lo stesso dato e si vedono
// allo stesso modo, chiunque le abbia dichiarate; un numero con un intervallo
// dichiarato è un cursore, che sia un corpo del testo o un peso della ricerca.
// Per chiave restano soltanto i gesti che la shell possiede già (il tema con la
// sua anteprima, la lingua, il fuso), e li decide `settings.ts`.
import type { SettingEntry, SettingKind, SettingValue, UiOption } from "../host/contract";
import { t } from "../i18n/strings";

/// Il controllo di una riga.
export type Control =
  | { kind: "switch" }
  | { kind: "segmented"; options: UiOption[] }
  | { kind: "select"; options: UiOption[] }
  | { kind: "range"; min: number; max: number; step: number }
  | { kind: "number"; min: number | null; max: number | null }
  | { kind: "text" }
  | { kind: "list" };

/// Quante opzioni al più, e quanto lunghe, stanno in un segmentato.
///
/// Oltre tre opzioni un segmentato diventa una riga di bottoni da leggere uno
/// per uno, e un'etichetta lunga lo allarga fino a spingere via la prosa della
/// riga: da lì in su la tendina è la forma giusta. Una sola opzione non è una
/// scelta, e resta una tendina che mostra il valore.
export const SEGMENTED_MAX_OPTIONS = 3;
export const SEGMENTED_MAX_LABEL = 18;

/// Oltre quanti passi un cursore smette di essere un gesto utile: un intervallo
/// di tremila giorni si trascina a salti di tre, e allora il campo numerico da
/// solo è più onesto.
export const RANGE_MAX_STEPS = 1000;

/// Il controllo, dalla specie dichiarata e dalla sua forma.
export function controlFor(entry: SettingEntry): Control {
  const kind = entry.spec.kind;
  switch (kind.kind) {
    case "toggle":
      return { kind: "switch" };
    case "choice":
      // Un valore fuori dalle scelte (un file scritto a mano, uno schema che è
      // cambiato) resta visibile solo in una tendina, come voce a sé: in un
      // segmentato nessun bottone risulterebbe acceso, cioè un valore falso.
      return isShortChoice(kind.options) && kind.options.some((option) => option.value === String(entry.value))
        ? { kind: "segmented", options: kind.options }
        : { kind: "select", options: kind.options };
    case "number": {
      const { min, max } = kind;
      if (
        min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && max > min &&
        fitsTheStep(kind, entry.value)
      ) {
        const step = numberStep(kind, entry.value);
        if ((max - min) / step <= RANGE_MAX_STEPS) return { kind: "range", min, max, step };
      }
      return { kind: "number", min, max };
    }
    case "text":
      return { kind: "text" };
    case "list":
      return { kind: "list" };
  }
}

/// Una scelta breve: da due a tre opzioni, ciascuna con un'etichetta corta.
export function isShortChoice(options: UiOption[]): boolean {
  return (
    options.length >= 2 &&
    options.length <= SEGMENTED_MAX_OPTIONS &&
    options.every((option) => optionLabel(option).length <= SEGMENTED_MAX_LABEL)
  );
}

/// L'etichetta di un'opzione, con il valore nudo come ripiego: un'opzione senza
/// etichetta resta riconoscibile invece di diventare un bottone vuoto.
export function optionLabel(option: UiOption): string {
  return option.label || option.value || t("settings.as_system");
}

/// Il passo del cursore di un numero.
///
/// `SettingKind::Number` non dichiara un passo, e aggiungerlo sarebbe firma: lo
/// si ricava dai numeri che lo schema e il valore portano già. Se sono tutti
/// interi il passo è uno; altrimenti è la decina che rappresenta il più fine di
/// loro (1,7 → 0,1; 1,25 → 0,01), fino al centesimo. Il campo numerico accanto
/// resta libero (`step="any"`): il passo aiuta il trascinamento, non è una
/// regola sul dato — quella la verificano `min` e `max`, nel kernel.
export function numberStep(kind: Extract<SettingKind, { kind: "number" }>, value?: SettingValue): number {
  const numbers = [kind.default, kind.min, kind.max, typeof value === "number" ? value : null]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const decimals = Math.min(2, Math.max(0, ...numbers.map(decimalsOf)));
  return decimals === 0 ? 1 : Number((10 ** -decimals).toFixed(decimals));
}

/// Il cursore sa rappresentare questi numeri? Il suo passo arriva al
/// centesimo: un estremo o un valore più fine (0,005, 1e-7) cadrebbe fra due
/// tacche, e il cursore mostrerebbe e scriverebbe un altro numero. Lì resta il
/// campo numerico, che scrive ciò che si digita.
function fitsTheStep(kind: Extract<SettingKind, { kind: "number" }>, value: SettingValue): boolean {
  return [kind.default, kind.min, kind.max, typeof value === "number" ? value : null]
    .filter((n): n is number => typeof n === "number")
    .every((n) => decimalsOf(n) <= 2);
}

function decimalsOf(n: number): number {
  const text = String(n);
  if (text.includes("e")) return Infinity;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/// Il valore di una riga come lo scriverebbe un umano.
export function show(value: SettingValue): string {
  if (typeof value === "boolean") return t(value ? "settings.on" : "settings.off");
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : t("settings.nothing");
  return String(value);
}

/// Il valore predefinito di una riga, detto come si vedrebbe nel controllo:
/// l'etichetta dell'opzione e non il suo valore, «acceso» e non `true`, e
/// «vuoto» dove il predefinito è la stringa vuota (che a schermo non si vede).
///
/// `empty` è come chiamare il vuoto quando il controllo gli dà un nome suo
/// (lingua e fuso: «come il sistema»).
export function defaultText(entry: SettingEntry, empty = t("settings.value.empty")): string {
  const kind = entry.spec.kind;
  if (kind.kind === "choice") {
    const option = kind.options.find((candidate) => candidate.value === kind.default);
    if (option) return optionLabel(option);
  }
  const text = show(kind.default);
  return text === "" ? empty : text;
}

/// Una riga è **modificata** se qualcuno ha scelto un valore, a qualunque
/// livello: è esattamente ciò che «Ripristina» dimenticherebbe. Un valore scelto
/// uguale al predefinito resta una scelta — e resta tale se il predefinito
/// cambia con la prossima versione.
export function isModified(entry: SettingEntry): boolean {
  return entry.source !== "default";
}

/// Il testo con cui una ricerca confronta: minuscolo e senza diacritici, così
/// «densita» trova «Densità» e «liberta» trova «Libertà».
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/// Le parole di una ricerca, normalizzate. Vuoto = nessun filtro.
export function searchTerms(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter((term) => term !== "");
}

/// Tutto ciò che di una riga si può cercare: etichetta, prosa, chiave, gruppo
/// ed etichette delle opzioni. La chiave c'è per chi la conosce da un file o da
/// una documentazione; le opzioni perché «scuro» deve trovare il tema.
export function searchText(entry: SettingEntry, label = entry.spec.label, description = entry.spec.description): string {
  const kind = entry.spec.kind;
  const options = kind.kind === "choice" ? kind.options.map(optionLabel) : [];
  return normalizeSearch([label, description, entry.spec.key, entry.spec.group, ...options].join(" "));
}

/// Una ricerca trova un testo se **ogni** parola vi compare.
export function matchesTerms(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

/// Una riga passa i filtri del pannello?
export function matchesSearch(
  entry: SettingEntry,
  query: string,
  modifiedOnly = false,
): boolean {
  if (modifiedOnly && !isModified(entry)) return false;
  return matchesTerms(searchText(entry), searchTerms(query));
}

/// L'id di una sezione per l'indice: stabile per titolo e posizione, e fatto
/// solo di caratteri che un selettore d'attributo non deve temere.
export function sectionAnchor(title: string, index: number): string {
  const slug = normalizeSearch(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `settings-section-${index}${slug ? `-${slug}` : ""}`;
}
