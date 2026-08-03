# 0073 — Una condizione che nessuno valuta è una scadenza senza data

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §16.3 (seduta 16) — non la voce, ma **la condizione** che ne tiene fuori il secondo tempo |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) · [il primo tempo](0071-una-feature-si-spegne-dove-si-dichiara.md) · [un numero si scrive accanto a come si ricava](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) · [un elenco che è la sorgente](0056-un-elenco-che-e-la-sorgente.md)

---

La [0071](0071-una-feature-si-spegne-dove-si-dichiara.md) ha chiuso il primo
tempo del §16.3 e ha lasciato il secondo — lo split di `fub-features` in un crate
per bundle — fuori con una condizione al posto di una scadenza: **il primo import
fra due moduli di feature che non sia un link di documentazione**.

Era la mossa giusta, e questo verbale non la ridiscute. Riguarda ciò che le
mancava: **chi si accorge che la condizione è scattata.** La risposta, fino a
oggi, era nessuno. La condizione viveva in due paragrafi di italiano — uno nella
roadmap, uno in un verbale — e la sola cosa che potesse farla notare era che
qualcuno ripassasse di lì e rifacesse il grep a mano. Che è esattamente ciò che è
successo per arrivare a questo verbale, ed è la dimostrazione del difetto e non
della sua assenza.

## La decisione

**La condizione della §16.3 è presidiata:
`crates/fub-features/tests/i_moduli_non_si_parlano.rs` chiede che nessun modulo
di feature nomini `crate::`, e quando è rosso dice che la voce si è sbloccata.**

Il presidio gira nel `cargo test --workspace` e ha un passo suo in CI, accanto a
quelli che la 0071 aveva messo lì. La misura di partenza: i moduli di feature
sono **otto** [conta: moduli-di-feature], e i riferimenti incrociati nei sorgenti
sono **sei**, tutti doc-comment che linkano `backlinks::catalog`. Nessun `use`.
La condizione non era scattata, e adesso non può scattare in silenzio.

## Le decisioni prese, da NON ridiscutere senza motivo

### Il compilatore lo sa già fare, e non basta — per la ragione meno ovvia

La 0071 lascia un criterio che qui andava applicato prima di scrivere qualunque
riga: *il presidio migliore non è un controllo in più, è la stessa cosa che si
dichiara letta da chi la usa; cerca il confine che il compilatore già sa far
valere prima di scrivere un test che grep-pa i sorgenti.* Quel confine c'è, e
c'è per merito del primo tempo: ogni modulo sta dietro il suo `#[cfg]` in
`lib.rs`, quindi nella build della sola `outline` — che la 0071 ha già messo in
CI — un `use crate::search::…` dentro `outline.rs` **non compila**. Verificato:

```
error[E0432]: unresolved import `crate::search`
note: found an item that was configured out
  46 | #[cfg(feature = "search")]
```

E prende anche la strada che un grep sul nome del modulo non vedrebbe, cioè
`use crate::SEARCH_ID` attraverso i `pub use` della radice: stesso errore, sullo
stesso `cfg`.

Poi si guarda **cosa succede a chi legge quell'errore**, ed è lì che il confine
si sfila. Chi voleva quell'import non rinuncia all'accoppiamento: gli mette
davanti un `#[cfg(feature = "search")]`, perché è la riparazione che il messaggio
suggerisce e perché senza le build parziali si rompono davvero. Verificato anche
questo: con il `cfg` davanti, la build della sola `outline` passa, la build piena
passa, `le_cargo_feature` passa — **tutto verde**, e l'accoppiamento
feature↔feature c'è per intero.

È il punto che vale oltre questo caso. La forma che evade il confine non è quella
distratta: è quella **attenta**, ed è il confine stesso ad averla insegnata.
Misurare un presidio su chi lo ignora dice poco; misurarlo su chi lo rispetta
diceva tutto, e quello che diceva è che qui non arriva.

Quindi il criterio della 0071 non è stato scartato: è stato applicato, e la
risposta è che il confine del compilatore copre la metà distratta. La domanda va
posta anche ai sorgenti, e va posta **prima del `cfg`**, dove un `#[cfg]` davanti
non nasconde niente. I tre `build` restano dove sono — comprano un'altra cosa,
che le feature si spengano davvero.

### La regola è più larga della condizione, e questo è il disegno

Non si cercano gli import *verso un altro modulo di feature*: si chiede che un
modulo di feature **non nomini `crate::` affatto**. È una soglia più severa di
quella che la condizione descrive, e la differenza è voluta per tre ragioni.

- **Non ha bisogno di sapere chi c'è.** Non c'è un elenco dei moduli da tenere
  allineato, quindi non c'è il difetto della
  [0056](0056-un-elenco-che-e-la-sorgente.md) scritto una volta di più: il banco
  guarda i file che trova in `src/`, e un nono modulo è coperto il giorno in cui
  qualcuno lo scrive.
- **Non ha bisogno di riconoscere le forme.** `crate::search::X`, `crate::X`
  dalla radice, un `use crate::{…}` con la graffa: sono la stessa cosa e si
  contano allo stesso modo, invece di essere tre pattern da indovinare — cioè
  tre occasioni di lasciarne fuori uno.
- **È ciò che la voce dice di volere.** Un modulo di feature è ciò che diventerà
  un crate a sé. Dentro un crate a sé quel `crate::` non si può scrivere, perché
  la radice che nomina è precisamente il confine che lo split disegnerà. La
  soglia larga non è severità in più: è il futuro della voce, chiesto oggi.

Oggi le due coincidono comunque — l'unica altra cosa nella radice sono i
`pub use` delle feature stesse — quindi la severità in più non costa niente a
nessuno.

### Un modulo condiviso si circoscrive, e la soglia non si tocca

Era la domanda di disegno da porre bene: un `use` fra moduli di feature è
*sempre* il segnale che la voce si sblocca, o esistono casi legittimi — un
helper, un tipo comune — che non lo sono?

Esistono, e la risposta non è ammetterli in blocco né indebolire la soglia. Il
banco ha una costante `RADICE` con i file che non sono moduli di feature
(`lib.rs`, che è la radice; `inventario.rs`, che è l'aggregatore e importa tutti
e otto **per definizione**, essendo l'elenco di cosa esiste). Il giorno in cui
nasce un `comune.rs` legittimo, entra lì con la sua ragione scritta accanto: «i
moduli di feature non si parlano» resta vero e diventa vero *rispetto a un
vocabolario dichiarato*.

È la mossa che la 0071 ha chiamato per nome col conto `viste > 0`: un presidio
che diventa rosso per un caso nuovo e legittimo non si indebolisce, si
circoscrive — la soglia resta, cambia la condizione in cui gli si fa la domanda.
E la differenza pratica è che aggiungere una riga a `RADICE` è un atto che si
vede in diff e che chiede una ragione, mentre ammettere «gli helper» in astratto
sarebbe stato un buco che nessuno avrebbe più richiuso.

### Rosso vuol dire «vieni a leggere», non «hai sbagliato»

È l'unica cosa che questo presidio ha di diverso da tutti gli altri del repo, e
sta nel messaggio, non nel codice. Ogni altro banco che diventa rosso accusa chi
ha appena scritto; questo gli **consegna una voce di roadmap**. Il messaggio
apre dicendo che non è un errore, spiega cosa il §16.3 aspettava e perché, elenca
i punti trovati, e dà tre strade in ordine: leggi la voce e la 0071; se è
accoppiamento vero, lo split è il lavoro; se è un helper condiviso, mettilo in
`RADICE`.

E chiude con la sola cosa che non va fatta — togliere l'assert per tornare
verdi — perché è la reazione più probabile di chi incontra un test che non
capisce, ed è quella che butterebbe via l'unica informazione che il presidio
esiste per produrre. Il verde di prima diceva *i moduli non si parlano*: se non è
più vero, il verde non si ricompra, si spende.

### Lo scanner si prova su una trappola, e le due specie di errore non pesano uguale

`solo_codice` toglie commenti di riga, commenti a blocco annidati e stringhe. I
commenti perché la condizione li esclude alla lettera e perché i sei riferimenti
che esistono oggi sono tutti doc-comment: un presidio che contasse la prosa
sarebbe nato rosso — l'inciampo in cui la
[0057](0057-la-dieta-dell-ipc.md) era già caduta contando `#[tauri::command]`
dentro i commenti.

Le stringhe per una ragione meno visibile e più cattiva: una `"https://…"` fa
partire un finto commento di riga che si mangia il resto della riga, cioè
nasconde un `use` vero. Contare un commento è un falso rosso e qualcuno se ne
accorge subito; **mancare** un `crate::` è un falso verde che dura per sempre.
Il secondo test dà allo scanner un sorgente finto con dentro tutte e due le
trappole — la stringa con l'URL, il blocco che si chiude a metà riga seguito da
un `use` vero, l'import dietro il `cfg` — e pretende esattamente due
sopravvissuti.

Le tre forme sono state provate anche sul banco vero, mutando `outline.rs` e
guardandolo diventare rosso: `use crate::search::SEARCH_ID`,
`use crate::SEARCH_ID` e la versione guardata dal `cfg`. La terza è quella che
nessun altro presidio del repo prende.

## Cosa resta fuori, e perché

**Lo split in crate resta fuori, e la sua ragione non è cambiata di una virgola.**
Questo verbale non chiude né la voce né mezza voce: la §16.3 resta aperta con la
stessa casella di prima. Ciò che cambia è che la casella adesso ha un guardiano,
e che il giorno in cui si sblocca lo si saprà in CI invece che per fortuna.

Ed è la novità di processo, che vale la pena dire perché l'indice delle decisioni
finora non aveva questa specie: **un verbale che non chiude niente.** La
[0031](0031-chi-possiede-i-bundle.md) aveva inaugurato il verbale che chiude
mezza voce; questo decide qualcosa *su* una voce aperta senza spostarne lo stato.
Il criterio per quando ne serve uno è lo stesso di sempre — c'è una decisione che
qualcuno rischia di ridiscutere, e la sua ragione non stava già scritta da
nessuna parte.

**Non si è esteso il `build` a tutte e otto le feature.** Compilare ogni bundle
da solo estenderebbe il confine del compilatore da una feature a otto, costa
poco (~2,4 s a cache calda, e l'unico grafo pesante è `search`, che CI compila
già), ed è stato scartato lo stesso: comprerebbe un sottoinsieme di ciò che il
banco sui sorgenti prende già, e lascerebbe fuori la stessa cosa — l'import
guardato dal `cfg`. Otto comandi in CI per una copertura più piccola sono un
costo senza compratore, che è la stessa frase con cui la voce tiene fuori lo
split.

**Il presidio non dice se l'accoppiamento sia grave.** Dice che c'è. Distinguere
un helper di tre righe da una dipendenza vera è un giudizio, e il posto dove si
esercita è la voce di roadmap che il messaggio consegna — non un'euristica dentro
un test, che sarebbe un modo elaborato di decidere in anticipo la cosa che si
vuole andare a guardare.

## I precedenti

**Una condizione che nessuno valuta è una scadenza senza data.** La §16.3 aveva
fatto la cosa giusta a rifiutare una scadenza — «lo split entro M5» sarebbe stato
un numero inventato — ma una condizione che vive solo in italiano non è il suo
contrario: è una scadenza che non arriva mai, perché il momento in cui scade è
proprio il momento in cui nessuno la sta guardando. La
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) ha censito questa
famiglia per i **numeri**; questo verbale la estende alle **condizioni**, ed è la
stessa forma: ciò che una frase promette, qualcuno lo deve rifare.

**Il motivo per cui si scrive una condizione è smettere di doverci pensare.** Se
per sapere se è scattata bisogna ricordarsene e rifare il grep a mano, la
condizione non ha comprato niente rispetto a «ogni tanto guarda se i moduli si
parlano» — ha solo scritto meglio la cosa a cui bisogna pensare. Il presidio è
ciò che rende vera la promessa che la condizione faceva.

**Un confine si misura su chi lo rispetta, non su chi lo ignora.** È il precedente
più esportabile di questo verbale. Il `#[cfg]` è un confine vero, prende la
violazione distratta, e viene aggirato dalla riparazione che esso stesso
suggerisce — non da un aggiramento deliberato. Prima di accettare un presidio
perché «il compilatore lo prende», vale la pena scrivere la violazione, leggere
l'errore, applicare la correzione che l'errore chiede, e guardare se a quel punto
è ancora rosso. Qui non lo era.
