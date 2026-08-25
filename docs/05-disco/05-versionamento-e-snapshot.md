# Versionamento e snapshot

Il bundle `fub.versioning` conserva copie storiche per documento. È composto da
un `EventHandler`, una vista della cronologia e un provider di comandi per il
ripristino.

## Flusso

```mermaid
flowchart LR
    Change["DocumentChanged"] --> Sampler["handler del versioning"]
    Sampler --> Store["spazio dati fub.versioning"]
    Store --> View["vista Cronologia"]
    View --> Restore["comando di ripristino"]
```

Lo snapshot viene campionato secondo l'intervallo configurato. La perdita di un
evento di modifica può quindi perdere una versione intermedia, ma non cambia il
file autorevole sul disco. Rename e rimozioni hanno un peso diverso: il bundle
migra la storia o scrive un tombstone e, dopo `Overflow`, riconcilia il proprio
stato con l'elenco reale dei documenti.

## Layout

Lo storage persistente assegnato al bundle vive nel layout autorevole:

```text
.fub/plugins/fub.versioning/
├── versions.json
└── <impronta-del-documento>/
    ├── meta.json
    └── <timestamp>.md
```

- `versions.json` è un indice ricostruibile leggendo le cartelle;
- `meta.json` conserva identità e tombstone;
- i file con timestamp contengono il testo delle versioni e **non sono cache**.

Il kernel continua a leggere anche il precedente spazio sotto
`.fub/data/plugins/` durante la transizione del layout. Non eliminare quelle
cartelle senza avere verificato che la cronologia sia stata migrata.

## Ripristino

La vista mostra le versioni del documento attivo e può aprirne l'anteprima. Il
comando di ripristino riscrive la nota con il contenuto scelto. Il ripristino è
a sua volta una modifica versionabile, quindi non distrugge necessariamente il
punto da cui si è partiti.

La documentazione non promette un motore di diff dedicato: la superficie
corrente è cronologia, anteprima e ripristino.

L'implementazione è in
[`../../crates/fub-features/src/versioning.rs`](../../crates/fub-features/src/versioning.rs).
