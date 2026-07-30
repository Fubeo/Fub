# 0061 — Un giro che non prende i byte dal modello, e uno che ci passa

|  |  |
|---|---|
| **Decisa** | 2026-07-30 |
| **Origine** | `todo.md` §17.1 ([seduta 17](../roadmap/17-presidi-che-restano.md)) — **una casella su cinque**: il round-trip import/export rifatto sul corpus. Restano le due del banco delle prestazioni, e con loro la voce |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/17-presidi-che-restano.md) · [import/export come trait, 0006](0006-import-export-come-trait.md) · [il corpus, 0060](0060-il-modello-dice-il-vero-sui-byte.md) · [la generazione non è un round-trip, 0059](0059-la-generazione-non-e-un-round-trip.md)

---

La [0060](0060-il-modello-dice-il-vero-sui-byte.md) ha chiuso due delle cinque
caselle del §17.1, ha detto di due che aspettano una macchina, e della quinta — il
round-trip import/export rifatto sul corpus — ha scritto la frase che ha prodotto
questo verbale: *«non aspetta nessuna delle due cose. La sua precondizione era il
corpus, e adesso c'è: è lavoro»*. Aspettava il corpus, e il corpus l'aveva appena
fatto lei.

Questo verbale è quella casella. E la riga portava un timore scritto, che è la prima
cosa che si è trovata facendola: *«le tredici divergenze dichiarate sono l'elenco di
ciò che un round-trip non può pretendere finché non sono riparate»*. **Era mal
riposto**, e per vederlo bastava chiedersi da dove vengono i byte.

## Il timore era mal riposto, e la ragione è da dove vengono i byte

Una divergenza dichiarata dalla 0060 è un disaccordo **fra il modello e il file**:
il barrato che il modello non ha, il termine di una definition list il cui span è
un byte, il tag che il parser inventa per `[[#Sezione]]`. Il round-trip dell'export
markdown, nella sua forma normale, i byte che posa non li prende dal modello: legge
la sorgente con `ReadApi::read_document` — il canale del **vault**, non quello dei
dati, che è `IndexQuery` e qui non c'entra — e la copia in un artefatto, dove
l'import la ritrova e la riscrive com'era. Fra i due versi non c'è nessun `serialize` — che sarebbe generazione, non
round-trip ([0059](0059-la-generazione-non-e-un-round-trip.md)) — e non c'è nessuno
span.

Quindi le divergenze non solo si possono pretendere: **le loro sorgenti stanno nel
vault del round-trip apposta**, accanto ai sessantadue casi curati, e sono le note
su cui la pretesa dice di più. Se un giorno il trasferimento cominciasse a farsi
dettare i byte dal modello — un import che «pulisce», un export che riscrive — quelle
tredici note sono le prime che diventerebbero rosse.

Va detta anche la mezza precisione, perché la frase corta è comoda e falsa: l'import
**il modello lo costruisce**. Parsa la sorgente per raccontare nel rapporto quanti
link, tag e heading stanno entrando (`transfer.rs`), e in linea di principio per
rifiutare ciò che non parsa. Ciò che non prende dal modello sono **i byte che
scrive**, e la differenza è tutta lì. Nota, trovata guardando: quel rifiuto è
irraggiungibile, perché `parse_markdown` non costruisce nessun `Err` — il `map_err`
che lo tradurrebbe è codice morto, e ciò che ferma una sorgente non testuale è
`ImportSource::text`, un passo prima. Resta dichiarato qui: non è di questa casella.

Il verso che dal modello ci passa è uno, ed è `frontmatter: false`.
`strip_frontmatter` taglia il file su `first.span().start`, cioè **affetta i byte con
un numero che viene dal modello**. Là l'identità non si può pretendere — è il punto
dell'opzione — e la domanda «cosa si pretende, allora» è tutta la sostanza di questa
casella.

## Una casella dichiarata lavoro, e perché ha aperto un verbale

Va detto subito, perché è un debito col criterio scritto. `decisions/README.md`
distingue una **mezza voce** da una **casella residua** così: *una casella residua è
ciò che si può fare senza aprire un verbale*. La 0060 ha chiamato questa riga
«lavoro», che per quel criterio vuol dire esattamente casella residua. E poi il
verbale c'è.

Il criterio non si emenda: **la previsione era sbagliata**, ed è la cosa
interessante. La casella sembrava lavoro perché il round-trip *sembrava* uno: apri il
vault, esporta, reimporta, confronta. Facendola si è visto che i versi sono due e che
non pretendono la stessa cosa — uno non prende i byte dal modello, l'altro sì — e
quella è una decisione intera, non una quota di lavoro: senza deciderla, la seconda
metà del presidio si sarebbe scritta pretendendo l'identità dove l'identità è esclusa
per definizione, e sarebbe finita disattivata.

Classificare un residuo, insomma, è **prevedere**: si fa guardando la riga, e la riga
può mentire. La conseguenza è mite, ed è la ragione per cui il criterio resta com'è:
sbagliare quella previsione costa un verbale in più, cioè costa che una decisione
venga scritta invece che no.

## Fatto

- [x] **Il corpus scende in un modulo condiviso**,
      [`tests/corpus/mod.rs`](../../crates/fub-format-markdown/tests/corpus/mod.rs):
      i sessantadue casi curati, le tredici sorgenti divergenti e il mutatore. Un
      modulo sotto `tests/` non è un bersaglio di cargo, viene compilato *dentro*
      ciascun binario che lo dichiara, e la conseguenza è quella che conta: le due
      suite vedono per costruzione lo **stesso** elenco.
- [x] **Il round-trip sul corpus, nel verso che copia i byte**
      ([`transfer_e2e.rs`](../../crates/fub-format-markdown/tests/transfer_e2e.rs)):
      settantacinque note posate sul disco, un export di tutto il vault, un import in
      un vault vuoto, e i sorgenti confrontati byte per byte. Più la riga che lo
      tiene onesto — i byte del caso sono i byte che il vault restituisce — senza la
      quale una normalizzazione fatta in tutt'e due i versi passerebbe.
- [x] **Il verso che passa dal modello**, con la pretesa giusta: non l'identità ma
      che **la struttura non cambi**. Confrontata due volte, una leggibile e una
      severa: una proiezione senza offset, e il **modello intero con gli span
      rimessi al loro posto** — che è l'unica cosa che vede un taglio spostato di un
      byte.
- [x] **Il corpus attraversa quel verso per davvero**: le stesse sorgenti entrano nel
      vault una seconda volta con un **frontmatter davanti**, perché di
      settantacinque solo quattro ne avevano uno e sulle altre settantuno il taglio
      non avveniva affatto. Senza quel cappello questo presidio sarebbe stato verde
      confrontando ogni documento con sé stesso.
- [x] **Due fuzzer nuovi**, la stessa porta della 0060 con un bersaglio diverso:
      ventimila mutazioni che diventano note di un vault e un export senza metadati
      che non deve panicare, duemila nomi di sorgente mutati che non devono uscire
      dal recinto — e per i nomi anche una camminata del disco, perché l'indice non
      sa dire dove un file *non* è finito.
- [x] **Un difetto di produzione trovato e riparato**: il taglio si mangiava
      l'indentazione di un code block indentato. Sotto.
- [x] **`conformita::bersagli` ha il cliente che il suo doc chiedeva**, e quindi
      resta. La 0060 l'aveva dichiarata **senza cliente** nel suo stesso doc, con la
      condizione: *il primo corpus che verifica cosa un documento nomina le dà una
      ragione di esistere, o va tolta*. Non era la sola del banco in quello stato —
      `cio_che_non_e_perduto_si_ritrova` è ancora là, dichiarata così dalla
      [0054](0054-il-banco-del-lato-provider.md) — ma era la sola con una condizione
      scritta, e la condizione è soddisfatta.
- [x] **Il legame fra le due metà delle divergenze è una chiave, e si confronta nei
      due versi**: i predicati stanno in `il_corpus.rs`, le sorgenti nel modulo, e il
      nome le tiene insieme. Un nome senza predicato o un predicato senza nome è
      rosso; e ogni predicato deve essere **falso** su cinque documenti di controllo,
      perché separando le due metà si è aperto il modo di fallire descritto sotto.

## La riparazione: il taglio si mangiava l'indentazione

Lo span di un **code block indentato** comincia dopo i quattro spazi — lo span dice
dov'è il contenuto, e l'indentazione è sintassi. Tagliando il frontmatter su
`first.span().start`, l'export produceva un documento in cui quel blocco non era più
un code block: *«togli i metadati»* aveva cambiato il significato dei byte che
teneva, che è più di quanto quell'opzione autorizzi.

Il taglio adesso si estende indietro fino all'inizio della riga, **ma solo
attraverso spazi e tabulazioni**. Fermarsi al primo carattere che non è indentazione
è ciò che tiene il gesto una patch guidata dagli span e non una seconda lettura del
file — che è il confine della [0008](0008-modifica-chirurgica.md), e la ragione per
cui `strip_frontmatter` non conta i `---` da sé.

Il difetto era vecchio come l'opzione, cioè come la
[0006](0006-import-export-come-trait.md). Nessuna prova lo vedeva perché il suo test
a esempio — `metadata_can_be_left_behind` — usa un documento normale, e in un
documento normale il primo blocco comincia a inizio riga: **il caso serve un corpus
per esistere**, ed è precisamente l'argomento del §17.1.

## Le tre sorgenti che il cappello non può prendere

Tre casi non passano la pretesa sulla struttura, e non perché il taglio sposti dei
byte: perché **il significato di certi byte dipende da dove cominciavano**. Tolto il
frontmatter, quei byte tornano in testa al documento, e in testa vogliono dire
un'altra cosa.

| caso | cosa succede |
|---|---|
| `bom` | col cappello davanti il BOM è in mezzo al documento, quindi è testo, e l'heading che lo segue non è un heading. Tagliato il frontmatter il BOM è in testa, smette di essere contenuto, e l'heading torna un heading |
| `solo un bom` | la stessa cosa sul documento che *è* un BOM: col cappello ha un paragrafo, tagliato non ha niente |
| `un frontmatter che non si parsa non lascia traccia` | col cappello davanti diventa un doppio frontmatter, che è la maglia già dichiarata: il primo giro ne toglie uno e scopre l'altro |

Stanno in un elenco chiuso, `FUORI_DAL_CAPPELLO`, una riga per caso **con la
ragione** — la forma degli scusati della 0060 — e una prova pretende che ciascuna
divergenza si presenti ancora. Una scusa che non serve più è la cosa peggiore di un
elenco a mano: sta lì a dire che qualcosa non si può fare, e nessuno la ricontrolla.

## Le decisioni

*Le due porte del trasferimento non pretendono la stessa cosa.* È lo stesso gesto
della 0060, che sul corpus curato chiede tutto e sulle mutazioni solo ciò la cui
violazione fa panicare — e per la stessa ragione, che non è pigrizia ma verità: una
pretesa sbagliata non è un presidio più severo, è un presidio rosso che qualcuno
disattiva. Qui le porte sono il verso che copia i byte e il verso che taglia sullo
span. Al primo si chiede l'**identità**: settantacinque sorgenti escono e rientrano
uguali, e fra loro ci sono il BOM, il CRLF, il `\r` nudo su più blocchi, il file
vuoto, quello senza a capo finale, l'NFD e i quattro byte fuori dal BMP. Al secondo
si chiede che **la struttura non cambi**, perché l'identità là è esclusa per
definizione.

*Un presidio che confronta due proiezioni deve dire quante volte ha confrontato
qualcosa.* È la lezione più utile di questo giro, e ha cambiato il codice tre volte.
Il taglio avviene solo se il documento ha un frontmatter: senza il cappello, su
settantacinque note se ne contavano quattro, e le altre settantuno erano `x == x`.
Nel fuzzer era peggio — il 2,8% delle mutazioni conservava un frontmatter, quindi il
97% delle corse non arrivava al codice sotto prova. Adesso le due prove **contano**:
il numero dei tagli avvenuti deve coincidere con quello delle note che hanno un
frontmatter, e il fuzzer pretende che almeno un quinto delle mutazioni ci arrivi.

*Gli span si possono confrontare, e prima si era detto il contrario.* La prima
versione escludeva gli offset scrivendo che «direbbero soltanto che un taglio è
avvenuto». Non era vero: l'invariante della coda ha già stabilito **quanti** byte
sono usciti, quindi lo scostamento è noto ed è `source.len() - fuori.len()`. Rimessi
indietro di quel tanto, i due modelli devono essere identici — frontmatter a parte —
e questo è il confronto che vede un taglio spostato di un byte, che nessuna
proiezione vede.

*La proiezione leggibile resta, e non è ridondanza.* Un `DocumentModel` a schermo non
si legge; una lista di righe sì. La severa dice *che* qualcosa è cambiato, la
leggibile dice *cosa*: quando il taglio a `+ 1` l'ha resa rossa, la riga che sparisce
era `heading 1 "corpo" "Corpo"` — il titolo era diventato un paragrafo, e si è capito
in un secondo.

*I tag stanno nella proiezione, e la prima versione li escludeva per una ragione
falsa.* Diceva che un `tag: [a, b]` nel frontmatter *è* un tag del documento e quindi
sparisce legittimamente. Non lo è: `parse_markdown` popola `model.tags` solo dai
`#tag` scritti nel corpo, e il frontmatter non ci entra mai. Togliendo il frontmatter
i tag non cambiano, quindi escluderli era buttare via del segnale credendo di
dichiarare una scelta — ed è il genere di errore che solo una misura corregge.

*Il corpus è un ingresso, non una garanzia, e sta dove i suoi clienti lo leggono.* La
0059 ha dato il criterio per i presidi — il soggetto della garanzia decide dove sta —
e per il corpus quel criterio non risponde, perché un elenco di byte non garantisce
niente. Risponde l'altra domanda: chi lo legge. Da oggi sono due suite, e un modulo
condiviso è l'unica forma in cui non possono divergere. Non l'SDK, dove sarebbero
finite delle sorgenti markdown in un crate che di markdown non sa niente; non un
terzo binario di test. Le ragioni di entrambi gli scarti sono in fondo.

*Il modulo condiviso non porta un `allow(dead_code)`, e la tentazione c'era.* Un
modulo compilato dentro due binari ha, in ciascuno, dell'inutilizzato: zittire il
lint sembra il prezzo del condividere. È il contrario — `cargo clippy --all-targets
-D warnings` è il solo posto che si accorgerebbe di un caso del corpus che nessuno
semina più, o del mutatore che un binario ha smesso di chiamare. Verificato con
`--force-warn dead_code` che oggi tutto è usato da tutt'e due, l'`allow` è stato
tolto: il giorno che qualcosa muore, il rosso è l'informazione.

*Le note del vault si posano sul disco, non entrano dall'import.* Se entrassero
dall'import, il presidio confronterebbe l'import con sé stesso e una normalizzazione
applicata nei due versi sarebbe invisibile. Il vault di partenza si scrive con
`std::fs`, e l'import compare **una volta sola**, nel verso di ritorno, dove è la
cosa sotto prova.

*Il nome è la chiave fra i predicati e le sorgenti, quindi va difeso come una
chiave.* Separando `divergenze_dichiarate` in due metà si è aperto un modo di fallire
che prima non c'era: finché nome, sorgente e predicato stavano nella stessa tupla, un
predicato non poteva finire accoppiato a una sorgente diversa dalla sua. Il confronto
nei due versi e il rifiuto degli omonimi non bastano — un predicato *negativo* resta
verde su qualunque cosa. Quindi il predicato riceve anche **la sorgente**, così che la
divergenza si scriva per quello che è («il file dice X e il modello dice Y»), e una
prova pretende che ogni predicato sia **falso** su cinque documenti di controllo. Tre
righe su tredici non lo erano, e sono state strette: `!d.text.contains("didascalia")`
è vero su un documento vuoto.

*Il fuzzer dell'export non è la simmetria di quello del parser: ha un bersaglio.*
`strip_frontmatter` affetta la sorgente con un numero che viene dal modello, e uno
span fuori range o in mezzo a un carattere non è un modello sbagliato — è un panico
dentro l'export, cioè un vault che non esce. La proprietà che lo impedisce esiste
dalla 0060 (`conformita::gli_span_affettano_la_sorgente`) e fino a oggi proteggeva
una cosa di cui nessuno poteva dire «protegge questa».

*Lo stesso conteggio del fuzzer del parser, che è un budget e non una simmetria.*
Ventimila mutazioni dell'export costano 3,3 s e ventimila del parser 2,6: 0,17 ms
per caso contro 0,13. La differenza non è la scrittura del file né l'indice — è che
metà dei semi sono più lunghi, avendo un cappello davanti. Il fuzzer dei nomi ne fa
duemila, un decimo, e stavolta il tempo c'entra: è il solo dei tre giri
**quadratico**, perché `MarkdownImport::import` rilegge l'elenco dei documenti una
volta per sorgente. Misurato: 2 000 → 0,24 s, 4 000 → 0,54, 8 000 → 1,38, 16 000 →
4,26 — raddoppiare i casi costa più del doppio. E duemila bastano, perché il recinto
lo decide il primo nome che prova a uscire.

## La prova che diventa rossa quando deve

Il rito è quello della 0060: ogni riga di questa tabella è stata vista rossa
guastando di proposito il codice che presidia, e la terza colonna porta l'osso del
messaggio.

| asserzione | come | cosa ha detto |
|---|---|---|
| i byte non si toccano | `MarkdownExport::export` normalizza `\r\n` in `\n` | `` `corpus/crlf.md` è uscita diversa da com'era nel vault `` |
| la struttura non cambia | il taglio a `first.span().start + 1` | `` `cappello/ancora che non è un'ancora.md`: togliendo il frontmatter è cambiato anche il corpo ``, e la differenza è `testo "^10 = 1024"` contro `testo "2^10 = 1024"` — un byte mangiato |
| il taglio prende un prefisso e nient'altro | lo span del `TaskMarker` non rimesso a posto, che è un difetto vero di questo giro | `` `cappello/cr solo su più blocchi.md`: il modello del documento tagliato, con gli span rimessi indietro di 14 byte, non è quello di prima `` |
| il taglio avviene davvero | `strip_frontmatter` restituisce sempre il sorgente | `il taglio è avvenuto su 0 note e 72 hanno un frontmatter: sono lo stesso insieme o non lo sono` |
| la proiezione non è vuota | `struttura` torna `Vec::new()` | ``in 72 note tagliate la proiezione non ha prodotto una sola riga `blocco …`: sta confrontando meno di quel che dice`` |
| l'export non pania | il taglio a `first.span().start + 3` | `start byte index 17 is not a char boundary; it is inside '\u{feff}'`, al caso 168 di 20 000, mutazione «con un byte ostile in mezzo» |
| il seme riproduce | lo stesso taglio, col comando che il messaggio stampa | rosso allo stesso caso 168, allo stesso conteggio |
| un fuzzer con zero casi non è un fuzzer | `FUB_FUZZ_TRASFERIMENTO=0`, `FUB_FUZZ_NOMI=0` | `0 mutazioni non sono un fuzzer: con zero il ciclo non gira nemmeno` |
| un seme illeggibile non cade sul default | `FUB_FUZZ_SEME=0x4675_6D4D_4420_3031`, cioè la forma in cui il default è scritto nel codice | `` FUB_FUZZ_SEME="0x4675_6D4D_4420_3031" non è un numero decimale `` |
| un nome non esce dal recinto | `MarkdownImport` smette di chiamare `ImportSource::stem` | `` caso 62 — mutazione «duplicato» — il nome "<div>blocco</div>\n<div>blocco</div>\n" è diventato `in/<div>blocco</div>…`: ha guadagnato dei componenti di path `` |
| il disco si guarda davvero | la camminata non scende nelle cartelle | `sotto la radice ci sono 0 file e ne sono nati 980: la camminata del disco non sta guardando dove si scrive` |
| il corpus non ha omonimi | un secondo `caso("enfasi", …)` | `` due casi si chiamano `corpus/enfasi.md` `` |
| le due metà si tengono | tolta da `divergenti()` la sorgente del barrato, lasciato il predicato | `` queste divergenze hanno un predicato e nessuna sorgente in `corpus::divergenti()`: ["il barrato non arriva nel modello"] `` |
| un predicato non descrive il vuoto | riportato «l'alt di un'immagine» alla sua forma di prima, `!d.text.contains("didascalia")` | `il predicato … è vero anche su un documento di controllo: ""` |

Tre cose vanno dette di questa tabella, perché sono ciò che ha cambiato il codice.

**La prima versione della prova era troppo debole, e si è visto guastandola, non
ragionandoci.** Il taglio a `+ 1` lasciava verde il punto fisso: l'invariante che
c'era — *ciò che esce senza metadati è una coda del sorgente* — non distingue una coda
giusta da una coda spostata di un byte, e il giro seguente non se ne accorge perché
il documento reimportato non ha più frontmatter da togliere. La proprietà sulla
struttura, il confronto degli span rimessi a posto e il cappello sono nati da quel
verde. L'invariante della coda è rimasto dov'era, perché dice una cosa vera e più
generale — l'export **non può inventare byte** — e perché vale su qualunque ingresso,
comprese le ventimila mutazioni, dove la struttura non si può pretendere.

**Due delle prove nuove hanno trovato difetti nelle prove stesse, non nel codice.**
La proiezione «senza offset» portava dentro il `TaskMarker` intero, che ha uno span:
bastava che un taglio fosse avvenuto perché divergesse, e sette casi risultavano
rotti senza esserlo. E il confronto degli span non spostava quello del `TaskMarker`,
per lo stesso motivo. Sono errori miei, non del provider, e stanno qui perché la
prima diagnosi era «il corpus ha trovato nove difetti»: erano due difetti del
presidio e tre fenomeni dichiarati, più uno vero.

**Guastare una prova appena scritta non serve a confermare che funziona** — serve a
scoprire *cosa* prova, che è spesso meno di quel che si credeva scrivendola. Tre
delle guardie di questa tabella (il taglio avviene, la proiezione non è vuota, zero
casi) esistono solo perché il guasto è stato provato prima di dichiarare la casella
chiusa.

Un dettaglio della prima riga, perché dice qualcosa sulla forma del presidio: quel
sabotaggio rende rossi **tre** test e non uno — l'identità byte per byte, il punto
fisso e il fuzzer dell'export. La colonna ne nomina il primo, che è quello il cui
messaggio dice la cosa giusta; gli altri due lo dicono di riflesso, ed è così che
deve essere: una normalizzazione nell'export non è un difetto del punto fisso.

Da segnalare, perché è una buona notizia sul lavoro di prima: il taglio a `+ 1` ha
fatto diventare rosso anche `metadata_can_be_left_behind`, il presidio a esempio che
la 0006 aveva lasciato. Le due reti si sovrappongono su un caso e divergono su tutti
gli altri, che è il modo in cui un corpus e un esempio convivono.

## Le maglie che lasciano passare

- **Il taglio non promette niente sui byte il cui significato dipende da dove
  cominciano**, e le tre righe di `FUORI_DAL_CAPPELLO` sono l'elenco chiuso di quelli
  che si conoscono. Il BOM è il caso di scuola; se ce ne sono altri, li trova chi
  aggiunge il caso, ed è il modo in cui questa maglia si stringe.
- **Il punto fisso non è una proprietà dell'export, ed è scritto come prova.** Due
  frontmatter in fila e il primo giro toglie il primo *scoprendo* il secondo, che al
  giro dopo è frontmatter a tutti gli effetti, perché il frontmatter si riconosce
  dall'inizio del documento e l'inizio è cambiato. Il controesempio sta nella forma
  delle divergenze dichiarate: se qualcuno ripara l'export — un taglio che taglia
  finché c'è da tagliare — quella prova diventa rossa e va tolta.
- **Il fuzzer dell'export non pretende la struttura**, solo che non pania e che
  l'uscita sia una coda. Non è prudenza: la mutazione del controesempio di qui sopra
  è plausibilissima, quindi pretendere la struttura su ingresso generato vorrebbe
  dire un fuzzer rosso su un difetto già dichiarato.
- **La proiezione leggibile non vede tutto** — non l'ordine dei bersagli di un link,
  che `conformita::bersagli` restituisce come insieme, e non gli offset. Chi li vede
  è il confronto del modello intero, che le sta accanto proprio per questo; sulle
  ventimila mutazioni però non gira nessuno dei due.
- **Il round-trip dei nomi non passa da un filesystem che normalizza.** Su APFS un
  nome NFD torna NFC, e il giro export→import dei *nomi* non è provato là: i nomi del
  corpus sono ASCII, quindi su questa macchina la maglia non si vede nemmeno. Il
  contenuto NFD invece c'è, ed è provato.
- **Il fuzzer dei nomi non distingue un rifiuto atteso da un guasto.** Un nome che
  non è markdown è un `BadArgs`, e un nome che il filesystem rifiuta è un
  `ImportOutcome::Failed`: la prova li scarta entrambi, e pretende soltanto che
  almeno un quarto dei casi diventi un documento. Che un `Failed` non lasci niente
  dietro non è verificato.
- **Settantacinque sorgenti non sono un vault.** Un vault vero ha allegati, `.fub/`,
  un cestino, cartelle con nomi propri. Il round-trip di un vault con degli allegati
  non c'è — non ce l'ha nemmeno la 0006 — e non lo copre questa casella.
- **Da questa porta passa solo UTF-8 valido**, che è il limite ereditato dalla 0060:
  il provider rifiuta i byte per contratto, e la proprietà che lo dice è
  `un_provider_testuale_rifiuta_i_byte`.
- **Aggiungere un caso al corpus rimescola la sequenza di tutti e tre i fuzzer.** «La
  stessa corsa a ogni push» vale fra due modifiche del corpus, non oltre — e un seme
  stampato in un messaggio di fallimento riproduce quel fallimento solo sul corpus di
  allora.

## Cosa si è scartato

**Un terzo binario di test** per il round-trip sul corpus. Il soggetto di queste
prove è il **trasferimento**, e il posto del presidio lo decide il soggetto: stanno
in `transfer_e2e.rs`, accanto al round-trip a esempio che la 0006 aveva lasciato. Un
file a sé avrebbe messo il corpus in mezzo a due clienti invece che sotto, e
raddoppiato i posti in cui si spiega cos'è.

**Il corpus nell'SDK.** Le proprietà sì — sono di un `FormatProvider` qualunque — ma
sessantadue sorgenti markdown in un crate che di markdown non sa niente no. È
l'applicazione del criterio della 0059 al caso in cui la risposta è «resta dov'è».

**Far entrare le note del vault di partenza dall'import.** Sarebbe stato meno codice e
avrebbe reso il presidio cieco alla classe di difetti più insidiosa: quella
simmetrica.

**Il round-trip di `TARGET_SINGLE`.** Una concatenazione di settantacinque note in un
documento non si reimporta in settantacinque note: pretenderlo avrebbe voluto dire
scrivere uno *splitter* di prova, cioè un secondo parser dei separatori. Quella
destinazione ha già la prova che le tocca — un artefatto solo, i documenti separati —
e non è un round-trip. Che il suo ramo tocchi i byte più dell'altro (`trim_end`, un
`# Titolo` in testa, un separatore fra i documenti) resta dichiarato senza corpus.

**Riparare le divergenze dichiarate.** Sono ancora tredici, tutte, e almeno tre
chiedono una decisione sul modello che questo verbale non ha titolo di prendere. Il
round-trip non le pretende risolte, che è appunto ciò che si è imparato.

**Un secondo cappello sui casi che ne hanno già uno.** Avrebbe costruito il doppio
frontmatter, cioè avrebbe preteso il punto fisso proprio dove è noto che non tiene.

## Cosa resta fuori, dichiarato

- **Le due caselle del banco delle prestazioni** — le soglie su vault sintetici
  10k/100k **e** il presidio `#[ignore]` della §8.4, che sono due cose e non una —
  tengono aperta la voce. Aspettano una macchina che non divida i core, e la 0060 ha
  già scritto perché: a quella scala il tempo se lo prendono lo spawn dei thread e lo
  scheduling, quindi il presidio smette di misurare la propria proprietà e comincia a
  misurare il vicino di banco. Non è una cosa che si compri scrivendo codice, ed è la
  ragione per cui non è una casella residua.
- **Gli allegati, e un vault vero.** Vale per il round-trip come per l'import: il
  confine della 0006 è di byte, e un allegato è byte che nessuno dei due provider
  markdown guarda.
- **Il round-trip attraverso un filesystem che normalizza i nomi.** Si vedrà con una
  macchina Apple in CI, che è la stessa macchina che serve al banco.
- **Le tredici divergenze**, e il lavoro con un verbale suo che le riparerà.
- **Il ramo morto di `strip_frontmatter`** — il `map_err` su un `parse_markdown` che
  non torna mai `Err` — e la domanda che porta con sé: se un parser non può fallire,
  la sua firma non dovrebbe dirlo. È del contratto, non di questa casella.
- **L'esplorazione guidata dalla copertura.** Come nella 0060: questi due fuzzer sono
  reti di regressione deterministiche, seme fisso e conteggio fisso. Cercare davvero
  è alzare `FUB_FUZZ_TRASFERIMENTO` e `FUB_FUZZ_NOMI` a mano — i comandi stanno in
  [CONTRIBUTING.md](../CONTRIBUTING.md) accanto a quello della 0060 — o è il lavoro
  di libFuzzer, che sta con la macchina.
- **Le caselle di [FEATURES.md](../FEATURES.md) restano senza spunta**, come tutte le
  altre e per la ragione che la 0060 ha già scritto: quel file è il catalogo di cosa
  l'app farà, non un tracciato di avanzamento, e non ha una sola casella spuntata. Le
  tre che questo lavoro sfiora — «Round-trip verificato su vault reali»,
  «Import/export round-trip test», «Apri-e-salva non cambia il file (presidio su
  corpus)» — non si spunterebbero comunque: il vault del corpus non è un vault reale,
  e «apri-e-salva» è l'editor ([0008](0008-modifica-chirurgica.md)), non il
  trasferimento.

## Verifica

`cargo fmt --all --check`: pulito. `cargo clippy --workspace --all-targets -- -D
warnings`: pulito.

`cargo test --workspace`: **938 test verdi in 89 binari, 0 falliti, 3 ignorati.**
Erano 930; gli otto nuovi sono sette in `transfer_e2e`, che passa da 17 test a 24, e
uno in `il_corpus`, che passa da 8 a 9 — la prova che nessun predicato di divergenza
descrive il vuoto. Nessun binario nuovo: un modulo sotto `tests/` non è un bersaglio
di cargo, ed è metà della ragione per cui il corpus sta là.

Il confronto col numero della 0060 — «934 test verdi in 90 binari» — passa per un
commit che non è di questa seduta: `d2e397a` ha tolto `radice_unica.rs`, che portava
quattro test e un binario suo. 934 − 4 = 930, e 930 + 8 = 938.

Le righe: `il_corpus.rs` da 1069 a 942 — ha perso duecento righe di corpus e ne ha
guadagnate settanta fra il presidio dei controlli e la spiegazione di dove sono
andate le sorgenti; `transfer_e2e.rs` da 477 a 1416; `tests/corpus/mod.rs` è nuovo,
374 righe.

Il vault del punto fisso ha **143 note** — le settantacinque sorgenti più le
sessantotto che prendono il cappello — e il taglio avviene su **72**: le quattro che
hanno un frontmatter loro, più le sessantotto. Prima del cappello erano quattro su
settantacinque, ed è il numero che questo verbale ha imparato a stampare.

Il fuzzer dell'export fa **20 000 mutazioni in 3,3 s**, quello del parser ventimila
in 2,6, quello dei nomi **2 000 in 0,24 s**; il binario `transfer_e2e` passa da
0,00 s a 3,3. I tre conteggi si alzano da `FUB_FUZZ_TRASFERIMENTO`, `FUB_FUZZ_CASI` e
`FUB_FUZZ_NOMI`, il seme è quello condiviso `FUB_FUZZ_SEME`, e i comandi delle corse
lunghe stanno in [CONTRIBUTING.md](../CONTRIBUTING.md).

`node .github/scripts/check-doc-links.mjs`: **133 file, 2500 link, 0 rotti**.

E quel numero va raccontato, perché è il terzo modo in cui la riga della
[§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md) che lo tiene si è trovata falsa,
e stavolta non per colpa di chi la scriveva. **A HEAD dichiarava «132 file, 2475
link» e il controllo ne contava 2468**: il rename e la ripulitura che precedono
questo giro hanno tolto sette link senza passare da lì. Misurarlo invece di
ricopiarlo è l'unico modo di scoprirlo, e la prima stesura di questo verbale l'ha
ricopiato. La seconda cosa: il conteggio dei **file** dipende dall'albero di lavoro,
perché lo script cammina il disco e non `git ls-files` — un `.md` di appunti non
tracciato in radice fa 134 invece di 133. Il valore scritto è quello di un clone
pulito. Misurato, scritto, rimisurato al punto fisso, e la riga della §16.8 corretta
per l'**ottava** volta — che è il primo conteggio di quelle correzioni che si
ricostruisce dalla storia del file, invece di essere un ordinale ereditato.
