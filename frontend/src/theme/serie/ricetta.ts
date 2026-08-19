// **La ricetta del tema di serie** (§31.2): da qui escono i due fogli.
//
// # Cosa è cambiato, e perché era un difetto
//
// Fino alla [0166](../../../../docs/decisions/0166-il-banco-che-vede.md) i due
// fogli erano novanta valori esadecimali scelti a mano: prima si sceglieva, poi
// `contrast.test.ts` diceva sì o no, e quando diceva no si spostava il valore
// finché diceva sì. Un presidio ferma il rosso, non produce il bello — e il
// prezzo si ripagava intero a ogni tavolozza nuova: l'alto contrasto (§31.7) e
// l'accento della persona (§31.6) sono due tavolozze in più.
//
// Qui il numero si scrive **accanto a come si ricava**, che è la
// [0072](../../../../docs/decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)
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
// [0020](../../../../docs/decisions/0020-le-regole-in-un-posto-solo.md) e dei
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
// L'elevazione (l'ombra, il filetto, quanto una superficie stacca) è la §31.5,
// e da qui prende solo i gradini. I caratteri sono la §31.3 e restano letterali.
// Le preferenze della persona sono la §31.6 e staranno **sopra** il foglio, in
// un canale proprio.
import { contrasto } from "../contrasto";
import { esa, type Oklch } from "../oklch";

/// Le due luci. Non sono due temi: sono lo stesso tema visto da due parti, e
/// tutto ciò che le distingue sta in queste due righe.
export type Luce = "scuro" | "chiaro";

export const LUCI = ["scuro", "chiaro"] as const;

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
const LUCE: Record<
  Luce,
  {
    readonly carta: number;
    readonly stacco: number;
    readonly passo: number;
    readonly schema: string;
  }
> = {
  scuro: { carta: 0, stacco: 0.125, passo: 0.032, schema: "dark" },
  chiaro: { carta: 1, stacco: 0.014, passo: 0.014, schema: "light" },
};

/// Dove sta il gradino `n`: la carta, e poi lo stacco più i passi che restano.
/// È l'unico posto in cui una chiarezza di superficie si calcola, e prende in
/// ingresso un conto di passi — mai una posizione. È qui che la monotonia
/// diventa impossibile da sbagliare.
function chiarezzaDelGradino(luce: Luce, passi: number): number {
  const { carta, stacco, passo } = LUCE[luce];
  if (passi === 0) return carta;
  return carta + verso(luce) * (stacco + passo * (passi - 1));
}

/// Il verso in cui ci si allontana dalla carta: verso l'alto al buio, verso il
/// basso in luce. Vale per i gradini **e** per la ricerca della chiarezza di un
/// inchiostro, che è la stessa direzione: allontanarsi dal fondo.
function verso(luce: Luce): 1 | -1 {
  return luce === "scuro" ? 1 : -1;
}

/// La tinta dei neutri. Uno solo, e lo stesso nelle due luci: un grigio scelto
/// si distingue da un grigio ereditato, e due tinte diverse farebbero dei due
/// fogli due tavolozze invece di una vista in due luci.
///
/// Il numero non è inventato: è dove stanno **già** i neutri dei fogli scritti a
/// mano (`--border` 285,4°, `--muted` 285,9°, `--text` 286,3°, e gli stessi tre
/// in luce fra 285,5° e 286,4°). Chi li ha scelti uno per uno ha scelto ogni
/// volta la stessa direzione senza avere un posto in cui dirlo; qui c'è.
const NEUTRO = 285;

/// La tinta dell'accento: il lime della decisione di prodotto (`bdc3203`),
/// misurato dai valori che c'erano — 128,8° al buio e 130,8° in luce, cioè due
/// arrotondamenti dello stesso colore.
const ACCENTO = 130;

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
type Mira = number | Readonly<Record<Luce, number>>;

function mira(m: Mira, luce: Luce): number {
  return typeof m === "number" ? m : m[luce];
}

type Voce = Readonly<
  { nome: string; prosa?: string } & (
    | /// Un valore che non è un colore, o un colore che non si ricava da niente
      /// (un velo bianco, un'ombra): si scrive, e si scrive uguale nelle due
      /// luci se non c'è una riga per luce.
      { tipo: "letterale"; valore: string | Readonly<Record<Luce, string>> }
    /// Un gradino della scala delle superfici: quanti passi sopra la carta.
    /// La chiarezza è l'unica cosa che si dichiara, e si dichiara in passi.
    | { tipo: "gradino"; passi: number; croma?: number }
    /// Un inchiostro: che colore è, sopra cosa sta, quanto deve reggere. La
    /// chiarezza la trova la generazione.
    ///
    /// Con una `famiglia`, la chiarezza smette di essere sua e diventa di tutte:
    /// si prende quella che serve alla specie **più difficile** e la si dà a
    /// tutte le altre. Costa qualche punto di contrasto a chi ne avrebbe avuto
    /// bisogno di meno, e in cambio la tavolozza si vede come una tavolozza —
    /// che è il difetto per cui dieci colori scelti uno per volta non lo sono.
    | {
        tipo: "inchiostro";
        h: number;
        c: number;
        sopra: readonly string[];
        mira: Mira;
        famiglia?: string;
      }
    /// Il testo **sopra** un pieno: nero o bianco, quello dei due che regge di
    /// più. Non è una scelta — è un conto con due candidati.
    | { tipo: "controcolore"; sopra: string }
    /// Un velo: lo stesso colore di un altro ruolo, in trasparenza. Sta sopra
    /// superfici diverse, e per questo non si può ridurre a un pieno.
    | { tipo: "velo"; da: string; alpha: Readonly<Record<Luce, number>> }
    /// Lo stesso valore di un altro ruolo, detto due volte perché sono due
    /// domande diverse. Non è un alias in CSS: il foglio scrive il valore, così
    /// chi ridefinisce l'uno non muove l'altro senza accorgersene.
    | { tipo: "eco"; di: string }
  )
>;

type Gruppo = Readonly<{ titolo: string; prosa: string; voci: readonly Voce[] }>;

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
const SCALA: readonly Gruppo[] = [
  {
    titolo: "la scala: ciò che i due fogli condividono",
    prosa:
      "Gli spazi. La scala è quella che la shell **già usava** (2, 4, 6, 8, 10,\n" +
      "12, 16), raccolta e chiusa: i valori dispari che erano rimasti in giro —\n" +
      "3px, 5px, 11px, 14px, 18px — erano differenze che nessuno aveva scelto, e\n" +
      "sono state tirate sul gradino accanto. I numeri che restano letterali nella\n" +
      "pelle sono quelli **strutturali** (la colonna da 240px, un bordo da 1px,\n" +
      "l'altezza massima di una lista): non sono spaziatura, e metterli in questa\n" +
      "scala vorrebbe dire che cambiarla li muove.",
    voci: [
      { nome: "space-1", tipo: "letterale", valore: "2px" },
      { nome: "space-2", tipo: "letterale", valore: "4px" },
      { nome: "space-3", tipo: "letterale", valore: "6px" },
      { nome: "space-4", tipo: "letterale", valore: "8px" },
      { nome: "space-5", tipo: "letterale", valore: "10px" },
      { nome: "space-6", tipo: "letterale", valore: "12px" },
      { nome: "space-7", tipo: "letterale", valore: "16px" },
      { nome: "space-8", tipo: "letterale", valore: "24px" },
      { nome: "space-9", tipo: "letterale", valore: "32px" },
      { nome: "space-10", tipo: "letterale", valore: "48px" },
    ],
  },
  {
    titolo: "i raggi",
    prosa:
      "Erano sette valori distinti fra 2px e 10px per quattro intenzioni: il segno\n" +
      "appena smussato, il controllo, la superficie che galleggia, la pastiglia.",
    voci: [
      { nome: "radius-xs", tipo: "letterale", valore: "2px" },
      { nome: "radius-sm", tipo: "letterale", valore: "4px" },
      { nome: "radius-md", tipo: "letterale", valore: "6px" },
      { nome: "radius-lg", tipo: "letterale", valore: "8px" },
      { nome: "radius-pill", tipo: "letterale", valore: "999px" },
    ],
  },
  {
    titolo: "la tipografia",
    prosa:
      "`--font-mono` esisteva già come `var(--mono, monospace)` in due regole —\n" +
      "cioè come token **mai definito**, che è il modo più silenzioso di non avere\n" +
      "un token: il ripiego funzionava, quindi nessuno se ne accorgeva. Le tre voci\n" +
      "in bundle e la scala che prende un passo sono la §31.3, e da qui non si\n" +
      "vedono: questa voce decide i colori.",
    voci: [
      {
        nome: "font-ui",
        tipo: "letterale",
        valore: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      },
      {
        nome: "font-mono",
        tipo: "letterale",
        valore: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      },
      { nome: "text-xs", tipo: "letterale", valore: "11px" },
      { nome: "text-sm", tipo: "letterale", valore: "12px" },
      { nome: "text-base", tipo: "letterale", valore: "13px" },
      { nome: "text-md", tipo: "letterale", valore: "14px" },
      { nome: "text-lg", tipo: "letterale", valore: "15px" },
      { nome: "text-xl", tipo: "letterale", valore: "16px" },
      { nome: "weight-medium", tipo: "letterale", valore: "600" },
      { nome: "weight-bold", tipo: "letterale", valore: "700" },
      { nome: "leading-tight", tipo: "letterale", valore: "1.35" },
      {
        nome: "tracking-caps",
        tipo: "letterale",
        valore: "0.6px",
        prosa:
          "Il maiuscoletto dei titoli di pannello: due proprietà che vanno sempre\n" +
          "insieme, e che separate si erano già disallineate (`0.6px` in un posto,\n" +
          "`0.04em` in un altro, per la stessa riga).",
      },
    ],
  },
  {
    titolo: "il moto",
    prosa:
      "Tre durate e tre curve, e sono le stesse in entrambe le luci — un bottone e\n" +
      "una modale non sono due prodotti, e un tema chiaro non ha un altro orologio.\n" +
      "`fast` è l'hover e il colore; `med` è lo spaziale piccolo (un menu, un\n" +
      "press); `slow` è l'ingresso di una superficie che si apre. `ease` è lo\n" +
      "standard; `ease-out` decade sull'ingresso (parte veloce, atterra fermo);\n" +
      "`ease-in` accelera sul press. Non c'è una durata «live»: la scocca non\n" +
      "respira. Ogni nome nuovo lo spende la pelle, o è debito — la lezione di\n" +
      "`--duration-med`.",
    voci: [
      { nome: "duration-fast", tipo: "letterale", valore: "120ms" },
      { nome: "duration-med", tipo: "letterale", valore: "180ms" },
      { nome: "duration-slow", tipo: "letterale", valore: "240ms" },
      { nome: "ease", tipo: "letterale", valore: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      { nome: "ease-out", tipo: "letterale", valore: "cubic-bezier(0.16, 1, 0.3, 1)" },
      { nome: "ease-in", tipo: "letterale", valore: "cubic-bezier(0.3, 0, 1, 1)" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Il colore.
// ---------------------------------------------------------------------------

/// Le superfici su cui un inchiostro della shell può finire: tutti i gradini
/// più i due stati. Un inchiostro che regge sul peggiore regge su tutti, e
/// quale sia il peggiore lo decide la luce — non chi scrive.
const SUPERFICI = [
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
const CARTA = ["doc-bg", "doc-active-line", "doc-selection"] as const;

const COLORE: readonly Gruppo[] = [
  {
    titolo: "le superfici: la scala, dalla carta in su",
    prosa:
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
    voci: [
      { nome: "bg", tipo: "gradino", passi: 1, prosa: "Il corpo dell'app: ciò che sta dietro tutto." },
      {
        nome: "bg-chrome",
        tipo: "gradino",
        passi: 2,
        prosa: "Titlebar, rail, statusbar. La scocca sta **sopra** la carta, non accanto.",
      },
      {
        nome: "bg-elev",
        tipo: "gradino",
        passi: 3,
        prosa: "Ciò che galleggia: pannelli, menu, popover, modali, toast.",
      },
      {
        nome: "bg-panel",
        tipo: "gradino",
        passi: 4,
        prosa:
          "Un riquadro **dentro** un pannello: la traccia di un controllo\n" +
          "segmentato, un banner, una pastiglia, la riga di una lista.",
      },
      { nome: "bg-input", tipo: "gradino", passi: 5, prosa: "Il campo: dove si scrive. E basta." },
      {
        nome: "bg-hover",
        tipo: "gradino",
        passi: 6,
        prosa: "La riga sotto il puntatore. È uno stato, e sta un passo sopra il campo.",
      },
      {
        nome: "bg-active",
        tipo: "gradino",
        passi: 7,
        prosa:
          "La riga **selezionata**, il segmento premuto. Prima non c'era e si\n" +
          "riusava l'hover, cioè si diceva «il puntatore è qui» per dire «questa è\n" +
          "quella scelta»: due cose che devono poter valere insieme.",
      },
      {
        nome: "overlay-hover",
        tipo: "letterale",
        valore: { scuro: "rgb(255 255 255 / 8%)", chiaro: "rgb(0 0 0 / 6%)" },
        prosa:
          "Il velo del bottone fantasma: un velo sul testo, non un secondo grigio.\n" +
          "In alpha perché deve restare un velo sopra qualunque superficie, e le\n" +
          "superfici adesso sono sette.",
      },
      {
        nome: "border",
        tipo: "gradino",
        passi: 9,
        prosa:
          "Il filetto è **il gradino dopo lo stato**, a due passi di distanza: un\n" +
          "bordo separa due superfici, quindi deve stare oltre la più lontana delle\n" +
          "due, e la scala sa già dov'è. Non gli si chiede 3:1 — un filetto non è un\n" +
          "controllo e pretenderglielo trasformerebbe l'interfaccia in un\n" +
          "wireframe — ma nemmeno lo si sceglie a mano.",
      },
    ],
  },
  {
    titolo: "gli inchiostri della shell",
    prosa:
      "Nessuno di questi dichiara una chiarezza. Dichiarano che colore sono, sopra\n" +
      "quali superfici finiscono, e quanto devono reggere sulla **peggiore** di\n" +
      "quelle: la chiarezza la cerca la generazione, partendo dal fondo e\n" +
      "allontanandosene finché il conto passa. È il motivo per cui la stessa riga\n" +
      "produce due valori diversi nelle due luci senza che nessuno li abbia\n" +
      "scelti.",
    voci: [
      {
        nome: "text",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.005,
        sopra: SUPERFICI,
        mira: { scuro: 11, chiaro: 12 },
        prosa:
          "Il testo della shell. La mira non è la soglia: è il rapporto che il\n" +
          "foglio scritto a mano già dava, misurato. Al buio è più bassa di un punto\n" +
          "e non per scelta — con sette superfici la più alta è chiara abbastanza da\n" +
          "abbassare il soffitto: sopra `--bg-active` nessun colore arriva a 12,8:1.",
      },
      {
        nome: "muted",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.018,
        sopra: SUPERFICI,
        mira: 5,
        prosa:
          "I sottotitoli, le didascalie, i secondi. Restano testo, quindi la mira\n" +
          "sta sopra la soglia del testo con un margine e non sul filo.",
      },
    ],
  },
  {
    titolo: "l'accento",
    prosa:
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
    voci: [
      {
        nome: "accent",
        tipo: "inchiostro",
        h: ACCENTO,
        c: 0.2,
        sopra: SUPERFICI,
        mira: { scuro: 9, chiaro: 3.2 },
      },
      {
        nome: "accent-soft",
        tipo: "inchiostro",
        h: ACCENTO,
        c: 0.16,
        sopra: SUPERFICI,
        mira: { scuro: 11, chiaro: 6.5 },
      },
      {
        nome: "accent-contrast",
        tipo: "controcolore",
        sopra: "accent",
        prosa:
          "Il testo **sopra** l'accento. Era `white` cablato in due regole, ed è la\n" +
          "riga che un tema chiaro non poteva ereditare: su un accento chiaro il\n" +
          "bianco sparisce. Adesso non è più una scelta né in una luce né\n" +
          "nell'altra — è un conto fra due candidati, e vince quello che regge.",
      },
    ],
  },
  {
    titolo: "i quattro intenti",
    prosa:
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
    voci: [
      { nome: "danger", tipo: "inchiostro", h: 25, c: 0.16, sopra: SUPERFICI, mira: 5 },
      { nome: "danger-wash", tipo: "velo", da: "danger", alpha: { scuro: 18, chiaro: 12 } },
      { nome: "danger-contrast", tipo: "controcolore", sopra: "danger" },
      { nome: "warning", tipo: "inchiostro", h: 80, c: 0.16, sopra: SUPERFICI, mira: 5 },
      { nome: "warning-wash", tipo: "velo", da: "warning", alpha: { scuro: 18, chiaro: 14 } },
      { nome: "warning-contrast", tipo: "controcolore", sopra: "warning" },
      { nome: "success", tipo: "inchiostro", h: 160, c: 0.14, sopra: SUPERFICI, mira: 5 },
      { nome: "success-wash", tipo: "velo", da: "success", alpha: { scuro: 18, chiaro: 14 } },
      { nome: "success-contrast", tipo: "controcolore", sopra: "success" },
      { nome: "info", tipo: "inchiostro", h: 250, c: 0.14, sopra: SUPERFICI, mira: 5 },
      { nome: "info-wash", tipo: "velo", da: "info", alpha: { scuro: 18, chiaro: 12 } },
      { nome: "info-contrast", tipo: "controcolore", sopra: "info" },
    ],
  },
  {
    titolo: "l'anello del fuoco (§12.4)",
    prosa:
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
    voci: [
      {
        nome: "focus-ring",
        tipo: "inchiostro",
        h: ACCENTO,
        c: 0.12,
        sopra: SUPERFICI,
        mira: { scuro: 10, chiaro: 6 },
      },
      { nome: "focus-ring-width", tipo: "letterale", valore: "2px" },
      { nome: "focus-ring-offset", tipo: "letterale", valore: "1px" },
    ],
  },
  {
    titolo: "i veli e le ombre",
    prosa:
      "Il velo sotto una superficie modale, e le tre ombre. Cambiano con la luce\n" +
      "perché un'ombra nera al 45% sotto una finestra chiara è una macchia.\n" +
      "Restano letterali: **quanto** una superficie stacca è la §31.5, e qui non si\n" +
      "decide — un'ombra nera su fondo nero non solleva niente, e sarà quella voce\n" +
      "a dirlo con una tabella.",
    voci: [
      {
        nome: "scrim",
        tipo: "letterale",
        valore: { scuro: "rgb(0 0 0 / 45%)", chiaro: "rgb(20 20 30 / 35%)" },
      },
      {
        nome: "shadow-sm",
        tipo: "letterale",
        valore: {
          scuro: "0 6px 20px rgb(0 0 0 / 45%)",
          chiaro: "0 4px 14px rgb(20 20 40 / 12%)",
        },
      },
      {
        nome: "shadow-md",
        tipo: "letterale",
        valore: {
          scuro: "0 8px 28px rgb(0 0 0 / 50%)",
          chiaro: "0 6px 20px rgb(20 20 40 / 14%)",
        },
      },
      {
        nome: "shadow-lg",
        tipo: "letterale",
        valore: {
          scuro: "0 12px 40px rgb(0 0 0 / 55%)",
          chiaro: "0 10px 30px rgb(20 20 40 / 18%)",
        },
      },
    ],
  },
  {
    titolo: "il grafo",
    prosa:
      "Il grafo dei collegamenti disegna su canvas, cioè fuori dalla portata di\n" +
      "qualunque regola CSS: i suoi colori li legge `panels/graph.ts` da qui con\n" +
      "`getComputedStyle`. Sono token come gli altri proprio perché quella\n" +
      "superficie, non essendo raggiungibile dal foglio di stile, è quella che si\n" +
      "dimentica per prima quando si cambia tema.",
    voci: [
      {
        nome: "graph-node",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.02,
        sopra: SUPERFICI,
        mira: { scuro: 5, chiaro: 3.6 },
      },
      {
        nome: "graph-node-active",
        tipo: "eco",
        di: "accent",
        prosa: "Il nodo della nota aperta è l'accento, e lo dice ripetendone il valore.",
      },
      {
        nome: "graph-node-hover",
        tipo: "inchiostro",
        h: 160,
        c: 0.12,
        sopra: SUPERFICI,
        mira: { scuro: 7, chiaro: 4 },
        prosa: "Il nodo sotto il puntatore: la tinta del riuscito, che qui vuol dire «questo».",
      },
    ],
  },
  {
    titolo: "la superficie del documento",
    prosa:
      "La carta e ciò che ci sta sopra. Sta qui, in un posto solo, perché le tre\n" +
      "modalità di 4.1 devono essere la stessa nota vista in tre modi — non tre\n" +
      "note diverse. Li usano `.markdown-preview` (Lettura), il tema della live\n" +
      "preview e il tema dell'editor, che prima portava i propri.\n" +
      "\n" +
      "La carta è il **fondo della scala**: il nero al buio, il bianco in luce. È\n" +
      "l'unico posto in cui il nero OLED conta davvero, ed è dove è finito.",
    voci: [
      {
        nome: "doc-bg",
        tipo: "gradino",
        passi: 0,
        croma: 0,
        prosa:
          "La carta. Zero passi: è l'estremo da cui tutto il resto si allontana, e\n" +
          "l'unico token del foglio che non ha una tinta — il nero e il bianco non\n" +
          "ne hanno una.",
      },
      {
        nome: "doc-active-line",
        tipo: "gradino",
        passi: 2,
        prosa: "La riga sotto il cursore: un gradino della carta, non un colore a parte.",
      },
      {
        nome: "doc-selection",
        tipo: "gradino",
        passi: 6,
        prosa:
          "Il testo selezionato. È il fondo **più lontano** su cui una specie di\n" +
          "sintassi possa finire, quindi è lui a decidere quanto scure possono\n" +
          "essere le dieci: portarlo un gradino più in là abbassa il soffitto di\n" +
          "tutta la tavolozza, e si vede subito perché la generazione si rifiuta.",
      },
      {
        nome: "doc-tooltip-bg",
        tipo: "gradino",
        passi: 3,
        prosa: "Il suggerimento dell'editor: galleggia sulla carta come un pannello sul corpo.",
      },
      {
        nome: "doc-fill",
        tipo: "letterale",
        valore: "rgb(135 135 135 / 16%)",
        prosa:
          "Riempimenti e righe in alpha su grigio: reggono su qualunque fondo, ed è\n" +
          "il motivo per cui valgono identici nelle due luci. Sono la sola famiglia\n" +
          "di colori che i due fogli dichiarano con lo stesso valore, e\n" +
          "`struttura.test.ts` lo pretende. Stanno **prima** degli inchiostri perché\n" +
          "uno di quelli — il link — ci finisce sopra, e per misurarlo il velo va\n" +
          "composto: un fondo si dichiara prima di chi ci sta sopra.",
      },
      { nome: "doc-fill-soft", tipo: "letterale", valore: "rgb(135 135 135 / 10%)" },
      { nome: "doc-rule", tipo: "letterale", valore: "rgb(135 135 135 / 45%)" },
      { nome: "doc-rule-soft", tipo: "letterale", valore: "rgb(135 135 135 / 28%)" },
      {
        nome: "doc-highlight",
        tipo: "letterale",
        valore: { scuro: "rgb(255 205 0 / 28%)", chiaro: "rgb(255 205 0 / 45%)" },
      },
      {
        nome: "doc-fg",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.012,
        sopra: CARTA,
        mira: { scuro: 9, chiaro: 10 },
        prosa: "Il corpo della nota. Sopra tutti e tre i fondi della carta, non solo la pagina.",
      },
      {
        nome: "doc-link",
        tipo: "inchiostro",
        h: 255,
        c: 0.14,
        sopra: [...CARTA, "doc-bg+doc-fill"],
        mira: 6,
        prosa:
          "Un wikilink. Il quarto fondo è la pagina **sotto un velo**: `--doc-fill`\n" +
          "è `rgb(135 135 135 / 16%)`, cioè un velo e non un colore, e un link dentro\n" +
          "un riempimento ci finisce sopra. La tabella dei token quella coppia non\n" +
          "poteva vederla — si rifiuta, giustamente, di misurare ciò che ha un alfa,\n" +
          "perché non sa cosa c'è sotto. Qui sotto ci sta la carta, e si sa: il velo\n" +
          "si compone e il conto si fa.",
      },
      {
        nome: "doc-heading",
        tipo: "inchiostro",
        h: 20,
        c: 0.15,
        sopra: CARTA,
        mira: { scuro: 5.5, chiaro: 5 },
        famiglia: "sintassi",
        prosa:
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
        nome: "doc-danger",
        tipo: "inchiostro",
        h: 25,
        c: 0.16,
        sopra: CARTA,
        mira: 5.5,
        prosa:
          "Il rosso **del documento**: un wikilink rotto. Non è `--danger`, che è il\n" +
          "rosso della shell: stessa tinta, fondi diversi, e per questo due valori.",
      },
      {
        nome: "doc-gutter-fg",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.015,
        sopra: CARTA,
        mira: 5,
        prosa: "I numeri di riga sono testo che qualcuno legge, non decorazione.",
      },
      {
        nome: "doc-caret",
        tipo: "inchiostro",
        h: 265,
        c: 0.2,
        sopra: CARTA,
        mira: 4.5,
        prosa: "Il cursore di scrittura: non è testo, ma è la cosa che si cerca con gli occhi.",
      },
    ],
  },
  {
    titolo: "i colori della sintassi",
    prosa:
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
    voci: [
      { nome: "syn-keyword", tipo: "inchiostro", h: 322, c: 0.18, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      { nome: "syn-name", tipo: "inchiostro", h: 22, c: 0.16, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      { nome: "syn-function", tipo: "inchiostro", h: 255, c: 0.16, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      { nome: "syn-literal", tipo: "inchiostro", h: 70, c: 0.12, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      { nome: "syn-type", tipo: "inchiostro", h: 85, c: 0.13, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      {
        nome: "syn-operator",
        tipo: "inchiostro",
        h: 220,
        c: 0.11,
        sopra: CARTA,
        mira: { scuro: 5.5, chiaro: 5 },
        famiglia: "sintassi",
      },
      {
        nome: "syn-comment",
        tipo: "inchiostro",
        h: NEUTRO,
        c: 0.025,
        sopra: CARTA,
        mira: 4.6,
        prosa:
          "Il commento è la sola specie che resta **fuori dalla famiglia**, e per la\n" +
          "ragione per cui la famiglia esiste: le altre nove devono vedersi come una\n" +
          "tavolozza, e il commento deve vedersi **indietro**. Prendere la chiarezza\n" +
          "delle altre lo porterebbe avanti, cioè gli toglierebbe il suo lavoro. La\n" +
          "sua mira è sopra la soglia del testo e non un dito più su.",
      },
      { nome: "syn-string", tipo: "inchiostro", h: 138, c: 0.13, sopra: CARTA, mira: { scuro: 5.5, chiaro: 5 }, famiglia: "sintassi" },
      {
        nome: "syn-heading",
        tipo: "eco",
        di: "doc-heading",
        prosa:
          "Un titolo ha lo stesso colore reso e in scrittura, e restano due nomi\n" +
          "perché sono due domande diverse: «di che colore è un `<h1>` reso» e «di\n" +
          "che colore è il testo che il parser ha marcato come titolo». Prima erano\n" +
          "lo stesso valore ricopiato, e ricopiare è come si diverge.",
      },
      {
        nome: "syn-invalid",
        tipo: "inchiostro",
        h: 25,
        c: 0.22,
        sopra: CARTA,
        mira: { scuro: 7, chiaro: 6 },
        prosa:
          "Ciò che il parser non riesce a leggere. Fuori dalla famiglia anche lui, e\n" +
          "per il verso opposto al commento: deve saltare all'occhio, quindi sta un\n" +
          "gradino **avanti** alle altre. Al buio era `#ffffff`, che non è un colore\n" +
          "scelto — è l'assenza di una scelta; adesso porta la tinta del guasto, che\n" +
          "è ciò che vuol dire.",
      },
    ],
  },
];

const RICETTA: readonly Gruppo[] = [...SCALA, ...COLORE];

// ---------------------------------------------------------------------------
// La derivazione.
// ---------------------------------------------------------------------------

/// Un velo composto sopra un fondo opaco: `rgb(r g b / a%)` sopra `#rrggbb`.
/// Serve a **misurare** una coppia che il velo rende invisibile alla tabella dei
/// token — un inchiostro dentro un riempimento — e non a emettere un colore: ciò
/// che il foglio scrive resta il velo.
function componi(velo: string, fondo: string): string {
  const letto = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\s*\)$/.exec(velo.trim());
  if (!letto) throw new Error(`«${velo}» non è un velo che si sappia comporre`);
  const a = Number(letto[4]) / 100;
  const sotto = daCanali(fondo);
  return `#${[1, 2, 3]
    .map((i) => Math.round(Number(letto[i]) * a + sotto[i - 1]! * (1 - a)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function daCanali(esadecimale: string): [number, number, number] {
  const c = esadecimale.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

/// Il fondo su cui si misura un ruolo. Un nome solo è un token; `a+b` è il token
/// `b` composto sopra il token `a`, ed è il modo di nominare una coppia che
/// nasce da un velo.
function fondoDi(nome: string, risolti: Map<string, string>): string {
  const [sotto, sopra] = nome.split("+");
  const base = risolti.get(sotto!);
  if (base === undefined) throw new Error(`il fondo «${sotto}» non è ancora stato risolto`);
  if (sopra === undefined) return base;
  const velo = risolti.get(sopra);
  if (velo === undefined) throw new Error(`il velo «${sopra}» non è ancora stato risolto`);
  return componi(velo, base);
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
function cerca(
  colore: Omit<Oklch, "l">,
  fondi: readonly string[],
  bersaglio: number,
  luce: Luce,
): number {
  const v = verso(luce);
  const regge = (l: number) => {
    const c = esa({ ...colore, l });
    return fondi.every((f) => contrasto(c, f) >= bersaglio);
  };

  const partenza = LUCE[luce].carta;
  const arrivo = v === 1 ? 1 : 0;
  if (!regge(arrivo)) {
    throw new Error(
      `nessuna chiarezza porta oklch(· ${colore.c} ${colore.h}) a ${bersaglio}:1 ` +
        `sopra ${fondi.join(", ")} nella luce ${luce}`,
    );
  }

  let vicino = partenza;
  let lontano = arrivo;
  for (let giro = 0; giro < 32; giro += 1) {
    const meta = (vicino + lontano) / 2;
    if (regge(meta)) lontano = meta;
    else vicino = meta;
  }

  // Il valore vero è quello arrotondato, e può stare un centesimo sotto: si
  // cammina a passi di un bit finché non regge davvero. Il ciclo ha un tetto
  // perché un presidio che gira per sempre non è un presidio.
  let l = lontano;
  for (let passo = 0; passo < 64; passo += 1) {
    if (regge(l)) return l;
    l += v * 0.002;
  }
  throw new Error(`la quantizzazione non lascia arrivare a ${bersaglio}:1 nella luce ${luce}`);
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
function chiarezzaDellaFamiglia(
  membri: readonly { h: number; c: number; sopra: readonly string[]; mira: Mira }[],
  luce: Luce,
  risolti: Map<string, string>,
): number {
  const chiarezze = membri.map((m) =>
    cerca(
      { c: m.c, h: m.h },
      m.sopra.map((f) => fondoDi(f, risolti)),
      mira(m.mira, luce),
      luce,
    ),
  );
  // La più lontana dalla carta: al buio la più alta, in luce la più bassa.
  return verso(luce) === 1 ? Math.max(...chiarezze) : Math.min(...chiarezze);
}

/// Il nero o il bianco, quello dei due che regge di più sopra un pieno. Non è
/// una scelta: è un conto con due candidati, e il presidio verifica che il
/// vincitore stia sopra la soglia del testo.
function controcolore(pieno: string): string {
  return contrasto("#000000", pieno) >= contrasto("#ffffff", pieno) ? "#000000" : "#ffffff";
}

/// I token di una luce, nell'ordine in cui la ricetta li dichiara. L'ordine
/// conta due volte: è quello in cui il foglio li scrive, ed è quello in cui si
/// risolvono — un inchiostro può nominare come fondo solo un ruolo già uscito.
export function tavolozza(luce: Luce): Map<string, string> {
  const risolti = new Map<string, string>();
  const famiglie = new Map<string, number>();

  for (const gruppo of RICETTA) {
    for (const voce of gruppo.voci) {
      risolti.set(voce.nome, valoreDi(voce, luce, risolti, famiglie));
    }
  }
  return risolti;
}

/// I membri di una famiglia, in tutta la ricetta. Si cercano a ogni prima
/// occorrenza e non si tiene una lista a parte: una lista a parte sarebbe un
/// secondo posto in cui dire chi è di quella famiglia, e la ricetta ne ha già
/// uno — il campo.
function membriDi(famiglia: string) {
  return RICETTA.flatMap((g) =>
    g.voci.filter((v) => v.tipo === "inchiostro" && v.famiglia === famiglia),
  ) as Extract<Voce, { tipo: "inchiostro" }>[];
}

function valoreDi(
  voce: Voce,
  luce: Luce,
  risolti: Map<string, string>,
  famiglie: Map<string, number>,
): string {
  switch (voce.tipo) {
    case "letterale":
      return typeof voce.valore === "string" ? voce.valore : voce.valore[luce];

    case "gradino": {
      // Il croma dei neutri cresce col gradino: una superficie lontana dalla
      // carta ha più posto per portare una tinta senza diventare colorata, e una
      // vicina non ne ha per niente. È il modo in cui «i neutri sono tinti, di
      // poco» resta vero anche sul gradino più basso, dove «di poco» vuol dire
      // zero — il nero e il bianco una tinta non ce l'hanno.
      const croma = voce.croma ?? Math.min(0.008, 0.0012 * voce.passi);
      return esa({ l: chiarezzaDelGradino(luce, voce.passi), c: croma, h: NEUTRO });
    }

    case "inchiostro": {
      const colore = { c: voce.c, h: voce.h };
      if (voce.famiglia === undefined) {
        const fondi = voce.sopra.map((f) => fondoDi(f, risolti));
        return esa({ ...colore, l: cerca(colore, fondi, mira(voce.mira, luce), luce) });
      }
      let l = famiglie.get(voce.famiglia);
      if (l === undefined) {
        l = chiarezzaDellaFamiglia(membriDi(voce.famiglia), luce, risolti);
        famiglie.set(voce.famiglia, l);
      }
      return esa({ ...colore, l });
    }

    case "controcolore": {
      const pieno = risolti.get(voce.sopra);
      if (pieno === undefined) throw new Error(`«${voce.sopra}» non è ancora stato risolto`);
      return controcolore(pieno);
    }

    case "velo": {
      const da = risolti.get(voce.da);
      if (da === undefined) throw new Error(`«${voce.da}» non è ancora stato risolto`);
      return `rgb(${daCanali(da).join(" ")} / ${voce.alpha[luce]}%)`;
    }

    case "eco": {
      const di = risolti.get(voce.di);
      if (di === undefined) throw new Error(`«${voce.di}» non è ancora stato risolto`);
      return di;
    }
  }
}

// ---------------------------------------------------------------------------
// L'emissione.
// ---------------------------------------------------------------------------

const INTESTAZIONE: Record<Luce, string> = {
  scuro:
    "Il foglio del tema di serie, nella luce scura: ruoli, tipografia, moto.\n" +
    "(§29.1, generato dalla ricetta della §31.2)",
  chiaro:
    "Il foglio del tema di serie, nella luce chiara: il gemello di\n" +
    "`foglio-scuro.css` (§29.1, generato dalla ricetta della §31.2)",
};

/// Il righello fra un gruppo e il successivo. La larghezza è dichiarata una
/// volta sola: due separatori lunghi diversi sono la specie di differenza che
/// nessuno ha scelto, e i fogli scritti a mano ne avevano già tre.
function separatore(titolo: string): string {
  return `  /* --- ${titolo} ${"-".repeat(Math.max(3, 66 - titolo.length))} */`;
}

/// Un blocco di prosa come commento CSS, con l'indentazione che il file usa.
function commento(testo: string, dentro: boolean): string {
  const righe = testo.split("\n");
  if (!dentro) {
    return ["/*", ...righe.map((r) => (r === "" ? " *" : ` * ${r}`)), " */"].join("\n");
  }
  const rientro = "  ";
  if (righe.length === 1) return `${rientro}/* ${righe[0]} */`;
  return [
    `${rientro}/* ${righe[0]}`,
    ...righe.slice(1).map((r) => (r === "" ? "" : `${rientro}   ${r}`)),
  ].join("\n").concat(" */");
}

/// Il foglio di una luce, per intero: è ciò che sta su disco, byte per byte.
export function foglio(luce: Luce): string {
  const valori = tavolozza(luce);
  const parti: string[] = [];

  parti.push(
    commento(
      `${INTESTAZIONE[luce]}\n` +
        "\n" +
        "FILE GENERATO — non modificare a mano.\n" +
        "\n" +
        "La sorgente è `theme/serie/ricetta.ts`, che dichiara ogni colore come\n" +
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
        "(`theme/struttura.css`) e qui non si ripetono; il chrome dei componenti\n" +
        "sta nella pelle (`pelle.css`), che di token non ne dichiara nessuno.",
      false,
    ),
  );
  parti.push(":root {");

  for (const gruppo of RICETTA) {
    if (gruppo !== RICETTA[0]) parti.push("");
    parti.push(separatore(gruppo.titolo));
    parti.push("");
    parti.push(commento(gruppo.prosa, true));
    parti.push("");
    for (const voce of gruppo.voci) {
      if (voce.prosa !== undefined) parti.push(commento(voce.prosa, true));
      parti.push(`  --${voce.nome}: ${valori.get(voce.nome)!};`);
    }
  }

  parti.push("");
  parti.push(separatore("ciò che vale per tutta la pagina"));
  parti.push("");
  parti.push(
    commento(
      "`color-scheme` dice al motore in che luce siamo: da qui prendono il verso\n" +
        "le barre di scorrimento e il cursore di testo. I controlli nativi che la\n" +
        "pelle veste — `<progress>`, le caselle — non lo leggono più, perché\n" +
        "`appearance: none` li ha portati dentro il tema (0166).",
      true,
    ),
  );
  parti.push("  font-family: var(--font-ui);");
  parti.push("  font-size: var(--text-md);");
  parti.push(`  color-scheme: ${LUCE[luce].schema};`);
  parti.push("}");

  return `${parti.join("\n")}\n`;
}

/// I due fogli, col nome del file che li ospita. È ciò che la generazione
/// scrive e ciò che il presidio confronta: un elenco solo, letto da due parti.
export const FOGLI: Readonly<Record<Luce, string>> = {
  scuro: "foglio-scuro.css",
  chiaro: "foglio-chiaro.css",
};

/// Il nome dei ruoli che la ricetta dichiara, nell'ordine del foglio. Lo legge
/// il presidio dell'additività: un ruolo non si rinomina, e il modo di
/// accorgersene è avere l'elenco di ieri accanto a quello di oggi.
export function ruoli(): string[] {
  return RICETTA.flatMap((g) => g.voci.map((v) => v.nome));
}

/// Le superfici e i fondi della carta, per chi deve misurarli da fuori: il
/// presidio della monotonia e il catalogo del banco. Non è una copia — è la
/// stessa costante che la ricetta consuma.
export const SCALA_SUPERFICI = ["doc-bg", ...SUPERFICI] as const;
export const FONDI_CARTA = CARTA;

/// Il passo di ciascuna luce, per il presidio che lo verifica sul foglio.
/// Esce di qui e non si riscrive di là: un numero dichiarato in due posti è la
/// coppia che diverge, e il presidio finirebbe per confermare sé stesso invece
/// della ricetta.
export const PASSO: Readonly<Record<Luce, number>> = {
  scuro: LUCE.scuro.passo,
  chiaro: LUCE.chiaro.passo,
};
