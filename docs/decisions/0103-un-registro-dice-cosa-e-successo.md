# 0103 — Un registro dice cosa è successo, non cosa c'era scritto

**Stato**: accolta
**Data**: 2026-08-05
**Chiude**: [§23.9](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#239-il-registro-non-si-spegne-e-per-una-modifica-chirurgica-porta-i-byte-dellutente)
**Commit**: *(questo commit)*

---

## La domanda

Dentro un vault c'è `.fub/journal.jsonl` — il registro di ciò che è successo,
fatto dalla [0067](0067-il-registro-di-cio-che-e-successo.md). È in chiaro, non
si spegne, e fino a qui è una scelta argomentata: un registro delle mutazioni
che si possa perdere non serve a niente, e *«un tutto-o-niente vero finché
qualcuno non tocca un interruttore non è un tutto-o-niente»*.

La 0067 dichiara anche il proprio prezzo, con la lucidità che è l'abitudine di
questo repo: *«un registro delle mutazioni nomina i path di ogni nota toccata e
quando lo è stata, cioè è più rivelatore in chiaro di quanto lo sia una nota
sola»*. Quello che nessuno aveva sommato è la riga accanto. `JournalOp::Edited`
portava `inverse: EditRequest`, e un `EditRequest` porta `edits: Vec<TextEdit>`,
cioè **il testo sostituito**.

Sommate, le due righe dicono una cosa che nessuna dice da sola: dentro il vault
c'era un file in chiaro, non spegnibile, che l'utente non aveva nessun comando
per cancellare, il quale conteneva frammenti delle sue note e **sopravviveva
alla cancellazione delle note da cui venivano**. Chi svuotava il cestino per far
sparire qualcosa non lo faceva sparire.

## Cosa la misura ha cambiato, prima di progettare

La voce chiedeva di soppesare un prezzo: *«un `Edited` che porta gli span invece
dei byte perde la capacità di annullare; va deciso se l'annullamento vale quel
prezzo, e la risposta plausibile è che valga»*. Misurato, **quel prezzo è
zero**, e la domanda era mal posta.

L'annullamento non è mai passato di qui. `Workspace::undo_last` legge
`self.undo.pop()`, cioè la pila in memoria della
[0045](0045-l-undo-ha-due-pile.md); nel suo corpo il registro non compare. I
lettori del journal in produzione sono **tre**, tutti dentro il kernel, e tutti
e tre usano un solo campo: `Lettura::scartate`, un intero. Il campo `inverse`
aveva **un solo consumatore in tutto il repo, ed era un test**. La capacità che
la voce temeva di perdere era una facoltà dichiarata e mai esercitata — e per
esercitarla si sarebbe dovuto tenere per sempre, in chiaro, il testo
dell'utente.

Questo rovescia l'argomento. Non «l'annullamento vale il prezzo della privacy?»,
ma: *stiamo conservando i byte dell'utente per un annullamento che non esiste,
in un file che nessuno può cancellare*.

E c'è una seconda misura che decide da sola. La facoltà futura che il registro
avrebbe abilitato è il **rollback di un lotto**, che
[strozzature.md](../roadmap/strozzature.md) assegna già a chi lo userà. Ma quel
rollback era **già** parziale, e per costruzione: `JournalOp::Written` — il
salvataggio dell'editor, cioè la mutazione più frequente che ci sia — non ha
inverso e non l'ha mai avuto, perché per riportarlo indietro servirebbe il testo
di prima. Un rollback che sa disfare le modifiche chirurgiche e non i salvataggi
è «un'operazione che si annulla per un pezzo», che il modulo stesso chiama
*peggio di una che non si annulla affatto*. Il posto dove il contenuto di ieri
vive è il versioning — che si spegne, e che si cancella.

## La decisione

**Il testo dell'utente esce dal registro, e non dietro un interruttore.**

`JournalOp::Edited` non porta più l'inverso: porta l'**impronta**.

```rust
pub struct EditFootprint {
    /// Dove, in byte UTF-8 del sorgente dopo la modifica.
    pub span: Span,
    /// Quanti byte c'erano al suo posto. Zero quando l'edit ha solo inserito.
    pub replaced: usize,
}

Edited { doc, from, to, footprint: Vec<EditFootprint> }
```

Un audit chiede *quando, chi, dove, quanto*, e ha ancora tutto — anzi ha una
cosa in più di prima, il **conto** di quanti edit erano, che l'inverso perdeva
fondendo quelli che condividevano un punto di partenza. Per *cosa* c'era
scritto, non è affare di un registro.

Tre righe di dettaglio che sono decisioni e non conseguenze:

- **il campo si chiama `footprint` e non `inverse`.** Un nome che promette di
  poter tornare indietro è un nome che qualcuno proverà ad applicare;
- **`is_invertible` risponde `false` anche per `Edited`.** Le due varianti che
  non si annullano sono ora *le due che porterebbero testo*, e non è una
  coincidenza: è la regola del modulo vista da lì — ciò che per tornare indietro
  vuole il contenuto di ieri, da un registro non torna indietro;
- **`report.inverse()` sulla strada del disco non si chiama più affatto.**
  L'impronta si costruisce da `report.applied`, così i byte dell'utente non
  passano nemmeno per una variabile. Togliere il testo *dopo* averlo
  materializzato sarebbe stato lo stesso risultato con una riga in più da non
  dimenticare.

Questo non è personalizzazione ed è giusto che non lo sia: è la riparazione di
una regola che il modulo aveva già scritto. Il paragrafo in testa a `journal.rs`
si intitolava *«Il contenuto di prima non ci sta, e l'inverso sì»* e diceva, a
undici righe di distanza, che *«gli snapshot restano l'unico posto in cui il
contenuto di ieri è conservato, e questo file non ne tiene nemmeno una copia»*.
Una copia la teneva. Il documento non aveva torto sul principio: aveva
un'eccezione che nessuno gli aveva sommato.

## E ciò che resta invece si dichiara

Tolto il contenuto, resta ciò che la 0067 aveva già dichiarato: **i path e i
tempi**. Quelli non sono un difetto — sono ciò per cui il registro esiste — ma
sono anche il dato che il verbale chiamava «più rivelatore in chiaro di quanto
lo sia una nota sola». È qui che va la scelta dell'utente, e sono due gesti.

**La finestra.** `journal.retention.days`: fuori dalla finestra una riga cade,
qualunque sia il conto. Zero — il default — vuol dire *per sempre*.

Che il default sia zero è una decisione, non un'omissione. Il registro è
**autorevole** ([0048](0048-una-radice-sola.md)): perso, non si ricostruisce da
niente. Cancellare per default un dato autorevole, in un vault che si è appena
aggiornato e senza che nessuno l'abbia chiesto, non è difendibile — nemmeno per
la privacy, e meno che mai ora che il dato è ridotto ai path. La finestra è
scritta, visibile e vuota: l'utente sceglie.

Il tetto dei diecimila record resta e **non è la stessa cosa**: è una rete
strutturale, cioè una scadenza che dipende da quanto si scrive e non da cosa si
vuole tenere. Chi apre il vault due volte l'anno si ritrova dieci anni di path;
chi ci lavora ogni giorno, due mesi. I due criteri non fanno due potature — si
prende il taglio **più avanti dei due** e da lì si scorre una volta sola fino al
confine di lotto, perché un secondo passaggio taglierebbe a metà del lotto che
il primo aveva appena rispettato.

Una riga che non si sa **leggere** ma si sa **datare** — scritta da una Fub più
nuova sullo stesso vault — si data e si valuta come le altre: la potatura legge
il solo campo `at`, con un tipo suo, invece di pretendere di capire
l'operazione. E una riga che non porta nemmeno `at` **ferma** la scansione
invece di cadere: il conto delle scadute è un prefisso, e ciò che non si data
non è vecchio, è ignoto. Potare non deve perdere ciò che non capisce.

**Il gesto.** `vault.clear-journal`, che lo svuota adesso. Perché la
[0086](0086-una-cronologia-e-la-sua-porta.md) ha già la regola per un dato di
questa specie, e il journal era **l'unico dato dell'utente dentro il vault che
nessun gesto dell'utente raggiungeva**: non un comando, non una riga di
pannello, non una menzione. Un dato che l'utente non sa di avere non è un dato
che può decidere di tenere.

Svuotare cancella **tutto**, comprese le righe di una Fub più nuova che la
potatura si guarda bene dal toccare, e la differenza è chi ha chiesto: potare è
manutenzione e non deve perdere ciò che non capisce, svuotare è un gesto
esplicito e irreversibile che vuole esattamente quello.

Sta in `maintenance.rs` — la regola di quel modulo, *la dichiarazione sta nel
registro, l'esecuzione sta dove sta il potere* — e non fra i comandi di
`fub-features`, per la ragione che quel modulo dà già: il registro non è
sull'`HostApi` e non deve diventarci. Un potere che serve a un gesto dell'utente
non si concede a **ogni** plugin montato per poterglielo servire. Il modulo
guadagna però una riga che prima non gli serviva: i suoi primi tre si
dichiaravano reversibili «perché non si è perso niente», e questo **perde
apposta**. È l'unico dei quattro con `irreversible()`, che non è una formalità —
è la riga che la palette legge per scrivere «non reversibile» accanto al nome.

Ed è l'unico dei quattro il cui **piano** ha un sommario: in prova dice quante
righe cadrebbero. Gli altri tre non hanno niente da mostrare perché non perdono
niente; chi approva questo deve vedere il conto di ciò che sta per sparire. È il
campo `CommandPlan::summary` usato per ciò per cui esiste.

## Dove sta la regola, e perché lì

La finestra vale **da quando è dichiarata**, e da lì a ogni cambiamento. Sono
due momenti e una funzione sola, `Workspace::pota_il_registro`:

- alla **dichiarazione dello schema**, in `register_plugin`. Prima di quella
  riga la chiave non si può nemmeno leggere — leggerne una non dichiarata dà un
  errore, non un default — quindi il journal si era aperto col solo tetto;
- in **`announce_setting`**, quando l'utente la cambia. È lo stesso punto in cui
  la [0098](0098-un-permesso-si-vede-e-si-nega.md) ha messo il ricalcolo del
  recinto, e per la stessa ragione: chi stringe la conservazione a trenta giorni
  lo fa per far cadere ciò che c'è **adesso**, non ciò che ci sarà.

Una chiave che manca vale zero, cioè *per sempre*: un'impostazione assente fa
cadere nel default e non in un guasto, e per un registro autorevole il default
che non perde niente è l'unico difendibile.

La chiave è dichiarata **nel kernel**, accanto a chi la legge, come quelle del
locale — è il criterio del §11.1, *una chiave sta dove sta chi la legge* — e
montata da `fub-host` con le altre del core. Non è `program_writable`, per la
ragione di `history.enabled` letta al contrario: un componente che potesse
**allungare** la finestra allungherebbe la conservazione dei path dell'utente da
dietro un interruttore che l'utente crede suo. E non è `per_machine`: il
registro vive dentro il vault e viaggia con lui, quindi «per quanto lo tengo» è
una proprietà dell'archivio ([0076](0076-le-impostazioni-vivono-nel-vault.md)).

## Il difetto peggiore stava fuori dalla voce, per la quarta volta di fila

Dopo la [0099](0099-una-rinomina-che-non-ha-visto-nessuno.md), la
[0101](0101-una-voce-non-e-un-passo.md) e la
[0102](0102-i-byte-non-stanno-nel-record.md), ancora.

`crates/fub-kernel/tests/il_journal.rs` aveva un test di nome
`il_registro_non_porta_dentro_il_documento`, e il suo doc-comment dichiarava:
*«Il registro non contiene il testo dei documenti»*. Affermazione universale,
esattamente la proprietà che questa voce contesta. Il corpo esercitava **due
`write_document`** e nient'altro — cioè le sole varianti `Created` e `Written`,
che per costruzione portano impronte — e poi verificava che il file grezzo non
contenesse la frase segreta.

Non chiamava mai `apply_edit`. Non produceva mai un `Edited`. Presidiava, con un
nome che prometteva tutto, l'unico caso in cui non c'era niente da presidiare.

E la parte che vale la pena guardare due volte: **cinquanta righe più su, nello
stesso file**, un altro test riprendeva l'`inverse` dalla riga del registro e lo
riapplicava per dimostrare che il documento tornava com'era — cioè *dimostrava*
che il registro conteneva abbastanza dei byte dell'utente da ricostruirli. I due
test stavano nello stesso file, sotto lo stesso `//!`, e non si guardavano.

Il presidio riparato esercita **tutte e sei** le varianti e lo verifica con un
`match` esaustivo e senza `_`, così una settima non si può aggiungere senza
passare di lì a dichiarare cosa porta — la forma che il pannello delle
impostazioni usa già sullo `switch` delle specie di chiave. Senza quella riga il
banco tornerebbe a presidiare «le varianti che mi è capitato di produrre», che è
il difetto che aveva.

La lezione riusabile è più stretta di «i test vanno visti rossi», ed è questa:
**un presidio che afferma un universale va letto contro l'enumerazione di ciò su
cui è universale.** Sei varianti, due esercitate. Il conto non tornava, e a
nessuno era venuto in mente di farlo perché il nome del test lo aveva già fatto.

## Il prezzo, dichiarato

- **Dal registro non si ricostruisce più il testo di una modifica chirurgica.**
  Un rollback di lotto costruito su questo file potrà rimettere i nomi al loro
  posto, ripristinare dal cestino e ricestinare, e **non** disfare gli edit. Era
  già così per i salvataggi; adesso è così in modo uniforme, ed è scritto in
  `is_invertible` invece che scoperto applicando.
- **La potatura per età legge ogni riga fino alla prima dentro la finestra**,
  all'apertura e a ogni cambio della chiave. Con la finestra a zero — il default
  — non si legge niente, quindi chi non la usa non la paga.
- **La finestra vale da quando è dichiarata**, non da quando il journal si apre.
  Un vault aperto da un host che non monta il core (un e2e headless) non pota
  per età: nessuno ha dichiarato una finestra, e potare per una regola che
  nessuno ha scritto sarebbe peggio.
- **`vault.clear-journal` non chiede conferma con una finestra sua.** L'attrito
  è quello del repo: il nome da digitare in palette e il «non reversibile» che
  la palette ci scrive accanto, più il conto nel piano di una prova. Costruire
  una view di conferma per un file che non ha una view sarebbe stato gonfiare
  (una view del registro è un'altra voce, non questa).

## Cosa NON è cambiato, e perché

- **Il journal non si spegne**, e la 0067 regge per intero. Le sue tre gambe
  sono state ricontrollate una per una e stanno ancora in piedi. Spegnere la
  scrittura avrebbe bucato due caselle di `FEATURES.md` che chiedono il registro
  **acceso** (24.2, «Journaling») e **loggato** (23.3, «Audit logs»), per
  proteggere un dato che con questo verbale non c'è più. La domanda che la voce
  trattava come una era davvero due, e la risposta è diversa per ciascuna: *cosa
  conserva* si è riparato per tutti, *per quanto* si dichiara, *se registra* non
  si tocca.
- **I path e i tempi restano in chiaro.** È ciò per cui il registro esiste, ed è
  scritto nella descrizione della chiave — che nomina il file. Fino a oggi
  nessuna riga del prodotto diceva che questo registro esiste.
- **Il contratto WIT non cambia.** Il journal è interno al kernel: non compare
  in `abi.wit` se non in due commenti di prosa, non passa dall'`HostApi` e non
  passa dall'IPC. Nessun ritaglio, nessuna riga in
  [wit-congelato.md](../architecture/wit-congelato.md).

## Il formato sul disco

`JournalOp::Edited` cambia forma, e le righe scritte prima di oggi non si
rileggono più come `Edited`. Non serve una migrazione e non se ne fa una: la
versione di schema sta **su ogni riga** (0067), e una riga che non si parsa si
scarta e **si conta** — `Lettura::scartate` la porta fuori, e `vault.repair` la
racconta. È esattamente la regola che quel campo esiste per servire, usata per
la prima volta da un cambiamento nostro invece che da un file rotto.

Alzare `SCHEMA_VERSION` avrebbe fatto scartare **tutte** le righe vecchie,
comprese le cinque varianti che non cambiano. Lasciandola ferma si perdono le
sole `Edited` di prima, che sono anche le sole a portare ciò che questo verbale
voleva togliere.
