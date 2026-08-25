# Il vault

Un vault è una cartella normale del computer scelta dall'utente. Fub non la
trasforma in un database proprietario: documenti, immagini e altri allegati
restano file visibili e utilizzabili anche da altri programmi.

Il primo formato documentale supportato è Markdown. Il kernel, però, non presume
che ogni file sia una nota Markdown: sono i provider registrati a dichiarare
quali estensioni rappresentano documenti.

## Cosa può contenere

```text
Appunti/
├── Storia.md
├── Scienze.md
├── immagini/
│   └── cellula.png
├── .trash/
└── .fub/
```

| Percorso | Ruolo |
|---|---|
| File dell'utente | Documenti e allegati che costituiscono il contenuto del vault. |
| `.trash/` | Cestino condivisibile con applicazioni che adottano la stessa convenzione. |
| `.fub/` | Impostazioni, organizzazione, dati dei plugin e cache usate da Fub. |

## Cosa significa local-first

- La copia autorevole dei documenti è sul disco dell'utente.
- Fub può funzionare sul vault senza trasferire obbligatoriamente i file a un servizio remoto.
- Un'altra applicazione può modificare la stessa cartella; il watcher e la risincronizzazione aggiornano Fub.
- Le operazioni richieste dall'utente, come salvataggio, rinomina e ripristino, modificano realmente quei file.

“File normali” non significa “file che Fub non tocca”: significa che le modifiche
restano leggibili fuori dall'app e non richiedono un formato contenitore
proprietario.

## Attenzione a `.fub/`

Non eliminare `.fub/` pensando che sia tutta cache. Alcuni contenuti sono
autorevoli, come l'organizzazione del vault e i dati persistenti dei plugin. La
struttura e ciò che può essere ricostruito sono spiegati in
[`../05-disco/02-cartella-fub.md`](../05-disco/02-cartella-fub.md).

## Approfondimenti

- [`../05-disco/01-note-utente.md`](../05-disco/01-note-utente.md): formato delle note Markdown.
- [`../05-disco/03-cestino-e-sidecar.md`](../05-disco/03-cestino-e-sidecar.md): cestino e ripristino.
