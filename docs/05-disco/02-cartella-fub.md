# La cartella `.fub/`

Fub usa una sola radice di servizio dentro il vault. Il path indica la disciplina
del dato, ma la situazione corrente richiede una precauzione importante: **non
eliminare `.fub/` o `.fub/data/` in blocco senza un backup**.

## Layout corrente

```text
.fub/
├── settings.json
├── workspace.json
├── plugins/
│   └── <plugin-id>/
└── data/
    ├── entries.json
    ├── trash/
    └── plugins/
        └── <plugin-id>/
```

Non tutte le voci devono essere presenti in ogni vault; i provider creano solo
ciò che usano.

## Dati autorevoli

| Percorso | Perché va conservato |
|---|---|
| `.fub/settings.json` | Impostazioni specifiche del vault. |
| `.fub/workspace.json` | Icone, note appuntate, ordinamenti manuali e spazi. |
| `.fub/plugins/<id>/` | Dati persistenti assegnati al plugin, per esempio la cronologia del versioning. |

Questi dati non si ricostruiscono leggendo le note. Le scritture usano schema e
sostituzione atomica; un file illeggibile non deve essere sovrascritto come se
fosse vuoto.

## Dati sotto `.fub/data/`

La radice nasce per contenere derivati, come anagrafe e indice di ricerca. Il
codice può buttare e ricostruire un derivato che non capisce.

Esistono però ancora contenuti storicamente collocati qui che non sono davvero
ricostruibili, in particolare i sidecar del cestino e dati di plugin creati con
il vecchio layout. Il kernel legge entrambe le radici dei plugin durante la
migrazione. Per questo la regola sicura per l'utente non è “cancella tutta
`data/`”, ma “elimina soltanto una cache identificata e ricostruibile”.

## Dati della macchina

Non tutto lo stato dell'app vive nel vault. Registro dei vault conosciuti, log e
altre configurazioni della macchina appartengono a `fub-host` e seguono la
cartella di configurazione del sistema operativo.

## Fonti

- [`../../crates/fub-kernel/src/vault.rs`](../../crates/fub-kernel/src/vault.rs): radici del vault e sidecar del cestino.
- [`../../crates/fub-kernel/src/documents.rs`](../../crates/fub-kernel/src/documents.rs): spazi persistenti e cache dei plugin.
- [`../../crates/fub-abi/src/organization.rs`](../../crates/fub-abi/src/organization.rs): contenuto di `workspace.json`.
