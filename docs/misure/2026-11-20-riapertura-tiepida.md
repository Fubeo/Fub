# La riapertura tiepida che non scatta

Quanto costa riaprire un vault già aperto prima, dove va il tempo, e quanto
si risparmierebbe se i documenti non toccati non si rileggessero
(issue #521).

> **Per chi:** chi lavora sull'apertura del vault, sugli indici delle
> feature o sul contratto `IndexProvider`.
> **Risultato:** su `f4ed55641` ogni riapertura rilegge, rianalizza e
> rialimenta ogni documento. Se la riapertura tiepida scattasse, la fase
> d'indicizzazione passerebbe da 727 a 117 ms su 5000 note ricche e da
> 1183 a 241 ms su 30000 note piccole: l'apertura intera scende del 35–58 %,
> il picco di memoria dell'8–27 %. Solo l'indice dei promemoria ha davvero
> bisogno del corpo: tre dei quattro indici in memoria non tengono niente per
> documento.

## Macchina e sistema

- build di rilascio di `f4ed55641` (`integra/editor-3`) con una sonda di
  misura, 20 novembre 2026, misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, disco ext4; Debian 13;
- ogni apertura è un processo nuovo (`Host::without_watcher`), come un riavvio
  dell'app; le corse passano dalla coda dei controlli pesanti con `nice 19`;
- carico medio a un minuto: fra 10 e 14 nella corsa delle tabelle, fra 21 e
  48 nella terza corsa, che serve per i promemoria e per le fasi in più
  (caricamento dell'anagrafe, flush finale); i suoi totali sono rumorosi e
  non entrano nelle tabelle.

## Il metodo

- **La sonda** (fuori dal repository) aggiunge span `tracing` di target
  `fub.apertura` alle fasi che gli span di sempre non separano: la lettura
  (`prepare_index_batch_parse`), il parse, la presa del core, l'alimentazione
  di ogni indice per nome, la domanda `up_to_date` per indice, il caricamento
  dell'anagrafe, l'apertura della ricerca e il flush finale. Il subscriber è
  quello di `crates/fub-host/examples/open_30k.rs`.
- **La forzatura** (`FUB_MISURA_FORZA=1`, solo nella sonda) fa saltare a
  `up_to_date_handles` ogni indice tranne `fub.search`: l'intersezione diventa
  la risposta della sola ricerca, che è durevole. Non è una correzione: serve
  solo a dare il numero, e rompe i promemoria (vedi sotto).
- **I vault**, generati in una cartella temporanea:
  - `cinquemila`: la disposizione di `crates/fub-host/tests/vault_cinquemila.rs`,
    5000 note da una riga;
  - `ricche`: 5000 note da circa 3 KB, con frontmatter, sei sezioni, link,
    tag, citazioni e dodici compiti l'una;
  - `trentamila`: 30000 note di `open_30k.rs`, un titolo, due tag e due link;
  - `promemoria`: 200 note con un compito aperto e un `⏰`.
- **Il giro** per ogni vault: un'apertura a freddo, quattro riaperture con il
  codice com'è (`base`), quattro forzate, poi 50 note toccate ad app chiusa,
  una riapertura forzata e una normale.
- «apertura» è `Host::open`, «indice» è `wait_indexed`; il picco è `VmHWM`.

## Quanto costa la riapertura, e quanto costerebbe

Mediana delle quattro riaperture, in millisecondi.

| Vault | Freddo | Riapertura com'è: apertura + indice | Forzata: apertura + indice | Risparmio | Picco com'è → forzata |
|---|---|---|---|---|---|
| `cinquemila` | 437 | 143 + 119 = 262 | 143 + 28 = 171 | 91 ms, 35 % | 61 → 56 MB |
| `ricche` | 1093 | 299 + 727 = 1026 | 318 + 117 = 435 | 591 ms, 58 % | 373 → 286 MB |
| `trentamila` | 1704 | 575 + 1183 = 1758 | 617 + 241 = 858 | 900 ms, 51 % | 578 → 422 MB |

Le quattro riaperture normali di ogni vault stanno entro il 4 % l'una
dall'altra; le forzate oscillano di più in proporzione (su `cinquemila`
l'indice va da 24 a 34 ms), ma il loro indice resta sotto un terzo di
quello attuale.
La riapertura costa quasi quanto la prima apertura: su `ricche` il 94 %,
su `trentamila` più del freddo, perché in più carica l'anagrafe.

## Dove va il tempo di una riapertura com'è

Una riapertura `base-2`, in millisecondi; le fasi si sovrappongono in parte
(la lettura e il parse girano su più thread).

| Fase | `cinquemila` | `ricche` | `trentamila` |
|---|---|---|---|
| caricare l'anagrafe (`entries.json`), terza corsa | 17 | 142 | non misurato |
| scansione (`scan_vault`) | 28 | 50 | 210 |
| domanda `up_to_date`, tutte le fette | 4 | 9 | 39 |
| lettura dei sorgenti | 35 | 65 | 255 |
| parse | 33 | 92 | 207 |
| presa del core (metadati, tag, link) | 13 | 305 | 224 |
| alimentazione di `fub.search` | 3 | 47 | 37 |
| alimentazione di `fub.tasks` | 0,1 | 9 | 0,8 |
| alimentazione di `fub.base`, `fub.draw`, `fub.proof` | 0 | 0 | 0 |
| grafo (`graph_sources` + `rebuild_graph`) | 4 | 55 | 88 |
| scrivere l'anagrafe (`store_entries`) | 31 | 94 | 255 |

- Le fette sono 10 su 5000 note e 59 su 30000: con la forzatura nessuna.
- La ricerca risponde «ce l'ho» per tutti i documenti: lo si vede perché la
  domanda arriva anche al secondo indice (`fub.tasks`), che risponde vuoto e
  chiude l'intersezione. La ricerca poi non riscrive niente in tantivy
  (l'impronta del modello combacia): il suo lavoro è già tiepido.
- Il risparmio vero non è l'alimentazione degli indici (3–57 ms) ma la
  lettura, il parse e la presa del core, che la strada tiepida sostituisce
  con `restore` dai metadati dell'anagrafe.

## Chi blocca, e perché

`up_to_date_handles` (`crates/fub-kernel/src/index/mod.rs`) interseca le
risposte di tutti gli indici registrati. Nell'host di serie sono cinque:

| Indice | Cosa tiene per documento | `up_to_date` |
|---|---|---|
| `fub.search` (`SearchIndex`) | testo, campi, impronte, su disco | sì, dalle impronte del manifest |
| `fub.tasks` (`ReminderIndex`) | i promemoria dei compiti aperti, dal **corpo** | default: vuoto |
| `fub.base` (`BaseIndex`) | niente: `on_documents_indexed` non fa nulla | default: vuoto |
| `fub.draw` (`DrawIndex`) | niente | default: vuoto |
| `fub.proof` (`ProofIndex`) | niente | default: vuoto |

Il primo «mandami tutto» svuota l'intersezione. Solo `ReminderIndex` ha
davvero bisogno di vedere i documenti; gli altri tre rispondono «mandami
tutto» per default e poi buttano ciò che ricevono.

**La forzatura rompe i promemoria in silenzio.** Sul vault `promemoria` le
riaperture normali danno 200 promemoria; le quattro forzate ne danno 0, e
dopo 50 note toccate ne danno 50, cioè solo quelli delle note rilette. Nessun
errore, nessuna perdita dichiarata: l'indice è vuoto e risponde come un
vault senza compiti. È il caso che la strada scelta deve rendere
impossibile.

## Le strade

### a. Gli indici in memoria diventano durevoli

Ogni indice che tiene stato per documento lo scrive con `flush` nel suo
spazio dati, con la versione di schema e l'impronta del sorgente da cui lo ha
ricavato, lo ricarica in `activate` e implementa `up_to_date` come
`SearchIndex`.

- **Pro:** nessun contratto cambia (`activate`, `flush`, i `data_*` e
  `up_to_date` ci sono già); l'owner resta la feature; è il modello già
  provato dalla ricerca.
- **Contro:** applicata a tutti e quattro è lavoro sprecato: tre non hanno
  niente da scrivere. Per i promemoria è un file in più nello spazio dati.
- **Rischi:** dati vecchi se l'impronta non è quella del sorgente (si
  confronta la revisione dichiarata dal kernel, come fa la ricerca); schema
  cambiato (il file è derivato: versione diversa → si butta e si rilegge,
  nessuna migrazione); memoria invariata; compatibilità piena, il default
  resta «mandami tutto».

### b. Gli indici si alimentano dai metadati ricordati

Alla riapertura il kernel passa agli indici in memoria un modello rifatto
dall'anagrafe (`StoredMeta`: frontmatter, outline, link, ancore, nomi dei
tag), senza rileggere il sorgente.

- **Pro:** zero stato nuovo nelle feature.
- **Contro:** `StoredMeta` non ha il corpo, e l'unico indice che ne ha
  bisogno, `ReminderIndex`, legge proprio il corpo (`reminders_of` cammina i
  blocchi delle liste). Un modello senza corpo gli toglierebbe tutti i
  promemoria: lo stesso guasto della forzatura. Per farlo funzionare
  servirebbe o mettere nell'anagrafe del kernel dati di una feature (owner
  sbagliato), o un metodo nuovo del trait per i «documenti ripresi» con un
  tipo nuovo, cioè `fub-abi` e WIT, una forma nata da un caso solo.
- **Rischi:** un indice che legge il corpo diventa stantio senza
  accorgersene; costo di memoria per i modelli rifatti.

### c. Chi non tiene niente lo dice, e i promemoria diventano durevoli (consigliata)

Due passi, nessun contratto nuovo:

1. `BaseIndex`, `DrawIndex` e `ProofIndex` implementano `up_to_date`
   rispondendo con gli id di tutti i documenti che ricevono: non tengono
   niente per documento, quindi niente può restare indietro. La conformità
   (`up_to_date_only_reported_what_it_saw`) resta vera: a un elenco vuoto
   rispondono vuoto. Va solo aggiunta una frase al doc di `up_to_date` in
   `crates/fub-abi/src/traits/index_provider.rs`: chi non tiene stato per
   documento può dire di averli tutti.
2. `ReminderIndex` diventa durevole come nella strada a: i promemoria per
   documento sono pochi byte, con la revisione del sorgente accanto.

- **Owner:** le tre feature per il passo 1, `fub-features/src/tasks` per il
  passo 2. Il kernel non cambia.
- **Contratti:** nessuno; WIT, IPC e formati del kernel restano uguali. Nasce
  un file derivato nello spazio dati di `fub.tasks`, con versione di schema.
- **Pro:** prende tutto il risparmio misurato; il rischio sta in un indice
  solo, piccolo.
- **Contro e rischi:** un indice nuovo che domani tiene stato e copia la
  risposta «ho tutto» resterebbe indietro: lo deve fermare il test qui sotto.
  Un plugin WASM con un indice continuerà a rendere la riapertura fredda
  finché non risponde a `up_to_date`, ed è giusto così.

### d. I promemoria dentro l'indice di ricerca

La ricerca indicizza già i compiti con scadenza, al giorno
(`QueryPredicate::TaskDue`), ed è durevole: `ReminderIndex` potrebbe
chiedere a lei invece di tenere una mappa sua.

- **Pro:** un indice durevole in meno da mantenere.
- **Contro:** i promemoria hanno l'ora al minuto e la sezione del compito,
  la ricerca no; dipenderebbero da una feature che si può spegnere;
  l'owner della regola dei promemoria si sposterebbe. Più lavoro della
  strada c per lo stesso risultato.

## Il test che impedisce di restare indietro

Un test di `fub-host` con le feature di serie, su un vault temporaneo con
note, compiti con `⏰`, una base e un disegno:

1. apertura a freddo, chiusura, riapertura con un `Host` nuovo;
2. la riapertura non rilegge nessun documento: l'indicizzazione nasce con
   zero voci da leggere (lo stesso controllo di
   `a_warm_the_second_phase_not_has_nothing_from_do` in
   `crates/fub-kernel/tests/the_opening.rs`, ma con gli indici veri);
3. dopo la riapertura i promemoria, la ricerca e le basi rispondono come dopo
   il freddo;
4. una nota cambiata ad app chiusa (stessa dimensione, data diversa) torna
   con il promemoria nuovo, non con quello vecchio.

Il punto 2 diventa rosso se un indice nuovo risponde vuoto e rende fredda la
riapertura; il punto 3 se un indice dice «ho tutto» senza averlo. Su
`f4ed55641` il punto 2 fallisce; con la forzatura fallisce il punto 3
(0 promemoria).

## Altri costi visti

Fuori dalla domanda dell'issue, ma misurati nello stesso giro:

- **Il flush della ricerca dopo poche note cambiate.** Con 50 note toccate ad
  app chiusa, il flush finale (`flush_host`, il commit di tantivy) costa
  334 ms su `cinquemila` (terza corsa): più dell'intera rilettura attuale
  (101 ms di fette). Una riapertura con poche note cambiate resta quindi
  lenta anche con la strada c.
- **L'anagrafe da caricare.** `entries.json` pesa 22 MB su `ricche` e 27 MB
  su `trentamila`; caricarla costa 142 ms su `ricche` ed è il motivo per cui
  l'apertura di una riapertura (300 ms) costa più di quella a freddo
  (173 ms). Dopo #523 la lettura costa circa un terzo:
  [L'anagrafe letta in un colpo](2026-11-20-anagrafe-lettura.md).
- **L'anagrafe riscritta a ogni riapertura.** `store_entries` gira due volte
  anche quando niente è cambiato: 31 ms su `cinquemila`, 94 su `ricche`,
  255 su `trentamila`, e resta anche con la forzatura.

Ognuno merita la sua issue, misurata dopo la strada c.

## Dopo la correzione

La strada c è entrata con #521: Base, Disegni e Prove rispondono con tutti i
documenti, i promemoria si ricordano ciò che hanno visto nella cache `reminders.json`,
e il kernel chiede `up_to_date` a ogni indice anche quando l'intersezione è
già vuota (senza, la riapertura diventava tiepida solo dalla terza apertura).
Per #524 l'anagrafe di una riapertura ferma si confronta con quella del file
senza ricomporla; non si scriveva già prima.

- build di rilascio di `67691ecb0` (`perf/tiepido-c`) con la stessa sonda
  senza la forzatura, che non serve più; 20 novembre 2026, misura di un
  agente, stessa macchina;
- carico medio a un minuto fra 43 e 52, contro 10–14 della corsa di prima:
  le fasi che girano in parallelo e l'apertura (`Host::open`) ne escono
  gonfiate, e i loro numeri non si confrontano con quelli di prima;
- il giro: un'apertura a freddo, quattro riaperture, 50 note toccate ad app
  chiusa, una riapertura e un'altra dopo; solo `cinquemila` e `ricche`.

Fase d'indicizzazione (`wait_indexed`), mediana delle quattro riaperture, in
millisecondi.

| Vault | Prima, com'era | Prima, forzata | Dopo | Fette di lettura dopo |
|---|---|---|---|---|
| `cinquemila` | 119 | 28 | 31 | nessuna |
| `ricche` | 727 | 117 | 145 | nessuna |

- **La riapertura non rilegge niente.** Nessuna fetta di lettura nelle
  quattro riaperture e in quella dopo le note toccate: la domanda
  `up_to_date` (5–20 ms) è tutto ciò che resta del lavoro per documento. Il
  «dopo» è vicino al «forzato» di prima pur con un carico tre o quattro volte
  più alto, e a differenza della forzatura i promemoria restano giusti
  (`crates/fub-host/tests/warm_reopening.rs`).
- **Le note toccate si rileggono da sole.** Con 50 note cambiate ad app
  chiusa la riapertura legge una fetta sola (2 ms su `cinquemila`, 10 su
  `ricche`); il costo che resta è il commit della ricerca (`flush_host`,
  267 e 164 ms), cioè #522.
- **L'anagrafe.** Nessuna scrittura nelle riaperture ferme, come prima (lo
  conta il presidio). `store_entries` costa 30–41 ms su `cinquemila` e
  50–110 su `ricche` sotto questo carico, contro 31 e 94 prima: il
  confronto al suo posto toglie la copia dei metadati, ma resta il giro su
  ogni voce col suo testimone, e a questo carico il guadagno non si vede.
  Caricarla resta la voce più cara della riapertura (140–300 ms su
  `ricche`), cioè #523.
- `PROMEMORIA 0` su entrambi i vault è giusto: le loro note non hanno `⏰`.
