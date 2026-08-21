# 0132 — Un rifiuto non è una frase, sono i due dati da cui la frase si compone

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: la
[§24.3](../roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) —
*«`Unsupported` è l'unico errore che non è testo che qualcuno legge»*. Non era
l'unico e non era quello che si vede più spesso; ma è **la sola voce delle tre
di questa seduta che scadeva davvero col freeze**, e la linea di base congelata
si è dovuta ritagliare **Commit**: *(questo commit)*

---

## La domanda, com'era posta

La [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) ha stabilito che un
errore è testo, e la [0040](0040-chi-localizza.md) che il testo si risolve sulla
via d'uscita col catalogo di chi ha scritto la frase.
`FormatError::Unsupported(String)` portava una stringa nuda: non un `Text`, cioè
non qualcosa che qualcuno sappia tradurre. La voce chiedeva di decidere **di chi
è** quel rifiuto — del contratto, e allora la frase si compone da due dati; o
del provider, e allora è un `Text` col catalogo di chi lo emette.

## Le premesse della voce, misurate

Tre su tre erano false, e una lo era in un modo che cambia cosa si sta
riparando.

**«È l'unico»: falso, e il conto giusto è quattro.** `FormatError` ha quattro
varianti e **nessuna** delle quattro è un `Text`: `Parse`, `Render` e
`Serialize` portano una `String` esattamente come `Unsupported` portava la sua.
Il modulo lo dice per esteso e lo dice bene — *«`Display` è per chi legge un
log, `Text` è per chi legge uno schermo»* —, e per quelle tre è la risposta
giusta: sono una diagnosi su un documento (una riga, un delimitatore non
chiuso), il loro lettore è il codice che le ha chiamate, e il kernel le porta a
[`Internal`](../../crates/fub-abi/src/error.rs), cioè a un log. Andando ancora
più in là si scopre che nemmeno il conto sui `PluginError` regge: la maggioranza
di quelli che il kernel costruisce porta un `Text::Literal` di prosa italiana
cablata, ed è **anche quella una decisione dichiarata** — sta scritta in
`Workspace::localized`: *«ciò che fallisce prima che un provider sia stato
chiamato è prosa del kernel; farlo passare di qui non sarebbe sbagliato, sarebbe
rumore che suggerisce una traduzione che non avviene»*.

Quindi `Unsupported` non era «l'unico che non è testo». Era l'unico che **non
doveva portare prosa affatto**, e per una ragione che la voce non aveva scritta:
è l'unica delle quattro che non è una diagnosi su un documento. È il disaccordo
fra due dati **già dichiarati nel contratto** — la forma che il provider ha
chiesto in `FormatDescriptor::source` e quella che ha ricevuto — ed è l'unica
delle quattro che il kernel porta a `Unserved`, cioè davanti a una persona che
ha appena provato ad aprire un file, col consiglio «installa un plugin».

**«È la variante che un utente vede più spesso di tutte»: falso, e al
contrario.** Oggi non la vede **mai** passando dal kernel, e lo impedisce una
riga scritta apposta: `DocumentStore::source_from_disk` è il *punto unico* in
cui `FormatDescriptor::source` viene consultato
([0087](0087-il-testo-che-sta-dentro-gli-allegati.md), §21.8), e legge il file
**nella forma che il provider ha chiesto**. Un provider `SourceKind::Text`
riceve `DocumentSource::Text` sempre; un file che non è UTF-8 fallisce un piano
più sotto, in `Vault::read`, come `KernelError::Io` con l'offset del primo byte
storto. La frase della voce — *«ciò che compare quando si apre un file col
provider sbagliato, il caso normale in un vault che contiene anche allegati»* —
descrive un caso vero, ma quel caso è `NoProvider` («nessun provider per questa
estensione») oppure `Io` («non è UTF-8»): non è questo. Sembrava vera perché la
conclusione era giusta e la catena no.

**E questo non toglie niente all'urgenza, la sposta**: `Unsupported` è una
promessa del *contratto* verso host e provider che questo repo non ha ancora,
non un percorso dell'host di oggi. Ciò che si congela a M4 è la promessa, non il
percorso — ed è esattamente la ragione per cui la firma andava decisa prima.

**«O un `Text` col catalogo di chi lo emette»: impraticabile.** È la forma che
l'audit proponeva alla lettera (*«un campo `Text` facoltativo per spiegare la
ragione»*), ed è quella che il verso opposto ha demolito.

## Il verso opposto, che è ciò che ha deciso la forma

*C'è un sito in cui `Unsupported` viene consumato da qualcuno che non ha nessuna
frase sensata da dare?* Sì, ed è **l'unico** che ha:
`impl From<KernelError> for PluginError`. È una `From`: nessun `&self`, quindi
nessun registro dei plugin, nessun locale, nessun catalogo. E la via su cui
quell'errore viaggia — aprire un documento — **non passa da
`Workspace::localize`**, che si applica ai soli sei `?` delle vie d'uscita di
view e comandi, dove l'`owner` è noto.

Un `Text::Message` messo lì dentro non verrebbe risolto da nessuno, e la scala
di ripiego della [0040](0040-chi-localizza.md) ha per ultimo gradino **la chiave
nuda**: l'utente leggerebbe `formato.non-supportato`. Cioè la forma «più
corretta» avrebbe prodotto, per chi guarda, un esito **peggiore** della stringa
inglese di prima. Il quarto gradino è deliberatamente brutto perché una chiave
mancante si debba notare in sviluppo; farci arrivare un caso che si sa già che
nessuno risolverà è usarlo come discarica.

Quindi: il payload smette di essere prosa, ma la prosa non diventa una chiave —
diventa **prosa del kernel**, come ogni altra riga di quel `match`, e diventerà
traducibile il giorno in cui lo diventeranno tutte, in un posto solo. Questa
voce non è quel giorno, e fingere il contrario avrebbe lasciato in piedi la metà
difficile spacciandola per fatta.

## La decisione

Ha vinto la prima delle due forme che la voce nominava — *`Unsupported` è del
contratto* — nella forma più stretta possibile:

```rust
#[error("il formato «{format}» non legge una sorgente di tipo {got:?}")]
Unsupported {
    /// L'id del formato che ha detto di no.
    format: String,
    /// La forma di sorgente che ha ricevuto, e che non è la sua.
    got: SourceKind,
},
```

**Una variante di struct, e senza `..` da nessuna parte.** È la forma di
`Inline`/`Block` in `fub-format-markdown::serialize`
([0122](0122-una-sorgente-non-degrada-si-rifiuta.md)): chi la costruisce
dimenticandosi un campo prende `E0063`, chi la legge dimenticandosene uno prende
`E0027`. Il secondo chiamante la eredita gratis senza che nessuno gli dica
niente, che è la prova che questo repo chiede.

Nessun tipo nuovo in Rust: `SourceKind` c'era già, e la variante è inline —
`superficie_della_radice` non ha niente da vedere. Un metodo nuovo,
`DocumentSource::kind()`, perché *quale specie ho ricevuto* è una domanda che il
`match` di `text()` si stava già facendo, e riscriverla a mano al sito del
rifiuto vuol dire poterla scrivere sbagliata.

La frase la compone il kernel, in `From<KernelError> for PluginError`, spendendo
tutti e due i campi. Accanto c'è `specie_di_sorgente`, un `match` **senza `_`**:
una specie di sorgente in più nel contratto (l'encoding da rilevare del §2.3, un
flusso) non compila finché non le si è data una parola italiana. È la metà che
il tipo non può prendere da sé — il tipo obbliga a *dire* cosa è arrivato, il
`match` obbliga a saperlo **nominare**.

## Sì, scade col freeze — e questa volta per la ragione giusta

Terza voce della seduta, e la prima in cui la risposta è **sì**.

`format-error` attraversa il WIT (`interface format`), ed è il tipo d'errore
delle tre funzioni che un plugin di formato **esporta**: `parse`, `render-html`,
`serialize`, più `syntax.apply` e `custom-render.render`. Cambiare il payload di
un caso già pubblicato non è un'aggiunta in nessuna lettura: è un **ritipo**, e
sposta la forma di ciò che c'era.

Il presidio lo dice per nome. Rimettendo la sola linea di base al suo stato
precedente:

```
- [0.1.0] variant `format::format-error`, casi: in posizione 3 c'era
  ("unsupported", Some("string")) e ora c'è ("unsupported",
  Some("format-error-unsupported")) (rinomina, ritipo o riordino: l'ordine è ABI)
```

Come nella [0102](0102-i-byte-non-stanno-nel-record.md) — e a differenza della
[0049](0049-una-posizione-dentro-un-documento.md) e della
[0101](0101-una-voce-non-e-un-passo.md) — **`0.1.0.wit` si tocca davvero**: quel
caso c'era già quando la linea di base è stata tagliata. Il ritaglio è nel file,
col suo commento, ed è in tabella in
[wit-congelato.md](../architecture/wit-congelato.md).

La via additiva — un caso `unsupported-source` **in coda** al variant, lasciando
`unsupported(string)` dov'è — è stata scartata per la ragione della
[0049](0049-una-posizione-dentro-un-documento.md) e della
[0089](0089-da-cosa-e-partita-una-scrittura.md): lascerebbe per sempre **due
modi di rifiutare una sorgente, di cui uno intraducibile**, e chi scrive un
provider sceglierebbe il più corto — che è quello che il giro è venuto a
togliere.

## Il difetto fuori dalla voce, ventitreesimo giro di fila

Stava dentro il banco che avrebbe dovuto smentirmi, e il grep che il metodo
prescrive l'ha trovato in trenta secondi.

`un_provider_testuale_rifiuta_i_byte` esiste dalla
[0054](0054-il-banco-del-lato-provider.md), e il suo doc-comment cita la regola
del contratto per intero: *«un provider testuale che ricevesse dei byte risponde
`FormatError::Unsupported` invece di indovinare l'encoding»*. Il corpo ne
provava **metà**: `assert!(esito.is_err())`. Quale errore, non lo guardava.

Non è pedanteria. Un provider che rifiutasse con `Parse` sarebbe passato verde
per sempre, e la differenza arriva intera fino allo schermo: `Parse` va a
`Internal` — *«errore interno del plugin»*, cioè «segnala un bug» — mentre
`Unsupported` va a `Unserved`, cioè «nessuno serve questo, installa un plugin».
Sull'allegato di un utente il primo dice *«il tuo file è rotto»* di un file che
sta benissimo. È la famiglia della 0054 stessa — *un banco che passa a vuoto* —
trovata **dentro** un banco della 0054, e la lezione è che citare la regola nel
commento non è provarla: il commento diceva `Unsupported`, il codice diceva
`is_err`, e nessuno dei due mentiva abbastanza da farsi notare.

Adesso il banco pretende la variante **e i due campi**, e il secondo controllo è
quello che il compilatore non può fare: il tipo obbliga a *portare* un id di
formato, non a portare **il proprio** — un provider che si nominasse con l'id di
un altro manderebbe l'utente a installare il plugin sbagliato.

## I presidi, e il rosso

Attore doppio, e la divisione è quella della
[0105](0105-una-porta-si-nomina-e-un-presupposto-si-compila.md): *il compilatore
prende la variante che non vuol dire niente, il test prende il comportamento.*

**Il compilatore** (nessun banco: verificato rompendo, non scritto):

| rottura | esito |
| --- | --- |
| costruire `Unsupported` senza `got` | `E0063: missing field got in initializer of FormatError` |
| leggere `Unsupported { format }` senza `..` | `E0027: pattern does not mention field got` |
| una `SourceKind` in più nel contratto | `specie_di_sorgente` non compila (`match` senza `_`) |

**I test**, tutti verificati rossi rompendo apposta la proprietà:

1. `fub-kernel::error::il_rifiuto_di_un_formato_nomina_chi_e_e_cosa_ha_ricevuto`
   — è il verso che il compilatore **non** prende: il tipo obbliga a portare i
   due dati, non a **spenderli**, e un `format!` che ne dimentichi uno compila
   benissimo. Rosso due volte, una per campo: *«la frase non dice QUALE formato
   ha rifiutato»*, *«la frase non dice COSA gli è arrivato: … gli è arrivato , che
   non è la forma…»*.
2. `fub-kernel::error::le_altre_tre_restano_un_difetto_e_non_un_nessuno_lo_serve`
   — la riga che tiene separate le due metà di `FormatError`: le altre tre vanno
   a `Internal`, non a `Unserved`.
3. `fub-sdk::conformita::un_provider_testuale_rifiuta_i_byte`, riparato sopra.
   Rosso facendo rifiutare il markdown con `Parse` (*«ha rifiutato dei byte
   grezzi con `Parse(…)` invece che con `Unsupported`»*) e rosso facendolo
   nominare `commonmark` (*«ha rifiutato dicendo di essere `commonmark`»*).
4. `wit_additivity::il_contratto_cresce_solo_per_aggiunta` — rosso rimettendo la
   linea di base congelata al suo stato precedente, con la riga citata sopra. È
   il presidio che dimostra la tesi della voce, e l'unico dei tre della seduta
   24 che si sia acceso.

## Zone cieche dichiarate

- **La frase resta prosa italiana del kernel**, non traducibile — per la ragione
  argomentata sopra, non per dimenticanza. Il debito è quello, largo, di tutti i
  `Text::Literal` che `From<KernelError> for PluginError` costruisce; questa
  voce ne toglie uno dai *provider*, dove nessuno poteva ripararlo, e lo porta
  dove tutti gli altri sono già, dove un giorno si riparano insieme.
- **`Parse`, `Render` e `Serialize` restano `String`**, e non è un lavoro a
  metà: il loro lettore è un log, e l'hanno scritto apposta.
- **Il caso non è raggiungibile dal kernel di oggi** (`source_from_disk` legge
  nella forma dichiarata). È una promessa del contratto verso host e provider di
  domani, e il banco della SDK la prova chiamando `parse` direttamente — che è
  l'unico modo di provarla, e va detto che è un banco su un percorso che l'host
  non percorre.
- **Nessuna fixture si è mossa, ed è verificato e non sperato**: `FormatError`
  non è nel mirror TypeScript perché non attraversa mai l'IPC (diventa un
  `PluginError` prima), e non era in `fieldless_enums()` perché tutte e quattro
  le sue varianti hanno sempre avuto un payload — quindi non poteva né entrarci
  né uscirne. Centoventuno binari `test result: ok`, come prima: le due prove
  nuove stanno in `fub-kernel` (lib) e in un banco che c'era già.
