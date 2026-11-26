// I tasti dei segni nel Completo, per posizione (piano K6; `docs/product/drawing.md`, «I tasti
// del Completo»). VectorCraft scrive i suoi tasti sulla tastiera americana (`Cmd+[`, `\`,
// `Shift+~`): nel Completo un segno vale per il **tasto fisico** che lo porta là, su ogni
// tastiera, e si legge col segno che quel tasto porta sulla tastiera di chi scrive. Sulla
// tastiera italiana `Cmd+[` è Ctrl+È, `\` (Segmento) è Ù, `/` (Nessun colore) è il tasto del
// meno.
//
// Il segno di un tasto sulla tastiera di chi scrive arriva, nell'ordine, da:
//
// 1. ciò che la tastiera stessa ha già detto: ogni tasto premuto senza modificatori insegna il
//    suo segno (`impara`);
// 2. la mappa del sistema, dove la WebView la dà (`navigator.keyboard.getLayoutMap`, Chromium);
// 3. la tastiera della lingua dell'app, per le lingue di cui Fub ne conosce una (l'italiano);
// 4. il segno americano, com'è scritto.
//
// Le lettere restano dei loro caratteri. Le cifre sono qui per il Maiusc (Maiusc+2 è `@` sulla
// tastiera americana e `"` su quella italiana); senza, una cifra è la stessa ovunque.

import type { KeyChord } from "../../../ui/commands";

/// Il segno di ogni tasto fisico (`KeyboardEvent.code`) sulla tastiera americana, senza e con
/// Maiusc: quella su cui VectorCraft scrive i suoi tasti.
const AMERICANA: Readonly<Record<string, readonly [string, string]>> = {
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Backquote: ["`", "~"],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
};

/// Il tasto fisico e il Maiusc di ogni segno americano.
const POSTO_DEL_SEGNO: ReadonlyMap<string, { readonly code: string; readonly maiusc: boolean }> = new Map(
  Object.entries(AMERICANA).flatMap(([code, [senza, con]]): [string, { code: string; maiusc: boolean }][] => [
    [senza, { code, maiusc: false }],
    [con, { code, maiusc: true }],
  ]),
);

/// Le tastiere che Fub conosce per lingua: il segno di ogni tasto dei segni senza Maiusc.
const PER_LINGUA: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  it: {
    Minus: "'",
    Equal: "ì",
    BracketLeft: "è",
    BracketRight: "+",
    Backslash: "ù",
    Semicolon: "ò",
    Quote: "à",
    Backquote: "\\",
    Comma: ",",
    Period: ".",
    Slash: "-",
  },
};

/// I segni imparati dalla tastiera, e quelli della mappa del sistema.
const imparati = new Map<string, string>();
let delSistema: ReadonlyMap<string, string> | null = null;
let chiesta = false;

/// Il segno americano senza Maiusc del tasto fisico di `evento`, o `null` se il tasto non è uno
/// dei segni (una lettera, una cifra, un tasto senza `code`).
export function segnoAmericano(evento: Pick<KeyChord, "code">): string | null {
  const segni = evento.code === undefined ? undefined : AMERICANA[evento.code];
  return segni === undefined ? null : segni[0];
}

/// Il segno americano senza Maiusc e il Maiusc del tasto che porta `segno` (`~` è Maiusc+`` ` ``),
/// o `null` se `segno` non è un segno americano.
export function postoDelSegno(segno: string): { readonly segno: string; readonly maiusc: boolean } | null {
  const posto = POSTO_DEL_SEGNO.get(segno);
  return posto === undefined ? null : { segno: AMERICANA[posto.code]![0], maiusc: posto.maiusc };
}

/// Un tasto premuto insegna il segno del suo tasto fisico, se è un tasto dei segni premuto senza
/// Maiusc, Ctrl, Cmd o Alt (con Alt Gr il segno è un altro).
export function impara(evento: KeyChord): void {
  if (evento.shiftKey || evento.ctrlKey || evento.metaKey || evento.altKey) return;
  if (evento.code === undefined || !(evento.code in AMERICANA)) return;
  if ([...evento.key].length !== 1) return;
  imparati.set(evento.code, evento.key);
}

interface MappaDellaTastiera {
  getLayoutMap?: () => Promise<ReadonlyMap<string, string>>;
}

/// Chiede una volta la mappa del sistema, dove la WebView la dà. Senza, restano gli altri segni.
function chiediAlSistema(): void {
  if (chiesta) return;
  chiesta = true;
  const tastiera = (globalThis.navigator as { keyboard?: MappaDellaTastiera } | undefined)?.keyboard;
  try {
    void tastiera?.getLayoutMap?.().then(
      (mappa) => {
        delSistema = mappa;
      },
      () => undefined,
    );
  } catch {
    // Una WebView che la nega: restano gli altri segni.
  }
}

function lingua(): string {
  return (globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "").slice(0, 2).toLowerCase();
}

/// Il segno che il tasto fisico `code` porta sulla tastiera di chi scrive, senza Maiusc.
function segnoDelTasto(code: string): string {
  chiediAlSistema();
  return imparati.get(code) ?? delSistema?.get(code) ?? PER_LINGUA[lingua()]?.[code] ?? AMERICANA[code]?.[0] ?? code;
}

/// Il segno americano `segno` come si legge sulla tastiera di chi scrive: il segno del tasto
/// fisico, maiuscolo (`[` → `È` sulla tastiera italiana), col Maiusc davanti se il segno
/// americano lo vuole (`~` → `Shift+\`). Un carattere che non è un segno americano resta com'è.
export function segnoDaLeggere(segno: string): { readonly segno: string; readonly maiusc: boolean } {
  const posto = POSTO_DEL_SEGNO.get(segno);
  if (posto === undefined) return { segno, maiusc: false };
  const locale = segnoDelTasto(posto.code);
  // Sulla tastiera americana un segno con Maiusc si legge com'è (`~`, non `Shift+``).
  if (posto.maiusc && locale === AMERICANA[posto.code]![0]) return { segno, maiusc: false };
  return { segno: locale.toLocaleUpperCase(), maiusc: posto.maiusc };
}

/// Un tasto scritto come lo scrive `displayBinding` della shell (`Ctrl+Shift+]`, `⌘[`, `\`) col
/// segno finale della tastiera di chi scrive: `Ctrl+Shift+È`. Le scritte senza un segno finale
/// restano come sono.
export function scrittaDelTasto(scritta: string, mac = false): string {
  const fine = [...scritta].pop();
  if (fine === undefined || !POSTO_DEL_SEGNO.has(fine)) return scritta;
  const testa = scritta.slice(0, scritta.length - fine.length);
  const letto = segnoDaLeggere(fine);
  if (letto.segno === fine) return scritta;
  const maiusc = letto.maiusc && !/(Shift\+|⇧)$/.test(testa) ? (mac ? "⇧" : "Shift+") : "";
  return `${testa}${maiusc}${letto.segno}`;
}

/// Solo per le prove: dimentica i segni imparati e la mappa del sistema.
export function dimenticaLaTastiera(): void {
  imparati.clear();
  delSistema = null;
  chiesta = false;
}
