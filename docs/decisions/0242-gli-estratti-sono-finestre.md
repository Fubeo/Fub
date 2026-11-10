# 0242 — Gli estratti sono finestre: un campo `fub:parts` accanto al `subpath`

- **Stato:** proposta
- **Data:** 2026-11-10
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Sulla lavagna si vuole mettere solo una parte di un file: alcune pagine di
un PDF, un rettangolo di una pagina, alcune sezioni di una nota, un ritaglio
di una foto. La parte deve restare legata al file vero: se il file cambia,
la scheda lo mostra cambiato, e niente viene copiato.

Una lavagna è un file JSON Canvas 1.0, lo stesso di Obsidian. Il formato ha
una scheda `file` con un `subpath` facoltativo, che Obsidian usa per una
pagina di un PDF (`#page=3`) o per una sezione di una nota (`#Titolo`). Un
`subpath` dice una parte sola, e non sa dire un rettangolo né un ritaglio.

Il modello della lavagna conserva già ogni campo che non conosce, come fa
per `fub:ink` ([ADR 0241](0241-inchiostro-sulla-lavagna.md)). La forma degli
estratti diventa un contratto fra Rust, TypeScript, Obsidian e altri
programmi: cambiarla dopo vuol dire una conversione dei file.

## Decisione

1. **Un estratto è una scheda `file` con un campo in più.** Il `subpath`
   dice la prima parte, scritto da Fub; il campo `fub:parts`, un oggetto
   con `kind`, le dice tutte. Quattro specie nella versione 1: `pages`,
   `region`, `sections` e `image`. Un estratto che il `subpath` dice già
   tutto non ha il campo.
2. **Le misure sono frazioni di ciò che si vede.** Un rettangolo è
   `[x, y, larghezza, altezza]` in frazioni della pagina o dell'immagine
   come si vede, dall'angolo in alto a sinistra, con una tolleranza di 1e-6.
3. **Il `subpath` vince.** Se il campo non si capisce, non vale, non va
   bene per il file o il `subpath` non è quello della sua prima parte, la
   scheda mostra il `subpath` e il campo resta nel file byte per byte.
4. **Una lettura, due lingue.** Il nucleo Rust e la shell TypeScript leggono
   e scrivono con le stesse regole e gli stessi vettori, e i numeri si
   scrivono come in JavaScript.

La forma precisa, le regole e i vettori stanno in [Gli estratti della
lavagna](../reference/canvas-parts.md).

## Conseguenze

### Positive

- Obsidian, e ogni programma che legge JSON Canvas, mostra almeno la prima
  parte senza sapere niente di Fub;
- copiare, spostare o rinominare il file della scheda segue le regole delle
  schede di file, che ci sono già, link compresi;
- un rettangolo resta sopra la stessa parte della pagina a ogni misura della
  scheda e a ogni risoluzione con cui il PDF si disegna;
- una specie nuova è un `kind` nuovo: una versione di Fub che non la conosce
  la conserva e mostra il `subpath`.

### Negative

- **Due informazioni dicono la stessa cosa.** Il `subpath` ripete la prima
  parte di `fub:parts`; quando non tornano vince il `subpath`, e le parti in
  più non si vedono finché non si scelgono di nuovo.
- **Le frazioni dipendono dalla pagina come si vede.** Se il PDF cambia la
  misura o la rotazione di una pagina, il rettangolo non la segue; `key`,
  l'impronta della pagina, è il posto per accorgersene in una versione
  successiva.
- **Il codice è doppio.** Le regole stanno in Rust e in TypeScript; i
  vettori comuni sono ciò che le tiene uguali.
- **Che cosa fa Obsidian del campo quando riscrive il file** lo dice solo
  una prova con Obsidian vero, come per `fub:ink`: finché non c'è, la
  decisione resta proposta.

## Alternative scartate

### Un tipo di scheda nuovo

Un `"type": "excerpt"` con le sue parti. È più pulito per Fub, ma JSON
Canvas e Obsidian non lo conoscono: Obsidian lo mostrerebbe vuoto o lo
scarterebbe, e il file non sarebbe più una lavagna che altri programmi
leggono. Il campo accanto al `subpath` lascia una scheda `file` valida.

### Le coordinate in punti del PDF o in pixel

Un rettangolo in punti della pagina o in pixel dell'immagine. Dipende dalla
`MediaBox`, dalla rotazione della pagina e dalla risoluzione del file, che
il nucleo non legge; le frazioni di ciò che si vede bastano a disegnarlo e
si controllano senza aprire il file.

### `fub:parts` che vince sul `subpath`

Le parti di Fub sempre prima del `subpath`. Ma chi cambia il `subpath` fuori
da Fub, per esempio in Obsidian, vedrebbe Fub ignorare la sua modifica.
Mostrare ciò che dice il `subpath` è ciò che fa ogni altro programma.

## Verifica

- I vettori in `apps/client/src/__fixtures__/canvas-parts/`, un caso per
  file, sono la prova comune di `crates/fub-canvas-core/tests/parts_vectors.rs`
  e di `apps/client/src/editors/canvas/parts.test.ts`.
- Gli stessi test provano che spostare una scheda non tocca un byte del suo
  `fub:parts`, anche di una specie sconosciuta.
- La prova con Obsidian dice che cosa succede al campo quando Obsidian
  riscrive la lavagna.
