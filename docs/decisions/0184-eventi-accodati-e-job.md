# 0184 — Gli eventi sono accodati e il lavoro lungo usa job

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** kernel
- **Sostituisce:** 0012, 0033–0035, 0052, 0062–0063, 0080, 0103, 0126, 0161
- **Sostituita da:** —

## Contesto

Consegnare un evento durante una mutazione può rientrare nel kernel, trattenere
lock o osservare stato intermedio. Usare eventi come unico risultato perde
informazioni sotto compattazione. Eseguire lavori lunghi in una chiamata breve
blocca il custode del workspace.

## Decisione

Una modifica completa lo stato autorevole, accoda l'evento e poi restituisce il
proprio esito. Gli handler vengono eseguiti in seguito e non durante il lock.
Il progresso può essere compattato; il risultato finale resta nella risposta o
nello stato del job. Operazioni lunghe hanno id, lifecycle, progresso e
cancellazione.

## Conseguenze

### Positive

- nessuna rientranza implicita durante le mutazioni;
- la shell riceve progresso senza perdere il risultato;
- job e shutdown hanno ownership osservabile;

### Negative

- la consegna è asincrona rispetto alla modifica;
- gli handler devono tollerare overflow e riconciliare quando necessario;
- serve distinguere attentamente evento, comando e job;

## Alternative scartate

### Callback sincroni

Espongono lock e stato parziale al codice esterno.

### Tutto come evento

Un canale con budget non è una risposta autorevole.

### Thread per ogni operazione

Non definisce cancellazione, progresso o teardown.

## Verifica

Test del bus dimostrano ordine, non rientranza e overflow. I test dei job
verificano transizioni, cancellazione e rilascio durante shutdown.
