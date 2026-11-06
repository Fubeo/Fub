// solo simulatore: gli scenari della pre-alpha, passo per passo. Ogni passo è
// uno stato del simulatore (con luce, larghezza o scelte di Aspetto quando
// servono) e una frase che dice che cosa fa la persona e che cosa vede.
// Il bottone «Avanti» del simulatore li percorre; costruisci-sim.mjs controlla
// che ogni stato esista.
const p = (stato, dice, o = {}) => ({ stato, dice, ...o });

export const SCENARI = [
  {
    id: "primo-avvio", nome: "Il primo avvio",
    passi: [
      p("avvio-attesa", "Fub parte: lo strato d'avvio copre la finestra finché la cornice non è pronta."),
      p("avvio-lento", "Se ci mette più di qualche secondo, lo dice e mostra che cosa sta facendo."),
      p("vuoto", "Nessun vault ancora: il benvenuto offre di aprire una cartella o di crearne una."),
      p("nuovo-vault", "Un vault nuovo chiede il profilo: quali componenti accendere."),
      p("nota-riposo", "Il vault è aperto sulla nota «Benvenuto», in Live."),
    ],
  },
  {
    id: "scrivere", nome: "Scrivere una nota",
    passi: [
      p("nota-riposo", "Si clicca nel foglio e si scrive: il testo è vero (nel simulatore non si salva)."),
      p("slash", "«/» a inizio riga apre il menu dei blocchi."),
      p("slash-filtro", "Le lettere filtrano: «tab» lascia la tabella."),
      p("barra", "Selezionato del testo, la barra di formato dà grassetto, titoli, elenchi, collegamenti."),
      p("salvataggio", "«Salvato» nella testata apre il foglietto: dove sta il file, quando è stato scritto."),
      p("nota-lettura", "La stessa nota in Lettura, senza cursore."),
    ],
  },
  {
    id: "riquadri", nome: "Due riquadri",
    passi: [
      p("g2-trascina", "Una linguetta trascinata sul bordo destro: l'anteprima della divisione."),
      p("g2-due-riquadri", "Lasciata, la nota e il PDF stanno affiancati; il fuoco ha il bordo."),
      p("g2-live-lettura", "La stessa nota in due riquadri: Live a sinistra, Lettura a destra."),
      p("g2-menu-riquadro", "«…» nella testata del riquadro: dividi, sposta, chiudi."),
    ],
  },
  {
    id: "foglio", nome: "Un foglio di calcolo",
    passi: [
      p("foglio", "Il foglio «Conti» aperto: le celle, la barra della formula, i fogli in fondo."),
      p("g2-foglio-selection", "Un intervallo scelto: la somma e la media nella banda."),
      p("celle-riempimento", "La maniglia di riempimento tirata verso il basso."),
      p("g2-foglio-formula", "Una cella aperta con l'aiuto della funzione."),
      p("g3-foglio-errore", "Una formula sbagliata: l'errore nella cella e la spiegazione."),
      p("g2-foglio-tab-dati", "La scheda «Dati» del nastro: filtro, ordinamento, blocca riquadri."),
      p("foglio-comandi", "«Comandi»: le azioni del motore, cercabili."),
      p("g2-foglio-result-table", "Il risultato di un comando, in tabella."),
    ],
  },
  {
    id: "disegno", nome: "Un disegno",
    passi: [
      p("g2-disegno-penna", "Il disegno aperto con la penna: la colonna degli strumenti a sinistra, le opzioni sopra."),
      p("disegno-a-testo", "Lo strumento Testo con la sua riga di opzioni (D5 A: lo stato del motore nella banda)."),
      p("g3-disegno-livelli", "I livelli nel pannello."),
      p("disegno-a-perse", "Il motore ha aperto il file: 3 parti restano come sono, e lo dice."),
      p("disegno-a-fermo", "Il motore si è fermato: il disegno resta aperto in sola lettura."),
      p("dis-b-fermo", "Lo stesso caso nella forma B (la striscia sopra la tela), da confrontare."),
    ],
  },
  {
    id: "lavagna", nome: "Una lavagna",
    passi: [
      p("lav-vuota", "Una lavagna nuova: il foglio vuoto e come si comincia."),
      p("lav-impianto", "Le schede di note, documenti, fogli e PDF, con un testo libero."),
      p("lav-sel-una", "Una scheda scelta: la barra della selezione sopra."),
      p("lav-sel-molte", "Tutte e dieci le schede scelte: la barra dice quante e che cosa si può fare insieme."),
      p("lav-scrive-slash", "Si scrive in una scheda di testo, e «/» apre il menu dei blocchi (T27)."),
      p("lav-filo-nuovo", "Un legame tirato da una scheda all'altra."),
      p("lav-penna", "La penna (N4): il menu delle penne e l'inchiostro sopra le schede."),
      p("lav-lazo", "Il lazo prende più schede."),
      p("lav-estratti", "Gli estratti di un PDF tirati fuori in schede (T28)."),
      p("lav-codice-menu", "«Lavagna in codice»: il menu della scheda."),
      p("lav-codice-riepilogo", "Incollato il codice: il riepilogo di che cosa entra."),
      p("lav-cinquecento", "Cinquecento schede da lontano."),
    ],
  },
  {
    id: "conflitto", nome: "Un conflitto",
    passi: [
      p("conflitto", "Il file è cambiato fuori mentre si scriveva: il banner offre le scelte."),
      p("g4-conflitto-confronta", "«Confronta»: le due versioni riga per riga."),
      p("g4-conflitto-mio", "«Mantieni il mio testo» chiede prima di scrivere."),
      p("g4-conflitto-dopo", "«Decidi dopo»: il banner diventa una riga, niente è scritto."),
      p("g2-conflitto-lettura", "In Lettura il conflitto si vede lo stesso."),
    ],
  },
  {
    id: "r01-versione", nome: "Una bozza ritrovata e una versione",
    passi: [
      p("g2-bozza", "Fub si era chiuso con del testo non salvato: la bozza (R01) aspetta."),
      p("g2-bozza-divergente", "La bozza è diversa dal file su disco: si sceglie quale tenere."),
      p("g2-ispettore-3", "Le versioni della nota nell'ispettore (R02): se ne apre una."),
      p("g2-non-salvata", "Una modifica non ancora scritta: la testata lo dice."),
    ],
  },
  {
    id: "cestino", nome: "Il cestino",
    passi: [
      p("g2-cestino", "Un file buttato va nel cestino del vault: si vede e si ripristina."),
      p("conferma", "Svuotare il cestino è una domanda di pericolo: il fuoco parte da Annulla."),
      p("g2-cestino-vuoto", "Il cestino vuoto."),
    ],
  },
  {
    id: "componente", nome: "Un componente",
    passi: [
      p("componenti", "Impostazioni › Componenti: che cosa è installato e acceso."),
      p("comp-permesso", "Un componente nuovo chiede un permesso: si legge che cosa e perché."),
      p("comp-installato", "Installato e acceso."),
      p("comp-rotto-tempo", "Il componente è andato oltre il tempo: Fub lo ferma e lo dice."),
      p("comp-rotto-errore", "Il componente si è rotto (trap): fermo, con il dettaglio."),
      p("comp-aggiorna", "Un aggiornamento: che cosa cambia nei permessi."),
      p("g2-comp-spegni", "Spegnere un componente: che cosa smette di funzionare."),
    ],
  },
  {
    id: "ricetta", nome: "Una ricetta (A1)",
    passi: [
      p("ricette", "Le ricette nelle impostazioni: quali ci sono e che cosa toccano."),
      p("ricetta-dialogo", "Lanciata dalla nota: il dialogo dice che cosa farà."),
      p("ricetta-prova", "La prova a vuoto: che cosa cambierebbe, senza scrivere."),
      p("ricetta-prova-errore", "La prova fallisce: lo dice e non scrive niente."),
      p("ricetta-fatta", "Fatta: l'avviso con il riepilogo."),
    ],
  },
  {
    id: "vault", nome: "Cambiare vault",
    passi: [
      p("g2-vault", "Il chip del vault: i vault recenti e «Apri un'altra cartella»."),
      p("impostazioni-vault", "Le impostazioni del vault aperto."),
      p("vault-irraggiungibile", "Un vault che non si raggiunge (disco staccato): Riprova o un altro."),
    ],
  },
  {
    id: "aspetto", nome: "L'aspetto",
    passi: [
      p("aspetto", "Impostazioni › Aspetto, coi valori di serie."),
      p("aspetto", "Densità compatta: la cornice si stringe.", { prefs: { density: "compact" } }),
      p("aspetto", "Accento terracotta.", { prefs: { density: "compact", accent: 55 } }),
      p("nota-riposo", "La nota con quell'accento e quella densità.", { prefs: { density: "compact", accent: 55 } }),
      p("nota-riposo", "Alto contrasto, di notte.", { luce: "dark", prefs: { contrast: "high" } }),
      p("tema-carta", "Un tema della comunità, «Carta»."),
    ],
  },
  {
    id: "tastiera", nome: "Solo con la tastiera",
    passi: [
      p("palette-file", "Ctrl+O apre l'avvio rapido sulle note; si scrive per filtrare."),
      p("g2-lanciatore-comandi", "Ctrl+P: i comandi."),
      p("nota", "Dalla banda, Invio apre il menu delle modalità; le frecce scelgono."),
      p("blocchi-menu", "In Blocchi, il menu della maniglia si apre anche da tastiera."),
      p("g2-imp-tasti", "Impostazioni › Tasti: tutte le scorciatoie."),
    ],
  },
  {
    id: "errori", nome: "Quando qualcosa va storto",
    passi: [
      p("g2-salvataggio-fallito", "Il salvataggio fallisce: il testo resta e la testata lo dice."),
      p("g3-pdf-rotto", "Un PDF rotto: lo dice, non si blocca."),
      p("file-sconosciuto", "Un formato che Fub non conosce: l'altra app o la cartella."),
      p("file-troppo-grande", "Un file troppo grande per aprirlo qui."),
      p("errore", "Il motore dei fogli non parte."),
      p("avvio-guasto", "L'avvio non riesce: il motivo e che cosa fare."),
    ],
  },
  {
    id: "telefono", nome: "Al telefono",
    passi: [
      p("tel-avvio", "Il primo schermo al telefono."),
      p("tel-nota", "Una nota a tutta larghezza; la barra in basso."),
      p("tel-tastiera", "Con la tastiera aperta, la barra sale sopra i tasti."),
      p("tel-cassetto", "Scorrendo verso l'alto si apre il cassetto."),
      p("t-cassetto-file", "Il cassetto dei file, fino al cestino."),
      p("tel-doc", "Un documento al telefono."),
      p("g2-tel-foglio-aperto", "Una cella aperta al telefono."),
      p("t-foglio-errore", "Un comando del foglio che non riesce: il perché e «Riprova»."),
      p("lav-sel-una", "La lavagna al telefono (ricomposta, provvisoria).", { larghezza: "tel" }),
    ],
  },
  {
    id: "skin", nome: "Una skin facile",
    passi: [
      p("tema-sviluppo", "Aspetto in modalità sviluppo: la sezione dei temi in prova."),
      p("tema-installa", "Installare un tema da una cartella."),
      p("tema-rifiutato", "Un tema rifiutato: la diagnosi dice riga e motivo."),
      p("tema-collegato", "Un tema collegato «In sviluppo»: si ricarica a ogni salvataggio."),
      p("tema-tutti-componenti", "«Tutti i componenti»: ogni controllo, nelle sue forme, col tema addosso."),
      p("tema-salvia", "Lo schermo vestito da «Salvia»."),
    ],
  },
];
