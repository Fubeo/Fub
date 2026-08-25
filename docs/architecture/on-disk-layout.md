# Layout su disco

## Il vault resta una cartella normale

I documenti e gli allegati dell'utente vivono nei loro percorsi ordinari. Fub aggiunge `.fub/` per lo stato dell'applicazione.

Non esiste una regola corretta del tipo “tutto ciò che è sotto `.fub/data/` è cancellabile”. La recuperabilità dipende dal singolo formato e dal suo schema.

## Dati che non vanno considerati cache

A seconda delle funzionalità attive, `.fub/` può contenere:

- impostazioni del vault;
- organizzazione della sidebar e stato delle viste;
- bozze non salvate;
- registro delle mutazioni;
- snapshot di versioning;
- metadati del cestino e di ripristino;
- storage persistente dei provider.

Queste informazioni possono non essere ricostruibili dalle note.

## Dati ricostruibili

Anagrafe dei file, indici di ricerca e altri derivati possono essere rigenerati quando il relativo schema lo dichiara. La ricostruzione deve passare dai comandi di manutenzione, non da cancellazioni manuali basate sul nome della cartella.

## Scritture

Le modifiche devono essere confinate al vault, validate e applicate con la disciplina prevista dal kernel: percorso normalizzato, controllo delle capacità, scrittura atomica dove richiesta, aggiornamento del journal ed emissione degli eventi dopo l'esito.

## Compatibilità

Ogni formato persistente possiede una propria `SchemaVersion`. Un file scritto da una versione più nuova viene rifiutato quando interpretarlo parzialmente potrebbe perdere dati. I derivati ricostruibili possono invece essere scartati e rigenerati.

La tabella completa degli schemi è in [`versionamento.md`](../versionamento.md). Le istruzioni operative sono in [`guida/dati-e-recupero.md`](../guida/dati-e-recupero.md).