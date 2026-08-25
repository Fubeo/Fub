# 0197 — La documentazione descrive il presente e Git conserva la storia

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0014, 0142–0144
- **Sostituita da:** —

## Contesto

Guide, roadmap, milestone, verbali e specifiche raccontavano lo stesso
argomento con stati diversi. Alias e archivi obbligavano il lettore a conoscere
la cronologia per trovare la fonte autorevole.

## Decisione

`docs/` contiene soltanto guide, prodotto corrente, architettura, sviluppo,
riferimenti, stato breve e ADR architetturali. Le attività vivono nelle issue.
Milestone concluse, cronaca, checklist e idee non approvate vengono rimosse; Git
resta l'archivio. Ogni pagina è raggiungibile dall'indice e ogni informazione ha
una fonte canonica.

## Conseguenze

### Positive

- il lettore trova il documento senza ricostruire la storia;
- il presente e il futuro sono separati;
- la cancellazione riduce fonti concorrenti;

### Negative

- recuperare un dettaglio storico richiede Git;
- una pagina di progetto viene eliminata quando si conclude;
- i link esterni a percorsi legacy devono essere aggiornati;

## Alternative scartate

### Cartella archive

Mantiene documenti superati nel percorso di lettura.

### Alias Markdown permanenti

Nascondono link non aggiornati e creano pagine senza contenuto.

### Conservare ogni verbale

Rende la cronologia una seconda roadmap.

## Verifica

Guard di link, orfani, dimensione, stile e riferimenti legacy presidiano il
corpus. `docs/README.md` è il punto d'ingresso unico.
