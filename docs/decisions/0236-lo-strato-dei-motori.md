# 0236 — Lo strato dei motori

- **Stato:** proposta
- **Data:** 2026-11-02
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub porta dentro di sé motori copiati da altri progetti (GridCraft per i fogli,
WordCraft per i documenti; PdfCraft, VectorCraft e gli altri dopo). Ognuno ha
il suo costo: tabelle, dizionari, cache, a volte thread. Le misure di K0
([`motori-2026-10-31-linux-ryzen.md`](../misure/motori-2026-10-31-linux-ryzen.md))
hanno mostrato due cose:

- chiudere un documento non rende la memoria: le cache dei motori restano
  piene, e glibc trattiene le pagine liberate finché non si chiede
  `malloc_trim` (WordCraft, `Documento.docx`: 29,6 MiB tutto chiuso, 21,6 MiB
  dopo `malloc_trim`);
- senza un posto comune ogni motore nuovo porterebbe i suoi thread, le sue
  cache senza tetto e il suo modo di nascere, e Fub non saprebbe quanto tiene
  né come lasciarlo.

I motori di terzi, per regola, si nominano soltanto dai loro adattatori
(`check-engine-boundary.mjs`, `GRIDCRAFT_OWNERS` e `WORDCRAFT_OWNERS` in
`dependency_invariant.rs`). La forma disegnata nel piano di K3, un
`Motori { fogli: Pigro<…>, documenti: Pigro<…>, … }` con un campo per motore,
violerebbe quella regola e farebbe dipendere lo strato dagli adattatori che
dipendono da lui.

## Decisione

Un crate `fub-motori` dà i pezzi comuni; ogni adattatore vi porta il suo
motore.

1. **Il registro è dinamico e non nomina nessun motore** (A1). `fub-motori` dà
   `Pigro<T>`, `Servizi`, `Budget`, `Cache` e un registro `Motori` dove un
   adattatore iscrive una `Voce` con uno spazio e le estensioni che apre
   (`fub-format-xlsx` → «fogli», `fub-format-rich` → «documenti»). Uno spazio
   si iscrive una volta sola e un'estensione appartiene a un motore solo:
   una seconda iscrizione è un errore tipato, non una sostituzione silenziosa.
2. **Un registro e dei servizi per processo** (A2). Fub è un processo solo:
   `Servizi::processo()` e `Motori::processo()` sono unici e crearli non avvia
   niente. Le prove usano `Servizi::nuovi(config)` e `Motori::nuovi(servizi)`,
   che non toccano quelli del processo.
3. **Niente all'avvio, nessun lucchetto tenuto.** Un motore nasce alla prima
   richiesta, una volta sola anche con più richieste insieme; il gruppo di
   thread dei motori nasce al primo lavoro. Nessun lucchetto dello strato è
   tenuto mentre un motore si costruisce o lavora, o mentre si chiama una
   cache o una voce. Un panico durante la costruzione diventa un errore e non
   lascia il motore a metà.
4. **Un budget comune con un tetto che segue la macchina** (A5). Il tetto parte
   da un ottavo della RAM installata, fra 256 MiB e 2 GiB (1 GiB quando la RAM
   non si legge), e su Linux scende con la pressione della memoria (PSI): a
   metà con `some avg10 ≥ 10`, a un quarto con `full avg10 ≥ 5`. macOS e
   Windows non hanno un segnale di pressione letto da Fub: il tetto resta
   quello di partenza. Il budget libera dalla cache meno usata di recente
   finché si sta sotto il tetto. La pressione si legge quando si chiede il
   tetto, al più una volta al secondo, senza un thread in più.
5. **Chiudere libera** (A6). Su Linux con glibc `rilascia_al_sistema()` chiama
   `malloc_trim(0)`; altrove non fa niente. Un adattatore la chiama dopo aver
   svuotato le cache, quando l'ultimo documento del suo motore si chiude.
6. **La scheda grafica e l'archivio dei caratteri arrivano dopo** (A3). Nessun
   motore acceso in Fub li usa. `Servizi` ha i campi privati e un metodo per
   servizio, così un servizio nuovo si aggiunge con il primo motore che lo usa
   senza cambiare chi usa quelli che ci sono.

Il funzionamento è in [Lo strato dei motori](../architecture/motori.md).

## Conseguenze

### Positive

- un motore nuovo porta un adattatore e una voce, non un sistema suo di
  thread, cache e avvio;
- il confine dei motori di terzi resta quello delle guardie: `fub-motori` non
  dipende da nessun adattatore né da nessun motore;
- la memoria dei motori ha un tetto, si conta (`elenco`, `usati`) e torna al
  sistema alla chiusura;
- le prove sono separate dal processo e non condividono thread né tetto.

### Negative

- l'iscrizione è a tempo di esecuzione: un adattatore che non si iscrive non
  si vede dal compilatore, solo dalle prove e da `elenco`;
- il budget conta ciò che le cache dichiarano: una stima sbagliata di un
  motore sposta il tetto reale;
- su macOS e Windows il tetto non scende sotto pressione;
- `malloc_trim` vale soltanto con glibc; con altri allocatori la memoria torna
  quando l'allocatore decide.

## Alternative scartate

### Un campo per motore dentro `Motori`

Era la forma del piano: tipata e senza iscrizione. Farebbe nominare i motori
a `fub-motori` contro `check-engine-boundary.mjs` e `dependency_invariant`, e
creerebbe un ciclo con gli adattatori.

### Ogni motore con il suo `OnceLock` e i suoi thread

È la forma che c'era. Non dà un tetto comune né un modo comune di rendere la
memoria, e ogni motore nuovo ripete le stesse scelte.

### Il gruppo di thread globale di `rayon`

Non ha un nome né un numero di thread scelti da Fub, e lo condividono altre
dipendenze: i lavori dei motori si mescolerebbero ai loro.

### Un thread che sorveglia la pressione

Leggerebbe PSI anche quando nessun motore è acceso, contro «niente
all'avvio». Leggere quando si chiede il tetto basta, perché il tetto serve
soltanto quando una cache cresce o un documento si chiude.

## Verifica

- `crates/fub-motori/tests/pigro.rs`: una costruzione sola con richieste
  insieme, errori e panici che tornano allo stato vuoto, `libera` che non
  distrugge un motore ancora tenuto.
- `crates/fub-motori/tests/memoria.rs`: il budget libera dalla meno usata fin
  sotto il tetto senza lucchetti tenuti; i lettori di `meminfo` e PSI sui
  campioni; il tetto senza `/proc/pressure`.
- `crates/fub-motori/tests/registro.rs`: iscrizioni doppie rifiutate, servizi
  del processo unici e senza thread prima del primo lavoro.
- `cargo test -p fub-abi --test dependency_invariant` e
  `check-engine-boundary.mjs`: `fub-motori` non nomina nessun motore.
