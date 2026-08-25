# Stile della documentazione

> **Ambito:** ogni file Markdown canonico della repository.
> **Fonte autorevole:** questa pagina e i guard in `.github/scripts/`.

## Scopo

La documentazione deve permettere di rispondere a una domanda senza conoscere
la cronologia del repository.

Una pagina descrive:

- un comportamento corrente;
- un confine architetturale;
- una procedura;
- un contratto;
- stato o direzione;
- il perché di una decisione.

Non svolge più ruoli insieme.

## Tassonomia

| Tipo | Contenuto | Cartella |
|---|---|---|
| guida iniziale | procedura verificabile | `getting-started/` |
| prodotto | comportamento osservabile | `product/` |
| architettura | responsabilità, flussi e invarianti | `architecture/` |
| sviluppo | modo di lavorare | `development/` |
| riferimento | forma precisa di un contratto | `reference/` |
| progetto | stato e direzione correnti | `project/` |
| ADR | motivazione di una scelta costosa | `decisions/` |

Un'attività eseguibile vive in una GitHub Issue.

## Struttura

Ogni file ha:

- un solo H1;
- una frase iniziale che chiarisce domanda, pubblico o risultato;
- sezioni ordinate;
- link agli approfondimenti;
- newline finale.

Titoli descrittivi:

- `# Storage e identità`
- `## Scritture atomiche`

Titoli da evitare:

- `# La grande promessa del disco`
- `## Cosa scoprimmo quel giorno`

## Linguaggio

- italiano semplice;
- frasi brevi;
- termini tecnici spiegati alla prima occorrenza;
- nomi del codice in backtick;
- voce attiva;
- niente cronaca del commit;
- niente conteggi manuali destinati a cambiare;
- niente “oggi” o “al momento” fuori da `project/`;
- niente checklist completate in pagine permanenti.

## Fonti

La pagina indica i percorsi autorevoli quando descrive architettura o
riferimenti.

Ordine di autorità:

1. codice e test;
2. contratti persistenti;
3. pagina canonica;
4. ADR;
5. stato e roadmap;
6. Git.

Non copiare intere enum o strutture quando un link al sorgente è più preciso.
Spiega significato e invarianti.

## Link

- usa link relativi per file del repository;
- usa URL assoluti soltanto per risorse esterne e issue;
- non creare alias Markdown;
- dopo una rinomina, aggiorna tutti i chiamanti;
- ogni pagina deve essere raggiungibile da `docs/README.md`;
- ogni ADR deve essere indicizzato.

## Mermaid

Tipi ammessi:

| Domanda | Diagramma |
|---|---|
| dipendenze | `flowchart LR` |
| ordine delle chiamate | `sequenceDiagram` |
| lifecycle | `stateDiagram-v2` |
| tipi | `classDiagram` |
| entità persistenti | `erDiagram` |

Regole:

- un diagramma, una domanda;
- massimo consigliato 20 nodi o partecipanti;
- id ASCII ed etichette in italiano;
- niente colori o stili hardcoded;
- niente diagrammi duplicati;
- una frase prima e una breve interpretazione dopo;
- nessuna relazione futura in un diagramma corrente.

## Tabelle

Usa una tabella soltanto per dimensioni regolari. Ogni riga deve avere lo stesso
numero di celle e non deve contenere una lista narrativa.

## Dimensioni

| Tipo | Obiettivo | Revisione obbligatoria |
|---|---:|---:|
| guida | 100–250 righe | 300 |
| architettura | 150–350 righe | 450 |
| riferimento | 150–450 righe | 550 |
| ADR | 50–140 righe | 180 |
| indice | 30–100 righe | 150 |

Il guard blocca la soglia massima. Un'eccezione richiede una motivazione
esplicita nello script, non un commento casuale nella pagina.

## ADR

Un ADR resta soltanto quando:

- vincola più componenti;
- definisce un contratto pubblico o persistente;
- conserva alternative plausibili;
- richiede una migrazione per essere invertito;
- chiarisce sicurezza o compatibilità.

Usa [`../decisions/template.md`](../decisions/template.md). Non inserire
checklist, conteggi di test, link a piani chiusi o frasi come “questo commit”.

## Verifica

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-mermaid.mjs
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```
