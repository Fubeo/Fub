# 0190 — Un documento condivide il buffer, ogni superficie conserva il proprio undo

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** frontend
- **Sostituisce:** 0015, 0044–0045, 0075, 0078–0079, 0150, 0153, 0170–0173
- **Sostituita da:** —

## Contesto

Aprire lo stesso documento in più riquadri può creare buffer concorrenti,
salvataggi fuori ordine e cursor state condiviso per errore. Un singolo undo
globale confonde battute locali con comandi applicati dal core.

## Decisione

Una sessione documento possiede testo, revisione, dirty state, coda di
salvataggio e bozza. Le superfici condividono il buffer ma possiedono cursore,
scroll, modalità, focus e pila locale di undo. Le modifiche remote aggiornano il
buffer senza entrare nella history locale. Gli esiti dei comandi conservano un
undo di dominio separato.

## Conseguenze

### Positive

- più riquadri non sovrascrivono lo stesso file;
- ogni superficie mantiene un'esperienza locale coerente;
- undo dell'editor e undo del comando hanno semantiche chiare;

### Negative

- il lifecycle richiede reference counting e flush ordinato;
- la sincronizzazione deve convertire offset e terminatori correttamente;
- un secondo motore deve rispettare la stessa distinzione;

## Alternative scartate

### Editor indipendente per riquadro

Crea due autorità concorrenti.

### Stato intero condiviso

Cursore e scroll di un riquadro muovono gli altri.

### Un'unica pila di undo

Mescola eventi locali e operazioni di dominio.

## Verifica

I test aprono due superfici, intercalano edit, modifiche esterne, undo, close e
riapertura. CRLF e UTF-8 sono casi obbligatori.
