# 0089 — Da cosa è partita una scrittura

|  |  |
|---|---|
| **Decisa** | 2026-08-04 |
| **Origine** | `todo.md` §18.1 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/18-editor-e-tastiera.md) · [la modifica chirurgica, 0008](0008-modifica-chirurgica.md) · [ciò che non è ancora successo, 0088](0088-cio-che-non-e-ancora-successo.md) · [chi vede il modello parsato, 0018](0018-chi-vede-il-modello-parsato.md) · [il rilevamento si può chiedere, 0030](0030-il-rilevamento-si-puo-chiedere.md) · [un errore è testo che qualcuno legge, 0041](0041-un-errore-e-testo-che-qualcuno-legge.md) · [una scorciatoia è una chiave, 0077](0077-una-scorciatoia-e-una-chiave.md)

---

La guardia c'era già, e valeva per metà del sistema. La
[0008](0008-modifica-chirurgica.md) aveva messo la revisione nella firma di
`apply_edit` e fatto rispondere `Conflict` invece di sovrascrivere in silenzio;
ma `apply_edit` è la primitiva dei **provider**, e l'editor non passa di là.
L'editor salva il proprio buffer intero, cioè chiama `write_document`, che non
portava niente — quindi il salvataggio dell'editor **copriva** una scrittura
altrui che il watcher non aveva visto, e nessuna delle due metà del sistema se
ne accorgeva.

Il rischio non era teorico e non era nemmeno nascosto: la
[0030](0030-il-rilevamento-si-puo-chiedere.md) lo aveva reso **misurabile** —
con `VaultStatus.watching` a `false` la copertura è nulla, e si sa. Ciò che
mancava era che qualcuno, sapendolo, potesse fare qualcosa.

## Prima di eseguire, rimisurare

La voce aveva due caselle, e la prima non si è eseguita. Chiedeva «semantica
dagli `Span` del modello», cioè un canale che porti il modello parsato fino alla
webview. Quel canale la [0018](0018-chi-vede-il-modello-parsato.md) ha deciso
che **non ci sarà**, e non per rimandarlo: la live preview decora un **buffer**,
che può essere sporco, mentre il modello è quello del **file** — un modello
spedito di là sarebbe vero solo quando serve meno. La casella è stata quindi
riformulata e rimandata alla
[§4.4](../roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi),
dove la stessa cosa è già scritta dal lato giusto: il secondo livello si può
scrivere quando la dichiarazione delle sintassi è condivisa, non quando esiste
un canale per il modello.

È la terza volta di fila che una voce ferma va rimisurata invece che eseguita —
dopo la [0087](0087-il-testo-che-sta-dentro-gli-allegati.md) e la
[0088](0088-cio-che-non-e-ancora-successo.md) — e stavolta il modo è nuovo: le
due precedenti avevano trovato che ciò che la voce aspettava era **caduto**;
questa trova che ciò che la voce chiedeva è stato **deciso di no**. Una voce che
nomina un canale non ha modo di sapere che il canale è stato discusso e scartato
altrove: quel fatto sta in un verbale, e la voce è più vecchia del verbale.

## La base, e perché è opzionale qui e obbligatoria là

`write_document` prende ora una `base: Option<Revision>`. Se c'è e non combacia,
`Conflict`, e **non viene scritto niente**.

Che sia opzionale mentre in `apply_edit` non lo è non è un compromesso col
freeze: è che le due firme rispondono a due domande diverse. Un edit **non
esiste** senza la revisione su cui è stato calcolato — i suoi offset indicano un
testo, e senza dire quale non sono una modifica ma un'ipotesi. Una riscrittura
totale invece è compiuta da sé: un importer che crea una nota, un template che
scrive la nota di oggi, il ripristino di una versione non stanno correggendo un
testo che hanno letto, lo stanno **dettando**. Obbligare quei chiamanti a
esibire una base vorrebbe dire farsela inventare — e una base inventata è una
guardia che dice sempre di sì, cioè peggio di nessuna guardia, perché sembra una
guardia.

Quindi: `None` = «scrivi, questo testo non discende da niente»; `Some` = «scrivi
solo se il file è ancora quello da cui sono partito». I tre chiamanti che
scrivono ciechi lo fanno ora **per iscritto**, con un commento che dice perché,
invece di farlo perché la firma non permetteva altro.

## Il ritorno, che è la metà che paga due volte

`write_document` restituisce la revisione **prodotta**. Costa una riga e compra
due cose che non si somigliano.

La prima è che la guardia diventa una **catena** invece di un controllo alla
prima battuta. Senza il ritorno, il secondo salvataggio nominerebbe una base
ormai vecchia — quella con cui il documento è stato aperto — e fallirebbe contro
sé stesso: l'editor non riuscirebbe a salvare due volte di fila. Con il ritorno,
ogni scrittura consegna la base della successiva.

La seconda è che chiude un buco che la [0088](0088-cio-che-non-e-ancora-successo.md)
aveva dovuto dichiarare un verbale fa. `DraftInfo::base` — la revisione da cui
il buffer di crash si è discostato — era `null` **sempre**, perché la shell non
aveva modo di calcolarla: ricalcolare FNV-1a in TypeScript sarebbe stata una
seconda implementazione della stessa funzione, cioè due verità, e la seconda
mente in silenzio. Adesso la base arriva dal kernel insieme al testo, e la bozza
la porta con sé. Il caso `incerta` che la 0088 aveva costruito **resta**, ed è
giusto che resti: una bozza scritta prima di oggi non la sa, e una che non la sa
non deve fingere.

Ed è questo il criterio di leva con cui la voce è stata scelta: **due caselle
che si pagano una volta sola**. Dare la base a `write_document` chiude un difetto
vecchio *e* rende calcolabile la base delle bozze, e il secondo effetto non
sarebbe stato ottenibile lavorando sulla 0088 — che l'aveva già guardato e aveva
dovuto scriverne il limite.

## Il ritaglio, e il ripiego scartato

Nessuna delle due metà è additiva, e il presidio dell'additività lo ha detto
subito e con precisione: *«aveva 2 parametri e ora ne ha 3»*, *«restituiva
`result<_, plugin-error>` e ora restituisce `result<revision, plugin-error>`»*.
Una guardia si aggiunge solo cambiando l'arità; una revisione prodotta solo
cambiando il tipo di ritorno.

Il ripiego additivo esisteva: una `write-document-based` accanto a quella che
c'è. È stato scartato per la ragione della
[0049](0049-una-posizione-dentro-un-documento.md) — lascerebbe per sempre **due
modi di scrivere un documento intero, di cui uno cieco**, cioè esattamente la
cosa che questo lavoro esiste per togliere. Chi scrive un plugin sceglierebbe la
più corta, e la più corta è quella che copre il lavoro degli altri.

Siamo prima del freeze di M4, quindi si è presa l'altra uscita onesta che il
presidio nomina: **ritagliare la linea di base**, con un commit che tocca
`wit/frozen/0.1.0.wit` e dice perché. La riga è nella tabella dei ritagli in
[wit-congelato.md](../architecture/wit-congelato.md). Dopo il freeze questo
lavoro non sarebbe stato difficile: sarebbe stato impossibile.

## Il confronto è col disco, e la lettura si paga solo se serve

La guardia rilegge il file. È la stessa scelta di `document_revision`, e la
ragione è che la verità di un documento è il file: una guardia che si fidasse
dell'anagrafe direbbe di sì proprio nel caso in cui l'anagrafe è indietro — che è
il solo caso che deve prendere. Il test
`la_guardia_non_si_fida_dell_anagrafe` esiste per questo, e senza il confronto
col disco resta verde in modo ingannevole.

La lettura in più però si paga **solo quando qualcuno la chiede**. Senza `base`,
`write_document` legge dalla memoria come prima, e la riga del registro continua
a costare zero letture: la 0088 aveva scritto che *«una riga di registro non vale
una lettura in più a ogni salvataggio»*, e resta vero. Chi chiede la guardia
paga la guardia.

## Di là dal confine: un conflitto non è un disco pieno

La shell tiene ora, accanto al testo del buffer, **da cosa si è discostato**.
Arriva con il documento — `read_document` consegna testo e revisione insieme,
in una porta sola — e si aggiorna a ogni salvataggio riuscito e a ogni ricarica.

Il salvataggio che fallisce aveva un ramo solo, e ne ha due, perché adesso i due
casi sono **distinguibili**: la [0041](0041-un-errore-e-testo-che-qualcuno-legge.md)
aveva reso la specie di un errore interrogabile (`kind: "conflict"` accanto a
`"io"`) proprio perché un giorno qualcuno ci ramificasse sopra. La differenza non
è di sfumatura: un disco pieno si **riprova**, e la battuta dopo ci riprova da
sola; un conflitto no, perché riprovare è la sovrascrittura che la guardia ha
appena impedito. Ciò che manca non è un tentativo ma una **decisione**, e la
decisione è dell'utente. Tenerli insieme vorrebbe dire che l'autosave, insistendo,
risolve da sé un caso in cui insistere è il danno.

La decisione sta in una funzione pura (`esitoDelFallimento`) e non in un `if` in
mezzo a `saveDoc`, per la disciplina che quel file si è già dato: ciò che si può
sbagliare guardando l'app mentre tutto funziona si prova senza un DOM.

**Nessun dialogo modale.** Il buffer resta sporco e vivo, la bozza si scrive
subito — è di nuovo l'unica copia —, la barra di stato lo dice e non lo chiama
«salvataggio fallito». Le due vie d'uscita sono **comandi della shell**, con la
forma della [0077](0077-una-scorciatoia-e-una-chiave.md): «tieni il mio testo» e
«tieni il testo sul disco». È la forma del recupero bozze della 0088 — un buffer
precaricato che aspetta — e non un secondo meccanismo accanto.

Tre cose che quella scelta porta con sé, e che valgono più della scelta:

- **I titoli nominano cosa si perde**, non «risolvi». Chi legge una riga in una
  palette sta scegliendo fra due testi, e «risolvi il conflitto» non dice quale
  dei due resta.
- **Nessuno dei due ha una scorciatoia**, per la regola di `shell.history.clear`
  più una sua: sono i due gesti in cui l'utente sceglie quale testo perdere, e un
  tasto premuto per sbaglio sceglierebbe al posto suo. Si cercano nella palette,
  dove per arrivarci bisogna averli scritti.
- **«Tieni il mio» azzera la base, non la rilegge.** Rileggere la revisione di
  adesso e riprovare sarebbe la sovrascrittura silenziosa di prima con un giro in
  più, e la guardia non guarderebbe niente. Qui la sovrascrittura c'è, ed è ciò
  che l'utente ha chiesto — dopo che gli è stato detto cosa stava coprendo.

## Cosa NON si è toccato, e perché

Il rischio di questa voce era di aggiungere un **terzo** modo di dire «è cambiato
sotto». Ce n'erano due e mezzo: `cambioSotto` nella shell (quattro casi, fra cui
l'eco del proprio salvataggio), `VaultStatus.watching` che dice se la copertura
del watcher è nulla, e `Revision` + `Conflict` nel contratto.

Non ne è nato uno nuovo: il conflitto del salvataggio **è** il terzo di quei tre,
esteso alla seconda primitiva di scrittura. Ciò che è cambiato è la gerarchia fra
i primi due e lui. `cambioSotto` resta l'avviso **precoce** — arriva con l'evento,
quando il salvataggio non è ancora partito — e non è più ciò da cui dipende la
correttezza: quella adesso è del kernel, che non si può ingannare.

In particolare il contatore `echi` resta com'era. Toglierlo vorrebbe dire far
portare all'evento `document_changed` la revisione prodotta, cioè un'altra firma
del contratto, per un guadagno che è di pulizia e non di correttezza. È una
domanda vera e sta scritta qui perché qualcuno la ritrovi, non perché sia stata
evitata: il commento che la nomina è ancora in `panels/document.ts`, dove dice
che *«il kernel non ci dà modo di riconoscerlo — l'evento non porta una
revisione»*.

## Cosa resta

Della §18.1 non resta niente. Il secondo livello di decorazione vive ora nella
§4.4, dove era già scritto dall'altro lato, e la §18.2 resta col suo accordo in
sequenza, che è un secondo problema.
