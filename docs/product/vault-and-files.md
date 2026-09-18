# Vault e file

> **Per chi:** chi vuole capire che cosa Fub legge, scrive e conserva.
> **Risultato:** distinguere documenti, stato autorevole e dati ricostruibili.

## Il vault

Un vault è una cartella scelta dall'utente. I path pubblici sono relativi alla
radice e usano `/`; nel contratto sono rappresentati da `DocId`.

Fub non sposta i documenti in un contenitore proprietario. Un file Markdown
resta un file Markdown e può essere aperto da altri strumenti.

```mermaid
flowchart TD
    ROOT["vault/"]
    ROOT --> DOCS["documenti e allegati"]
    ROOT --> SERVICE[".fub/"]
    SERVICE --> AUTH["stato non ricostruibile"]
    SERVICE --> DERIVED["cache e indici ricostruibili"]
    SERVICE --> PLUGIN["dati per-plugin"]
```

## Apertura

L'apertura procede a fasi:

1. riconosce la struttura del vault;
2. rende disponibili albero e operazioni di base;
3. legge e indicizza i documenti;
4. segnala i file non leggibili senza rendere inutilizzabile l'intero vault.

Durante l'indicizzazione la ricerca espone lo stato del lavoro invece di
restituire silenziosamente un risultato incompleto.

## Modifiche sicure

Le scritture usano una revisione di base. Se il file è cambiato da quando una
modifica è stata calcolata, l'esito è un conflitto, non una sovrascrittura
silenziosa.

Le operazioni principali emettono eventi tipizzati. Rename e cancellazione
aggiornano identità, indici e sessioni attraverso il kernel e l'host, invece di
essere semplici chiamate filesystem dalla UI.

## Bozze

Una bozza protegge testo che non è ancora diventato una scrittura riuscita sul
documento. Le bozze appartengono al vault e non sostituiscono il file
autorevole.

Il lifecycle dell'editor deve eseguire flush, eventuale persistenza della bozza
e teardown nell'ordine previsto quando si chiude l'ultima superficie.

## Cestino

La cancellazione sposta la voce nel cestino del vault. Un sidecar può ricordare
la posizione originale e consentire il ripristino.

Il sidecar è un aiuto, non l'unica copia della nota. Se manca o non è
compatibile, il comportamento di degrado deve preservare il contenuto e usare
una destinazione sicura.

## Versioning

Il versioning conserva snapshot del contenuto. `version.restore` cattura la
revisione del documento, quindi verifica che il riferimento alla versione
esista e che il blob sia leggibile e integro (dimensione e impronta FNV-1a).
La scrittura condizionata usa quella revisione come confronto e scambio (CAS).
Per gli writer cooperativi, una modifica intervenuta durante la lettura viene
rifiutata come conflitto.
Per gli writer esterni il controllo è best-effort: una modifica già osservabile
al confronto produce lo stesso conflitto. Un riferimento o un blob non valido e
gli errori di lettura o confronto non modificano né il documento né l'indice
delle versioni. Le garanzie di un errore di scrittura dipendono dal supporto:
per i file regolari sostituibili il valore precedente resta intatto; symlink,
hardlink e filesystem senza conteggio dei nomi richiedono invece la scrittura
in-place descritta nel riferimento tecnico.

Quando riesce, il ripristino è una scrittura normale: fotografa prima il
contenuto sostituito e, se il contenuto cambia, crea una nuova versione; quando
esiste una versione precedente, il comando dichiara anche il ripristino inverso.

## Cartella `.fub/`

La classificazione precisa è in
[`../reference/on-disk-layout.md`](../reference/on-disk-layout.md).

La regola importante è per voce, non per cartella:

- impostazioni, organizzazione, bozze, versioni e storage di un plugin possono
  contenere dati non ricostruibili;
- anagrafe e indici possono essere ricreati dal vault;
- un file sconosciuto non va cancellato soltanto perché si trova sotto
  `.fub/data/`.

## Compatibilità con altri strumenti

Fub comprende convenzioni usate nei vault Markdown, tra cui frontmatter YAML,
wikilink, tag, heading, ancore ed embed. Il provider decide la semantica del
formato; il kernel conserva path e sorgente senza incorporare regole Markdown.

## Backup e ripristino

Il backup completo riguarda l'intero vault: documenti, allegati, file
sconosciuti, `.trash/`, stato autorevole sotto `.fub/` e storage autorevole
dei plugin. La configurazione macchina è esclusa. Il banco focalizzato si
esegue con:

```bash
cargo +1.89.0 test -p fub-host --lib legacy_tests::backup_restore_drill -- --nocapture
```

Il fixture è versionato e il manifesto indipendente controlla ogni path,
classe, dimensione, impronta FNV-1a e schema; symlink e file speciali sono
rifiutati. Il flusso resta offline, con parent temporaneo privato ed
esclusivo, staging adiacente e un solo rename di pubblicazione. Sono espliciti
i limiti: nessuna garanzia universale di no-replace concorrente e nessuna
garanzia di durabilità dopo un crash.

Artefatti corrotti o mancanti falliscono la validazione prima dello staging e
della destinazione. Una destinazione occupata conserva il contenuto esistente
e lo staging completo. `Host` reale apre il vault ripristinato, attende
l'indicizzazione, verifica la lettura del documento e chiude senza errori.

`fub.backup` copia snapshot delle sole note nello storage namespaced dello stesso vault e al restore ricrea soltanto note mancanti; il drill completo resta separato.

## Limiti

- Fub non sincronizza automaticamente il vault con un servizio remoto;
- il backup completo include ogni dato classificato come autorevole;
- eliminare l'intera `.fub/` può perdere impostazioni, organizzazione, bozze,
  versioni e dati di plugin;
- eliminare soltanto una cache è sicuro solo quando il riferimento tecnico la
  dichiara ricostruibile.

La prova è tracciata nell'issue
[#7](https://github.com/Fubeo/Fub/issues/7), ancora aperta finché CI non la
verifica.
