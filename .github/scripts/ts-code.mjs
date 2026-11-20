// Il codice di un sorgente TypeScript senza commenti né letterali, per le
// guardie che lo leggono con le espressioni regolari (`check-races.mjs`,
// `check-listeners.mjs`): una graffa, un `await` o un `addEventListener`
// scritti in un commento o in una stringa non sono codice, e un commento non
// deve nascondere il codice che gli sta accanto sulla stessa riga.
//
// Non è un parser: segue commenti, stringhe, template annidati e regex
// letterali quanto basta per non sbagliare i confini. Le posizioni restano
// quelle del sorgente (spazi al posto di ciò che toglie, a capo tenuti), così
// le guardie danno ancora il numero di riga giusto.

/// Il testo con commenti e contenuto dei letterali svuotati.
export function codeOnly(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " ";
  };
  // Per ogni `${` aperto, la profondità delle graffe di codice al suo interno:
  // la `}` che la riporta a zero chiude il segnaposto e si torna nel template.
  const templates = [];
  let index = 0;
  // L'ultimo pezzo di codice non bianco: dice se una `/` apre una regex.
  let previous = "";
  const template = () => {
    // Da dopo il backtick (o la `}` di un segnaposto) fino al backtick o a `${`.
    const from = index;
    while (index < text.length && text[index] !== "`") {
      if (text[index] === "\\") index++;
      else if (text[index] === "$" && text[index + 1] === "{") {
        blank(from, index);
        templates.push(0);
        index += 2;
        previous = "{";
        return;
      }
      index++;
    }
    blank(from, index);
    index++;
    previous = "`";
  };
  while (index < text.length) {
    const char = text[index];
    const pair = text.slice(index, index + 2);
    if (pair === "//") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      blank(index, stop);
      index = stop;
    } else if (pair === "/*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < text.length && text[stop] !== char && text[stop] !== "\n") {
        if (text[stop] === "\\") stop++;
        stop++;
      }
      blank(index + 1, stop);
      index = stop + 1;
      previous = char;
    } else if (char === "`") {
      index++;
      template();
    } else if (char === "/" && (previous === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(previous))) {
      // Una regex letterale: può contenere virgolette e graffe che non contano.
      let stop = index + 1;
      let inClass = false;
      while (stop < text.length && text[stop] !== "\n") {
        if (text[stop] === "\\") stop++;
        else if (text[stop] === "[") inClass = true;
        else if (text[stop] === "]") inClass = false;
        else if (text[stop] === "/" && !inClass) break;
        stop++;
      }
      blank(index + 1, stop);
      index = stop + 1;
      previous = "/";
    } else if (templates.length && char === "{") {
      templates[templates.length - 1]++;
      index++;
      previous = char;
    } else if (templates.length && char === "}") {
      if (templates[templates.length - 1] === 0) {
        templates.pop();
        index++;
        template();
      } else {
        templates[templates.length - 1]--;
        index++;
        previous = char;
      }
    } else if (/\s/.test(char)) {
      index++;
    } else {
      // Dopo `return`, `typeof` e simili una `/` apre una regex, dopo un nome
      // o una parentesi chiusa è una divisione.
      const word = /[\w$]/.test(char) ? text.slice(index).match(/^[\w$]+/)[0] : char;
      previous = /^(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(word) ? "(" : word.at(-1);
      index += word.length;
    }
  }
  return out.join("");
}

/// L'autoprova di `codeOnly`: lancia un errore col primo caso sbagliato.
export function selfTestCode() {
  const cases = [
    ["un commento di riga", "a(); // b()", "a();       "],
    ["un commento a blocco prima del codice", "/* x */ b();", "        b();"],
    ["una stringa con una graffa", 'f("}");', 'f(" ");'],
    ["un template annidato", "`a ${b ? `c${d}` : \"}\"} e`; g();", "`  ${b ? ` ${d}` : \" \"}  `; g();"],
    ["una regex con una virgoletta", "q = /[\"']/g; h();", "q = /    /g; h();"],
    ["una divisione non è una regex", "x = a / b / c; i();", "x = a / b / c; i();"],
    ["una regex dopo return", "return /\"/.test(s); j();", "return / /.test(s); j();"],
    ["gli a capo restano", "/* a\nb */ k();", "    \n     k();"],
  ];
  for (const [label, source, expected] of cases) {
    const actual = codeOnly(source);
    if (actual !== expected) {
      throw new Error(`codeOnly, ${label}: atteso ${JSON.stringify(expected)}, trovato ${JSON.stringify(actual)}`);
    }
  }
  return cases.length;
}
