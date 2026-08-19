// OKLCH → esadecimale: l'aritmetica con cui un colore del tema **si ricava**
// invece di essere scelto (§31.2).
//
// # Perché OKLCH e non HSL
//
// Perché HSL mente sulla chiarezza. In HSL `hsl(60 100% 50%)` (giallo) e
// `hsl(240 100% 50%)` (blu) hanno la stessa `L`, e uno dei due è quasi bianco e
// l'altro quasi nero: costruire una scala di superfici muovendo `L` in HSL
// produce gradini che si vedono in una tinta e spariscono in un'altra. OKLab è
// uno spazio **percettivamente uniforme**: due colori con la stessa `l` si
// vedono ugualmente chiari qualunque sia la tinta, e due gradini di `l` uguali
// si vedono ugualmente distanti. È la sola proprietà che rende scrivibile la
// frase «una distanza minima fra due gradini adiacenti».
//
// # Perché la conversione sta qui e non in una dipendenza
//
// Perché ha due clienti che non possono divergere. Il primo è la generazione
// dei fogli, che gira una volta e produce testo committato; il secondo è la
// shell, che con la §31.6 deriverà l'accento della persona **a runtime**,
// nella webview. Se i due usassero due implementazioni, un accento scelto
// dall'utente non sarebbe più lo stesso colore che la stessa ricetta produce
// nel foglio, e il presidio del contrasto — che misura il foglio — non direbbe
// più niente sull'altro.
//
// Le matrici sono quelle pubblicate di OKLab (Björn Ottosson, 2020) e la
// codifica di trasferimento è quella di sRGB. Non c'è niente di scelto qui
// dentro: è aritmetica, e i presidi la verificano su valori noti.
//
// # Il gamut, e la sola decisione di questo file
//
// OKLCH descrive più colori di quanti sRGB ne sappia mostrare: `oklch(0.85 0.4
// 130)` è un verde che un monitor non fa. Chi converte deve decidere cosa
// farne, e le due strade danno risultati diversi:
//
// - **tagliare i canali** a [0,1]. È una riga, ed è sbagliata: taglia
//   indipendentemente i tre canali, quindi sposta la tinta e la chiarezza
//   insieme. Un lime fuori gamut diventa un lime più giallo *e* più chiaro, e
//   la chiarezza è precisamente ciò su cui si stanno costruendo i gradini.
// - **abbassare il croma** finché il colore rientra, tenendo `l` e `h` fermi.
//   Costa una bisezione, e conserva le due grandezze che la ricetta dichiara.
//
// Si abbassa il croma. È la stessa scelta della CSS Color 4 (`gamut mapping`),
// meno il ritocco finale in ΔE che qui non serve: le tinte della ricetta stanno
// tutte vicine al bordo, non oltre, e la bisezione è deterministica — cioè
// rigenerare dà gli stessi byte, che è ciò che il presidio pretende.

/// Un colore come la ricetta lo dichiara: chiarezza (0–1), croma (0–~0,4) e
/// tinta in gradi (0–360). Le tre grandezze sono indipendenti, che è tutto il
/// punto: si può alzare la chiarezza di un colore senza cambiare che colore è.
export type Oklch = { readonly l: number; readonly c: number; readonly h: number };

/// Da OKLab a sRGB **lineare** (senza la codifica di trasferimento).
function aLineare(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/// La codifica di trasferimento di sRGB, dal lineare al valore che si scrive.
function codifica(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/// Se i tre canali lineari stanno dentro sRGB. La tolleranza è quella della
/// quantizzazione a otto bit: un canale a `-1e-9` è dentro, e pretendere lo
/// zero esatto farebbe abbassare il croma a colori che si rendono benissimo.
function dentroIlGamut([r, g, b]: [number, number, number]): boolean {
  const soglia = 1 / 512;
  return [r, g, b].every((v) => v >= -soglia && v <= 1 + soglia);
}

/// I tre canali a otto bit, con la chiarezza e la tinta tenute ferme e il croma
/// abbassato quanto serve a rientrare in sRGB.
///
/// La bisezione fa un numero **fisso** di giri: venti, che portano l'incertezza
/// sul croma sotto un milionesimo, cioè molto sotto un passo di quantizzazione.
/// È fisso e non «finché converge» perché la generazione deve dare gli stessi
/// byte a ogni corsa, su qualunque macchina.
function canaliDi({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const lineare = (croma: number) =>
    aLineare(l, croma * Math.cos(rad), croma * Math.sin(rad));

  let dentro = lineare(c);
  if (!dentroIlGamut(dentro)) {
    let basso = 0;
    let alto = c;
    for (let giro = 0; giro < 20; giro += 1) {
      const meta = (basso + alto) / 2;
      const prova = lineare(meta);
      if (dentroIlGamut(prova)) {
        basso = meta;
        dentro = prova;
      } else {
        alto = meta;
      }
    }
  }

  return dentro.map((v) => Math.round(Math.min(1, Math.max(0, codifica(v))) * 255)) as [
    number,
    number,
    number,
  ];
}

/// Il colore come si scrive in un foglio: `#rrggbb`, sempre in sei cifre e
/// sempre minuscolo. La forma corta (`#fff`) non si emette apposta — i due
/// presidi che leggono i fogli come testo confrontano stringhe, e due modi di
/// scrivere lo stesso colore sono due stringhe.
export function esa(colore: Oklch): string {
  return `#${canaliDi(colore)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// ---------------------------------------------------------------------------
// Il verso opposto: serve a **misurare** ciò che esiste già.
// ---------------------------------------------------------------------------

/// La decodifica di trasferimento di sRGB, dal valore scritto al lineare.
function decodifica(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/// Da `#rrggbb` a OKLCH. Non lo usa la generazione — che parte dalla ricetta e
/// non torna indietro — ma lo usa chi deve dire *dove stava* un colore scelto a
/// mano: è così che le tinte di questa ricetta sono state prese dalla tavolozza
/// che c'era, invece di essere immaginate da capo.
export function daEsa(esadecimale: string): Oklch {
  const cifre = esadecimale.trim().replace(/^#/, "");
  const [r, g, b] = [0, 2, 4].map((i) =>
    decodifica(parseInt(cifre.slice(i, i + 2), 16) / 255),
  ) as [number, number, number];

  const L = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const M = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const S = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * L + 0.793617785 * M - 0.0040720468 * S;
  const a = 1.9779984951 * L - 2.428592205 * M + 0.4505937099 * S;
  const bb = 0.0259040371 * L + 0.7827717662 * M - 0.808675766 * S;

  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}
