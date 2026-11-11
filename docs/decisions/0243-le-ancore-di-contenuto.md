# 0243 — Le ancore di contenuto

- **Stato:** proposta
- **Data:** 2026-11-11
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

L'inchiostro della lavagna sta nei campi `fub:ink` del `.canvas`
([ADR 0241](0241-inchiostro-sulla-lavagna.md)). Ogni tratto ha un'ancora che
dice in che unità sono i suoi punti: `card` (la scheda alla misura di quando
il tratto si è scritto) o `free` (la lavagna).

Una scheda PDF mostra una pagina alla volta, e si sfoglia. Con la sola
ancora `card` un segno fatto sulla pagina 3 resta sopra la pagina 4 quando
la scheda volta pagina: il segno è della scheda, non della pagina. L'utente
ha scelto che il segno sia della pagina (D-4 del piano N6, risposta del
2026-11-02): cambiando pagina sparisce con lei, e torna tornandoci.

La forma dell'ancora è un contratto su disco fra Rust, TypeScript e gli
altri programmi che leggeranno il file: cambiarla dopo vuol dire convertire
i file. Le prossime schede vorranno lo stesso per altre parti di un file
(le celle di un foglio, piano N6 T37).

## Decisione

1. **Un'ancora nuova, `page`.** `{"kind": "page", "page": 3, "width": 595,
   "height": 842}`: la pagina da 1 e la sua misura in punti PDF (1/72 di
   pollice), la pagina come si vede, con la sua rotazione. I punti del tratto
   sono in punti PDF dall'angolo in alto a sinistra di quella pagina. Vale
   solo nel livello di una scheda.
2. **Il tratto è della pagina se comincia sulla pagina.** Sopra la scheda
   ma fuori dalla pagina (la testata, il margine) il tratto prende l'ancora
   `card`, come prima. Un tratto che parte sulla pagina e ne esce resta
   della pagina, e la resa lo taglia alla scheda.
3. **Si disegna solo sulla sua pagina.** La resa porta la pagina scritta sul
   rettangolo dove la scheda la mostra (lo stesso fattore nei due sensi,
   dall'angolo in alto a sinistra), da viva e da ferma. Il nucleo non sa
   dove la pagina sta nella scheda: non sposta né ridimensiona un tratto di
   pagina, e il Lazo non lo prende; la gomma sì.
4. **Un'ancora che non vale si conserva.** Una pagina non intera o minore di
   1, una misura non positiva, o un'ancora `page` che una versione vecchia
   di Fub non conosce: il tratto resta nel file com'era e non si disegna
   (ragione `anchor`). I campi sconosciuti dell'ancora si conservano.
5. **Come cresce.** Una parte nuova di un file è un `kind` nuovo
   dell'ancora, con i suoi campi e i suoi vettori, mai un campo nuovo
   dentro `card`: `card` e `free` restano identici byte per byte.

## Conseguenze

### Positive

- un segno resta sulla pagina dove è stato fatto, anche se la scheda cambia
  misura o pagina;
- un altro programma che ha il PDF ritrova il posto del segno senza sapere
  come Fub disegna la scheda: i punti PDF sono l'unità del PDF;
- la pagina scritta nell'ancora dice la misura anche a chi non ha il PDF; se
  il PDF cambia, il segno si scala sulla pagina nuova;
- i file di N4 non cambiano, e una versione vecchia conserva i tratti nuovi.

### Negative

- una versione vecchia di Fub non mostra i tratti di pagina: li conserva e
  basta;
- un PDF sostituito con uno più corto lascia tratti che non si vedono (la
  pagina non c'è più), finché il file non torna o qualcuno li toglie;
- il Lazo non sposta un tratto di pagina: il nucleo non conosce il
  rettangolo della pagina.

## Alternative scartate

### Un campo della scheda (`fub:page` sui tratti, o un livello per pagina)

Un campo sulla scheda o un livello per pagina terrebbero insieme tratti in
unità diverse, e un lettore che non lo conosce disegnerebbe ogni tratto su
ogni pagina, senza saperlo. Un `kind` nuovo invece è sconosciuto a chi non
lo sa leggere, e il tratto si conserva senza disegnarsi.

### L'inchiostro della scheda su ogni pagina (D-4 b)

Più semplice, ma il segno della pagina 3 resta sopra la pagina 4: è ciò che
la scelta dell'utente esclude.

### L'inchiostro nel `.fubann` del PDF

Le note del PDF stanno accanto al file. Mettere lì l'inchiostro della
lavagna lo farebbe vedere in ogni lavagna e nel lettore PDF, e la lavagna
non sarebbe più la sola a tenerlo: è una domanda aperta del piano, non
questa.

### Le unità della scheda dentro la pagina

Unità della lavagna dall'angolo della pagina mostrata dipendono da come Fub
disegna la scheda (la larghezza, la testata): un altro programma non le
saprebbe ritrovare.

## Obsidian

Obsidian non conosce i campi `fub:ink` e non vede niente dell'inchiostro:
come per le altre ancore, i livelli restano suoi da conservare, e ciò che fa
quando riscrive il file lo dice la prova dell'ADR 0241.

## Verifica

- I vettori `page-anchor` e `reason-page` di
  `apps/client/src/__fixtures__/canvas-ink/` passano nel nucleo
  (`crates/fub-canvas-core/tests/ink_vectors.rs`), nella facciata `.wasm`
  (`crates/fub-canvas-wasm/tests/`) e nel client
  (`apps/client/src/editors/canvas/wasm/ink-vectors.test.ts`); i vettori di
  N4 passano senza cambiare un file.
- `apps/client/src/editors/canvas/engine-ink-anchors.test.ts`: un tratto
  sulla pagina 2 sparisce sulla 3 e torna sulla 2; un tratto fuori dalla
  pagina ha l'ancora `card`.
- Il formato: [L'inchiostro della lavagna](../reference/canvas-ink.md#lancora-di-pagina).
