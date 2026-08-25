# 0181 — Il modello comune conserva sorgente, span e struttura

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0003, 0049, 0121
- **Sostituita da:** —

## Contesto

Ricerca, link, view, comandi e formati hanno bisogno di una struttura comune,
ma il file dell'utente resta la fonte autorevole. Un AST specifico di Markdown
nel kernel impedirebbe nuovi formati; un modello troppo povero farebbe
ripetere il parsing in ogni feature. WIT non può esprimere direttamente alberi
ricorsivi.

## Decisione

`DocumentModel` rappresenta blocchi, inline, heading, tag, ancore, link e
proprietà comuni. `DocumentSource` conserva byte decodificati, BOM e terminatori
di riga. Gli span sono intervalli UTF-8 sulla sorgente esatta. Le estensioni
specifiche usano forme `Custom` namespaced finché non esiste un consumatore
trasversale. Al confine WIT gli alberi diventano arena piatte con indici e
limiti controllati.

## Conseguenze

### Positive

- il kernel resta indipendente dal formato;
- edit e diagnosi possono riferirsi alla sorgente esatta;
- la stessa conversione ricorsiva serve tutti i componenti;

### Negative

- il modello comune richiede disciplina per non diventare un superset di ogni formato;
- gli span obbligano a preservare la sorgente e la revisione;
- le arena aggiungono conversione e validazione;

## Alternative scartate

### AST Markdown nel kernel

Renderebbe Markdown un caso speciale e duplicabile.

### Solo testo e JSON libero

Sposterebbe parsing e compatibilità in ogni consumatore.

### Tipi ricorsivi WIT ad hoc

Il linguaggio non li supporta e le conversioni divergerebbero.

## Verifica

I test di parse, round-trip, span e arena verificano la forma. Il crate
`fub-abi` non può importare il provider Markdown.
