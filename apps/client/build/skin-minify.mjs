// La pelle composta nella build: senza commenti, rientri e spazi che non
// contano. Arriva nel bundle come testo (`?raw`), e Vite il testo non lo
// minimizza: commenti e rientri pesavano quanto le regole, e il chunk
// `theme-skin` sta sotto il budget di `vite.config.ts` solo senza di loro.
//
// Le regole restano le stesse, una per una: stessi selettori, proprietà e
// valori, a meno degli spazi che la grammatica del CSS ignora. Lo prova
// `skin-minify.test.mjs` sulla pelle vera, confrontando gli alberi di postcss
// (il parser del sanitizzatore) prima e dopo.
//
// Che cosa non si tocca:
// - le stringhe (`content: "…"`, `url("…")`), carattere per carattere;
// - un `url(` senza virgolette, fino alla sua `)`;
// - gli escape (`\31 a`): lo spazio che chiude un escape esadecimale è suo;
// - lo spazio prima di `(` (`and (` non è `and(`, che sarebbe una funzione),
//   dopo `)` e attorno a `+`, `-`, `*`, `/`, `~`, `!` (`calc(1px + 2px)`);
// - lo spazio prima di `:` (`.a :hover` non è `.a:hover`);
// - il valore vuoto di una proprietà personalizzata (`--x: ;`).
//
// Che cosa si toglie: i commenti; gli spazi a inizio e fine; gli spazi attorno
// a `{`, `}`, `;`, `,`, `>`, dopo `(` e `:`, prima di `)`; ogni altra serie di
// spazi diventa uno spazio solo; il `;` prima di `}`.

/** Dopo questi caratteri uno spazio non conta. */
const NO_SPACE_AFTER = new Set(["{", "}", ";", ",", ">", "(", ":"]);
/** Prima di questi caratteri uno spazio non conta. */
const NO_SPACE_BEFORE = new Set(["{", "}", ";", ",", ">", ")"]);

const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isHex = (c) => /^[0-9a-fA-F]$/.test(c);
/** Un carattere che può stare dentro un identificatore o un numero: due di
 * questi ai lati di un commento, senza il commento, diventerebbero un token
 * solo. */
const isWordy = (c) => c !== undefined && (/^[\w%\\-]$/.test(c) || c.charCodeAt(0) >= 0x80);

/**
 * Il CSS `css` senza commenti né spazi superflui, regola per regola uguale.
 * Un commento o una stringa che non si chiude arrivano in fondo, come nel
 * tokenizzatore del CSS.
 *
 * @param {string} css
 * @returns {string}
 */
export function minifySkin(css) {
  let out = "";
  let pending = false;
  let i = 0;
  /** L'ultimo carattere scritto, se era punteggiatura del CSS e non il pezzo
   * di una stringa o di un escape (`\;`, `"a,"`). */
  let plain = null;
  const last = () => out[out.length - 1];
  /** Prima di scrivere `c`: lo spazio in sospeso, se conta. */
  const flush = (c) => {
    if (pending && out.length > 0) {
      // `--x: ;` è un valore vuoto; `--x:;` per un motore vecchio no.
      const emptyValue = plain === ":" && (c === ";" || c === "}");
      if (emptyValue || (!NO_SPACE_AFTER.has(plain) && !NO_SPACE_BEFORE.has(c))) out += " ";
    }
    pending = false;
    plain = null;
  };
  while (i < css.length) {
    const c = css[i];
    if (isSpace(c)) {
      pending = true;
      i++;
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      // `a/**/b` sono due token: senza niente in mezzo sarebbero uno solo.
      if (!pending && isWordy(last()) && isWordy(css[i])) {
        out += "/**/";
        plain = null;
      }
    } else if (c === '"' || c === "'") {
      flush(c);
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === "\\") {
      flush(c);
      let j = i + 1;
      if (isHex(css[j] ?? "")) {
        while (j < css.length && j - i <= 6 && isHex(css[j])) j++;
        out += css.slice(i, j);
        // Lo spazio che chiude l'escape fa parte dell'escape.
        if (css[j] === "\r" && css[j + 1] === "\n") j++;
        if (isSpace(css[j] ?? "")) {
          out += " ";
          j++;
        }
        i = j;
      } else {
        out += css.slice(i, j + 1);
        i = j + 1;
      }
    } else if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4)) && !isWordy(css[i - 1])) {
      flush(c);
      let j = i + 4;
      while (j < css.length && isSpace(css[j])) j++;
      if (css[j] === '"' || css[j] === "'") {
        // `url("…")` è una funzione con una stringa: la stringa la copia il
        // ramo delle stringhe.
        out += css.slice(i, i + 4);
        plain = "(";
        i += 4;
      } else {
        const end = css.indexOf(")", j);
        const stop = end === -1 ? css.length : end + 1;
        out += css.slice(i, stop);
        i = stop;
      }
    } else {
      const previous = plain;
      flush(c);
      if (c === "}" && previous === ";") out = out.slice(0, -1);
      out += c;
      plain = c;
      i++;
    }
  }
  return out;
}
