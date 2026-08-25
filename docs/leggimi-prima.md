# Leggimi prima

I documenti di Fub usano quattro categorie. Confonderle è il modo più semplice per ottenere una documentazione formalmente corretta ma sostanzialmente falsa.

## Corrente

Descrive il comportamento presente nel repository. Le fonti principali sono [`STATO.md`](STATO.md), [`guida/`](guida/README.md), [`architecture/`](architecture/README.md), [`06-contratto/`](06-contratto/README.md), [`frontend/`](frontend/README.md) e [`riferimento/`](riferimento/README.md).

Quando una pagina corrente contraddice codice, manifest o test, va corretta nello stesso cambiamento.

## Specifica

Le cartelle [`features/`](features/README.md), [`microfeatures/`](microfeatures/README.md) e [`personas/`](personas/README.md) descrivono requisiti e criteri di prodotto. Non sono una lista delle funzioni disponibili.

## Piano

[`PIANO.md`](PIANO.md), [`milestones/`](milestones/README.md), [`todo.md`](todo.md) e i documenti che includono “piano” nel titolo descrivono priorità, traguardi o lavoro ancora aperto. Un piano può essere molto dettagliato senza essere già implementato.

## Storico

[`decisions/`](decisions/README.md) conserva il perché delle scelte chiuse. [`roadmap/`](roadmap/README.md) conserva le sedute che hanno portato a quelle scelte. I nomi e i percorsi citati nei documenti storici possono essere quelli del momento in cui furono scritti.

## Ordine consigliato

| Obiettivo | Percorso |
|---|---|
| Usare Fub | [`guida/`](guida/README.md) |
| Contribuire | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Capire il sistema | [`architecture/panoramica.md`](architecture/panoramica.md) |
| Verificare una funzione | [`STATO.md`](STATO.md), poi codice e test collegati |
| Capire una priorità | [`PIANO.md`](PIANO.md), poi [`todo.md`](todo.md) |
| Ricostruire una scelta | [`decisions/`](decisions/README.md), poi la seduta collegata |