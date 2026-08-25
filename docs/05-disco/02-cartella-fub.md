# Dati del vault e cartella `.fub/`

Questo percorso resta perché è citato dal documento sul versionamento. La vecchia pagina classificava erroneamente tutta `.fub/data/` come cache cancellabile; quella regola non è più valida.

## Regola corretta

La recuperabilità dipende dal singolo formato persistente:

- note e allegati sono dati dell'utente;
- bozze, organizzazione, stato delle viste, journal, snapshot e metadati di recupero possono non essere ricostruibili;
- indici e anagrafi sono eliminabili soltanto quando il relativo schema dichiara che verranno rigenerati.

Non cancellare `.fub/` o `.fub/data/` in blocco. Prima crea una copia completa del vault e usa i comandi di manutenzione previsti dall'applicazione.

La documentazione canonica è in [`architecture/on-disk-layout.md`](../architecture/on-disk-layout.md) e [`guida/dati-e-recupero.md`](../guida/dati-e-recupero.md).