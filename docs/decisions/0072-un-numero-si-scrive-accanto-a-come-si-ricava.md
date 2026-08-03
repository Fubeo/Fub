# 0072 — Un numero si scrive accanto a come si ricava

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §16.8 (seduta 16) — la prosa che conta i sorgenti non ha nessun presidio |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) · [l'elenco che è la sorgente](0056-un-elenco-che-e-la-sorgente.md) · [le regole in un posto solo](0020-le-regole-in-un-posto-solo.md) · [una feature si spegne dove si dichiara](0071-una-feature-si-spegne-dove-si-dichiara.md)

---

Questa voce è nata da una separazione: era la seconda metà del §16.7, e chiudere
quello con la [0056](0056-un-elenco-che-e-la-sorgente.md) ha mostrato che il
difetto era sì lo stesso — un elenco che smette di dire il vero senza diventare
rosso — ma il presidio no. Ciò che la 0056 ha chiuso sono insiemi che un test
estrae dai sorgenti; ciò che restava qui è **un'affermazione scritta in italiano
dentro un documento**, che nessun compilatore legge.

E restava con un censimento già fatto: quattro famiglie di numeri falsi trovate
da un giro dedicato, altre quattro trovate chiudendo il §16.7 in mezza giornata,
due dalla mezza voce del §17.1, cinque da un giro di verifica, più un bersaglio
meccanico. Nessuno di questi ha mai rotto un test.

Questo verbale chiude la voce, ed è l'ultima viva della seduta 16.

## La decisione

**Un numero che afferma qualcosa sui sorgenti si scrive accanto al nome del
comando che lo ricava, e il presidio rifà il conto.**

    le **quattordici** famiglie di capacità [conta: guard-famiglie]

- `.github/scripts/conteggi.mjs` è il registro: una voce per conteggio, con il
  `comando` che lo ricava dai sorgenti e la `ragione` per cui quel numero conta.
  Oggi sono dieci voci.
- `.github/scripts/check-prosa.mjs` esegue ogni comando **una volta** e lo
  confronta con **ogni** posto che cita quel nome, in tutte e due le direzioni:
  un numero che cambia nel codice diventa rosso, e una voce che nessuna prosa
  cita più diventa rossa anche lei.
- Lo stesso script porta il secondo controllo, che non è un conteggio: **una
  frase che dice *questo è presidiato da X* deve nominare un X che esiste**, dove
  `X` è un `fn` o un file di test.
- `check-doc-links.mjs` impara a leggere il `:N`: un link che porta `abi/model.rs:600`
  ora verifica anche che **a quella riga ci sia ancora la cosa che la voce
  nomina**, e quando non c'è dice dove è finita.
- Tre passi nuovi nel job `docs` della CI. Il primo è l'autoprova del lettore dei
  numeri, e sta prima degli altri per una ragione precisa, scritta più sotto.

## Le decisioni prese, da NON ridiscutere senza motivo

### Il registro tiene i comandi, non i valori

È la differenza che decide se il presidio funziona una volta o per sempre. Il
censimento ha trovato **due numeri falsi il giorno in cui sono stati scritti** —
«un terzo crate per otto funzioni» quando le funzioni erano già quattordici, e un
conteggio di link falso di uno nel commit stesso che lo misurava. Un numero
invecchiato si aggiorna; uno che non è mai stato ricavato dalla sua sorgente si
aggiorna **e torna falso al giro dopo**, perché a scriverlo è sempre la stessa
mano che ha misurato a occhio.

Tenere i valori nel registro avrebbe spostato il problema di un file: qualcuno
avrebbe scritto `valore: 34` accanto al comando, e la prima volta che i due
divergono si sarebbe corretto il valore. Tenendo solo il comando, la domanda
«quanti sono» ha una sola risposta possibile, e non è un'opinione di nessuno.

### L'annotazione è testo semplice, e non un commento di markdown

Un `<!-- conta: … -->` funzionerebbe nei `.md` e in nessun altro posto, e ne
mancherebbe metà: **la prima falsità del censimento stava in un commento di
`guard.rs`**, cioè nello stesso file del codice che descriveva, e ripetuta tre
volte. La distanza fra la frase e la cosa non è la ragione per cui una frase
invecchia — la ragione è che nessuno la ricalcola.

Che l'annotazione si veda anche a documento reso è voluto. Chi legge «le
quattordici famiglie [conta: guard-famiglie]» sa due cose in più: che quel numero
è ricavato e non ricordato, e dove andare a vedere come. È la stessa disciplina
con cui ogni riga dell'allowlist di `dieta_ipc.rs` porta la sua ragione.

### Il numero sta sulla stessa riga dell'annotazione

Il lettore prende **l'ultimo numero prima** dell'annotazione e non guarda la riga
sopra. Sembra una rigidità e non lo è: la frase che porta un conteggio spesso ne
porta due («3400 righe di cui 1697 di commento»), e un lettore che vada a capo
sceglierebbe fra numeri che stanno in frasi diverse. Scrivere il presidio ha
prodotto subito tre di questi casi — tre annotazioni finite a capo, che il
presidio ha segnalato al primo giro con «non c'è nessun numero prima
dell'annotazione». Un errore che si vede è meglio di una regola che indovina.

### Il lettore dei numeri ha un test suo, e gira per primo

Qui la parte fragile non è il confronto: è che **questi documenti i numeri li
scrivono in lettere**. «Le quattordici famiglie», «ne conta ventitré»,
«trentaquattro oggi». Un presidio che sapesse leggere solo `14` non guarderebbe
la prosa — guarderebbe le tabelle, che sono la parte che invecchia di meno.

Quindi c'è una tabella dei numerali italiani da zero a cento, con l'elisione
(`ventuno`, non `ventiuno`) e l'accento (`ventitré`), e c'è `--autoprova` che la
verifica su dieci casi presi dalla prosa vera. Sta come primo passo del job
perché se il lettore si spegnesse, il controllo direbbe «nessun numero» o
peggio direbbe verde: **un presidio che si spegne in silenzio è il difetto di
questa voce fatto al presidio stesso**. È la stessa ragione per cui
`check-doc-links.mjs` esce rosso quando ha controllato zero file.

### Il `:N` di un link si verifica col nome che c'è già accanto

È l'unica specie di questa voce che non ha bisogno che qualcuno dichiari come si
ricava: il link il file lo apre già, e il nome della cosa è scritto lì di fianco
fra backtick — `Anchor`, `LinkTarget::Wiki`, `HostQuery::query_index`. Il
controllo chiede solo che uno di quei nomi sia ancora **a quella riga**.

Due raffinamenti che non sono dettagli, perché senza sarebbe un presidio che dà
consigli sbagliati:

- **Un percorso non è un simbolo.** `.fub/workspace.json` non si cerca dentro
  `organization.rs`: cercarlo troverebbe un `workspace` qualsiasi a riga 1 e
  chiamerebbe verde un link stantio.
- **Si suggerisce la definizione, non la prima occorrenza.** `Block` compare
  cinquanta volte in `model.rs`, quasi tutte in un commento. Suggerire la prima
  vorrebbe dire riparare un numero stantio con un altro numero stantio — il
  difetto di questa voce, fatto a macchina.

Il risultato è che il presidio ripara da sé: dei **51** link stantii trovati, 49
si sono corretti leggendo il numero che lo script stesso stampava.

### Un verbale è prosa datata, e non si presidia

Né i conteggi né le garanzie si controllano dentro `docs/decisions/`. Un verbale
dice cos'era vero il giorno in cui è stato scritto, e la sua promessa è quella —
non «questo è vero oggi». La regola non è una scappatoia: è la sola sotto cui un
verbale può raccontare un nome che è cambiato, o citarne uno per dire che non
esisteva, che è esattamente ciò che la [0053](0053-il-contratto-ha-una-sorgente.md)
e la [0060](0060-il-modello-dice-il-vero-sui-byte.md) fanno — e sono stati i due
soli rossi rimasti quando il controllo delle garanzie ha girato la prima volta.

Il rovescio: un numero **dentro un verbale che parla al presente** va riscritto
al passato («allora ne contava otto»), non annotato. Chi scrive un verbale non
sta promettendo manutenzione.

### Le garanzie si guardano solo dove si dichiarano

Il controllo dei nomi non passa su tutte le frasi che nominano una funzione: un
documento ne nomina cento, e metà sono quelle che *non* esistono ancora ed è il
punto di nominarle. Passa sulle righe che dicono «presidio», «presidiato»,
«verificata da» — cioè dove qualcuno sta dichiarando una rete tesa. È lì che il
censimento ha trovato la specie peggiore: **la garanzia che non è mai esistita**,
nel cappello di una seduta, che diceva che una certa cosa violerebbe
un'invariante presidiata da un file che non nominava quel crate da nessuna parte.

Le altre specie sono una descrizione invecchiata di qualcosa che esiste; questa
no, e non c'è niente da aggiornare perché non c'è mai stato niente. Nessuno se ne
accorge, perché **il motivo per cui si scrive una garanzia è smettere di doverci
pensare**: un conteggio prima o poi qualcuno lo ricontrolla, una rete che si
crede tesa non la guarda nessuno.

## Cosa il presidio ha trovato accendendolo

Non è un elenco di riparazioni: è la misura di quanto la famiglia fosse fitta il
giorno in cui il conto ha smesso di essere a mano.

| Cosa | Diceva | È |
|---|---|---|
| gli `SCHEMA_VERSION` su disco, in [versionamento.md](../versionamento.md) | sette | **otto** — e è il numero il cui errore non si annulla, perché la promessa è ai file dell'utente |
| i `console.warn`/`console.error` della shell, nella [leva](../roadmap/leva.md) | quattordici | **sedici** — un numero che deve *scendere*, e che era risalito |
| le righe di commento di `abi.wit`, in [M4](../milestones/M4-wit-hardening.md) | 1683 su 3386 | **1758 su 3502** |
| `safety::notifying`, in [plugin-boundary.md](../architecture/plugin-boundary.md) | «una riga su stderr» | si chiama **`reporting`** e *restituisce* il panico — la sesta specie, smentita da un verbale a due file di distanza |
| i numeri di riga nei link | quindici stantii, stimati | **cinquantuno**, contati |

I tre numeri che il censimento accusava e che qualcuno aveva già corretto — le
famiglie del varco, i metodi dell'`HostApi`, le strutturali — sono stati
annotati: la riparazione non li teneva fermi, il presidio sì.

## Cosa resta fuori, e perché

- **Un linter di prosa non esiste**, e non è ciò che si è scritto. Il presidio
  non capisce le frasi: verifica i numeri che qualcuno ha dichiarato ricavabili
  e i nomi che qualcuno ha dichiarato presidianti. Ciò che nessuno annota resta
  prosa, e va bene così — la mossa è rendere **possibile** legare un numero alla
  sua sorgente, non obbligatorio.
- **I trenta link con un `:N` e nessun nome accanto** non si verificano, e il
  conto in fondo lo dice invece di far finta. Aggiungere il nome è lavoro di chi
  passa di lì; inventarlo sarebbe un presidio che indovina.
- **La seconda metà che i conteggi non coprono — gli elenchi che rimandano.**
  Una riga di [strozzature.md](../roadmap/strozzature.md) invecchia quando
  qualcosa si chiude *altrove*, e un giro ne aveva trovate diciassette false su
  ottantasette. Il collegamento è verificabile — un `§X.Y` chiuso, un simbolo che
  non esiste più — ma il giudizio che la riga porta no, e il presidio giusto
  chiede di decidere prima cosa significa «chiusa» per una strozzatura. Resta
  aperto, e resta scritto nella voce.
- **Il numero di questa riga.** Il conteggio dei file e dei link di
  `check-doc-links.mjs`, che la §16.7 ha visto falsificarsi otto volte, **non**
  è entrato nel registro: dipende anche da cosa c'è nell'albero di lavoro, e un
  numero che cambia a ogni `.md` non tracciato in radice non è una promessa che
  valga la pena presidiare. È scritto nella voce come coda, ed è il solo posto in
  cui questa famiglia si racconta da sé.

## I precedenti

La forma è quella della [0020](0020-le-regole-in-un-posto-solo.md) —
`rules_mirror.rs` → `rules-samples.json`, un posto in cui scriverlo e due da cui
leggerlo — applicata alla prosa invece che alle regole. La disciplina delle due
direzioni è quella di `dieta_ipc.rs` e di `ALLOWED_TRANSITIVE_ABI`: un elenco che
resta lungo mentre il codice si accorcia smette di essere una fotografia e
diventa un ricordo.

E c'è il precedente della [0071](0071-una-feature-si-spegne-dove-si-dichiara.md),
che è questa voce vista **dal lato in cui la prosa falsa si crea**: sei righe che
contavano gli otto bundle, tutte vere fino al commit che ha reso quel numero
condizionale. Quel verbale ne ha ricavato il criterio — chi rende condizionale un
conteggio è l'unico che sa dove sono le righe che lo ripetono. Questo ne ricava
il complemento: **finché il numero sta in una riga e la sua sorgente in un'altra,
quel criterio dipende da chi si ricorda di applicarlo.** Da qui in poi no.

La 0071 lascia anche l'osservazione che ha fatto scegliere questa forma: cargo
rifiuta il manifest se `default` nomina una feature che non c'è, cioè un presidio
migliore di quello che si stava scrivendo, perché non è un controllo in più — è
la stessa cosa che si dichiara, letta da chi la usa. Il registro dei conteggi è
il più vicino che si potesse arrivare a quello per la prosa: il numero non si
scrive due volte, si scrive una volta e si cita.
