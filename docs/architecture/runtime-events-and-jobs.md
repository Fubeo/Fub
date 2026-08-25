# Runtime, eventi e job

> **Domanda:** come attraversano Fub operazioni brevi, eventi e lavoro lungo
> senza rientranza o lock prolungati?
> **Fonti autorevoli:** `crates/fub-kernel/src/bus.rs`,
> `crates/fub-host/src/jobs.rs`, `crates/fub-host/src/session.rs`.

## Tre forme di lavoro

| Forma | Uso |
|---|---|
| chiamata breve | lettura, query o comando sincrono e limitato |
| evento | fatto già accaduto, consegnato in coda |
| job | lavoro lungo con progresso, cancellazione e stato |

Una funzione sincrona non diventa un job soltanto perché attraversa IPC. Un
lavoro potenzialmente lungo non deve bloccare il thread che custodisce il
workspace.

## Eventi

Gli eventi descrivono:

- origine e attore;
- soggetto;
- tipo di cambiamento;
- severità o avviso;
- lotto, quando più fatti appartengono alla stessa operazione.

La consegna è accodata. Un handler non viene chiamato mentre il kernel mantiene
un prestito esclusivo o sta ancora mutando lo stesso registro.

```mermaid
sequenceDiagram
    participant OP as Operazione
    participant K as Kernel
    participant Q as Coda eventi
    participant H as Handler
    participant UI as Shell

    OP->>K: modifica
    K->>K: aggiorna stato
    K->>Q: accoda evento
    K-->>OP: esito
    Q->>H: consegna successiva
    H-->>Q: risultato
    Q->>UI: evento serializzato
```

## Job

Un job ha un'identità, uno stato e un proprietario. Il lifecycle tipico è:

```mermaid
stateDiagram-v2
    [*] --> Queued
    Queued --> Running
    Running --> Completed
    Running --> Failed
    Running --> Cancelling
    Cancelling --> Cancelled
    Queued --> Cancelled
    Completed --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

Il progresso è informativo e può essere compattato. Il risultato finale non
deve essere ricostruito da una sequenza di eventi che potrebbe essere stata
limitata da un budget.

## Apertura del vault

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant HOST as Host
    participant K as Kernel
    participant JOB as Pool job
    participant BUS as Event bus

    UI->>HOST: open_vault
    HOST->>K: fase strutturale
    K-->>HOST: albero e file non letti
    HOST-->>UI: vault disponibile
    HOST->>JOB: indicizzazione
    JOB->>BUS: progresso
    BUS-->>UI: aggiornamenti
    JOB->>K: commit dei derivati
    K-->>HOST: stato completo
```

La shell può lavorare prima che l'indice sia completo, ma le query dichiarano
lo stato di indicizzazione.

## Custodia e lock

`fub-host` custodisce il workspace e misura i prestiti esclusivi lunghi. Le
regole sono:

- non chiamare provider con il lock del workspace;
- estrarre i dati necessari, rilasciare il lock, chiamare codice esterno;
- rientrare soltanto per applicare un esito verificato;
- accodare gli eventi;
- non eseguire subito il lavoro appena accodato da un callback.

## Errori

Gli errori attraversano i confini come specie tipizzate: conflitto, permesso
negato, argomenti errati, non trovato, I/O, cancellazione e altre varianti.

La localizzazione della frase avviene prima della presentazione, ma il tipo non
viene perso. La shell non decide il comportamento cercando sottostringhe in un
messaggio.

## Shutdown

Lo spegnimento avviene dal livello proprietario verso l'interno:

1. impedisce nuove registrazioni o richieste;
2. cancella o attende i job secondo la policy;
3. disattiva i bundle;
4. rimuove registrazioni, handler e timer;
5. chiude watcher e sessioni;
6. rilascia il workspace.

Un disposer appartiene all'owner che ha registrato la risorsa. Non si svuotano
mappe globali per tentativi.
