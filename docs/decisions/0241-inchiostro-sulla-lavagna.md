# 0241 — L'inchiostro della lavagna sta nel `.canvas`, con la stringa dei disegni e la misura della scheda

- **Stato:** proposta
- **Data:** 2026-11-02
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La penna deve scrivere su tutta la lavagna: sopra ogni scheda (nota, foglio,
PDF, foto) e sul vuoto. L'inchiostro deve seguire la scheda quando la si
sposta o la si ridimensiona, e non deve mai toccare il file della scheda.

Una lavagna è un file JSON Canvas 1.0, lo stesso formato di Obsidian, che non
ha un posto per i tratti. Il modello della lavagna conserva già ogni campo che
non conosce, sulla radice, su ogni scheda e su ogni arco: un campo `fub:ink`
sopravvive alla lettura e alla scrittura di Fub senza regole nuove.

I disegni hanno già una forma per i campioni di un tratto, la stringa
`fub:ink` del [formato della scena](../reference/scene-format.md), §5, con il
pennello in `fub:brush`. Il suo codice esiste in Rust (`fub-scene`) e in
TypeScript (`editors/spatial/ink/codec.ts`).

La forma diventa un contratto condiviso fra Rust, TypeScript, Obsidian e
altri programmi: cambiarla dopo vuol dire una versione nuova e una
conversione dei file.

## Decisione

1. **L'inchiostro sta nel `.canvas`.** Un livello `{"v": 1, "strokes": [...]}`
   sotto la chiave `fub:ink` di una scheda tiene i tratti di quella scheda;
   lo stesso livello alla radice tiene i tratti liberi. Un file solo, e
   un'ancora per tratto.
2. **I punti si scrivono con la stringa della §5**, la stessa dei disegni, e
   il pennello con la grammatica di `fub:brush`, la penna compresa.
3. **I punti sono in unità della scheda alla misura di riferimento.**
   L'ancora `{"kind": "card", "width": W, "height": H}` dice la misura della
   scheda quando il tratto si è scritto; `{"kind": "free"}` dice coordinate
   della lavagna. Spostare o ridimensionare una scheda non scrive niente.
   Sulle immagini e sui PDF la resa scala il tratto da `W × H` alla misura
   di adesso con lo stesso fattore nei due sensi, il minore, centrato; sulle
   altre schede lo lascia alla misura in cui è stato scritto, in alto a
   sinistra.
4. **Ciò che Fub non capisce si conserva e non si tocca.** Un livello estraneo
   (un'altra versione, un id doppio o mancante) si conserva byte per byte e
   Fub non ci scrive; un tratto non valido si conserva e non si disegna.

La forma precisa, le regole e i vettori stanno in
[L'inchiostro della lavagna](../reference/canvas-ink.md).

## Conseguenze

### Positive

- un file solo: copiare, spostare o sincronizzare la lavagna porta con sé
  l'inchiostro, e spostare una scheda non tocca i suoi tratti;
- un codec solo per i disegni e per la lavagna, già scritto e provato in due
  lingue, con la stessa quantizzazione;
- la stringa della §5 è più corta del base64 di numeri `f32` a parità di
  traccia, e resta leggibile;
- su un'immagine o un PDF un'annotazione resta sopra la stessa parte del
  contenuto, che scala anche lui senza deformarsi;
- la regola della resa è una formula sola, con i suoi vettori
  (`canvas-ink-fit/`), che un altro programma può rifare uguale.

### Negative

- **Il codec esce da `fub-scene`.** Il nucleo della lavagna non può dipendere
  da `fub-scene`, che porta il lettore XML dei disegni: il codec dei tratti e
  la grammatica dei pennelli vanno in un crate piccolo, `fub-ink-codec`, che
  dipende soltanto da `fub-ink`.
- **Un'eccezione nel nucleo della lavagna.** Il nucleo non dipende da nessun
  membro del workspace; per leggere l'inchiostro gli servono `fub-ink-codec` e
  `fub-ink`, un'eccezione nominata nel test delle dipendenze
  (`crates/fub-abi/tests/dependency_invariant.rs`).
- **Obsidian non vede l'inchiostro.** I campi `fub:ink` per lui sono
  sconosciuti. Che cosa ne fa quando riscrive il file (li tiene, li riordina,
  li perde) lo dice soltanto una prova con Obsidian vero: finché la prova non
  c'è, la decisione resta proposta.
- **Il ridimensionamento non uniforme non deforma, ma non riempie.** Su
  un'immagine o un PDF allargati in un senso solo il tratto scala col fattore
  minore e lascia una fascia vuota ai lati; su una nota, un foglio o un
  gruppo il tratto non scala affatto, e se la scheda si rimpicciolisce può
  uscirne (si vede, non si taglia) o finire sopra un'altra parte del
  contenuto, che lì si ridispone invece di scalare.

## Alternative scartate

### Un SVG accanto alla lavagna

L'inchiostro in un disegno a parte, mostrato come scheda `file`. Obsidian lo
vedrebbe come un'immagine ferma. Ma i file diventano due, spostare una scheda
non sposta l'inchiostro che le sta sopra e cancellare la lavagna lascia il
disegno orfano. Resta possibile come copia in più per gli altri programmi, se
la prova con Obsidian la rende necessaria.

### Il base64 di numeri `f32`

Quattro numeri `f32` per campione, in base64. Chiede un codec nuovo in due
lingue, scrive file più lunghi della stringa della §5 per la stessa traccia e
non è senza perdite rispetto ai `f64` del percorso dell'inchiostro.

### Un'ancora `u`, `v` col solo centro

Il tratto ancorato con la posizione relativa del suo centro nella scheda,
fra 0 e 1. I punti di un tratto sono in unità, non fra 0 e 1: senza la misura
che la scheda aveva, un tratto non si rimette al suo posto in una scheda
ridimensionata.

## Verifica

- I vettori in `apps/client/src/__fixtures__/canvas-ink/`, un caso per file,
  sono la prova comune dei lettori in Rust e in TypeScript.
- I vettori in `apps/client/src/__fixtures__/canvas-ink-fit/` provano la
  regola della resa quando la scheda cambia misura.
- Il test delle dipendenze (`dependency_invariant.rs`) nomina l'eccezione del
  nucleo della lavagna.
- La prova con Obsidian dice che cosa succede ai campi `fub:ink` quando
  Obsidian riscrive la lavagna.
