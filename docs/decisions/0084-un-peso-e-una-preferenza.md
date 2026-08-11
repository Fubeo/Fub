# 0084 — Un peso è una preferenza, e una copia in RAM ha bisogno di chi la rinfresca

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §21.6 ([seduta 21](../roadmap/21-la-ricerca-predefinita.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[le impostazioni e i tre stati, 0036](0036-le-impostazioni-e-i-tre-stati.md) ·
[le impostazioni vivono nel vault, 0076](0076-le-impostazioni-vivono-nel-vault.md)
· [cosa si chiede a una ricerca, 0050](0050-cosa-si-chiede-a-una-ricerca.md) ·
[la ricerca predefinita, 0025](0025-la-ricerca-predefinita.md) ·
[una porta per chi cerca, 0082](0082-una-porta-per-chi-cerca.md)

---

Due numeri in `search.rs`: `PAGE_NAME_BOOST = 4.0` e `HEADING_BOOST = 2.0`. Sono
il motivo per cui chi cerca *Rust* trova per prima la nota **intitolata** Rust,
e sono buoni — restano i default. Il punto della voce non era mai che fossero
sbagliati: era che un vault di ricette e uno di paper non vogliono gli stessi
pesi, e che *omnisearch* quei pesi li rende regolabili.

Metà della decisione la §21.6 se l'era già data, e questo verbale non la
ridiscute: **il peso non va nella query, va nelle impostazioni**.
`TextQuery.fields` dice *dove* cercare, e dove cercare è un fatto sul vault;
*quanto* pesa un campo è una preferenza di chi legge, e il linguaggio delle
query contiene fatti («un predicato è un fatto sul vault, non un servizio»,
`abi/query.rs`). Ne segue la proprietà che rende questa voce piccola: **la firma
non si tocca**. Sarebbe stata la quinta volta di fila che una voce di questa
seduta si chiude senza spendere contratto, e lo è.

Restava il lavoro, e dentro il lavoro tre scelte vere.

## La copia in RAM, e chi la rinfresca

`IndexProvider::query(&self, query)` **non riceve un `HostApi`**. È il vincolo
che decide tutto il resto: i pesi non si possono leggere nel momento in cui
servono. L'unico posto in cui questo provider vede un host è `activate`, dove
già ritrova il proprio manifest — quindi i pesi si leggono lì e si tengono nel
provider.

Uno stato letto una volta e tenuto in RAM è una **copia**, e una copia
invecchia. La domanda onesta era: chi la rinfresca, o si scrive che i pesi
valgono dal prossimo avvio? Le due risposte erano entrambe difendibili, e la
seconda costava zero — bastava dirlo nella descrizione della chiave, che è un
modo legittimo di chiudere una voce.

Si è scelta la prima, e la ragione è nella natura di ciò che si sta
configurando: **un peso si tara**. Non è un interruttore che si mette una volta,
è un numero che si muove, si guarda l'effetto, si rimuove. Un ciclo di taratura
che passa dalla riapertura del vault è un ciclo che nessuno fa due volte, e la
chiave sarebbe rimasta formalmente configurabile e praticamente cablata — cioè
la voce chiusa a metà.

Il meccanismo è quello che il contratto rende disponibile, senza inventare
niente: il bundle della ricerca registra, accanto all'`IndexProvider`, un
`EventHandler` — `SearchSettings` — sottoscritto a `SettingChanged`. I due
condividono un `Arc<RwLock<FieldWeights>>`, e il capo dell'`Arc` si prende
**prima** di consegnare l'indice al workspace, perché dopo la registrazione il
provider è dentro e non lo si tocca più.

Tre cose vale la pena scrivere, perché ognuna era un modo di sbagliare:

- **L'evento non porta il valore nuovo**, per progetto: chi reagisce rilegge. È
  la stessa regola che il versioning incontra col proprio interruttore, e qui
  significa che l'handler chiama `FieldWeights::read(host)` e non legge il
  `Notice`. Un evento che portasse il valore sarebbe una seconda fonte di verità
  che arriva in ritardo.
- **Si guarda il prefisso `search.boost.`, non i quattro nomi.** Il giorno che
  un quinto campo diventa indicizzabile, la sua chiave arriva all'handler senza
  che nessuno si ricordi di aggiungerla a un elenco. Il tema che cambia non fa
  rileggere niente, e c'è un presidio che lo dice.
- **Una query legge i quattro pesi in un colpo solo** (`*self.weights.read()`,
  un `FieldWeights` è `Copy`). Leggerli uno per campo avrebbe aperto una
  finestra in cui una ricerca lanciata mentre qualcuno muove uno slider pesa il
  nome con la taratura nuova e gli heading con quella vecchia: un ordinamento
  che non corrisponde a nessuna configurazione mai esistita.

Il `RwLock` sta sul percorso di ogni query, ed è la forma giusta per la ragione
della [0024](0024-chi-legge-non-aspetta-chi-legge.md): chi legge è tutto il
mondo, chi scrive è una persona che muove uno slider ogni tanto.

## Quattro chiavi, e il corpo che è l'unità di misura

Le costanti erano due; le chiavi sono **quattro** — nome, heading, corpo, tag.
Le prime due erano ovvie. Il tag lo era quasi: pesava quanto il corpo per
assenza di una decisione, non per una decisione, e chi organizza le note per tag
li vuole sopra.

Il corpo è il caso interessante, perché dichiararlo è quasi inutile e non
dichiararlo è peggio. In un punteggio contano i **rapporti** fra i pesi, non i
loro valori: alzarli tutti e quattro insieme non sposta un solo risultato. Il
corpo a 1.0 è l'unità di misura degli altri tre, e una chiave che lo espone
offre un gesto che non fa niente. L'alternativa però era lasciare un campo
indicizzato su quattro che si comporta diversamente dagli altri senza che niente
lo dica, e un caso speciale da spiegare a voce è peggio di un gesto neutro: la
cosa che va detta si dice **nella descrizione della chiave**, che è il posto in
cui qualcuno la legge.

Sui limiti: `min 0.0`, `max 100.0`. Il tetto non è una legge di natura, è il
guardrail contro il refuso — `40` battuto al posto di `4.0` — e un valore fuori
intervallo viene **rifiutato** e non arrotondato, che è la regola di
`SettingKind::rejects` e vale qui come altrove.

Lo **zero è ammesso**, ed è la riga che ha richiesto più attenzione: in tantivy
un peso a zero non esclude il documento. Il campo continua a far *combaciare* la
nota — la nota si trova ancora — e smette solo di farla salire. Quindi «peso del
nome a zero» **non** vuol dire «non cercare nel nome»: quello si dice con
`TextQuery.fields`, che è la porta giusta e c'è già. Si è preferito ammetterlo e
spiegarlo invece di vietarlo, perché il caso è reale — «trova anche nei tag, ma
non premiarli» — e perché in questo progetto un valore non si corregge in
silenzio, si spiega.

Tutte e quattro sono `program_writable`, come `versioning.enabled` e per lo
stesso ragionamento: un peso è reversibile, non riguarda la privacy, e «questo
vault è un archivio di paper, alza gli heading» è esattamente il profilo di
vault che il §11.1 apre. Il permesso `fub:write-settings` resta il primo
cancello.

## Dove sta lo schema, e perché non dove sta quello del versioning

L'unico precedente era `versioning_settings()` in `fub_host::settings`, con le
chiavi delle stringhe dichiarate lì accanto e un commento che spiega perché non
stiano dentro la feature. Copiarlo sarebbe stato il gesto naturale, ed è
sbagliato: quel commento dice che l'interruttore del versioning è **dell'host**
— «il versioning non sa di poter essere spento» — e qui è l'opposto. Un motore
di ricerca sa benissimo di avere dei pesi, li legge lui, ed è lui a saper dire
cosa vuol dire metterne uno a zero.

Quindi schema e stringhe stanno in `fub_features::search`: `settings()` accanto
a `catalog()`, e le etichette dentro il catalogo che la feature ha già invece
che in un secondo da sommare al montaggio. Questa è la forma **normale** — un
componente che dichiara le proprie chiavi, che è esattamente ciò che scriverebbe
un plugin di terzi con un indice configurabile — e quella del versioning è
l'eccezione. Vale la pena averlo scritto in tutti e due i posti, perché una
disposizione diversa senza una ragione a fianco si legge come una dimenticanza.

C'è anche un vincolo che rendeva l'altra collocazione impraticabile, e conferma
la scelta invece di sostituirla: `fub-host` dipende da `fub-features` e non il
contrario. Se le chiavi vivessero nell'host, il provider che deve **leggerle**
non potrebbe nominarle, e sarebbero finite scritte due volte — cioè la copia che
diverge, che per una chiave di configurazione significa che il pannello scrive
dove nessuno legge.

## La duplicazione del banco, che stava per diventare una bugia

`examples/una_ricerca.rs` teneva i due pesi come costanti proprie, con un
commento che chiedeva a chi legge di non farli divergere: «se qui divergessero,
la fase 3 misurerebbe una query che nessuno esegue». Finché erano numeri cablati
era una copia di una cosa immutabile, cioè una promessa a basso rischio.

Rendendoli configurabili quella copia diventava una **bugia in attesa**: non più
la copia di una costante, ma la copia dei *default* di una chiave che qualcuno
cambia. Adesso il banco li **importa** — sono `pub` — e il commento passa da
«attenzione a non farli divergere» a «non possono divergere».

Ne segue una cosa che andava decisa e non è un dettaglio: il banco misura i
**default**, non la taratura del vault di chi lo lancia. È voluto — un banco i
cui numeri cambiano con le preferenze di chi lo esegue non è confrontabile con
la volta prima — ed è il motivo per cui importa le costanti invece di leggere le
impostazioni.

## Cosa la shell non ha dovuto fare, e la riga che invece ha dovuto

Il pannello delle impostazioni genera il form **dallo schema** e non cabla
niente: un `SettingKind::Number` con `min` e `max` diventa un campo numerico con
i suoi estremi senza che nessuno scriva una riga per queste quattro chiavi. È
andata davvero così, e vale la pena averlo verificato invece di darlo per
scontato — compreso il caso del campo svuotato, che `settings.ts` guardava già
(`Number("")` è zero, non `NaN`, e senza quel controllo svuotare la casella
avrebbe scritto uno zero in silenzio: proprio il caso che il nostro `min: 0.0`
rende accettabile dal kernel).

Una riga però è servita, e l'ha fatta emergere il fatto che questi sono i primi
numeri **frazionari** dello schema: un `input[type=number]` senza `step` sale di
uno, e `2.5` diventa un campo che il browser segna come invalido. Un peso a metà
strada fra il corpo e il titolo è esattamente il genere di taratura per cui
queste chiavi esistono. La riga è `input.step = "any"`, e «qualunque passo»
invece di un passo dichiarato perché `SettingKind::Number` ha `min` e `max` e
non ha uno `step` — aggiungerglielo sarebbe firma, a ridosso del freeze, per una
cosa che non è una regola sul dato: gli estremi li verifica il kernel, lo `step`
di un `input` è un aiuto alla digitazione.

## I presidi

- `i_pesi_arrivano_dalle_impostazioni` è il rovescio esatto di
  `page_name_outranks_body`, sugli stessi due documenti: col peso del nome a
  zero vince chi ripete il termine nel corpo. I due test insieme dicono che
  quella riga non è più una legge del motore. Lo stesso test verifica che la
  nota si trovi **comunque**, che è lo zero spiegato sopra.
- `i_pesi_si_aggiornano_a_vault_aperto` cambia il valore nell'host, annuncia
  `SettingChanged`, e riesegue la stessa query: l'ordine cambia senza riaprire
  niente. È il presidio del meccanismo intero.
- `una_chiave_che_non_e_un_peso_non_fa_rileggere` guarda il ramo del prefisso
  dal lato dell'effetto.
- `una_chiave_mai_scritta_vale_il_suo_default`: un host che di impostazioni non
  sa niente non impedisce alla ricerca di partire. Un motore che si rifiutasse
  di pesare perché un numero non si legge sarebbe un vault senza ricerca per una
  chiave assente.
- `lo_schema_dichiara_i_default_che_il_motore_usa` è il presidio della fonte
  unica: schema, costanti del motore e banco non possono più separarsi.
- `i_pesi_della_ricerca_parlano_in_tutte_le_lingue` (§12.4): il presidio
  generale dei cataloghi cammina view e comandi, cioè ciò che l'inventario sa
  dire di una feature, e le impostazioni non sono in quell'elenco — sarebbero
  passate mute. Per queste chiavi la prosa conta più dello schema: un campo
  numerico senza la frase che spiega cosa fa lo zero è un campo che qualcuno
  mette a zero credendo di spegnere la ricerca su quel campo, e ritrova le
  stesse note in un altro ordine.
