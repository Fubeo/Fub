# 0076 — Le impostazioni vivono nel vault, e la macchina tiene solo ciò che serve quando il vault non si apre

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | Revisione della [0036](0036-le-impostazioni-e-i-tre-stati.md), §11.1 ([seduta 11](../roadmap/11-impostazioni-e-i-tre-stati.md)) — la voce era già chiusa: qui cambia **dove sta un valore**, non cosa lo dichiara |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/11-impostazioni-e-i-tre-stati.md) · [le impostazioni, 0036](0036-le-impostazioni-e-i-tre-stati.md) · [il locale, 0039](0039-il-locale-e-il-caso.md)

---

La [0036](0036-le-impostazioni-e-i-tre-stati.md) ha dato alle impostazioni due
posti e una precedenza: il file del vault (`<root>/.fub/settings.json`) sopra
quello della macchina (`~/.config/fub/`), col default dello schema sotto tutti e
due. Tema, lingua, fuso, primo giorno della settimana e formato dell'ora erano
dichiarati `.per_machine()`, e le chiavi di macchina scritte dentro un vault si
ignoravano — con un avviso, ma si ignoravano.

Il posto diventa **uno, e il posto è il vault**. È la forma che ha Obsidian con
`.obsidian/`: un file visibile, copiabile, che viaggia con le note di cui parla.

## L'argomento che reggeva i due livelli, riguardato

L'argomento era questo: *un vault è dato che arriva da fuori — si scarica, si
sincronizza, lo passa un collega — e un vault che decidesse come guardi lo
schermo sarebbe un file che cambia l'interfaccia di chi lo apre.* Detto così
suona come una regola di sicurezza, e per questo non era stato discusso.

Non lo è. La differenza fra una regola di sicurezza e una precauzione è **cosa
succede quando il caso si verifica**: un vault che porta con sé un tema scuro e
una lingua inglese fa una cosa che si vede subito e si disfa in un gesto. Non
scrive nulla fuori dal vault, non concede permessi, non è irreversibile. Obsidian
vive così da sempre e nessuno lo racconta come un problema.

In cambio, quei due livelli costavano la cosa che rendeva il §11.1 poco
intuitivo: **«prima guardo qui, poi lì»**. Una precedenza è una regola che tutti
quelli che toccano una chiave devono tenere a mente, ed è il genere di regola che
si paga nel caso storto — la chiave scritta nel file sbagliato, che non ha
effetto e che a spiegare perché serve conoscere lo scope. Con un posto solo la
domanda *«perché questo vault è chiaro?»* si risponde aprendo **un** file.

Il prezzo del confronto, allora, è: una precauzione contro un danno visibile e
reversibile, contro una regola che chiunque legga la configurazione deve avere in
testa. Vince il posto solo.

## Cosa resta fuori, e perché non è un'eccezione di comodo

**Il log** (`log.level`, `log.verbose`) resta di macchina. Non perché sia più
delicato: perché è di un'altra specie. Non è una preferenza su come leggi le tue
note, è lo strumento per **diagnosticare l'applicazione**, e deve valere anche
quando un vault non si apre — che è precisamente il caso in cui serve. Una chiave
che vivesse dentro `.fub/settings.json`, in quel caso, non si potrebbe nemmeno
leggere: il livello del log sarebbe deciso dal file che non si riesce ad aprire.
È l'unico posto in cui la parola «macchina» dice qualcosa di vero e non solo di
prudente.

**Il registro dei vault** (quali conosci, i preferiti, le icone) resta fuori
anche lui, e per una ragione ancora più semplice: non è un'impostazione con uno
schema, è l'**elenco di cosa esiste**. Per definizione non può stare dentro
ciascuno degli elementi che elenca.

## `SettingScope` resta, con un cliente solo

La tentazione, con l'eccezione ridotta a due chiavi, era togliere lo scope e
scrivere il file del log a mano da qualche parte. Non si fa, e la ragione è che
il vocabolario **ha ancora il suo caso**: `log.*` non è «una chiave che per caso
sta altrove», è una chiave che dichiara di non poter dipendere da un vault
aperto, e dichiararlo nello schema è ciò che rende la cosa leggibile a chi la
incontra invece che una stranezza da scoprire nel codice che la scrive. Un
vocabolario con un cliente solo che *nomina* una proprietà vera costa una
variante di enum; lo stesso comportamento senza il vocabolario costa un ramo
speciale in ogni posto che legge o scrive una chiave.

Resta anche la riga che il kernel applica e nessun altro può applicare al posto
suo — **una chiave di macchina scritta in un `.fub/settings.json` si ignora**.
Dice una cosa più stretta di prima (un vault non alza il livello di log di chi lo
apre), ma senza di lei lo scope sarebbe un suggerimento invece di una regola.

## Ciò che è cambiato davvero nel codice: la precedenza è sparita

Il grosso della modifica non sono i cinque `.per_machine()` tolti: è che
`SettingsStore::resolve` **non scala più**. Prima una chiave di vault non trovata
nel vault scendeva al file della macchina; adesso legge il livello che dichiara,
e sotto c'è il default dello schema. Se fosse rimasta la scalata, un valore
lasciato nel file della macchina da una versione precedente — proprio il tema che
oggi scende nel vault — avrebbe continuato a vincere sul default senza che il
file del vault ne parlasse: cioè esattamente il caso storto che questa decisione
esiste per togliere, sopravvissuto alla decisione che lo toglieva.

Per la stessa ragione anche la validazione in `declare` guarda ora **solo** il
livello dichiarato. Un valore nel file sbagliato non è un valore scartato per la
sua forma — è un valore che nessuno leggerà mai, e diagnosticarlo come «ignorato
(livello Machine)» manderebbe a cercare il difetto dalla parte opposta.

Il resto è conseguenza: `appearance.theme` e le quattro `locale.*` perdono lo
scope, e la precedenza del locale — che la [0039](0039-il-locale-e-il-caso.md)
aveva scritto come *vault → macchina → ciò che la shell riporta → default* —
diventa **vault → ciò che la shell riporta → default**. Il gradino di mezzo se ne
va senza che il resto si muova, e non è un caso: era il livello che non decideva
mai da solo.

## La finestra senza vault non ha bisogno di un livello di riserva

Era l'obiezione più concreta: se le impostazioni stanno nel vault, cosa guarda
l'app **prima** che un vault sia aperto? Niente di nuovo. Tema e lingua hanno già
`AS_SYSTEM` come valore di fabbrica — cioè *chiedilo a chi sta sotto* — quindi
senza vault l'app segue il sistema operativo, e appena se ne apre uno prende le
sue. Il livello macchina non era la risposta a questa domanda: la risposta era
già nel default, e il livello macchina ci si appoggiava sopra.

## Ciò che resta scoperto, e va detto

Il prezzo vero di questa decisione non è nessuno dei due sopra: è che **un vault
nuovo riparte dalle impostazioni di fabbrica**. Chi ha passato mezz'ora a
sistemare tema, lingua e formato dell'ora li ritrova azzerati la prima volta che
crea un secondo vault, e non ha modo di dire «come l'altro».

Si addolcirà, e si sa già come: un vault **appena creato** parte con una
**copia** delle impostazioni dell'ultimo aperto. Una copia esplicita al momento
della creazione — un file scritto una volta, che da lì in poi è suo e diverge — e
non una regola di precedenza nascosta, che sarebbe la cosa appena tolta rientrata
dalla porta di servizio. Non è fatto qui: qui è nominato, perché una cosa scoperta
che ha un nome è un lavoro, e una senza nome è una sorpresa.
