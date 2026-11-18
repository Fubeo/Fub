// Il catalogo dei simboli della formula (T61, E27): ogni simbolo col suo
// disegno, quello che entra nella formula (coi suoi spazi vuoti), il nome in
// italiano e in inglese, le altre parole con cui si cerca e la sua scrittura
// veloce. Solo dati e la scelta delle proposte, senza DOM: la tavolozza (T62)
// e le proposte dopo `\` leggono lo stesso catalogo, così un simbolo ha un
// nome solo in tutta l'app.
//
// Il catalogo è quello del prototipo (`SYM` di `PLAN-ui/editor.html`), voce
// per voce; i nomi inglesi e le parole inglesi sono di Fub.

/// I sette gruppi della tavolozza, nell'ordine in cui si vedono.
export type SymbolGroup = "structure" | "greek" | "operators" | "relations" | "arrows" | "sets" | "brackets";

export const GROUPS: readonly SymbolGroup[] = ["structure", "greek", "operators", "relations", "arrows", "sets", "brackets"];

/// Le lingue dei nomi. Una lingua che non c'è legge l'italiano.
export type SymbolLanguage = "it" | "en";

export interface MathSymbol {
  /// Il nome stabile: il comando senza la `\`, o una parola per i pezzi senza
  /// comando (`power`, `subscript`).
  readonly id: string;
  readonly group: SymbolGroup;
  /// Come si disegna nelle proposte e nella tavolozza (TeX).
  readonly glyph: string;
  /// Che cosa entra nella formula: `{}` è uno spazio vuoto, `§` dove va il
  /// cursore se non nel primo spazio vuoto.
  readonly template: string;
  readonly name: Readonly<Record<SymbolLanguage, string>>;
  /// Le altre parole con cui si trova, per lingua, separate da spazi.
  readonly words: Readonly<Record<SymbolLanguage, string>>;
  /// La scrittura veloce (T63), se ce n'è una: `a/b`, `->`, `alpha`.
  readonly quick: string;
}

type Row = readonly [group: SymbolGroup, glyph: string, template: string, it: string, en: string, wordsIt: string, wordsEn: string, quick: string];

/// Il comando con cui un modello comincia: `\frac` per `\frac{}{}`, `\left`
/// per le parentesi; niente per `^{}`.
function commandOf(template: string): string {
  return /^\\[a-zA-Z]+/.exec(template)?.[0] ?? "";
}

function idOf(row: Row): string {
  const command = commandOf(row[2]).slice(1);
  if (command && command !== "left" && command !== "begin") {
    // Più simboli dallo stesso comando (`\sqrt`, `\sqrt[n]`, `\mathbb{R}`):
    // il resto del disegno li distingue.
    return command;
  }
  return row[4].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STRUCTURE: readonly Row[] = [
  ["structure", "\\frac{a}{b}", "\\frac{}{}", "Frazione", "Fraction", "fratto diviso rapporto", "over divided ratio", "a/b"],
  ["structure", "x^{n}", "^{}", "Potenza", "Power", "esponente apice alla quadrato", "exponent superscript squared", "^"],
  ["structure", "x_{i}", "_{}", "Pedice", "Subscript", "indice basso", "index lower", "_"],
  ["structure", "\\sqrt{x}", "\\sqrt{}", "Radice quadrata", "Square root", "radice", "root", "sqrt"],
  ["structure", "\\sum", "\\sum_{}^{}", "Sommatoria", "Sum", "somma", "summation sigma", "sum"],
  ["structure", "\\int", "\\int_{}^{}", "Integrale", "Integral", "", "", "int"],
  ["structure", "\\lim", "\\lim_{}", "Limite", "Limit", "tende", "tends", "lim"],
  ["structure", "\\text{ab}", "\\text{}", "Testo", "Text", "parole scritta", "words", "\"…\""],
  ["structure", "\\sqrt[n]{x}", "\\sqrt[n]{}", "Radice ennesima", "Nth root", "radice cubica", "root cube", ""],
  ["structure", "\\prod", "\\prod_{}^{}", "Produttoria", "Product", "prodotto", "", ""],
  ["structure", "\\frac{d}{dx}", "\\frac{d}{dx}", "Derivata", "Derivative", "derivata", "", ""],
  ["structure", "\\frac{\\partial}{\\partial x}", "\\frac{\\partial}{\\partial x}", "Derivata parziale", "Partial derivative", "parziale", "partial", ""],
  ["structure", "\\binom{n}{k}", "\\binom{}{}", "Coefficiente binomiale", "Binomial coefficient", "binomio combinazioni", "choose combinations", ""],
  ["structure", "\\vec{v}", "\\vec{}", "Vettore", "Vector", "freccia sopra", "arrow above", ""],
  ["structure", "\\bar{x}", "\\bar{}", "Media, barra sopra", "Mean, bar above", "soprallineato medio", "overline average", ""],
  ["structure", "\\hat{a}", "\\hat{}", "Cappello", "Hat", "stimato versore", "estimate unit", ""],
];

const GREEK: readonly Row[] = [
  ...([
    ["alpha", "Alfa", "Alpha"], ["beta", "Beta", "Beta"], ["gamma", "Gamma", "Gamma"], ["delta", "Delta", "Delta"],
    ["epsilon", "Epsilon", "Epsilon"], ["theta", "Teta", "Theta"], ["lambda", "Lambda", "Lambda"], ["mu", "Mi", "Mu"],
    ["pi", "Pi greco", "Pi"], ["rho", "Ro", "Rho"], ["sigma", "Sigma", "Sigma"], ["tau", "Tau", "Tau"], ["phi", "Fi", "Phi"],
    ["omega", "Omega", "Omega"],
  ] as const).map(([command, it, en]): Row => ["greek", `\\${command}`, `\\${command}`, it, en, "greca lettera", "greek letter", command]),
  ...([
    ["Gamma", "Gamma maiuscola", "Capital gamma"], ["Delta", "Delta maiuscola", "Capital delta"],
    ["Sigma", "Sigma maiuscola", "Capital sigma"], ["Phi", "Fi maiuscola", "Capital phi"], ["Omega", "Omega maiuscola", "Capital omega"],
  ] as const).map(([command, it, en]): Row => ["greek", `\\${command}`, `\\${command}`, it, en, "greca lettera", "greek letter uppercase", ""]),
];

const OPERATORS: readonly Row[] = [
  ["operators", "\\times", "\\times", "Per", "Times", "moltiplicato prodotto", "multiplied product", "×"],
  ["operators", "\\cdot", "\\cdot", "Punto", "Dot", "per prodotto", "times product", "·"],
  ["operators", "\\div", "\\div", "Diviso", "Divided by", "", "division", "÷"],
  ["operators", "\\pm", "\\pm", "Più o meno", "Plus or minus", "", "", "+-"],
  ["operators", "\\infty", "\\infty", "Infinito", "Infinity", "", "", "inf"],
  ["operators", "\\partial", "\\partial", "Parziale", "Partial", "derivata", "derivative", ""],
  ["operators", "\\nabla", "\\nabla", "Nabla", "Nabla", "gradiente", "gradient", ""],
  ["operators", "^\\circ", "^\\circ", "Gradi", "Degrees", "grado angolo", "degree angle", "°"],
  ["operators", "\\%", "\\%", "Per cento", "Percent", "percento percentuale", "percentage", ""],
  ["operators", "\\dots", "\\dots", "Puntini", "Dots", "eccetera", "ellipsis etc", "..."],
];

const RELATIONS: readonly Row[] = [
  ["relations", "\\le", "\\le", "Minore o uguale", "Less than or equal", "", "", "<="],
  ["relations", "\\ge", "\\ge", "Maggiore o uguale", "Greater than or equal", "", "", ">="],
  ["relations", "\\ne", "\\ne", "Diverso", "Not equal", "non uguale", "different", "!="],
  ["relations", "\\approx", "\\approx", "Circa uguale", "Approximately equal", "approssimato", "about", "~="],
  ["relations", "\\equiv", "\\equiv", "Equivalente", "Equivalent", "identico", "identical", ""],
  ["relations", "\\propto", "\\propto", "Proporzionale", "Proportional", "", "", ""],
  ["relations", "\\ll", "\\ll", "Molto minore", "Much less than", "", "", ""],
  ["relations", "\\gg", "\\gg", "Molto maggiore", "Much greater than", "", "", ""],
];

const ARROWS: readonly Row[] = [
  ["arrows", "\\to", "\\to", "Freccia a destra", "Right arrow", "tende va", "tends goes to", "->"],
  ["arrows", "\\leftarrow", "\\leftarrow", "Freccia a sinistra", "Left arrow", "", "", ""],
  ["arrows", "\\Rightarrow", "\\Rightarrow", "Implica", "Implies", "quindi allora", "therefore then", "=>"],
  ["arrows", "\\Leftrightarrow", "\\Leftrightarrow", "Se e solo se", "If and only if", "equivale doppia", "iff equivalent double", ""],
  ["arrows", "\\mapsto", "\\mapsto", "Manda in", "Maps to", "funzione", "function", ""],
  ["arrows", "\\uparrow", "\\uparrow", "Freccia in su", "Up arrow", "cresce", "increases", ""],
  ["arrows", "\\downarrow", "\\downarrow", "Freccia in giù", "Down arrow", "cala", "decreases", ""],
];

const SETS: readonly Row[] = [
  ["sets", "\\in", "\\in", "Appartiene", "Element of", "elemento", "in belongs", ""],
  ["sets", "\\notin", "\\notin", "Non appartiene", "Not an element of", "", "", ""],
  ["sets", "\\subset", "\\subset", "Sottoinsieme", "Subset", "contenuto", "contained", ""],
  ["sets", "\\cup", "\\cup", "Unione", "Union", "", "", ""],
  ["sets", "\\cap", "\\cap", "Intersezione", "Intersection", "", "", ""],
  ["sets", "\\emptyset", "\\emptyset", "Insieme vuoto", "Empty set", "", "", ""],
  ["sets", "\\forall", "\\forall", "Per ogni", "For all", "", "every", ""],
  ["sets", "\\exists", "\\exists", "Esiste", "Exists", "", "there is", ""],
  ["sets", "\\mathbb{R}", "\\mathbb{R}", "Numeri reali", "Real numbers", "insieme", "set", ""],
  ["sets", "\\mathbb{N}", "\\mathbb{N}", "Numeri naturali", "Natural numbers", "insieme", "set", ""],
  ["sets", "\\land", "\\land", "E", "And", "logico and", "logical", ""],
  ["sets", "\\lor", "\\lor", "O", "Or", "logico or", "logical", ""],
  ["sets", "\\neg", "\\neg", "Non", "Not", "negazione", "negation", ""],
];

const BRACKETS: readonly Row[] = [
  ["brackets", "(\\,)", "\\left(§\\right)", "Parentesi tonde che crescono", "Growing parentheses", "tonde", "round brackets", ""],
  ["brackets", "[\\,]", "\\left[§\\right]", "Parentesi quadre che crescono", "Growing square brackets", "quadre", "square", ""],
  ["brackets", "\\{\\,\\}", "\\left\\{§\\right\\}", "Parentesi graffe", "Braces", "graffe insieme", "curly set", ""],
  ["brackets", "|x|", "\\left|§\\right|", "Valore assoluto", "Absolute value", "modulo", "modulus", ""],
  ["brackets", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\begin{pmatrix} § &  \\\\  &  \\end{pmatrix}", "Matrice 2 per 2", "2 by 2 matrix", "matrice tabella", "matrix table", ""],
  ["brackets", "\\begin{pmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{pmatrix}", "\\begin{pmatrix} § &  &  \\\\  &  &  \\\\  &  &  \\end{pmatrix}", "Matrice 3 per 3", "3 by 3 matrix", "matrice", "matrix", ""],
  ["brackets", "\\begin{cases}a\\\\b\\end{cases}", "\\begin{cases} § & \\text{se }  \\\\  & \\text{altrimenti} \\end{cases}", "Casi", "Cases", "sistema definizione a tratti", "piecewise system", ""],
];

/// Tutti i simboli, nell'ordine della tavolozza: i primi otto sono i pezzi
/// più usati (la riga sotto la formula, T62).
export const SYMBOLS: readonly MathSymbol[] = (() => {
  const seen = new Map<string, number>();
  return [...STRUCTURE, ...GREEK, ...OPERATORS, ...RELATIONS, ...ARROWS, ...SETS, ...BRACKETS].map((row): MathSymbol => {
    let id = idOf(row);
    // `\sqrt` e `\sqrt[n]`, `\mathbb{R}` e `\mathbb{N}`: lo stesso comando.
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${row[4].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return {
      id,
      group: row[0],
      glyph: row[1],
      template: row[2],
      name: { it: row[3], en: row[4] },
      words: { it: row[5], en: row[6] },
      quick: row[7],
    };
  });
})();

/// I pezzi che entrano coi loro spazi vuoti (E27).
export const PIECES: readonly string[] = ["frac", "power", "subscript", "sqrt", "sum", "int", "lim", "text"];

/// Il comando con cui il simbolo entra: `\frac`, `\alpha`, `\left`; vuoto per
/// `^{}` e `_{}`, che si scrivono coi loro tasti.
export function commandName(symbol: MathSymbol): string {
  return commandOf(symbol.template);
}

/// Il nome del simbolo nella lingua di chi guarda.
export function symbolName(symbol: MathSymbol, language: string): string {
  return language.toLowerCase().startsWith("en") ? symbol.name.en : symbol.name.it;
}

/// Senza accenti e in minuscolo, per confrontare: «Più» si trova con `piu`.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const wordsOf = (text: string): string[] => fold(text).split(/[\s,]+/).filter(Boolean);

interface Folded {
  readonly symbol: MathSymbol;
  readonly command: string;
  readonly names: readonly string[];
  readonly words: readonly string[];
}

/// Le parole di ogni simbolo, già piegate: le proposte si scelgono a ogni
/// tasto, in memoria.
const FOLDED: readonly Folded[] = SYMBOLS.map((symbol) => ({
  symbol,
  command: commandName(symbol).slice(1),
  names: [...wordsOf(symbol.name.it), ...wordsOf(symbol.name.en)],
  words: [...wordsOf(symbol.words.it), ...wordsOf(symbol.words.en)],
}));

/// Quante proposte si vedono al più.
export const PROPOSAL_LIMIT = 5;

/// Le proposte per il nome scritto dopo `\` (senza la `\`), le migliori
/// prima: il comando uguale (prima con le stesse maiuscole), poi il comando
/// che comincia così, il nome in italiano o in inglese, le altre parole. Solo
/// i simboli che entrano con un comando: `^` e `_` hanno i loro tasti. Un nome
/// che non c'è (`alpah`) trova il simbolo più vicino.
export function propose(query: string, limit = PROPOSAL_LIMIT): MathSymbol[] {
  if (!query) return [];
  const q = fold(query);
  const ranked: { rank: number; symbol: MathSymbol }[] = [];
  for (const entry of FOLDED) {
    if (!entry.command) continue;
    const command = entry.command.toLowerCase();
    let rank = 9;
    if (entry.command === query) rank = -2;
    else if (command === q) rank = -1;
    else if (command.startsWith(q)) rank = 0;
    else if (entry.names.some((word) => word.startsWith(q))) rank = 1;
    else if (entry.words.some((word) => word.startsWith(q))) rank = 2;
    if (rank < 9) ranked.push({ rank, symbol: entry.symbol });
  }
  if (ranked.length === 0) {
    const near = nearest(query);
    return near ? [near] : [];
  }
  // L'ordinamento è stabile: a pari merito resta l'ordine del catalogo.
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map((entry) => entry.symbol);
}

/// Il simbolo più vicino a un nome che non c'è, a due lettere al più di
/// distanza dal comando o da un nome: `alpah` è `\alpha`, `alfa` è Alfa.
export function nearest(query: string): MathSymbol | null {
  const q = fold(query);
  if (q.length < 3) return null;
  let best: MathSymbol | null = null;
  let distance = 3;
  for (const entry of FOLDED) {
    if (!entry.command) continue;
    for (const word of [entry.command.toLowerCase(), ...entry.names]) {
      if (Math.abs(word.length - q.length) >= distance) continue;
      const d = levenshtein(q, word);
      if (d < distance) {
        distance = d;
        best = entry.symbol;
      }
    }
  }
  return best;
}

/// Le proposte si nascondono quando non aggiungono niente: una sola, che
/// entra esattamente com'è scritta (`\alpha`).
export function proposalsAddNothing(query: string, proposals: readonly MathSymbol[]): boolean {
  return proposals.length === 1 && proposals[0]!.template === `\\${query}`;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}
