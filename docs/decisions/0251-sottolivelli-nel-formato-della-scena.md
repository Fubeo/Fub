# 0251 — I sottolivelli sono livelli annidati in un livello

- **Stato:** accolta
- **Data:** 2026-11-24
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Il Disegno completo deve avere i sottolivelli come VectorCraft («Nuovo
sottolivello», «Raccogli in un nuovo livello», trascinare un livello dentro un
altro). Il formato della scena ammetteva un livello solo come figlio della
radice: un `<g fub:layer>` più in basso era un gruppo, e le operazioni lo
rifiutavano. Servono una forma nel file che Inkscape e gli altri lettori SVG
capiscano, e una regola di ruolo che non cambi il significato dei file già
scritti.

## Decisione

- Un `<g>` con `fub:layer` è un livello se è figlio della radice o di un
  livello, a qualunque profondità di livelli. Nel file è un sottolivello; nel
  modello ha il ruolo `layer` come gli altri.
- Un `<g>` con `fub:layer` dentro un gruppo, un collegamento o una risorsa
  resta un gruppo, come prima.
- Un sottolivello sta fra gli oggetti del suo livello e ne eredita blocco,
  visibilità, trasformazione e ritaglio. Ha un id che inizia con `l`.
- Le operazioni ammettono un livello sotto la radice o in un livello (`add`,
  `move`); `set` scrive `fub:layer` solo su un figlio della radice o su un
  elemento che è già un sottolivello, così un gruppo in un livello non lo
  diventa.

## Conseguenze

### Positive

- La forma è additiva: un file senza sottolivelli si legge come prima, e un
  file con sottolivelli resta SVG valido, con gli stessi `<g>` annidati che
  Inkscape usa per i suoi sottolivelli.
- Il ruolo dipende solo dal genitore, quindi Rust (`fub-scene`) e il client lo
  calcolano allo stesso modo in un solo passo.

### Negative

- Un file scritto prima, con un `<g fub:layer>` dentro un livello, ora si legge
  come sottolivello invece che come gruppo; Fub non scriveva questa forma, quindi
  riguarda solo file fatti a mano.
- Chi elenca i livelli deve visitarli in profondità, non solo i figli della
  radice.
