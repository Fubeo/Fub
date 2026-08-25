# 0179 — La supply chain viene verificata prima del rilascio

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** sicurezza
- **Sostituisce:** 0001
- **Sostituita da:** —

## Contesto

Fub distribuisce un binario desktop con dipendenze Rust, npm e native. Una
licenza incompatibile, una sorgente non prevista o una vulnerabilità nota
diventano parte del prodotto anche se nessun modulo applicativo è cambiato.
Ricostruire a posteriori la provenienza dell'albero è costoso e non protegge gli
artefatti già pubblicati.

## Decisione

La repository mantiene una policy chiusa per sorgenti e licenze, controlla
advisory e crate ritirati in CI e produce una SBOM per gli artefatti. I lockfile
sono parte della revisione. Le dipendenze interne dichiarano sia path sia
versione. Wasmtime e altre dipendenze pesanti restano confinate al componente
che ne ha bisogno.

## Conseguenze

### Positive

- licenze e vulnerabilità diventano proprietà verificabili;
- la provenienza degli artefatti è ricostruibile;
- una nuova dipendenza costosa è visibile nella PR;

### Negative

- la CI dipende da database di advisory e strumenti aggiuntivi;
- un advisory può bloccare il lavoro anche quando l'exploit non è raggiungibile;
- le eccezioni richiedono motivazione e manutenzione;

## Alternative scartate

### Controllo manuale prima della release

Non protegge i commit intermedi e non scala con l'albero.

### Accettare ogni licenza permissiva per nome

Il nome non esprime compatibilità, eccezioni o obblighi di distribuzione.

## Verifica

`deny.toml`, il job di supply chain, i lockfile e la generazione SBOM sono le
fonti eseguibili. Una modifica che li aggira deve rendere rosso almeno un guard.
