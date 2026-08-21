# 25. Sette scelte che il codice ha preso senza dirlo

Una **seduta** — un momento di lavoro isolato su un tema — della
[roadmap infrastrutturale](../todo.md): sette punti in cui il codice ha già
preso una posizione da solo. Nessuno l'ha scelta. Queste decisioni sono scelte
di prodotto e di contratto rimaste implicite dentro un'implementazione. Non sono
pezzi mancanti del piano di M4.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: dal giro — l'iterazione di sviluppo — del
2026-08-07.** La [24](24-tre-firme-che-il-freeze-rende-definitive.md) l'aveva
trovata un consuntivo. Questa l'ha trovata una **rilettura**. Cinque letture
indipendenti hanno ripreso le osservazioni del repo: righe di difetto, premesse
citate, affermazioni sull'architettura. Le hanno rimisurate contro i sorgenti di
oggi, al commit `bc1d27d`. L'esito è il fatto principale del giro. **La
rimisurazione ha smentito più spesso di quanto abbia confermato.**

Risultati sulle venticinque righe di difetto riprese:
- **Tre erano false.**
- **Dieci dicevano una cosa diversa.** Mostravano un altro soggetto o un altro
  meccanismo rispetto a ciò che si osserva.
- **Due difetti veri** sono stati trovati accanto a una riga falsa, cercando la
  prova per smentirla.
- Delle cinque osservazioni sui link ne sono rimaste **due**.
- Tre premesse sono cadute intere.
- Delle tre «decisioni portate avanti», **una non era una voce affatto**. Era
  prosa falsa in tre presidi — test che falliscono se una promessa del repo
  smette di valere —. Il repo aveva già deciso per iscritto contro l'unica forma
  che l'avrebbe resa una decisione.
- La voce più grave, la [§25.1](#251-una-rinomina-che-atterra-su-una-nota-viva),
  regge **per una strada diversa**. Tutte e quattro le sue premesse originali
  sono false. Il danno esiste in un'altra funzione.

---

**Perché stanno insieme.** In tutte e sette le scelte, il codice ha già preso
una posizione senza una scelta esplicita:
- **§25.1**: **Schiacciare** ciò che apparteneva a un'altra identità.
- **§25.2**: **Lasciar nascere** una regola di identità di un nome in silenzio.
- **§25.3**: Chiamare la prima fotografia di un vault **dal posto in cui
  capita** invece che da quello deciso.
- **§25.4**: **Copiare il blocco intero** in ogni contesto di backlink.
- **§25.5**: **Tacere** quando lo stato dell'applicazione non si salva più.
- **§25.6**: **Tenere un lucchetto** di macchina per il tempo di un `fsync`.
- **§25.7**: **Campionare tre chiavi cablate** per trovare i byte di un blocco
  di terzi.

C'è una seconda proprietà. È la ragione per cui queste sette si decidono
insieme: **in sei casi su sette la risposta giusta è già scritta nel repo e il
codice non la applica.**
- **§25.1**: Il versioning fonde le storie invece di buttarne una.
- **§25.2**: La forma del conto che pretende una dichiarazione esiste già per i
  lucchetti.
- **§25.3**: La [0070](../decisions/0070-un-vault-si-apre-in-due-tempi.md)
  scrive il criterio di cosa sta nell'apertura sincrona.
- **§25.4**: La ricerca ha un tetto di 220 caratteri sull'estratto.
- **§25.5**: La
  [0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) dice
  che il log è il pavimento e l'evento è la porta.
- **§25.6**: Il commento di `set_view_state` scrive parola per parola perché lì
  non si prende il prestito esclusivo.
- **§25.7**: Questa è l'eccezione che regge il conto. La regola non è scritta
  **da nessuna parte**, ed è proprio questo il difetto.

---

### 25.1 Una rinomina che atterra su una nota viva

*chiusa dalla
[0135](../decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md) · strato
**kernel** · **P0***

**Com'è finita e cosa lascia.** La voce chiedeva chi vince quando una rinomina
esterna atterra su un'identità già esistente nel vault. La risposta è la **forma
(a)**. Se `to_id` è già in anagrafe, non è un rename. È un `remove(from)`
seguito da `sync_path(to)`.

La decisione si basa su una misura dei quattro canali di stato attaccati a
un'identità. Di questi, **tre la distruggevano e uno la fondeva**. Il canale
distrutto più grave è la bozza. Il modulo la dichiara come «l'unica copia di ciò
che l'utente ha scritto». Eseguire `mv A.md B.md` da un terminale, con Fub
aperto e il buffer di `B` sporco, cancellava per sempre quel testo in silenzio.
La guardia si trova in una riga sola. Tutte e tre le porte attraversano questo
punto. La degradazione esisteva già lì accanto.

Delle quattro premesse originali della voce, **nessuna reggeva**. Il danno
esisteva comunque in un'altra funzione. Questo è un caso esemplare di una voce
sbagliata sul meccanismo ma giusta sul posto da osservare. Il dettaglio si trova
nel verbale.

La **forma (b)** è completata da C7VersioningB. Le politiche di collisione coprono
`organization`, `docdata`, `versioning` e `drafts`, senza lasciare aperto il caso
delle bozze non salvate:

- [x] **(b) Migrare senza mai schiacciare.** C7VersioningB estende la regola del
      versioning agli altri tre canali.
  - Se fondere ha senso, si fonde.
  - Se non ha senso, vince la destinazione e ciò che resta indietro si
    **nomina**. `doc_data_warnings` e `organization.warn` esistono già.
  - Il modello è già scritto. `VersionStore::rename` unisce le due storie in
    ordine di tempo per non perdere versioni in silenzio.
  - Le politiche da scrivere sono **tre**, una per canale, e tutte diverse. Due
    bozze non salvate non si fondono senza inventare un testo inesistente.
  - Paga **chi manterrà il codice**. È l'unica forma in cui nessuno perde niente
    in silenzio.

---

### 25.2 Quante regole di identità di un nome vuole Fub

*chiusa dalla
[0136](../decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md) ·
strato **contratto** · **P1***

**Com'è finita e cosa lascia.** La voce chiedeva se una regola nuova su «quando
due nomi sono lo stesso nome» si dichiara o nasce in silenzio. La risposta è la
**forma (a)**, raccomandata dalla voce stessa. Questa forma è un **conto sulle
sorgenti** nel file `crates/fub-abi/tests/una_regola_di_nome_si_dichiara.rs`.
Questo conto pretende **famiglia e ragione** per ognuna delle regole in
produzione. Diventa rosso sotto `cargo test` se si aggiunge una regola senza
dichiararla. La forma **(b)** è una porta `fub_abi::rules` esclusiva. Questa
**non si fa**. Risponde a una domanda che quattro verbali hanno già chiuso con
un no. Inoltre è irreversibile perché adiacente al WIT.

Il censimento ha misurato 44 regole per la stessa domanda. Sembrava una
duplicazione da unificare, ma **non lo era**. La vera duplicazione era nella
**dichiarazione mancante**. Il presidio — il test di salvaguardia — è nato verde
su **quaranta** righe. È stato acceso rosso nei due versi: con una regola non
dichiarata e con una famiglia mentita. Il difetto `0142` descriveva la piegatura
scritta a mano due volte nel rename. È stato riparato qui tramite
`solo_il_caso`, che chiama `resolution_key`. Tre righe di difetto nominate da
questa voce sono risultate **false**:
- `0070`: `İ` e `ẞ` sono le risposte giuste e deliberate.
- `0093` sulla conseguenza: `heading_matches` è una disgiunzione. Rompe l'`id=`
  HTML, non la risoluzione.
- `0018` sul posto: la scansione sempre pagata è nel ramo `Wiki`, ed è il
  difetto `0115`. Il dettaglio sta nel verbale.

La forma (a) **non** ripara una divergenza. Restano aperti come difetti
misurati, e non come caselle — elementi di lavoro da completare —:
- Il `0115`: risolvere un wikilink scandisce l'anagrafe.
- Il `0140`: quattro regole senza NFC.
- Il `0141`: tre risposte incompatibili a «sta dentro questa cartella?». Le loro
  righe di allowlist li nominano per numero invece di travestirli da ragione.
  Una divergenza dichiarata è più visibile di una taciuta e rimane tale.

---

### 25.3 Dove sta la prima fotografia di un vault

*chiusa dalla
[0141](../decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md) ·
strato **kernel** · **P1***

**Com'è finita e cosa lascia.** La voce chiedeva dove posizionare la prima
fotografia di un vault mai visto: dentro l'apertura sincrona o in differita. La
risposta è la **forma (a)**, raccomandata dalla voce stessa. La finestra
scoperta resta **zero**. Si sposta solo *dove* avviene la chiamata, non
*quando*.
- La passata esce dalla fase 1.
- La chiama il **runner**, una volta per apertura, **prima della prima fetta**.
  Il *quando* non cambia di un'unità osservabile. La fotografia precede ancora
  qualunque scrittura dell'utente. Il *chi* invece cambia. Non è più un ramo
  `Event::VaultOpened` dentro `VersioningHandler`, dove finiva per caso perché
  l'evento nasceva lì. Diventa una chiusura consegnata dal montaggio alla
  sessione. Il ramo e la sua maschera si eliminano. `InCorso` porta una chiusura
  consumata con `take`. La garanzia di esecuzione una-sola-volta si ottiene con
  **il tipo, non con un flag**.

L'argomento a favore è il numero della voce. Riparato l'O(N²), restano circa 167
ms su 5000 note. Questo è il prezzo per una finestra di lunghezza zero su un
dato impossibile da ricostruire in caso di perdita. Il posto è dettato dalla
[0070](../decisions/0070-un-vault-si-apre-in-due-tempi.md). La fase 1 identifica
**quali** documenti esistono, mentre la passata legge il **contenuto**. Quindi
si trovava dalla parte sbagliata della separazione.

**La forma approvata è morta sul banco — la suite di test —.** La premessa
caduta giustifica il verbale. La forma prevedeva un `JobHost` per-capacità.
Serviva a far girare la passata senza il prestito esclusivo del workspace, come
aveva funzionato nella
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md).
Qui invece **chiude un ciclo di lock**. La passata mantiene il mutex interno
dello store durante le proprie scritture. Le scritture normali mantengono il
workspace attraverso le chiamate alla feature. Di conseguenza, `concorrenza.rs`
è rimasto appeso oltre sessanta secondi in **deadlock**. La passata gira sotto
l'esclusivo, come in fase 1. Della forma originale rimane il taglio, ma
l'ambizione sul lock viene scartata. Nessuna riga della voce richiedeva questo
lock. La seconda premessa caduta riguarda il posizionamento. La funzione
`first_snapshot_of_the_vault` sta in **`fub-features`**, non in `fub-kernel`.

Le altre tre forme non si fanno e sono state scartate:

| Alternativa | Perché no |
|---|---|
| **(b)** | Apre una finestra lunga quanto l'indicizzazione. Chi scrive subito perde lo stato iniziale della nota. La 0124 ha già rifiutato il compromesso. |
| **(c)** | Ha gli stessi difetti della (b). In più aggiunge una superficie da disegnare senza ulteriori vantaggi. |
| **(d)** | Richiede un evento con il sorgente, un campo nel WIT e il byte-per-byte dei documenti nella coda. È un'opzione irreversibile e accorcia la finestra senza chiuderla. |

La voce lascia scoperto un elemento che non è né una casella né una riga di
difetto. Si tratta del **residuo O(N²)** — il debito di calcolo — del
versioning. Il codice chiama `let mut piano = inner.docs.clone()` due volte in
`VersionStore::snapshot` e nei comandi gemelli `rename` e `tombstone`. Questa
copia *è* la forma `Durevole`. Riscriverla come un delta con rollback significa
abbandonare questa forma. La sua riparazione dipende dalla decisione mantenuta
aperta dal difetto `0113`. Un difetto legato a una decisione in sospeso non è un
vero difetto. È registrato nel verbale come un fatto misurato in attesa di una
decisione.

*Quello che si diceva e che non regge.* Si affermava che la passata girasse
«fuori dal ciclo a fette del `JobRunner`». La realtà era più grave: girava
**prima che il ciclo esistesse**. Il numero riportato di «1542 ms su 2358» non
trovava riscontro nel repo. Si trattava di una stima, non di una vera misura.

---

### 25.4 Quanto contesto porta un backlink

*chiusa dalla
[0138](../decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md) ·
strato **contratto** · **P1***

**Com'è finita e cosa lascia.** La risposta è la forma **(b)**, raccomandata
dalla voce stessa. Il contesto di un backlink diventa una **finestra di 220
caratteri attorno al link**. Si ritaglia sul testo renderizzato del blocco
contenitore, usando l'ellissi ai bordi del taglio. Il link non si taglia mai
perché rappresenta il riferimento di cui la riga parla. La regola si trova in
`fub-abi::rules::snippet`, cioè `window(testo, intervallo) -> String`. Il
provider WASM di M5 la eredita così senza doverla reinventare (0020). Il tetto
rimane una costante Rust fuori dal contratto (0094). Il WIT continua a esporre
`context: option<string>`, ma la forma (b) vi inserisce meno byte. Il numero 220
corrisponde allo snippet di ricerca. La costante `SNIPPET_CHARS` è migrata in un
posto solo da `fub-features/src/search.rs` (oggi `search.rs:1195` per tantivy,
`:1218` per `head_of`). La ricerca e i backlink condividono ora la stessa
definizione di estratto. Il parser registra la posizione di ogni link nel testo
renderizzato del blocco in un contenitore unico che non può disallinearsi.
Questa registrazione prima non esisteva, ed è il costo che la voce non
considerava. Il trim si applica dopo il ritaglio.

La voce chiude il difetto `0110` descrivendolo come «vera e trascurabile, detta
coi numeri» invece di «riparata con la fetta condivisa». Le copie della catena
rimangono strutturalmente presenti come **due copie e una move**, non tre. La
riga originale trascurava sia il clone del render sia il disco. Ognuna scende da
una mediana di 341 byte (fino a un massimo di 195.738) a ≤222 caratteri. Il
calcolo diventa: 4.367 link × ≤222 ≈ **969 KB** al posto di **53.994.565 byte**,
pari all'1,8%.

Le forme scartate:

| Alternativa | Perché no |
|---|---|
| **(a)** | Taglia il testo all'inizio. Il link finisce fuori dall'ellissi. |
| **(c)** | Sposta il costo dall'indice alla lettura. Causa il ridisegno del pannello a ogni cambio di documento. |
| **(d)** | Non ripara `entries.json`, che essendo JSON viene serializzato N volte lo stesso. |

Rimangono dei fatti, non difetti aperti: `entries.json` viene ancora riletto e
riscritto interamente a ogni apertura (il 0112 è un'altra riga). Il pannello
attraversa ancora l'IPC con `page: None`, anche se con ≤222 caratteri per riga.
Le premesse cadute sono elencate nel
[verbale](../decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md).
La più importante si ripete qui: il vero difetto era la dimensione dei dati, non
la loro duplicazione.

---

### 25.5 Quando la cartella di configurazione non si può scrivere

*chiusa dalla
[0139](../decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md) · strato
**kernel** · **P1***

**Com'è finita e cosa lascia.** La risposta è la **forma (a)** raccomandata
dalla voce stessa: si parte e si notifica l'errore una volta sola per sessione.
Il dettaglio cruciale è il **quando**. La porta non può inviare una spinta
all'avvio perché nessuno è in ascolto. Il ponte degli eventi nasce dentro
`Host::open` al primo vault aperto. La shell si iscrive agli eventi in un
momento successivo. Un `Trouble` emesso all'avvio andrebbe perso comunque:
- Prima del `setup` di Tauri si perderebbe come `Consegna::Persa`.
- Dopo il `setup` si perderebbe come un `app.emit` che restituisce `Ok` senza
  ascoltatori, poiché Tauri non accoda i messaggi.

La diagnosi composta da `pavimento` per `stderr` si sposta. Il log è il primo a
tentare di scrivere in quella cartella. La diagnosi esce da `install_logging`,
entra nell'host con `with_avviso_di_sessione`, e viene consegnata tramite un
**tiraggio** — un meccanismo di lettura su richiesta —. Questo tiraggio è il
comando `avviso_di_sessione`. La shell lo richiede in `init()` appena il router
è attivo, prima di `initial_vault`. Il `take` rende la garanzia «una volta per
sessione» strutturale. La seconda chiamata restituisce `None` senza usare alcun
latch. Il ramo dove `config_dir()` è `None` ora comunica con un proprio
messaggio, mentre prima taceva. Il banco che presidiava quel silenzio si
chiamava `senza_cartella_di_configurazione_stderr_non_e_un_guasto`, ed è stato
riscritto nel verso nuovo: oggi si chiama
`un_avviso_di_sessione_si_dice_una_volta_sola`
(`crates/fub-host/tests/la_macchina_senza_vault.rs:289`). I banchi bloccano le
modifiche errate nei due versi: se si rimuove il `take` il test fallisce, se si
toglie il tiraggio da `init()` il test fallisce. Il nuovo gesto della finestra
senza vault — il dodicesimo descritto in
[17-presidi-che-restano](../roadmap/17-presidi-che-restano.md) — verifica che la
chiamata arrivi alla porta e mostri il toast.

**Le premesse cadute e il residuo.** La citazione «undici derivati, zero
originali» attribuita alla
[0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md) è falsa. La frase
esiste solo in questa voce, ma la sostanza del verbale rimane valida. La
premessa «alla prima scrittura fallita» identifica il momento in cui nasce la
diagnosi. La prima scrittura fallita coincide con l'apertura del log. Questa è
la riga consegnata dal tiraggio. Resta fuori una normalizzazione, dichiarata nel
verbale ma **non** come casella. Non possiede un innesco — una condizione che ne
forzi l'esecuzione —, e una casella senza innesco è una riga inutile. La
normalizzazione riguarda i tre percorsi di errore del punto 7:
- `PluginError::Io` per il registro vault.
- `Internal` per le impostazioni macchina.
- `String` nudo per lo stato di vista. La forma (a) informa su questi percorsi
  ma non li uniforma. Resta anche la tensione tra il toast `guasto` di
  `set_setting` e il tono `info` della porta. Sono due frasi destinate a momenti
  diversi.

### 25.6 Chi paga la latenza di una scrittura fatta dentro un comando IPC

*chiusa dalla
[0137](../decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md)
· strato **shell** · **P2***

**Com'è finita e cosa lascia.** La risposta è la **forma (a)** raccomandata
dalla voce stessa: una scrittura su disco in un comando IPC **si accoda nella
shell**. I valori vengono coalesi per chiave. Due scritture accavallate sulla
stessa chiave diventano una sola scrittura contenente l'ultimo valore. La
chiamata non si rende `async` nel thread dell'IPC. La coda si trova in
`frontend/src/ui/corsa.ts`, accanto a `Coda`, affinché sia ereditabile
gratuitamente da tutti. I chiamanti di `scriviStato` sono **cinque** in tre
moduli. La premessa originale, che ne contava due, era falsa.

Le alternative scartate o sospese sono due:
- La **(b)** si scarta in base alla
  [0057](../decisions/0057-la-dieta-dell-ipc.md). Una seconda convenzione di
  chiamata violerebbe l'elenco chiuso.
- La **(c)** resta chiusa **fino alla soglia**. Si accetta il lucchetto di
  macchina finché il file di stato non supera la taglia misurata. Questi valori
  sono 5,036 ms su 137 KB con 20 vault, contro 2,561 ms su 2,4 KB. La metrica è
  dominata dall'`fsync` e non dalla fusione. Quel giorno si riaprirà l'opzione
  (c), che è l'unica forma irreversibile.

Il «caso peggiore» descritto nella voce — l'uso di `set_setting_for_user` e
`reset_setting_for_user` con il prestito esclusivo del workspace — **non è un
difetto aperto**. La ritrattazione nel commit `53972d4` aveva già smentito
questo falso problema prima che questa voce si chiudesse. Il prestito esclusivo
in `set_setting_for_user` non serve alla scrittura su disco. Serve a rifare i
recinti, potare il registro ed emettere eventi. I quattro fratelli che usano il
prestito condiviso non eseguono queste azioni. La voce originale lo citava
ancora perché la ritrattazione aveva ripulito la tabella ma non il testo della
voce stessa.

### 25.7 Dove stanno i byte di un `kind` di terzi

*chiusa dalla
[0140](../decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md) · strato
**contratto** · **P2***

**Com'è finita e cosa lascia.** La risposta è la **forma (b)** raccomandata
dalla voce: la chiave del carico di un `kind` di terzi è `source`. La regola è
scritta in `fub_abi::rules::carichi` con `CHIAVE_DEL_CARICO` e
`carico_testuale`. In questo modo il secondo chiamante, il provider WASM di M5
(0020), può ereditarla gratuitamente. La lista `CARICHI` **non cresce e non può
crescere**. Il conto a due versi di `ogni_kind_dichiara_cosa_porta` rifiuta ogni
riga che non nomina una `const` del core. La scelta posta dalla voce era già
stata decisa da questo presidio. Il campione a tre chiavi sparisce da
`render.rs`. Ora il render chiede la risposta direttamente al contratto. Le
chiavi `html` e `text` vengono eliminate. Le due fixture di test che le usavano
su kind di terzi sono migrate a `source` nel medesimo commit. Senza questa
migrazione le fixture sarebbero diventate mute in silenzio. Il banco resta verde
anche con una fixture che restituisce un risultato vuoto.

Il silenzio a runtime rimane e viene dichiarato secondo la decisione 0052. Chi
vede il guasto — il sistema di resa in `fub-format-markdown` — non possiede il
bus. Aprire una porta dal render costituirebbe una seconda convenzione, in
aggiunta a quella dell'avvio citata nel §25.5. Il pavimento (`tracing` nel
provider) viene rimandato a un verbale specifico. Questa modifica richiederebbe
una dipendenza nuova in un crate progettato per non averne (0062).

Il presidio è un banco nei due versi, chiamato
`un_kind_di_terzi_degradato_mostra_i_byte_della_chiave_convenzionale` in
`custom_blocks_e2e.rs`. È stato provato rosso in entrambi i versi:
- Rinominare la chiave in produzione fa fallire l'asserzione, mostrando un
  `<div>` vuoto nel messaggio.
- Riallargare il campione fa vincere `TESTO-SBAGLIATO` su `source`. Questo è il
  banco che il §7 dichiarava mancante. In realtà esisteva già a metà: il
  passaggio era presente, ma mancava l'asserzione sul contenuto.

Resta aperta la sola forma **(a)**. Non è stata scartata, ma resta in sospeso
perché non è urgente:

- [ ] **(a) Un campo in fondo a `syntax-rule-spec`.** Questo campo definirebbe
      `carichi: list<carico>` più un `variant carico`, da consultare prima della
      convenzione.
  - L'innesco è osservabile. Coinciderà con **il primo `custom_kind` di terzi
    che richiede di dichiarare il proprio carico** senza seguire la convenzione.
  - Si tratterebbe di un plugin che deve specificare *dove* conserva i byte
    (usando più di una chiave, una chiave diversa da `source`, o carichi in più
    punti). Per questo plugin `source` rappresenterebbe una limitazione invece
    di una soluzione.
  - È un intervento additivo per la regola scritta del repo, poiché si tratta di
    un campo in fondo (`wit_additivity.rs`). Tuttavia, il nome e la forma del
    `variant` si pagherebbero per sempre (0002).
  - Questa è la casella che il verbale lascia registrata, con il suo trigger
    pronto a scattare.