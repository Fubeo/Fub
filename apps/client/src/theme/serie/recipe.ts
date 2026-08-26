// **La ricetta del tema di serie** (§31.2): da qui escono i due fogli.
//
// # Cosa è cambiato, e perché era un difetto
//
// Fino alla [0166](../../../../docs/decisions/0196-test-e-artefatti-generati.md) i due
// fogli erano novanta valori esadecimali scelti a mano: prima si sceglieva, poi
// `contrast.test.ts` diceva sì o no, e quando diceva no si spostava il valore
// finché diceva sì. Un presidio ferma il rosso, non produce il bello — e il
// prezzo si ripagava intero a ogni tavolozza nuova: l'alto contrasto (§31.7) e
// l'accento della persona (§31.6) sono due tavolozze in più.
//
// Qui il numero si scrive **accanto a come si ricava**, che è la
// [0072](../../../../docs/decisions/0196-test-e-artefatti-generati.md)
// presa alla lettera. Un inchiostro non dichiara un esadecimale: dichiara *che
// colore è* (tinta e croma), *sopra cosa deve stare* e *quanto deve reggere*. La
// chiarezza — l'unica grandezza che il contrasto muove — la trova la
// generazione, cercandola dal fondo in su nella luce scura e dal fondo in giù
// in quella chiara.
//
// # Perché la sorgente è OKLCH e il foglio resta esadecimale
//
// Perché sono due domande diverse. La sorgente deve poter dire «alza la
// chiarezza senza cambiare che colore è», e in HSL quella frase non ha
// significato (`oklch.ts` racconta il perché). Il foglio deve poter essere
// **letto come testo** da tre presidi che non hanno un motore di rendering, e
// `oklch()` vivo nel CSS lo renderebbe un valore che solo un browser sa dire.
// Quindi: si scrive in un posto, si legge da due — è lo schema della
// [0020](../../../../docs/decisions/README.md) e dei
// `*.generated.ts`, e il presidio è lo stesso: rigenerare deve dare **gli
// stessi byte**.
//
//     npm run tema:genera        rigenera i due fogli
//     npm run tema:verifica      dice se sono quelli che la ricetta produce
//
// # La scala delle superfici
//
// I fogli di prima dichiaravano quattro superfici a 1,06:1, 1,14:1 e 1,21:1
// l'una dall'altra, e la scala **non era monotona**: `--bg-elev` (un popover)
// stava più in basso di `--bg-input` (il campo che quel popover contiene). Non
// era una svista: erano quattro valori scelti separatamente, e niente li teneva
// in fila.
//
// Qui la scala si costruisce per **accumulo** — ogni gradino dichiara quanti
// passi sta sopra il precedente, mai dove sta — e una scala costruita per
// accumulo non può essere non-monotona: non c'è modo di scriverlo. Il passo è
// uno solo per luce, e la distanza minima fra due gradini adiacenti **è** il
// passo.
//
// Il fondo della scala è la **carta**: la superficie del documento. È l'estremo
// — il nero al buio, il bianco in luce — e tutto il resto sale da lì. Il nero
// OLED non si perde: si sposta dove è grande, cioè sotto la nota che si sta
// leggendo, invece di stare sotto la scocca. Ed è il verso di ogni editor: la
// pagina è la superficie estrema, la scocca ci galleggia sopra.
//
// # Cosa questo file **non** decide
//
// L'elevazione (superficie, filetto e ombra) è la tabella qui sotto (§31.5).
// I caratteri sono la §31.3 e restano letterali.
// Le preferenze della persona sono la §31.6 e staranno **sopra** il foglio, in
// un canale proprio.
import { contrast } from "../contrast";
import { PAIRS } from "../contrast-fixture";
import { toHex, type Oklch } from "../oklch";

/// Le due luci. Non sono due temi: sono lo stesso tema visto da due parti, e
/// tutto ciò che le distingue sta in queste due righe.
export type Light = "dark" | "light";

export const LIGHTS = ["dark", "light"] as const;

export type ContrastLevel = "normal" | "high";
export const CONTRASTS = ["normal", "high"] as const;

/** Le soglie numeriche dell'alto contrasto: AAA per il testo, una volta e
 *  mezza il minimo per segni e controlli. */
const HIGH_CONTRAST = { text: 7, ui: 4.5 } as const;

/// Ciò che una luce decide, e nient'altro.
///
/// Sono **due** misure e non una, e la seconda l'ha insegnata la prima corsa
/// della generazione: con un passo solo, i primi tre gradini della luce scura
/// uscivano tutti `#000000`.
///
/// La ragione è che sotto la carta nera lo spazio a otto bit **finisce**. OKLab
/// è percettivamente uniforme e per un grigio vale `L = Y^(1/3)`: a `L` 0,034 la
/// luminanza è quattro centomillesimi, e in sRGB quel valore è il codice zero.
/// Vicino al bianco succede l'opposto — un codice solo copre una frazione di
/// gradino percettivo — e infatti in luce si cammina benissimo. Non è un difetto
/// di OKLab: è la densità della codifica, e la ricetta la deve sapere.
///
/// Quindi: lo **stacco** è il primo gradino, quello che si fa per uscire dalla
/// carta, e il **passo** è ogni gradino dopo. Al buio lo stacco è quattro volte
/// il passo perché deve attraversare la zona in cui i codici non ci sono; in
/// luce sono lo stesso numero, e dirlo due volte è il modo di dire che lì la
/// differenza non serve.
const LIGHT: Record<
  Light,
  {
    readonly paper: number;
    readonly gap: number;
    readonly step: number;
    readonly schema: string;
  }
> = {
  dark: { paper: 0, gap: 0.125, step: 0.032, schema: "dark" },
  light: { paper: 1, gap: 0.014, step: 0.014, schema: "light" },
};

/// Dove sta il gradino `n`: la carta, e poi lo stacco più i passi che restano.
/// È l'unico posto in cui una chiarezza di superficie si calcola, e prende in
/// ingresso un conto di passi — mai una posizione. È qui che la monotonia
/// diventa impossibile da sbagliare.
function stepClarity(light: Light, steps: number): number {
  const { paper, gap, step } = LIGHT[light];
  if (steps === 0) return paper;
  return paper + direction(light) * (gap + step * (steps - 1));
}

/// Il verso in cui ci si allontana dalla carta: verso l'alto al buio, verso il
/// basso in luce. Vale per i gradini **e** per la ricerca della chiarezza di un
/// inchiostro, che è la stessa direzione: allontanarsi dal fondo.
function direction(light: Light): 1 | -1 {
  return light === "dark" ? 1 : -1;
}

/// La tinta dei neutri. Uno solo, e lo stesso nelle due luci: un grigio scelto
/// si distingue da un grigio ereditato, e due tinte diverse farebbero dei due
/// fogli due tavolozze invece di una vista in due luci.
///
/// Il numero non è inventato: è dove stanno **già** i neutri dei fogli scritti a
/// mano (`--border` 285,4°, `--muted` 285,9°, `--text` 286,3°, e gli stessi tre
/// in luce fra 285,5° e 286,4°). Chi li ha scelti uno per uno ha scelto ogni
/// volta la stessa direzione senza avere un posto in cui dirlo; qui c'è.
const NEUTRAL = 285;

/// La tinta dell'accento: il lime della decisione di prodotto (`bdc3203`),
/// misurato dai valori che c'erano — 128,8° al buio e 130,8° in luce, cioè due
/// arrotondamenti dello stesso colore.
const ACCENT = 130;

// ---------------------------------------------------------------------------
// Le forme di una voce.
// ---------------------------------------------------------------------------

/// Il rapporto di contrasto che un ruolo **vuole**, non il minimo che la legge
/// gli concede: il minimo lo verifica il presidio, questo è il disegno.
///
/// Dove è un numero solo vale in tutte e due le luci. Dove sono due, è perché
/// le due luci non hanno lo stesso soffitto: un colore saturo ha una luminanza
/// massima che dipende dalla tinta, quindi sopra il bianco un lime deve
/// scurirsi molto per reggere, mentre sopra il nero gli basta essere sé stesso.
/// Pretendere lo stesso numero da tutte e due vorrebbe dire, in luce, un'oliva
/// scura al posto di un accento.
type TargetContrast = number | Readonly<Record<Light, number>>;

function targetContrast(
  m: TargetContrast,
  light: Light,
  level: ContrastLevel,
  role: string,
): number {
  const base = typeof m === "number" ? m : m[light];
  if (level === "normal") return base;

  // La fixture è l'autorità sulle coppie che la pelle mette davvero insieme.
  // Una riga AA diventa AAA; una riga UI sale a 4,5:1. Il ruolo può stare da
  // una parte o dall'altra: il rapporto di contrasto è simmetrico.
  const required = PAIRS
    .filter(([ink, background]) => ink === role || background === role)
    .reduce(
      (target, [, , threshold]) =>
        Math.max(target, threshold >= 4.5 ? HIGH_CONTRAST.text : HIGH_CONTRAST.ui),
      base,
    );
  return required;
}

type Entry = Readonly<
  { name: string; prose?: string } & (
    | /// Un valore che non è un colore, o un colore che non si ricava da niente
      /// (un velo bianco, un'ombra): si scrive, e si scrive uguale nelle due
      /// luci se non c'è una riga per luce.
      { type: "letterale"; value: string | Readonly<Record<Light, string>> }
    /// Un gradino della scala delle superfici: quanti passi sopra la carta.
    /// La chiarezza è l'unica cosa che si dichiara, e si dichiara in passi.
    | { type: "gradino"; steps: number; chroma?: number }
    /// Un gradino che cambia passo fra le due luci: la tabella d'elevazione
    /// al buio separa con la luce, in chiaro lascia il lavoro all'ombra.
    | { type: "elevazione"; steps: Readonly<Record<Light, number>>; chroma?: number }
    /// Un inchiostro: che colore è, sopra cosa sta, quanto deve reggere. La
    /// chiarezza la trova la generazione.
    ///
    /// Con una `famiglia`, la chiarezza smette di essere sua e diventa di tutte:
    /// si prende quella che serve alla specie **più difficile** e la si dà a
    /// tutte le altre. Costa qualche punto di contrasto a chi ne avrebbe avuto
    /// bisogno di meno, e in cambio la tavolozza si vede come una tavolozza —
    /// che è il difetto per cui dieci colori scelti uno per volta non lo sono.
    | {
        type: "inchiostro";
        h: number;
        c: number;
        above: readonly string[];
        targetContrast: TargetContrast;
        family?: string;
      }
    /// Il testo **sopra** un pieno: nero o bianco, quello dei due che regge di
    /// più. Non è una scelta — è un conto con due candidati.
    | { type: "controcolore"; above: string }
    /// Un velo: lo stesso colore di un altro ruolo, in trasparenza. Sta sopra
    /// superfici diverse, e per questo non si può ridurre a un pieno.
    | { type: "velo"; from: string; alpha: Readonly<Record<Light, number>> }
    /// Lo stesso valore di un altro ruolo, detto due volte perché sono due
    /// domande diverse. Non è un alias in CSS: il foglio scrive il valore, così
    /// chi ridefinisce l'uno non muove l'altro senza accorgersene.
    | { type: "eco"; source: string }
  )
>;

type Group = Readonly<{ title: string; prose: string; entries: readonly Entry[] }>;

// ---------------------------------------------------------------------------
// La scala e il moto: ciò che non è colore, e non cambia con la luce.
// ---------------------------------------------------------------------------

/// Sta qui, letterale, e non nella parte che si ricava, perché non c'è niente da
/// ricavare: uno spazio non dipende dalla luce. Prima stava scritto **due
/// volte**, una per foglio, e `struttura.test.ts` esisteva anche per ricontare
/// che le due copie non divergessero. Adesso la copia è una sola e quel presidio
/// verifica una cosa che la generazione non può più sbagliare — il che va
/// benissimo: un presidio che regge una proprietà garantita altrove è un
/// presidio che si accorge se quell'altrove cambia.
const SCALE: readonly Group[] = [
  {
    title: "la scala: ciò che i due fogli condividono",
    prose:
      "Gli spazi. La scala è quella che la shell **già usava** (2, 4, 6, 8, 10,\n" +
      "12, 16), raccolta e chiusa: i valori dispari che erano rimasti in giro —\n" +
      "3px, 5px, 11px, 14px, 18px — erano differenze che nessuno aveva scelto, e\n" +
      "sono state tirate sul gradino accanto. I numeri che restano letterali nella\n" +
      "pelle sono quelli **strutturali** (la colonna da 240px, un bordo da 1px,\n" +
      "l'altezza massima di una lista): non sono spaziatura, e metterli in questa\n" +
      "scala vorrebbe dire che cambiarla li muove.",
    entries: [
      { name: "space-1", type: "letterale", value: "2px" },
      { name: "space-2", type: "letterale", value: "4px" },
      { name: "space-3", type: "letterale", value: "6px" },
      { name: "space-4", type: "letterale", value: "8px" },
      { name: "space-5", type: "letterale", value: "10px" },
      { name: "space-6", type: "letterale", value: "12px" },
      { name: "space-7", type: "letterale", value: "16px" },
      { name: "space-8", type: "letterale", value: "24px" },
      { name: "space-9", type: "letterale", value: "32px" },
      { name: "space-10", type: "letterale", value: "48px" },
    ],
  },
  {
    title: "i raggi",
    prose:
      "Erano sette valori distinti fra 2px e 10px per quattro intenzioni: il segno\n" +
      "appena smussato, il controllo, la superficie che galleggia, la pastiglia.",
    entries: [
      { name: "radius-xs", type: "letterale", value: "2px" },
      { name: "radius-sm", type: "letterale", value: "4px" },
      { name: "radius-md", type: "letterale", value: "6px" },
      { name: "radius-lg", type: "letterale", value: "8px" },
      { name: "radius-pill", type: "letterale", value: "999px" },
    ],
  },
  {
    title: "la tipografia",
    prose:
      "`--font-mono` esisteva già come `var(--mono, monospace)` in due regole —\n" +
      "cioè come token **mai definito**, che è il modo più silenzioso di non avere\n" +
      "un token: il ripiego funzionava, quindi nessuno se ne accorgeva. La §31.3 ha\n" +
      "portato tre voci in bundle — Inter, Literata, JetBrains Mono, tutte e tre\n" +
      "OFL-1.1 — al posto di `system-ui`, cioè di tre prodotti diversi su tre\n" +
      "piattaforme. Il sistema resta raggiungibile: ogni pila ha il ripiego di\n" +
      "piattaforma in coda, e diventerà una preferenza vera con la §31.6.\n" +
      "\n" +
      "`text-xs`…`text-xl` non si muovono: sono i sei valori di prima, e restano\n" +
      "perché cambiarli è un ridisegno di ogni componente che li spende — cinquantanove\n" +
      "regole nella pelle (`grep -cF 'var(--text-' frontend/src/theme/serie/skin.css`)\n" +
      "— e quello è lavoro della §31.4, non di questa voce. La\n" +
      "scala **si allarga**: due gradini nuovi in cima (`text-2xl`, `text-3xl`),\n" +
      "che seguono un passo dichiarato (×1,2 da `text-xl`, arrotondato al pixel) al\n" +
      "posto di essere il prossimo numero che serve; e una voce nuova per la\n" +
      "lettura (`text-reading`), perché Literata non è Inter con un altro nome —\n" +
      "è disegnata per un corpo diverso. `leading-tight` era l'unica interlinea:\n" +
      "resta per chi la usa già, e accanto arrivano `leading-normal` (il paragrafo\n" +
      "di un pannello) e `leading-relaxed` (la prosa lunga, dove Literata respira).\n" +
      "`content-width` è la misura di lettura — 70 caratteri, il punto in cui una\n" +
      "riga più lunga fa perdere il segno tornando a capo. Queste ultime cinque voci\n" +
      "sono dichiarate e non ancora consumate da nessuna regola: tocca alla §31.8\n" +
      "(*la stessa nota in tre modi*) metterle sulla superficie di lettura, editor e\n" +
      "anteprima insieme — la §31.3 poteva scriverle o lasciarle implicite in una\n" +
      "regola sola, e implicite è precisamente il difetto che questa seduta cerca.",
    entries: [
      {
        name: "font-ui",
        type: "letterale",
        value:
          '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      },
      {
        name: "font-reading",
        type: "letterale",
        value: '"Literata Variable", Georgia, "Times New Roman", serif',
      },
      {
        name: "font-mono",
        type: "letterale",
        value:
          '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, ' +
          '"Liberation Mono", monospace',
      },
      { name: "text-xs", type: "letterale", value: "11px" },
      { name: "text-sm", type: "letterale", value: "12px" },
      { name: "text-base", type: "letterale", value: "13px" },
      { name: "text-md", type: "letterale", value: "14px" },
      { name: "text-lg", type: "letterale", value: "15px" },
      { name: "text-xl", type: "letterale", value: "16px" },
      { name: "text-2xl", type: "letterale", value: "19px" },
      { name: "text-3xl", type: "letterale", value: "23px" },
      { name: "text-reading", type: "letterale", value: "16px" },
      { name: "weight-medium", type: "letterale", value: "600" },
      { name: "weight-bold", type: "letterale", value: "700" },
      { name: "leading-tight", type: "letterale", value: "1.35" },
      { name: "leading-normal", type: "letterale", value: "1.5" },
      { name: "leading-relaxed", type: "letterale", value: "1.7" },
      { name: "content-width", type: "letterale", value: "70ch" },
      {
        name: "tracking-caps",
        type: "letterale",
        value: "0.6px",
        prose:
          "Il maiuscoletto dei titoli di pannello: due proprietà che vanno sempre\n" +
          "insieme, e che separate si erano già disallineate (`0.6px` in un posto,\n" +
          "`0.04em` in un altro, per la stessa riga).",
      },
    ],
  },
  {
    title: "il moto",
    prose:
      "Tre durate e tre curve, e sono le stesse in entrambe le luci — un bottone e\n" +
      "una modale non sono due prodotti, e un tema chiaro non ha un altro orologio.\n" +
      "`fast` è l'hover e il colore; `med` è lo spaziale piccolo (un menu, un\n" +
      "press); `slow` è l'ingresso di una superficie che si apre. `ease` è lo\n" +
      "standard; `ease-out` decade sull'ingresso (parte veloce, atterra fermo);\n" +
      "`ease-in` accelera sul press. Non c'è una durata «live»: la scocca non\n" +
      "respira. Ogni nome nuovo lo spende la pelle, o è debito — la lezione di\n" +
      "`--duration-med`.",
    entries: [
      { name: "duration-fast", type: "letterale", value: "120ms" },
      { name: "duration-med", type: "letterale", value: "180ms" },
      { name: "duration-slow", type: "letterale", value: "240ms" },
      { name: "ease", type: "letterale", value: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      { name: "ease-out", type: "letterale", value: "cubic-bezier(0.16, 1, 0.3, 1)" },
      { name: "ease-in", type: "letterale", value: "cubic-bezier(0.3, 0, 1, 1)" },
    ],
  },
];

// ---------------------------------------------------------------------------
// L'elevazione: cinque livelli, letti nelle due luci.
// ---------------------------------------------------------------------------

export const ELEVATION_LEVELS = ["paper", "base", "chrome", "floating", "dialog"] as const;

type ElevationLevel = (typeof ELEVATION_LEVELS)[number];
type ElevationSpec = Readonly<{
  name: ElevationLevel;
  surface: Readonly<Record<Light, number>>;
  border: Readonly<Record<Light, number>>;
  shadow: Readonly<Record<Light, string>>;
}>;

/// La tabella livello × luce. Al buio ogni piano guadagna chiarezza e l'ombra
/// resta spenta; in luce le superfici restano raccolte e la profondità cresce
/// nell'ombra. Superficie, filetto e ombra escono sempre dalla stessa riga.
const ELEVATION_TABLE: readonly ElevationSpec[] = [
  { name: "paper", surface: { dark: 0, light: 0 }, border: { dark: 0, light: 0 }, shadow: { dark: "none", light: "none" } },
  { name: "base", surface: { dark: 1, light: 1 }, border: { dark: 2, light: 2 }, shadow: { dark: "none", light: "0 1px 2px rgb(20 20 40 / 4%)" } },
  { name: "chrome", surface: { dark: 2, light: 1 }, border: { dark: 4, light: 3 }, shadow: { dark: "none", light: "0 2px 6px rgb(20 20 40 / 7%)" } },
  { name: "floating", surface: { dark: 3, light: 1 }, border: { dark: 6, light: 5 }, shadow: { dark: "none", light: "0 6px 18px rgb(20 20 40 / 12%)" } },
  { name: "dialog", surface: { dark: 4, light: 1 }, border: { dark: 9, light: 7 }, shadow: { dark: "none", light: "0 12px 32px rgb(20 20 40 / 18%)" } },
];

const ELEVATION: Group = {
  title: "l'elevazione: dalla carta al dialogo",
  prose:
    "Cinque piani. In luce scura la superficie sale e l'ombra non finge di\n" +
    "staccare dal nero; in luce chiara la superficie resta quieta e cresce\n" +
    "l'ombra. Il filetto appartiene alla stessa riga, non a un componente.",
  entries: ELEVATION_TABLE.flatMap((level): Entry[] => [
    { name: `elevation-${level.name}-surface`, type: "elevazione", steps: level.surface },
    { name: `elevation-${level.name}-border`, type: "elevazione", steps: level.border },
    { name: `elevation-${level.name}-shadow`, type: "letterale", value: level.shadow },
  ]),
};

// ---------------------------------------------------------------------------
// Il colore.
// ---------------------------------------------------------------------------

/// Le superfici su cui un inchiostro della shell può finire: tutti i gradini
/// più i due stati. Un inchiostro che regge sul peggiore regge su tutti, e
/// quale sia il peggiore lo decide la luce — non chi scrive.
const SURFACES = [
  "bg",
  "bg-chrome",
  "bg-elev",
  "bg-panel",
  "bg-input",
  "bg-hover",
  "bg-active",
] as const;

/// I fondi della **carta**: la pagina, la riga sotto il cursore, il testo
/// selezionato. Sono tre, e non uno, per un difetto che il banco ha trovato
/// misurando la pagina vera (0166): la tabella dei token misurava ogni colore di
/// sintassi contro `--doc-bg`, che era l'unico fondo che sapesse esistere, e il
/// testo sulla riga attiva stava sotto la soglia senza che niente lo dicesse.
/// Un fondo dimenticato non è un errore di conto — è un conto che non è stato
/// fatto.
const PAPER = ["doc-bg", "doc-active-line", "doc-selection"] as const;

const COLOR: readonly Group[] = [
  {
    title: "le superfici: la scala, dalla carta in su",
    prose:
      "Sette gradini, e nessuno di essi dichiara dove sta: dichiara **quanti\n" +
      "passi** sta sopra il precedente. Una scala costruita per accumulo non può\n" +
      "essere non-monotona — quella di prima lo era, e nessuno se n'era accorto\n" +
      "perché quattro valori scelti separatamente non hanno un posto in cui\n" +
      "contraddirsi.\n" +
      "\n" +
      "Il fondo è la **carta** (`--doc-bg`, più giù), che è l'estremo: il nero al\n" +
      "buio, il bianco in luce. Il corpo dell'app le sta appena sopra, la scocca\n" +
      "sopra di lui, e ciò che galleggia sopra ancora. È il verso di un editor —\n" +
      "la pagina è la superficie estrema e il resto ci galleggia — e non quello di\n" +
      "prima, dove titlebar, rail, statusbar, corpo dell'app e carta erano lo\n" +
      "stesso `#000000` e si distinguevano per un filetto.\n" +
      "\n" +
      "`--bg-panel` e `--bg-active` sono nuovi. Non sono ruoli inventati: sono i\n" +
      "due posti in cui la pelle stava usando `--bg-input` per qualcosa che non è\n" +
      "un campo — la traccia di un segmentato, un banner, una pastiglia — e\n" +
      "`--bg-hover` per qualcosa che non è un hover: una riga **selezionata**, che\n" +
      "resta tale quando il puntatore se n'è andato.",
    entries: [
      { name: "bg", type: "gradino", steps: 1, prose: "Il corpo dell'app: ciò che sta dietro tutto." },
      {
        name: "bg-chrome",
        type: "gradino",
        steps: 2,
        prose: "Titlebar, rail, statusbar. La scocca sta **sopra** la carta, non accanto.",
      },
      {
        name: "bg-elev",
        type: "gradino",
        steps: 3,
        prose: "Ciò che galleggia: pannelli, menu, popover, modali, toast.",
      },
      {
        name: "bg-panel",
        type: "gradino",
        steps: 4,
        prose:
          "Un riquadro **dentro** un pannello: la traccia di un controllo\n" +
          "segmentato, un banner, una pastiglia, la riga di una lista.",
      },
      { name: "bg-input", type: "gradino", steps: 5, prose: "Il campo: dove si scrive. E basta." },
      {
        name: "bg-hover",
        type: "gradino",
        steps: 6,
        prose: "La riga sotto il puntatore. È uno stato, e sta un passo sopra il campo.",
      },
      {
        name: "bg-active",
        type: "gradino",
        steps: 7,
        prose:
          "La riga **selezionata**, il segmento premuto. Prima non c'era e si\n" +
          "riusava l'hover, cioè si diceva «il puntatore è qui» per dire «questa è\n" +
          "quella scelta»: due cose che devono poter valere insieme.",
      },
      {
        name: "overlay-hover",
        type: "letterale",
        value: { dark: "rgb(255 255 255 / 8%)", light: "rgb(0 0 0 / 6%)" },
        prose:
          "Il velo del bottone fantasma: un velo sul testo, non un secondo grigio.\n" +
          "In alpha perché deve restare un velo sopra qualunque superficie, e le\n" +
          "superfici adesso sono sette.",
      },
      {
        name: "border",
        type: "gradino",
        steps: 9,
        prose:
          "Il filetto è **il gradino dopo lo stato**, a due passi di distanza: un\n" +
          "bordo separa due superfici, quindi deve stare oltre la più lontana delle\n" +
          "due, e la scala sa già dov'è. Non gli si chiede 3:1 — un filetto non è un\n" +
          "controllo e pretenderglielo trasformerebbe l'interfaccia in un\n" +
          "wireframe — ma nemmeno lo si sceglie a mano.",
      },
    ],
  },
  {
    title: "gli inchiostri della shell",
    prose:
      "Nessuno di questi dichiara una chiarezza. Dichiarano che colore sono, sopra\n" +
      "quali superfici finiscono, e quanto devono reggere sulla **peggiore** di\n" +
      "quelle: la chiarezza la cerca la generazione, partendo dal fondo e\n" +
      "allontanandosene finché il conto passa. È il motivo per cui la stessa riga\n" +
      "produce due valori diversi nelle due luci senza che nessuno li abbia\n" +
      "scelti.",
    entries: [
      {
        name: "text",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.005,
        above: SURFACES,
        targetContrast: { dark: 11, light: 12 },
        prose:
          "Il testo della shell. La mira non è la soglia: è il rapporto che il\n" +
          "foglio scritto a mano già dava, misurato. Al buio è più bassa di un punto\n" +
          "e non per scelta — con sette superfici la più alta è chiara abbastanza da\n" +
          "abbassare il soffitto: sopra `--bg-active` nessun colore arriva a 12,8:1.",
      },
      {
        name: "muted",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.018,
        above: SURFACES,
        targetContrast: 5,
        prose:
          "I sottotitoli, le didascalie, i secondi. Restano testo, quindi la mira\n" +
          "sta sopra la soglia del testo con un margine e non sul filo.",
      },
    ],
  },
  {
    title: "l'accento",
    prose:
      "I due accenti non sono una tinta e la sua sfumatura: sono due **ruoli**, e\n" +
      "il presidio del contrasto li ha separati per sempre. `--accent` è un\n" +
      "**pieno** (il fondo di un bottone) e un **segno** (un bordo, un contorno di\n" +
      "selezione); `--accent-soft` è un **inchiostro**, sta sopra le superfici, e\n" +
      "gli tocca la soglia del testo.\n" +
      "\n" +
      "La tinta è una sola, e il lime è la decisione di prodotto di `bdc3203`.\n" +
      "Le due mire dell'accento sono diverse, e non per gusto: al buio l'accento è\n" +
      "la cosa più chiara dello schermo e il contrasto gli viene gratis; in luce è\n" +
      "un pieno che porta il proprio testo sopra, e spingerlo oltre lo farebbe\n" +
      "diventare un'oliva scura — cioè non più un accento.",
    entries: [
      {
        name: "accent",
        type: "inchiostro",
        h: ACCENT,
        c: 0.2,
        above: SURFACES,
        targetContrast: { dark: 9, light: 3.2 },
      },
      {
        name: "accent-soft",
        type: "inchiostro",
        h: ACCENT,
        c: 0.16,
        above: SURFACES,
        targetContrast: { dark: 11, light: 6.5 },
      },
      {
        name: "accent-contrast",
        type: "controcolore",
        above: "accent",
        prose:
          "Il testo **sopra** l'accento. Era `white` cablato in due regole, ed è la\n" +
          "riga che un tema chiaro non poteva ereditare: su un accento chiaro il\n" +
          "bianco sparisce. Adesso non è più una scelta né in una luce né\n" +
          "nell'altra — è un conto fra due candidati, e vince quello che regge.",
      },
    ],
  },
  {
    title: "i quattro intenti",
    prose:
      "Guasto, avviso, riuscito, informazione. Prima esisteva il solo rosso, e le\n" +
      "altre tre cose si dicevano con ciò che capitava: un avviso arrivava dal\n" +
      "kernel come `severity: warning` e la shell lo mostrava **come\n" +
      "un'informazione**, perché un tono «avviso» non c'era; e sette regole su\n" +
      "otto che volevano il rosso della shell prendevano `--doc-danger`, cioè il\n" +
      "rosso del **documento** — che è il colore con cui un wikilink rotto si\n" +
      "scrive dentro una nota, non quello con cui la shell dice che qualcosa è\n" +
      "andato storto. I due fogli raccontavano di aver già sciolto quel nodo; la\n" +
      "pelle non se n'era accorta.\n" +
      "\n" +
      "Ogni intento ha tre pezzi e sempre gli stessi tre: l'inchiostro, il velo (per\n" +
      "un fondo che non copre), e il controcolore (per un pieno). Le tinte sono\n" +
      "quattro e stanno lontane fra loro: il riuscito è **più freddo** del lime\n" +
      "apposta, perché un verde uguale all'accento direbbe «primario» dove voleva\n" +
      "dire «fatto».",
    entries: [
      { name: "danger", type: "inchiostro", h: 25, c: 0.16, above: SURFACES, targetContrast: 5 },
      { name: "danger-wash", type: "velo", from: "danger", alpha: { dark: 18, light: 12 } },
      { name: "danger-contrast", type: "controcolore", above: "danger" },
      { name: "warning", type: "inchiostro", h: 80, c: 0.16, above: SURFACES, targetContrast: 5 },
      { name: "warning-wash", type: "velo", from: "warning", alpha: { dark: 18, light: 14 } },
      { name: "warning-contrast", type: "controcolore", above: "warning" },
      { name: "success", type: "inchiostro", h: 160, c: 0.14, above: SURFACES, targetContrast: 5 },
      { name: "success-wash", type: "velo", from: "success", alpha: { dark: 18, light: 14 } },
      { name: "success-contrast", type: "controcolore", above: "success" },
      { name: "info", type: "inchiostro", h: 250, c: 0.14, above: SURFACES, targetContrast: 5 },
      { name: "info-wash", type: "velo", from: "info", alpha: { dark: 18, light: 12 } },
      { name: "info-contrast", type: "controcolore", above: "info" },
    ],
  },
  {
    title: "l'anello del fuoco (§12.4)",
    prose:
      "Non è l'accento, ed è un colore a parte per una ragione che il foglio\n" +
      "scritto a mano diceva sbagliata. Diceva: «deve reggere sopra l'accento\n" +
      "stesso — un pulsante primario che prende il fuoco lo mostra su fondo\n" +
      "accento». Non è vero, e la tabella delle coppie non l'ha mai verificato:\n" +
      "l'anello si disegna con `outline-offset`, cioè **un pixel fuori**\n" +
      "dall'elemento, quindi il suo fondo è la superficie intorno e mai il pieno\n" +
      "che circonda. Provato a chiedergli quel conto, non esiste nessuna\n" +
      "chiarezza che lo soddisfi: al buio allontanarsi dal fondo lo avvicina\n" +
      "all'accento, che è la cosa più chiara dello schermo. Le due pretese si\n" +
      "escludono, e una delle due era immaginaria.\n" +
      "\n" +
      "È l'offset a rendere vera la frase, ed è per questo che le misure viaggiano\n" +
      "col colore invece di stare nella scocca: senza l'offset, l'anello di un\n" +
      "bottone primario sarebbe lime su lime. Sono parte della forma dell'anello,\n" +
      "e la regola che le consuma sta nella struttura.",
    entries: [
      {
        name: "focus-ring",
        type: "inchiostro",
        h: ACCENT,
        c: 0.12,
        above: SURFACES,
        targetContrast: { dark: 10, light: 6 },
      },
      { name: "focus-ring-width", type: "letterale", value: "2px" },
      { name: "focus-ring-offset", type: "letterale", value: "1px" },
    ],
  },
  {
    title: "i veli e le ombre",
    prose:
      "Il velo sotto una superficie modale, e i tre nomi storici delle ombre.\n" +
      "Le ombre non hanno più numeri propri: leggono i livelli base, floating e\n" +
      "dialog della tabella, così un nome pubblico resta additivo senza diventare\n" +
      "una seconda scala.",
    entries: [
      {
        name: "scrim",
        type: "letterale",
        value: { dark: "rgb(0 0 0 / 45%)", light: "rgb(20 20 30 / 35%)" },
      },
      { name: "shadow-sm", type: "eco", source: "elevation-base-shadow" },
      { name: "shadow-md", type: "eco", source: "elevation-floating-shadow" },
      { name: "shadow-lg", type: "eco", source: "elevation-dialog-shadow" },
    ],
  },
  {
    title: "il grafo",
    prose:
      "Il grafo dei collegamenti disegna su canvas, cioè fuori dalla portata di\n" +
      "qualunque regola CSS: i suoi colori li legge `panels/graph.ts` da qui con\n" +
      "`getComputedStyle`. Sono token come gli altri proprio perché quella\n" +
      "superficie, non essendo raggiungibile dal foglio di stile, è quella che si\n" +
      "dimentica per prima quando si cambia tema.",
    entries: [
      {
        name: "graph-node",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.02,
        above: SURFACES,
        targetContrast: { dark: 5, light: 3.6 },
      },
      {
        name: "graph-node-active",
        type: "eco",
        source: "accent",
        prose: "Il nodo della nota aperta è l'accento, e lo dice ripetendone il valore.",
      },
      {
        name: "graph-node-hover",
        type: "inchiostro",
        h: 160,
        c: 0.12,
        above: SURFACES,
        targetContrast: { dark: 7, light: 4 },
        prose: "Il nodo sotto il puntatore: la tinta del riuscito, che qui vuol dire «questo».",
      },
    ],
  },
  {
    title: "la superficie del documento",
    prose:
      "La carta e ciò che ci sta sopra. Sta qui, in un posto solo, perché le tre\n" +
      "modalità di 4.1 devono essere la stessa nota vista in tre modi — non tre\n" +
      "note diverse. Li usano `.markdown-preview` (Lettura), il tema della live\n" +
      "preview e il tema dell'editor, che prima portava i propri.\n" +
      "\n" +
      "La carta è il **fondo della scala**: il nero al buio, il bianco in luce. È\n" +
      "l'unico posto in cui il nero OLED conta davvero, ed è dove è finito.",
    entries: [
      {
        name: "doc-bg",
        type: "gradino",
        steps: 0,
        chroma: 0,
        prose:
          "La carta. Zero passi: è l'estremo da cui tutto il resto si allontana, e\n" +
          "l'unico token del foglio che non ha una tinta — il nero e il bianco non\n" +
          "ne hanno una.",
      },
      {
        name: "doc-active-line",
        type: "gradino",
        steps: 2,
        prose: "La riga sotto il cursore: un gradino della carta, non un colore a parte.",
      },
      {
        name: "doc-selection",
        type: "gradino",
        steps: 6,
        prose:
          "Il testo selezionato. È il fondo **più lontano** su cui una specie di\n" +
          "sintassi possa finire, quindi è lui a decidere quanto scure possono\n" +
          "essere le dieci: portarlo un gradino più in là abbassa il soffitto di\n" +
          "tutta la tavolozza, e si vede subito perché la generazione si rifiuta.",
      },
      {
        name: "doc-tooltip-bg",
        type: "gradino",
        steps: 3,
        prose: "Il suggerimento dell'editor: galleggia sulla carta come un pannello sul corpo.",
      },
      {
        name: "doc-fill",
        type: "letterale",
        value: "rgb(135 135 135 / 16%)",
        prose:
          "Riempimenti e righe in alpha su grigio: reggono su qualunque fondo, ed è\n" +
          "il motivo per cui valgono identici nelle due luci. Sono la sola famiglia\n" +
          "di colori che i due fogli dichiarano con lo stesso valore, e\n" +
          "`struttura.test.ts` lo pretende. Stanno **prima** degli inchiostri perché\n" +
          "uno di quelli — il link — ci finisce sopra, e per misurarlo il velo va\n" +
          "composto: un fondo si dichiara prima di chi ci sta sopra.",
      },
      { name: "doc-fill-soft", type: "letterale", value: "rgb(135 135 135 / 10%)" },
      { name: "doc-rule", type: "letterale", value: "rgb(135 135 135 / 45%)" },
      { name: "doc-rule-soft", type: "letterale", value: "rgb(135 135 135 / 28%)" },
      {
        name: "doc-highlight",
        type: "letterale",
        value: { dark: "rgb(255 205 0 / 28%)", light: "rgb(255 205 0 / 45%)" },
      },
      {
        name: "doc-fg",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.012,
        above: PAPER,
        targetContrast: { dark: 9, light: 10 },
        prose: "Il corpo della nota. Sopra tutti e tre i fondi della carta, non solo la pagina.",
      },
      {
        name: "doc-link",
        type: "inchiostro",
        h: 255,
        c: 0.14,
        above: [...PAPER, "doc-bg+doc-fill"],
        targetContrast: 6,
        prose:
          "Un wikilink. Il quarto fondo è la pagina **sotto un velo**: `--doc-fill`\n" +
          "è `rgb(135 135 135 / 16%)`, cioè un velo e non un colore, e un link dentro\n" +
          "un riempimento ci finisce sopra. La tabella dei token quella coppia non\n" +
          "poteva vederla — si rifiuta, giustamente, di misurare ciò che ha un alfa,\n" +
          "perché non sa cosa c'è sotto. Qui sotto ci sta la carta, e si sa: il velo\n" +
          "si compone e il conto si fa.",
      },
      {
        name: "doc-heading",
        type: "inchiostro",
        h: 20,
        c: 0.15,
        above: PAPER,
        targetContrast: { dark: 5.5, light: 5 },
        family: "sintassi",
        prose:
          "I titoli, resi e in scrittura. Sono della **famiglia della sintassi**\n" +
          "perché è il parser a marcarli, e `--syn-heading` li ripete: tenerli fuori\n" +
          "vorrebbe dire un titolo che, dentro un blocco di codice, si vede più\n" +
          "chiaro o più scuro delle parole intorno.\n" +
          "\n" +
          "Prima la soglia era 3:1 — «un titolo è testo grande» — ed è vero per un\n" +
          "`h1` e falso da un `h3` in giù, dove il corpo torna quello del testo. Era\n" +
          "uno dei cinque debiti che il banco della 0166 ha trovato misurando la\n" +
          "pagina vera, ed è un'assunzione che si può fare solo **prima** di\n" +
          "rendere.",
      },
      {
        name: "doc-danger",
        type: "inchiostro",
        h: 25,
        c: 0.16,
        above: PAPER,
        targetContrast: 5.5,
        prose:
          "Il rosso **del documento**: un wikilink rotto. Non è `--danger`, che è il\n" +
          "rosso della shell: stessa tinta, fondi diversi, e per questo due valori.",
      },
      {
        name: "doc-gutter-fg",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.015,
        above: PAPER,
        targetContrast: 5,
        prose: "I numeri di riga sono testo che qualcuno legge, non decorazione.",
      },
      {
        name: "doc-caret",
        type: "inchiostro",
        h: 265,
        c: 0.2,
        above: PAPER,
        targetContrast: 4.5,
        prose: "Il cursore di scrittura: non è testo, ma è la cosa che si cerca con gli occhi.",
      },
    ],
  },
  {
    title: "i colori della sintassi",
    prose:
      "Dieci specie, e adesso sono **proprie**. Erano One Dark e One Light presi\n" +
      "interi, e la frase «la stessa nota in due luci» era vera perché quei due\n" +
      "pacchetti sono gemelli ufficiali — cioè per parentela, non per costruzione.\n" +
      "Misurandoli si vedeva che i gemelli non condividono nemmeno le tinte: la\n" +
      "parola chiave sta a 318° al buio e a 329° in luce, l'operatore a 206° e\n" +
      "237°, la stringa a 133° e 143°. Sono due tavolozze che si somigliano.\n" +
      "\n" +
      "Qui la tinta è **una per specie** e vale in tutte e due le luci, e la\n" +
      "chiarezza è **una per luce** e vale per tutte le specie: si prende quella\n" +
      "che serve alla più difficile e si dà a tutte. Le dieci si distinguono per\n" +
      "tinta, che è come si distinguono le parole di una lingua — non per quanto\n" +
      "sono chiare. Le tinte non sono state immaginate: sono quelle dei due\n" +
      "pacchetti, misurate e portate a un valore solo.\n" +
      "\n" +
      "Due specie restano fuori dalla famiglia, e si vede dalla riga che le\n" +
      "dichiara: il commento, che deve stare indietro, e l'invalido, che deve\n" +
      "saltare all'occhio. Sono le due il cui lavoro **è** stare a una chiarezza\n" +
      "diversa dalle altre.\n" +
      "\n" +
      "E `SOTTO_AA` va a zero. Sette specie su dieci stavano sotto la soglia del\n" +
      "testo nella luce chiara dal giorno in cui quel tema è nato (`087a40f`), ed\n" +
      "era un debito dichiarato perché ritoccarle una alla volta avrebbe lasciato\n" +
      "una tavolozza che non era più nessuna delle due. Non se ne ritocca nessuna:\n" +
      "si chiede alla famiglia un rapporto, e la famiglia trova **una** chiarezza.\n" +
      "Era esattamente l'operazione che prenderle in coppia serviva a evitare.",
    entries: [
      { name: "syn-keyword", type: "inchiostro", h: 322, c: 0.18, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      { name: "syn-name", type: "inchiostro", h: 22, c: 0.16, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      { name: "syn-function", type: "inchiostro", h: 255, c: 0.16, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      { name: "syn-literal", type: "inchiostro", h: 70, c: 0.12, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      { name: "syn-type", type: "inchiostro", h: 85, c: 0.13, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      {
        name: "syn-operator",
        type: "inchiostro",
        h: 220,
        c: 0.11,
        above: PAPER,
        targetContrast: { dark: 5.5, light: 5 },
        family: "sintassi",
      },
      {
        name: "syn-comment",
        type: "inchiostro",
        h: NEUTRAL,
        c: 0.025,
        above: PAPER,
        targetContrast: 4.6,
        prose:
          "Il commento è la sola specie che resta **fuori dalla famiglia**, e per la\n" +
          "ragione per cui la famiglia esiste: le altre nove devono vedersi come una\n" +
          "tavolozza, e il commento deve vedersi **indietro**. Prendere la chiarezza\n" +
          "delle altre lo porterebbe avanti, cioè gli toglierebbe il suo lavoro. La\n" +
          "sua mira è sopra la soglia del testo e non un dito più su.",
      },
      { name: "syn-string", type: "inchiostro", h: 138, c: 0.13, above: PAPER, targetContrast: { dark: 5.5, light: 5 }, family: "sintassi" },
      {
        name: "syn-heading",
        type: "eco",
        source: "doc-heading",
        prose:
          "Un titolo ha lo stesso colore reso e in scrittura, e restano due nomi\n" +
          "perché sono due domande diverse: «di che colore è un `<h1>` reso» e «di\n" +
          "che colore è il testo che il parser ha marcato come titolo». Prima erano\n" +
          "lo stesso valore ricopiato, e ricopiare è come si diverge.",
      },
      {
        name: "syn-invalid",
        type: "inchiostro",
        h: 25,
        c: 0.22,
        above: PAPER,
        targetContrast: { dark: 7, light: 6 },
        prose:
          "Ciò che il parser non riesce a leggere. Fuori dalla famiglia anche lui, e\n" +
          "per il verso opposto al commento: deve saltare all'occhio, quindi sta un\n" +
          "gradino **avanti** alle altre. Al buio era `#ffffff`, che non è un colore\n" +
          "scelto — è l'assenza di una scelta; adesso porta la tinta del guasto, che\n" +
          "è ciò che vuol dire.",
      },
    ],
  },
];

const RECIPE: readonly Group[] = [...SCALE, ELEVATION, ...COLOR];

// ---------------------------------------------------------------------------
// La derivazione.
// ---------------------------------------------------------------------------

/// Un velo composto sopra un fondo opaco: `rgb(r g b / a%)` sopra `#rrggbb`.
/// Serve a **misurare** una coppia che il velo rende invisibile alla tabella dei
/// token — un inchiostro dentro un riempimento — e non a emettere un colore: ciò
/// che il foglio scrive resta il velo.
function compose(veil: string, background: string): string {
  const read = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\s*\)$/.exec(veil.trim());
  if (!read) throw new Error(`«${veil}» non è un velo che si sappia comporre`);
  const a = Number(read[4]) / 100;
  const below = fromChannels(background);
  return `#${[1, 2, 3]
    .map((i) => Math.round(Number(read[i]) * a + below[i - 1]! * (1 - a)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function fromChannels(hex: string): [number, number, number] {
  const c = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

/// Il fondo su cui si misura un ruolo. Un nome solo è un token; `a+b` è il token
/// `b` composto sopra il token `a`, ed è il modo di nominare una coppia che
/// nasce da un velo.
function backgroundOf(name: string, resolved: Map<string, string>): string {
  const [below, above] = name.split("+");
  const base = resolved.get(below!);
  if (base === undefined) throw new Error(`il fondo «${below}» non è ancora state risolto`);
  if (above === undefined) return base;
  const veil = resolved.get(above);
  if (veil === undefined) throw new Error(`il velo «${above}» non è ancora state risolto`);
  return compose(veil, base);
}

/// La chiarezza minima che porta un colore a reggere la mira sul peggiore dei
/// suoi fondi, cercata **allontanandosi** dalla carta.
///
/// Si cerca per bisezione su `l`, e la ricerca è legittima perché il contrasto è
/// monotono in `l` una volta fissate tinta e croma: allontanandosi dal fondo il
/// rapporto cresce, e non torna indietro. Il numero di giri è fisso — trentadue,
/// che porta l'incertezza sotto un miliardesimo — perché rigenerare deve dare gli
/// stessi byte su qualunque macchina.
///
/// Poi si arrotonda a otto bit e si **ricontrolla**: la quantizzazione può far
/// scendere il rapporto sotto la mira di un centesimo, e in quel caso si fa un
/// passo in più. Ciò che il foglio scrive è ciò che il presidio misura, quindi
/// non c'è margine da lasciare — c'è da controllare il valore vero.
function search(
  color: Omit<Oklch, "l">,
  backgrounds: readonly string[],
  target: number,
  light: Light,
): number {
  const v = direction(light);
  const holds = (l: number) => {
    const c = toHex({ ...color, l });
    return backgrounds.every((f) => contrast(c, f) >= target);
  };

  const start = LIGHT[light].paper;
  const arrival = v === 1 ? 1 : 0;
  if (!holds(arrival)) {
    throw new Error(
      `nessuna chiarezza port oklch(· ${color.c} ${color.h}) a ${target}:1 ` +
        `sopra ${backgrounds.join(", ")} nella light ${light}`,
    );
  }

  let near = start;
  let far = arrival;
  for (let round = 0; round < 32; round += 1) {
    const midpoint = (near + far) / 2;
    if (holds(midpoint)) far = midpoint;
    else near = midpoint;
  }

  // Il valore vero è quello arrotondato, e può stare un centesimo sotto: si
  // cammina a passi di un bit finché non regge davvero. Il ciclo ha un tetto
  // perché un presidio che gira per sempre non è un presidio.
  let l = far;
  for (let step = 0; step < 64; step += 1) {
    if (holds(l)) return l;
    l += v * 0.002;
  }
  throw new Error(`la quantizzazione non lascia arrivare a ${target}:1 nella light ${light}`);
}

/// La chiarezza di una **famiglia**: quella che serve alla specie che ne chiede
/// di più, data a tutte.
///
/// È la riga con cui `SOTTO_AA` va a zero senza ritoccare dieci colori uno alla
/// volta — che era precisamente l'operazione da evitare. Sette specie su dieci
/// stavano sotto la soglia del testo in luce chiara dal giorno in cui quel tema
/// è nato: non perché qualcuno le avesse volute lì, ma perché erano dieci scelte
/// separate e nessuna aveva un posto in cui dipendere dalle altre. Qui la
/// chiarezza è **una**, e le dieci si distinguono per tinta — che è come si
/// distinguono le parole di una lingua, non per quanto sono chiare.
function familyClarity(
  members: readonly { name: string; h: number; c: number; above: readonly string[]; targetContrast: TargetContrast }[],
  light: Light,
  level: ContrastLevel,
  resolved: Map<string, string>,
): number {
  const clarities = members.map((m) =>
    search(
      { c: m.c, h: m.h },
      m.above.map((f) => backgroundOf(f, resolved)),
      targetContrast(m.targetContrast, light, level, m.name),
      light,
    ),
  );
  // La più lontana dalla carta: al buio la più alta, in luce la più bassa.
  return direction(light) === 1 ? Math.max(...clarities) : Math.min(...clarities);
}

/// Il nero o il bianco, quello dei due che regge di più sopra un pieno. Non è
/// una scelta: è un conto con due candidati, e il presidio verifica che il
/// vincitore stia sopra la soglia del testo.
function contrastColor(fill: string): string {
  return contrast("#000000", fill) >= contrast("#ffffff", fill) ? "#000000" : "#ffffff";
}

/// I token di una luce, nell'ordine in cui la ricetta li dichiara. L'ordine
/// conta due volte: è quello in cui il foglio li scrive, ed è quello in cui si
/// risolvono — un inchiostro può nominare come fondo solo un ruolo già uscito.
export function palette(
  light: Light,
  level: ContrastLevel = "normal",
  accentHue: number = ACCENT,
): Map<string, string> {
  const resolved = new Map<string, string>();
  const families = new Map<string, number>();
  const hue = Number.isFinite(accentHue) ? ((accentHue % 360) + 360) % 360 : ACCENT;

  for (const group of RECIPE) {
    for (const entry of group.entries) {
      resolved.set(entry.name, resolveValue(entry, light, level, hue, resolved, families));
    }
  }
  return resolved;
}

/// I membri di una famiglia, in tutta la ricetta. Si cercano a ogni prima
/// occorrenza e non si tiene una lista a parte: una lista a parte sarebbe un
/// secondo posto in cui dire chi è di quella famiglia, e la ricetta ne ha già
/// uno — il campo.
function membersOf(family: string) {
  return RECIPE.flatMap((g) =>
    g.entries.filter((v) => v.type === "inchiostro" && v.family === family),
  ) as Extract<Entry, { type: "inchiostro" }>[];
}

function resolveValue(
  entry: Entry,
  light: Light,
  level: ContrastLevel,
  accentHue: number,
  resolved: Map<string, string>,
  families: Map<string, number>,
): string {
  switch (entry.type) {
    case "letterale":
      return typeof entry.value === "string" ? entry.value : entry.value[light];

    case "gradino": {
      // Il croma dei neutri cresce col gradino: una superficie lontana dalla
      // carta ha più posto per portare una tinta senza diventare colorata.
      const chroma = entry.chroma ?? Math.min(0.008, 0.0012 * entry.steps);
      return toHex({ l: stepClarity(light, entry.steps), c: chroma, h: NEUTRAL });
    }

    case "elevazione": {
      const steps = entry.steps[light];
      const chroma = entry.chroma ?? Math.min(0.008, 0.0012 * steps);
      return toHex({ l: stepClarity(light, steps), c: chroma, h: NEUTRAL });
    }

    case "inchiostro": {
      const h = entry.h === ACCENT ? accentHue : entry.h;
      const color = { c: entry.c, h };
      if (entry.family === undefined) {
        const backgrounds = entry.above.map((f) => backgroundOf(f, resolved));
        return toHex({
          ...color,
          l: search(
            color,
            backgrounds,
            targetContrast(entry.targetContrast, light, level, entry.name),
            light,
          ),
        });
      }
      let l = families.get(entry.family);
      if (l === undefined) {
        l = familyClarity(membersOf(entry.family), light, level, resolved);
        families.set(entry.family, l);
      }
      return toHex({ ...color, l });
    }

    case "controcolore": {
      const fill = resolved.get(entry.above);
      if (fill === undefined) throw new Error(`«${entry.above}» non è ancora state risolto`);
      return contrastColor(fill);
    }

    case "velo": {
      const from = resolved.get(entry.from);
      if (from === undefined) throw new Error(`«${entry.from}» non è ancora state risolto`);
      return `rgb(${fromChannels(from).join(" ")} / ${entry.alpha[light]}%)`;
    }

    case "eco": {
      const source = resolved.get(entry.source);
      if (source === undefined) throw new Error(`«${entry.source}» non è ancora state risolto`);
      return source;
    }
  }
}

// ---------------------------------------------------------------------------
// L'emissione.
// ---------------------------------------------------------------------------

function header(light: Light, level: ContrastLevel): string {
  const base =
    light === "dark"
      ? "Il foglio del tema di serie, nella luce scura: ruoli, tipografia, moto."
      : "Il foglio del tema di serie, nella luce chiara: il gemello dello scuro.";
  const contrastLine =
    level === "high"
      ? "Soglie alte: testo 7:1, segni e controlli 4,5:1 (§31.7)."
      : "Soglie normali WCAG AA (§31.2).";
  return `${base}\n${contrastLine}`;
}

/// Il righello fra un gruppo e il successivo. La larghezza è dichiarata una
/// volta sola: due separatori lunghi diversi sono la specie di differenza che
/// nessuno ha scelto, e i fogli scritti a mano ne avevano già tre.
function separator(title: string): string {
  return `  /* --- ${title} ${"-".repeat(Math.max(3, 66 - title.length))} */`;
}

/// Un blocco di prosa come commento CSS, con l'indentazione che il file usa.
function comment(text: string, inside: boolean): string {
  const rows = text.split("\n");
  if (!inside) {
    return ["/*", ...rows.map((r) => (r === "" ? " *" : ` * ${r}`)), " */"].join("\n");
  }
  const rejoin = "  ";
  if (rows.length === 1) return `${rejoin}/* ${rows[0]} */`;
  return [
    `${rejoin}/* ${rows[0]}`,
    ...rows.slice(1).map((r) => (r === "" ? "" : `${rejoin}   ${r}`)),
  ].join("\n").concat(" */");
}

/// Il foglio di una luce, per intero: è ciò che sta su disco, byte per byte.
export function sheet(light: Light, level: ContrastLevel): string {
  const values = palette(light, level);
  const parts: string[] = [];

  parts.push(
    comment(
      `${header(light, level)}\n` +
        "\n" +
        "FILE GENERATO — non modificare a mano.\n" +
        "\n" +
        "La sorgente è `theme/serie/recipe.ts`, che dichiara ogni colore come\n" +
        "*che colore è* (tinta e croma), *sopra cosa sta* e *quanto deve reggere*:\n" +
        "la chiarezza — l'unica grandezza che il contrasto muove — la trova la\n" +
        "generazione. Qui sotto ci sono i risultati, in esadecimale, perché i tre\n" +
        "presidi del tema leggono i fogli **come testo** e un `oklch()` vivo\n" +
        "sarebbe un valore che solo un browser sa dire.\n" +
        "\n" +
        "    npm run tema:genera       rigenera questo file\n" +
        "    npm run tema:verifica     dice se è quello che la ricetta produce\n" +
        "\n" +
        "Non è cablato nell'app: lo monta il caricatore (`theme/loader.ts`), che\n" +
        "**sostituisce** — un foglio solo alla volta, niente cascata fra due temi,\n" +
        "niente gara di specificità. Chi decide quale luce vale è la shell\n" +
        "(`theme/theme.ts`): per questo qui non c'è nessuna\n" +
        "`@media (prefers-color-scheme)` e nessun selettore `[data-theme]` — il\n" +
        "foglio montato È il tema, e `:root` basta.\n" +
        "\n" +
        "Le metriche della scocca e la scala dei piani stanno nella struttura\n" +
        "(`theme/structure.css`) e qui non si ripetono; il chrome dei componenti\n" +
        "sta nella pelle (`skin.css`), che di token non ne dichiara nessuno.",
      false,
    ),
  );
  parts.push(":root {");

  for (const group of RECIPE) {
    if (group !== RECIPE[0]) parts.push("");
    parts.push(separator(group.title));
    parts.push("");
    parts.push(comment(group.prose, true));
    parts.push("");
    for (const entry of group.entries) {
      if (entry.prose !== undefined) parts.push(comment(entry.prose, true));
      parts.push(`  --${entry.name}: ${values.get(entry.name)!};`);
    }
  }

  parts.push("");
  parts.push(separator("ciò che vale per tutta la pagina"));
  parts.push("");
  parts.push(
    comment(
      "`color-scheme` dice al motore in che luce siamo: da qui prendono il verso\n" +
        "le barre di scorrimento e il cursore di testo. I controlli nativi che la\n" +
        "pelle veste — `<progress>`, le caselle — non lo leggono più, perché\n" +
        "`appearance: none` li ha portati dentro il tema (0166).",
      true,
    ),
  );
  parts.push("  font-family: var(--font-ui);");
  parts.push("  font-size: var(--text-md);");
  parts.push(`  color-scheme: ${LIGHT[light].schema};`);
  parts.push("}");

  return `${parts.join("\n")}\n`;
}

/// I quattro fogli luce × contrasto, col nome del derivato che li ospita.
export const SHEETS: Readonly<Record<Light, Readonly<Record<ContrastLevel, string>>>> = {
  dark: { normal: "sheet-dark.css", high: "sheet-dark-high.css" },
  light: { normal: "sheet-light.css", high: "sheet-light-high.css" },
};

export const VARIANTS = [
  { light: "dark", contrast: "normal" },
  { light: "dark", contrast: "high" },
  { light: "light", contrast: "normal" },
  { light: "light", contrast: "high" },
] as const;

/** I soli ruoli colorati dall'accento personale, derivati dalla ricetta intera. */
export const ACCENT_PREFERENCE_TOKENS = [
  "accent",
  "accent-soft",
  "accent-contrast",
  "focus-ring",
  "graph-node-active",
] as const;

export function accentPalette(
  light: Light,
  level: ContrastLevel,
  hue: number,
): Record<(typeof ACCENT_PREFERENCE_TOKENS)[number], string> {
  const values = palette(light, level, hue);
  return Object.fromEntries(
    ACCENT_PREFERENCE_TOKENS.map((token) => [token, values.get(token)!]),
  ) as Record<(typeof ACCENT_PREFERENCE_TOKENS)[number], string>;
}

/// Il nome dei ruoli che la ricetta dichiara, nell'ordine del foglio. Lo legge
/// il presidio dell'additività: un ruolo non si rinomina, e il modo di
/// accorgersene è avere l'elenco di ieri accanto a quello di oggi.
export function roles(): string[] {
  return RECIPE.flatMap((g) => g.entries.map((v) => v.name));
}

/// Le superfici e i fondi della carta, per chi deve misurarli da fuori: il
/// presidio della monotonia e il catalogo del banco. Non è una copia — è la
/// stessa costante che la ricetta consuma.
export const SURFACE_SCALE = ["doc-bg", ...SURFACES] as const;
export const PAPER_BACKGROUNDS = PAPER;

/// Il passo di ciascuna luce, per il presidio che lo verifica sul foglio.
/// Esce di qui e non si riscrive di là: un numero dichiarato in due posti è la
/// coppia che diverge, e il presidio finirebbe per confermare sé stesso invece
/// della ricetta.
export const STEP: Readonly<Record<Light, number>> = {
  dark: LIGHT.dark.step,
  light: LIGHT.light.step,
};
