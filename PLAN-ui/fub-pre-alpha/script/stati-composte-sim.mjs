// Gli stati «composti» del simulatore v2 (D4 = A): le pagine approvate dei
// piani, fotografate scena per scena (catture p-*), montate dentro la cornice
// di Scrittoio 2 al posto dell'editor. Ogni voce:
//   base    lo stato ospite (la cornice vera del banco)
//   strati  [{cattura, dove, dopo?, prima?, sopra?}]: la cattura p-* va in un
//           iframe dentro `dove`; `dopo`/`prima` lasciano visibili i pezzi
//           dell'ospite sopra e sotto (la barra a schede, i fogli in fondo);
//           `sopra` stende la cattura trasparente su tutta la finestra.
// Il DOM di uno strato è quello della pagina del piano, non del client: si
// copia dalla pagina (e dal suo PLAN.md), con la pelle di Scrittoio 2.

const LAV = { base: "lavagna", dove: ".pane.focus .pane-editor" };
const IMP = { base: "impostazioni", dove: ".settings-main" };
const CEL = { base: "foglio", dove: ".grid-surface", dopo: ".grid-notice", prima: ".grid-sheets" };
const DIS = { base: "g2-disegno-penna", dove: ".pane.focus" };

function c(g, id, nome, cattura, ospite, { dice, task, fuoco, piano, sopra = false }) {
  const { base, ...dove } = ospite;
  return {
    g,
    id,
    nome,
    prov: "composta",
    base,
    strati: [sopra ? { cattura, sopra: true } : { cattura, ...dove }],
    fuoco: fuoco ?? "body",
    dice,
    task,
    piano,
  };
}

const lav = (id, scena, nome, dice, task = ["N6 T25", "PA T28"]) =>
  c("Lavagna", id, nome, `p-lav-${scena}`, LAV, { dice, task, piano: "lavagna-schede", fuoco: ".proto-card, [data-proto-card], button" });
const pen = (id, scena, nome, dice) =>
  c("Lavagna", id, nome, `p-penne-${scena}`, LAV, { dice, task: ["N4 T20", "N4 T21", "PA T28"], piano: "lavagna-penne", fuoco: "button" });
const cel = (id, scena, nome, dice) =>
  c("Foglio", id, nome, `p-celle-${scena}`, CEL, { dice, task: ["griglia T1–T9", "PA T27"], piano: "celle-griglia", fuoco: ".grid-cell, [role=gridcell]" });
// D5 = A (2026-11-07): la forma B resta solo come confronto, e lo dice.
const dis = (id, scena, nome, dice, task = ["K5 T21–T23", "PA T27"]) =>
  c("Disegno", id, nome, `p-dis-${scena}`, DIS, { dice: `D5 B: non si costruisce. ${dice}`, task, piano: "disegno-motore", fuoco: ".kit-rail-slot, button" });
// I dialoghi e l'avviso delle ricette stanno sopra la nota su cui girano.
const NOTA = { base: "nota-riposo" };
const ric = (id, scena, nome, dice, sopra = false) =>
  c("Componenti", id, nome, `p-ricette-${scena}`, sopra ? NOTA : IMP, { dice, task: ["A1 T12", "PA T29"], piano: "ricette", fuoco: "button", sopra });

export const COMPOSTE = [
  // ── Lavagna: le schede (N6 T25, approvata 2026-11-04) ─────────────────────
  lav("lav-schede", "schede-snapshot", "Lavagna: le schede (istantanea)", "Le schede dei file: ogni scheda mostra il suo file in piccolo, ferma, finché non la si apre."),
  lav("lav-schede-vive", "schede-live", "Lavagna: le schede vive", "Le schede vive: il file si vede com'è adesso, e scorre dentro la scheda."),
  lav("lav-una-scelta", "schede-selected", "Lavagna: una scheda scelta", "Una scheda scelta: il bordo e le maniglie agli angoli, il nome sopra."),
  lav("lav-attive", "schede-active", "Lavagna: schede aperte (Esc per uscire)", "Si scrive dentro le schede: «Esc per uscire» su ognuna, il bordo dell'accento."),
  lav("lav-testate", "testate", "Lavagna: testate e gemelle", "Le testate delle schede e le gemelle (lo stesso file due volte)."),
  lav("lav-inchiostro", "inchiostro", "Lavagna: l'inchiostro sopra le schede", "Il tratto della penna passa sopra le schede e resta della lavagna."),
  lav("lav-filo", "maniglie", "Lavagna: maniglie e fili (un legame)", "Le maniglie dei lati e il filo fra due schede: il legame si tira da una maniglia."),
  lav("lav-mancante", "mancante", "Lavagna: un file mancante", "La scheda di un file che non c'è più: lo dice, e offre di ritrovarlo o toglierla."),
  lav("lav-rilascio3", "rilascio3", "Lavagna: si lasciano 3 file", "Tre file trascinati dall'albero: l'anteprima di dove cadranno."),
  lav("lav-rilascio47", "rilascio47", "Lavagna: si lasciano 47 file", "Quarantasette file: la pila col numero, poi la griglia."),
  lav("lav-colori", "colori", "Lavagna: i colori delle schede", "Il colore di una scheda dal suo menu: i campioni della serie."),
  lav("lav-notifiche", "notifiche", "Lavagna: le notifiche", "Una scheda dice che il suo file è cambiato fuori."),
  lav("lav-lontano", "lontano", "Lavagna: da lontano (0,25)", "Da lontano le schede diventano il nome e il tipo."),
  lav("lav-lontanissimo", "lontanissimo", "Lavagna: da lontanissimo (0,1)", "Da lontanissimo restano rettangoli colorati: si vede la forma della lavagna."),
  lav("lav-cinquecento", "cinquecento", "Lavagna: 500 schede", "Cinquecento schede da lontano: il limite interattivo regge, nessuna scheda viva."),
  c("Impostazioni", "lav-impostazioni", "Impostazioni › la lavagna", "p-lav-impostazioni", IMP, {
    dice: "Le impostazioni della lavagna nella pagina di Scrittoio 2: schede vive o ferme, la griglia.",
    task: ["N6 T25", "PA T28"],
    piano: "lavagna-schede",
    fuoco: "input, button",
  }),
  // ── Lavagna: le penne (N4 T20, approvata 2026-11-02) ─────────────────────
  pen("pen-chiuso", "closed", "Penne: il menu chiuso", "La penna della lavagna a riposo: il pulsante della penna nella barra."),
  pen("pen-penna", "pen", "Penne: la penna", "Il menu della penna (N4): colore, spessore, la penna scelta."),
  pen("pen-evidenziatore", "highlighter", "Penne: l'evidenziatore", "L'evidenziatore: tratto largo e trasparente."),
  pen("pen-gomma", "eraser", "Penne: la gomma", "La gomma: cancella i tratti interi o a pezzi."),
  pen("pen-mia", "custom", "Penne: una penna mia", "Una penna personalizzata salvata fra le penne."),
  pen("pen-mouse", "mouse", "Penne: col mouse", "Col mouse la penna disegna solo se scelta; la rotella resta lo zoom."),
  pen("pen-sola-lettura", "readonly", "Penne: sola lettura", "La lavagna in sola lettura: le penne sono spente e lo dicono."),
  c("Impostazioni", "pen-impostazioni", "Impostazioni › la penna", "p-penne-settings", IMP, {
    dice: "Le impostazioni della penna: la mano, la pressione, il palmo.",
    task: ["N4 T20", "PA T28"],
    piano: "lavagna-penne",
    fuoco: "input, button",
  }),
  // ── Foglio: le celle (griglia, D2) ───────────────────────────────────────
  cel("celle-riposo", "riposo", "Celle: a riposo", "La griglia del piano celle: la cella attiva col bordo dell'accento."),
  cel("celle-intervallo", "intervallo", "Celle: un intervallo", "Un intervallo scelto: il velo e le intestazioni accese."),
  cel("celle-oltre", "oltre", "Celle: la scelta oltre lo schermo", "La scelta continua oltre il bordo: le intestazioni lo dicono."),
  cel("celle-editor", "editor", "Celle: la cella aperta, con l'aiuto della funzione", "La cella aperta: si scrive la formula e l'aiuto mostra gli argomenti."),
  cel("celle-misura", "misura", "Celle: la misura di una colonna", "Si trascina il bordo dell'intestazione: la misura si vede mentre cambia."),
  cel("celle-riempimento", "riempimento", "Celle: la maniglia di riempimento", "La maniglia nell'angolo: il riempimento tratteggiato mostra dove arriva."),
  cel("celle-copiata", "copiata", "Celle: copiata", "Le celle copiate: il bordo tratteggiato che scorre."),
  cel("celle-tagliata", "tagliata", "Celle: tagliata", "Le celle tagliate: il tratteggio e il testo smorzato."),
  // ── Disegno: la pagina di K5 com'è approvata (D5 B, solo confronto) ───────
  dis("dis-b-pronto", "1", "Disegno (D5 B): il motore pronto", "La testa di K5 com'è approvata: il motore acceso, gli strumenti a sinistra."),
  dis("dis-b-perse", "2a", "Disegno (D5 B): 3 parti perse", "Il motore apre il file ma tre parti non le sa tenere: lo dice prima di salvare."),
  dis("dis-b-cinquecento", "2b", "Disegno (D5 B): 500 parti", "Un disegno grande: il motore lavora, la testa resta pronta."),
  dis("dis-b-spento", "3", "Disegno (D5 B): il motore spento", "Il componente è spento: il disegno si apre in sola lettura e dice come accenderlo."),
  dis("dis-b-fermo", "4", "Disegno (D5 B): il motore fermo (rotto)", "Il motore si è fermato: il testo resta, l'errore dice cosa è successo."),
  dis("dis-b-senza", "5", "Disegno (D5 B): senza motore", "Nessun motore installato: l'editor SVG semplice."),
  dis("dis-b-rifiutato", "6a", "Disegno (D5 B): il file rifiutato", "Il motore rifiuta il file: si apre il sorgente."),
  dis("dis-b-si-apre", "6b", "Disegno (D5 B): si apre (lavora)", "Il motore sta aprendo il file: la tela aspetta col segno di lavoro."),
  dis("dis-b-testo", "7a", "Disegno (D5 B): lo strumento Testo", "Lo strumento Testo con la sua riga d'opzioni: carattere, corpo, allineamento."),
  dis("dis-b-testo-spento", "7b", "Disegno (D5 B): Testo spento", "Senza motore lo strumento Testo è spento e dice perché."),
  dis("dis-b-mano", "strumento-hand", "Disegno (D5 B): la mano", "La mano: si sposta la tela."),
  dis("dis-b-penna", "strumento-pen", "Disegno (D5 B): la penna", "La penna con la sua riga d'opzioni."),
  dis("dis-b-gomma", "strumento-eraser", "Disegno (D5 B): la gomma", "La gomma con la sua riga d'opzioni."),
  dis("dis-b-rettangolo", "strumento-rect", "Disegno (D5 B): il rettangolo", "Le forme: il rettangolo con riempimento e bordo."),
  c("Componenti", "dis-comp-acceso", "Componenti: il motore del disegno acceso", "p-dis-8a", IMP, { dice: "La riga del motore di disegno fra i componenti, acceso.", task: ["K5 T23", "K2 T1–T7"], piano: "disegno-motore", fuoco: "button, [role=switch]" }),
  c("Componenti", "dis-comp-spento", "Componenti: il motore del disegno spento", "p-dis-8b", IMP, { dice: "Spento: il disegno torna all'editor semplice.", task: ["K5 T23", "K2 T1–T7"], piano: "disegno-motore", fuoco: "button, [role=switch]" }),
  c("Componenti", "dis-comp-accendi", "Componenti: «Accendi…» il motore", "p-dis-8c", IMP, { dice: "«Accendi…» chiede i permessi del motore prima di accenderlo.", task: ["K5 T23", "K2 T1–T7"], piano: "disegno-motore", fuoco: "button" }),
  // ── A1: le ricette (approvata 2026-11-03) ────────────────────────────────
  ric("ricette", "piena", "Ricette (A1): l'elenco", "Le ricette nella pagina delle impostazioni: nome, cosa fanno, l'ultima corsa."),
  ric("ricette-vuote", "vuota", "Ricette (A1): nessuna ricetta", "Nessuna ricetta: la pagina dice dove si mettono e offre un esempio."),
  ric("ricette-problemi", "problemi", "Ricette (A1): ricette con problemi", "Una ricetta che non si legge: la riga col problema e il posto nel file."),
  ric("ricette-carica", "carica", "Ricette (A1): si caricano", "Le ricette si stanno leggendo."),
  ric("ricette-errore", "errore", "Ricette (A1): la cartella non si legge", "La cartella delle ricette non si legge: l'errore e «Riprova»."),
  ric("ricette-cinquecento", "cinquecento", "Ricette (A1): 500 ricette", "Cinquecento ricette: la ricerca e l'elenco che regge."),
  ric("ricetta-dialogo", "dialogo-aperta", "Ricetta (A1): il dialogo per farla girare", "Il dialogo di una ricetta: che cosa legge, che cosa scrive, i permessi.", true),
  ric("ricetta-prova", "dialogo-prova", "Ricetta (A1): la prova a secco", "La prova a secco: che cosa cambierebbe, senza scrivere niente.", true),
  ric("ricetta-prova-errore", "dialogo-prova-errore", "Ricetta (A1): la prova fallisce", "La prova fallisce: l'errore della ricetta, il file intatto.", true),
  ric("ricetta-nessuna-nota", "dialogo-nessuna-nota", "Ricetta (A1): nessuna nota su cui girare", "Nessuna nota corrisponde: la ricetta non parte e lo dice.", true),
  ric("ricetta-venti", "dialogo-venti", "Ricetta (A1): venti note da scrivere", "Venti note da scrivere: il permesso di scrittura chiesto una volta, con l'elenco.", true),
  ric("ricetta-cambiata", "dialogo-cambiata", "Ricetta (A1): la ricetta è cambiata", "La ricetta è cambiata dall'ultima volta: si rilegge prima di farla girare.", true),
  ric("ricetta-fatta", "avviso", "Ricetta (A1): il risultato", "Il risultato della corsa: un avviso con quante note ha cambiato e «Annulla».", true),
];
