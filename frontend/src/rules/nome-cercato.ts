// **Dal testo cercato al nome di una nota** (§21.7): la regola che sta dietro
// «non l'ho trovata, creala».
//
// # Perché è una regola e non una riga dentro un pannello
//
// Perché una query e un nome di file non sono la stessa cosa, e il posto in cui
// smettono di esserlo è qui. Chi cerca scrive quello che ha in testa — con gli
// spazi che gli vengono, magari con uno slash, magari con dei due punti — e
// quello che arriva a `note.create` diventa un **path**: `name` non è
// un'etichetta, è l'id del documento con l'estensione appesa
// (`fub-features/src/commands.rs`, `note_create`). Passare la query così com'è
// vorrebbe dire che cercare `progetti/2026` crea una nota dentro una cartella
// che nessuno ha chiesto, e che cercare `a:b` sbatte contro la convalida del
// kernel o, peggio, contro quella di un filesystem — un errore che parla di
// caratteri illegali a chi stava soltanto cercando.
//
// # Cosa non fa, ed è la metà importante
//
// Non decide se il nome è **libero**. Quello lo sa solo il vault, e il comando
// lo chiede già a lui: `create_document` rifiuta un path occupato invece di
// sovrascriverlo, quindi il caso «esiste già» torna come errore del comando e
// non come una domanda che questa funzione dovrebbe indovinare. È un caso vero
// anche a risultati vuoti — la ricerca combacia sul **contenuto**, quindi una
// nota che si chiama come la query può esistere benissimo senza contenerla — e
// la risposta giusta è mostrare l'errore del kernel, non inventare un
// `nome (2)` che nessuno ha chiesto.
//
// Non normalizza il testo. Maiuscole, accenti e punteggiatura restano come sono
// stati scritti: chi ha cercato «Riunione con Anna» vuole una nota che si chiami
// così, e un nome ripulito in `riunione-con-anna` è il momento in cui l'app
// decide di sapere meglio dell'utente come si chiamano le sue cose.

/// I caratteri che in un nome di file non ci possono stare.
///
/// L'insieme è l'**unione** dei divieti dei tre sistemi, non quello del sistema
/// su cui gira: un vault sta in una cartella sincronizzata più spesso di no, e
/// una nota che su Linux si chiama `bilancio: 2026` è una nota che non si scarica
/// su Windows. Meglio un nome un po' più povero che una sincronizzazione che si
/// ferma su un file solo e non dice quale.
///
/// Le due barre ci stanno per una ragione diversa dalle altre: sono legali, ma
/// vogliono dire **cartella**, e questa funzione produce un nome e non un path.
/// I caratteri di controllo ci stanno per una terza ragione ancora: non si
/// vedono, e chi incolla da un PDF o da un terminale se li porta dietro senza
/// sapere di averlo fatto.
const VIETATI = /[\\/:*?"<>|\u0000-\u001f]/g;

/// Quanto può essere lungo il nome proposto.
///
/// Non è il limite di un filesystem (che è più alto e si misura in byte, non in
/// caratteri): è che chi incolla tre righe nella casella di ricerca e non trova
/// niente non sta chiedendo una nota che si chiami come tre righe. Tagliato, il
/// nome resta modificabile; troppo lungo, non si riesce nemmeno a leggerlo nella
/// riga che lo propone.
const MASSIMO = 80;

/// Il nome di nota che il testo cercato propone, o `null` se non ne propone uno.
///
/// `null` è il segnale che il gesto **non si offre**: una query fatta di soli
/// spazi o di soli caratteri vietati non è il nome di niente, e proporre lì un
/// «crea» che poi fallisce, o che crea una nota chiamata come il vuoto, è
/// peggio che non proporlo. Chi chiama disegna il gesto solo se qui esce una
/// stringa.
export function nomeDaCercato(testo: string): string | null {
  const pulito = testo
    .replace(VIETATI, " ")
    // Gli spazi si accorpano **dopo** la sostituzione, non prima: è la
    // sostituzione a crearne di nuovi, e `a / b` deve dare `a b` e non `a  b`.
    .replace(/\s+/g, " ")
    .trim()
    // I punti in coda se ne vanno, e non è pedanteria da Windows: un nome che
    // finisce per punto, con l'estensione appesa, dà `nota..md`.
    .replace(/\.+$/, "")
    .trim()
    .slice(0, MASSIMO)
    .trim();
  // Un nome che comincia per punto è un file nascosto, e nessuno che cerchi
  // qualcosa sta chiedendo una nota che poi non vede nell'albero.
  return pulito === "" || pulito.startsWith(".") ? null : pulito;
}
