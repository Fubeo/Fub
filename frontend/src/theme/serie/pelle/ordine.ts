// **La pelle si scrive a pezzi e si monta in un file** (§31.4).
//
// Il caricatore vuole una stringa e i presidi leggono un file — e tutti e due
// restano come sono. Quello che cambia è da che parte si scrive: un componente
// per volta, in questa cartella, invece che in duemilacento righe in cui
// trovare il posto giusto era già metà del lavoro.
//
// # L'ordine è dichiarato, non dedotto
//
// In CSS l'ordine di due regole della stessa specificità **decide chi vince**:
// assemblare per ordine alfabetico o per ordine di lettura della cartella
// vorrebbe dire che rinominare un file cambia ciò che si vede. È la stessa
// ragione per cui `theme/loader.ts` dichiara `ORDINE` invece di appendere in
// coda (§31.3): finché i pezzi erano due l'ordine era una conseguenza, e con
// diciotto smette di esserlo.
//
// E un elenco che qualcuno può svuotare in silenzio è indistinguibile da un
// elenco verde ([0109](../../../../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md)):
// un pezzo nuovo non elencato qui non finirebbe nella pelle, e nessuno lo
// direbbe. Il presidio in `theme/pelle.test.ts` confronta i due versi — ogni
// file un posto nell'ordine, ogni posto un file.
//
// # Perché è una funzione e non uno script
//
// Perché la si chiama da due parti: `tema/genera.mjs`, che legge la cartella
// con `fs` e riscrive il file, e il presidio, che legge gli stessi pezzi
// attraverso Vite e confronta. Un posto in cui scriverlo, due da cui leggerlo
// ([0020](../../../../../docs/decisions/0020-le-regole-in-un-posto-solo.md)).

/// I pezzi, nell'ordine in cui si montano — che è quello in cui stavano.
///
/// Dal generale al particolare, come li leggeva chi scorreva il file: le
/// fondamenta (la pagina, il bottone, gli intenti), le superfici della sidebar,
/// i componenti, le viste, e in fondo il chrome della finestra e il moto.
export const ORDINE = [
  "fondamenta",
  "pannelli",
  "albero",
  "spazi",
  "campi",
  "ricerca",
  "segmented",
  "riquadri",
  "anteprima",
  "menu-contestuale",
  "grafo",
  "modali",
  "avvisi",
  "view-dichiarate",
  "nodi",
  "impostazioni",
  "chrome",
  "moto",
] as const;

export type Pezzo = (typeof ORDINE)[number];

/// Il file che i pezzi compongono, relativo a `src/theme/serie/`.
export const PELLE = "pelle.css";

/// L'intestazione del derivato: cos'è questo strato, e che è generato.
///
/// Sta qui e non in un pezzo perché parla del **file**, non di un componente:
/// se stesse in `fondamenta.css` direbbe di quel pezzo cose che sono di tutti.
const INTESTAZIONE = `/* La pelle del tema di serie: il chrome (§29.1).
 *
 * GENERATO da \`theme/serie/pelle/\` — non si modifica qui: si tocca il pezzo e
 * si rigenera con \`npm run tema:genera\`. Una regola scritta a mano in questo
 * file sparisce alla prima rigenerazione, e fino ad allora dice il falso sul
 * pezzo che avrebbe dovuto contenerla.
 *
 * Qui è tutto ciò che del foglio visivo **si vede ma non è geometria né
 * garanzia**: i fondi, i bordi, i riempimenti, il moto dei componenti. La
 * geometria — dove sta cosa, quanto è larga la rail, come si dividono i
 * riquadri — e le garanzie — \`[hidden]\` nascosto, moto ridotto, anello del
 * fuoco, salto al contenuto — stanno nella struttura (\`theme/struttura.css\`),
 * che è della shell e non si tematizza. I valori — la scala, i ruoli di
 * colore, il moto — stanno nel foglio (\`foglio-scuro.css\` /
 * \`foglio-chiaro.css\`): questa pelle li consuma e non li dichiara.
 *
 * Come i fogli, non è cablata nell'app: la monta il caricatore
 * (\`theme/loader.ts\`), che **sostituisce** — una pelle sola alla volta. Una
 * pelle di terze parti può rifare ogni superficie che qui si vede, usando gli
 * stessi ruoli; non può muovere la scocca, che non legge da qui, né revocare
 * le garanzie, che non stanno qui.
 */
`;

/// Il filetto che, dentro il derivato, dice da quale pezzo viene ciò che segue.
///
/// Serve al verso opposto della generazione: i presidi, il browser e le tracce
/// puntano dentro `pelle.css`, e senza questa riga trovare il pezzo da toccare
/// vorrebbe dire cercare la regola a memoria.
function filetto(pezzo: string): string {
  const testa = `/* ── pelle/${pezzo}.css `;
  return `${testa}${"─".repeat(Math.max(3, 76 - testa.length))} */\n`;
}

/// Monta la pelle dai suoi pezzi. `contenuto` è il testo di ogni pezzo, per
/// nome; chiunque lo legga — da disco o da Vite — passa di qui.
export function assembla(contenuto: Readonly<Record<string, string>>): string {
  // Il verso che il montaggio da solo non vedrebbe: un pezzo che c'è e che
  // nessuno ha elencato non finirebbe da nessuna parte, e la pelle uscirebbe
  // più corta senza che niente lo dica.
  const inPiu = Object.keys(contenuto).filter((n) => !(ORDINE as readonly string[]).includes(n));
  if (inPiu.length > 0) {
    throw new Error(
      `pelle: ${inPiu.map((n) => `«${n}.css»`).join(", ")} non è nell'ORDINE, e un pezzo ` +
        "fuori dall'ordine non si monta: aggiungilo al punto in cui deve valere.",
    );
  }

  const fuori = [INTESTAZIONE];
  for (const pezzo of ORDINE) {
    const testo = contenuto[pezzo];
    if (testo === undefined) throw new Error(`pelle: manca il pezzo «${pezzo}.css»`);
    fuori.push(`\n${filetto(pezzo)}\n${testo.replace(/\n+$/, "\n")}`);
  }
  return fuori.join("");
}
