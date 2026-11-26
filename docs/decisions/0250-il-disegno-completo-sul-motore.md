# 0250 — Il disegno completo apre tutto il motore, a famiglie pigre, con l'interfaccia di Fub

- **Stato:** proposta
- **Data:** 2026-11-21
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La [0239](0239-il-disegno-sul-motore-vettoriale.md) fa passare dal motore
vettoriale (VectorCraft) gli strumenti semplici del disegno: Selezione, forme,
Testo, i colori e lo spessore. Lo spazio di lavoro Completo resta quello
scritto a mano in TypeScript, che non arriva a un editor vettoriale
professionale. Il motore sa già tutto: alla revisione fissa `cfb30d81` ha 100
strumenti, 881 comandi, 397 voci della sua interfaccia, 130 effetti e 43
pannelli, 1551 righe in tutto, contate dal generatore della mappa su quella
revisione.

Il 2026-11-05 il manutentore ha chiesto tre cose per il disegno completo:

1. la parità completa: ogni funzione del motore raggiungibile in Fub, con la
   mappa intera e niente tolto in silenzio;
2. il caricamento pigro, misurato e con il suo cancello: mai il motore intero
   all'avvio;
3. l'interfaccia di Fub: la cornice dello Scrittoio, il kit e i token, non
   quella del motore.

Le tre richieste vincolano insieme host, adattatore, client, file e IPC, e
la loro forma è costosa da invertire: per questo stanno qui.

## Decisione

1. **La parità ha un contratto: la mappa.** `crates/fub-disegno/mappa.tsv`
   elenca ogni funzione del motore con il suo posto in Fub. Una riga è
   **fatta** quando si raggiunge dal suo posto (menu, colonna, ispettore,
   finestra, banda o tasto), fa sul disegno ciò che fa nel motore e si
   annulla con un passo, e il suo caso nel banco di prova delle righe lo
   dimostra; è **fub** quando la serve una funzione di Fub (Salva, le schede,
   le Impostazioni, i recenti), scritta nella colonna `fub`; è **esclusa**
   con il suo perché. Alla fine nessuna riga resta da fare.
2. **Il motore non tocca il disco.** Ogni byte che legge o scrive passa dal
   kernel: aprire, salvare ed esportare, le librerie, le preferenze, il
   recupero. Il motore non ha una cartella di sessione e non scandisce i
   caratteri del sistema.
3. **Le famiglie sono le unità pigre.** Le funzioni stanno in famiglie (la
   colonna `famiglia` della mappa). Nel processo il codice è compilato, e
   pigro è lo stato: cache, tabelle, librerie e lavori di una famiglia
   nascono al suo primo uso e li libera il `Budget` dello strato dei motori
   ([0236](0236-lo-strato-dei-motori.md)). Nel client ogni famiglia è un
   chunk `drawing-fam-<id>`, caricato con `import()`.
4. **L'indice è generato.** Etichette, posti e tasti di tutte le righe fatte
   stanno in un indice che il Rust genera come gli altri mirror. Nel client
   non c'è un elenco dei comandi scritto a mano.
5. **Gli id.** In Fub un comando del motore si chiama `disegno.<id del
   motore>`. I tre comandi della 0239 restano come sono
   (`disegno.colore-tratto`, `disegno.colore-riempimento`, `disegno.spessore`),
   e la colonna `fub` della mappa li lega a `paint.setStroke`,
   `paint.setFill` e `stroke.set`.
6. **L'annulla è del client**, come nella 0239: un gesto o un comando è un
   passo della cronologia di Fub, e quella del motore non si usa.
7. **I pannelli diventano sezioni.** Un pannello del motore diventa una
   sezione dell'ispettore, una finestra del kit o una voce della banda, come
   dice la colonna `posto`. Non ci sono pannelli da agganciare né fluttuanti.
8. **I testi.** Le etichette italiane vengono dal catalogo italiano del
   motore, passate per un glossario di Fub; quelle inglesi vengono dal
   motore. Passano tutte dal gergo vietato di `apps/client/src/i18n/gergo.ts`,
   e nell'interfaccia non c'è nessun nome VectorCraft, ArtCraft o Craft: si
   dice «Motore del disegno».
9. **Le cose dell'utente stanno nel vault.** Le librerie (campioni, pennelli,
   simboli, stili grafici) e i caratteri aggiunti stanno in
   `.fub/plugins/fub.draw/librerie/`, i dati del plug-in del disegno, letti e
   scritti dal kernel. Gli spazi di lavoro salvati sono un'impostazione di
   Fub, `draw.workspaces`.
10. **I numeri sono misurati.** I conti della mappa sono quelli del
    generatore sulla revisione fissa, e un tetto di memoria o di byte nasce
    da una misura scritta in `docs/misure/`.
11. **Il componente e le feature.** Il Completo del motore è il componente
    «Disegno completo», che richiede il «Motore del disegno» e si spegne con
    lui. Gli importatori e gli esportatori sono il sottocomponente «Formati
    del disegno». Le feature Cargo sono `drawing-complete`, `drawing-formats`
    e `drawing-script`. I plug-in WebAssembly del motore non hanno una
    feature: restano fuori dal binario finché un'ADR non li ammette.
12. **Il disegno dentro una nota** resta quello della
    [0248](0248-il-disegno-nella-nota-si-modifica-sul-posto.md): la superficie
    compatta sta nel Semplice e non carica niente del Completo; «A tutta
    pagina» apre il Completo. Questa ADR non la cambia.

## Conseguenze

### Positive

- La mappa è il contratto della parità: una funzione senza riga, o una riga
  che sparisce, la vede una guardia.
- Il client non nomina il motore: parla di comandi `disegno.*`, di famiglie e
  di un indice, e il confine della 0239 (`check-engine-boundary.mjs`) resta.
- Ogni pezzo del Completo arriva tardi: all'avvio e nel Semplice non si
  carica niente, e una famiglia occupa memoria solo da quando la si usa.
- Il file resta un SVG che si vede ovunque, scritto dal client con le
  operazioni di scena.

### Negative

- La mappa si rigenera a ogni aggiornamento del motore (righe nuove da fare).
- Ogni comando e strumento sa la sua famiglia, e il client dice «Si
  prepara…» al primo uso.
- Il motore non sa negare il disco né liberare le sue tabelle globali da sé:
  servono patch numerate in `vendor/vectorcraft/patches/`.

## Alternative scartate

### Il Completo del motore come terzo spazio

Plausibile, perché lascia intatto il Completo nativo. Scartata: uno spazio in
più confonde. Con il componente acceso il Completo è quello del motore, con
il componente spento resta il Completo nativo, come ripiego.

### I pannelli del motore fluttuanti

Plausibile, perché chi viene dal motore li ritrova. Scartata: non è
l'interfaccia di Fub, e a 264 px di ispettore 43 schede non ci stanno. I
pannelli diventano sezioni delle schede, più «Pannelli ›» nel menu ≡.

### Il motore in WebAssembly nel client

Plausibile, perché il disegno completo vuole molte risposte veloci. Scartata
per le ragioni della 0239: i motori vivono nell'host con la loro custodia e i
loro limiti di memoria, e il motore intero nel client peserebbe sul
caricamento della superficie.

### Un chunk unico per il Completo

Plausibile, perché è un solo `import()`. Scartata: chi usa la penna
scaricherebbe anche gli effetti, il raster e il 3D, e il caricamento pigro
non si potrebbe misurare per famiglia.

## Le scelte del 2026-11-21

L'orchestratore ha deciso D1–D8 e D10–D12 con la raccomandazione; D9 resta
al manutentore. Le righe stanno nel registro di `DECISIONS.md`.

- **D1, i tasti:** nel Completo quelli del motore, nel Semplice quelli di
  Fub; i tasti globali di Fub (Ctrl+P, Ctrl+K, Ctrl+W, Ctrl+Tab) vincono.
- **D2, i pannelli:** sezioni delle schede dell'ispettore, più «Pannelli ›».
- **D3, il Completo:** quello del motore, o quello nativo a componente spento.
- **D4, lo spazio di lavoro:** nella banda, accanto alla modalità, e nel ≡.
- **D5, la penna:** «Penna» è la penna di Bézier del motore; la penna a mano
  libera di Fub diventa «Inchiostro», nello stesso gruppo.
- **D6, le righe escluse:** i link dell'Aiuto del motore, la barra
  contestuale mobile e l'aggancio libero dei pannelli, ognuno col suo perché.
- **D7, gli insiemi di tasti del motore:** in Impostazioni › Scorciatoie.
- **D8, raster e 3D:** compilati dentro, pigri come le altre famiglie.
- **D9, formati, script e plug-in:** da decidere. La raccomandazione è (a):
  «Formati del disegno» acceso di serie, lo script compilato dentro, i
  plug-in WebAssembly fuori finché un'ADR non li ammette, con le loro righe
  escluse. Ogni dipendenza nuova chiede il sì del manutentore.
- **D10, ciò che l'SVG non sa dire:** la ricetta in `<metadata>`, nello
  spazio dei nomi del motore, con l'impronta dell'elemento; un elemento
  cambiato fuori da Fub perde solo la sua ricetta, e lo dice.
- **D11, le librerie dell'utente:** in `.fub/plugins/fub.draw/librerie/`.
- **D12, i caratteri dell'utente:** in `librerie/caratteri/` della stessa
  cartella; quelli del sistema non si scandiscono mai.

## Verifica

- `node .github/scripts/check-disegno-mappa.mjs --finale`: le righe della
  mappa sono quelle del motore alla revisione fissa, e ognuna è fatta, fub o
  esclusa;
- `cargo test -p fub-disegno --test famiglie` e `--test copertura`: ogni riga
  fatta ha il suo caso, il suo posto e la sua etichetta;
- le regole di `apps/client/vite.config.ts` (`NOT_AT_STARTUP` e quelle sulle
  importazioni del Completo) e lo scenario V1 del banco WebView: niente del
  Completo all'avvio, e solo le famiglie usate;
- `cargo test -p fub-host --test famiglie_pigre`: una famiglia nasce al primo
  uso, il `Budget` la libera, e con il componente spento non nasce;
- `cargo test -p fub-disegno --test disco`: il motore non tocca il disco;
- `check-engine-boundary.mjs`: solo `fub-disegno` nomina il motore.

La pagina di architettura è [Il disegno completo](../architecture/disegno-completo.md).
