# Modello dei dati

Il modello comune vive in `fub-abi` e permette al kernel di lavorare senza conoscere il formato originale del documento.

## Identità

Un documento è identificato da un percorso relativo al vault, con separatori `/` e estensione inclusa. Il percorso è un dato del contratto: non deve diventare un percorso assoluto né consentire di uscire dalla radice del vault.

Il sistema distingue almeno:

- documento riconosciuto da un provider di formato;
- allegato;
- file sconosciuto, che esiste anche se nessun provider sa interpretarlo.

## Documento interpretato

Il provider traduce il file in una rappresentazione strutturata con:

- metadati e frontmatter;
- blocchi e contenuto inline;
- collegamenti, tag e riferimenti;
- escape hatch JSON per informazioni specifiche del formato.

Il modello comune non deve perdere il testo originale quando una costruzione non è ancora compresa. La serializzazione appartiene al provider, non al kernel.

## Query e viste

Le query dell'indice restituiscono dati serializzabili e paginabili. Le viste dichiarative ricevono dati dal contratto e producono `UiNode`; non ottengono un riferimento diretto al DOM o alla shell.

## Eventi

Gli eventi descrivono fatti già avvenuti: apertura, modifica, rinomina, indicizzazione, progresso o errore. Non sono scorciatoie per saltare i comandi e le regole del kernel.

## Confine WIT

WIT non ammette alberi ricorsivi diretti. Al confine WASM blocchi, inline e nodi UI viaggiano come arene piatte con riferimenti numerici; in Rust restano alberi. La conversione è centralizzata in `fub_abi::arena` e verificata con round-trip.

I tipi concreti e il loro mapping sono in [`06-contratto/01-i-trait-in-rust.md`](../06-contratto/01-i-trait-in-rust.md) e [`06-contratto/02-il-modello-dati.md`](../06-contratto/02-il-modello-dati.md).