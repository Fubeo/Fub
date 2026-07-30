# 0019 — Il canale dati: chi risponde, e chi instrada

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §5.1–§5.5 (seduta 5, *ex* §2.28, §2.18, §2.17, §2.26, §1.27) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/05-il-canale-dati.md)

---

Cinque voci, e una sola frase che le tiene insieme: **il canale dati prometteva
di essere il canale di chiunque e non lo era**. La [decisione 0005](0005-canale-dati-verso-le-view.md)
lo aveva chiamato «il canale dati verso le view» e in quel giro gli aveva
aggiunto sei varianti — tutte dalla parte che nessun provider poteva servire.
Un autore di plugin leggeva nove varianti e ne poteva servire due; le altre
sette il kernel se le rispondeva da sé con un `return` prima del ciclo, e
nessuno glielo diceva.

Le cinque voci sono chiuse.

## La risposta, in una frase

**La query è un albero del contratto, chi la serve è dichiarato, e le risposte
del kernel sono un indice come gli altri.**

- **§5.3** — [`fub_abi::query`](../../crates/fub-abi/src/query.rs): una
  `QueryExpr` è un OR di clausole, una clausola un AND di letterali, un
  letterale un predicato eventualmente negato. La stringa libera vive dentro
  **una** foglia (`Text`), e non è più una sintassi.
- **§5.2** — [`QueryRoute`](../../crates/fub-abi/src/traits.rs): un indice
  dichiara alla registrazione le **famiglie** che serve e le **foglie** che sa
  valutare. Un conflitto si vede al montaggio; chi non ha dichiarato niente non
  viene interpellato; ciò che nessuno serve torna come `PluginError::Unserved`.
- **§5.1** — [`CoreIndex`](../../crates/fub-kernel/src/index/core.rs): grafo,
  metadati e conteggi dei tag sono un `IndexProvider` registrato per primo. Non
  un ramo prima del ciclo — un provider, sostituibile chiedendolo per nome.
- **§5.4** — un `query_index` generico sull'IPC, gemello di
  `render_view`/`view_action`. I quattro comandi bespoke non ci sono più.
- **§5.5** — `HostApi::list_documents` prende una finestra; le spec di view e
  comandi sono **dato di registrazione**.

## Le decisioni prese, da NON ridiscutere senza motivo

- **L'albero è a due livelli, in forma normale disgiuntiva.** Non è un albero di
  profondità arbitraria, e la ragione non è di gusto: al confine WIT i tipi
  ricorsivi passano solo per **arena** (è il prezzo che `block`, `inline` e
  `ui-node` pagano già), e un'arena per una query che un umano compone a mano
  costerebbe un mirror in più a ogni voce del linguaggio, per sempre. La DNF
  esprime **ogni** combinazione booleana — chi ha `(a OR b) AND (c OR d)` la
  distribuisce, ed è ciò che fa comunque un pianificatore — e ha in più la
  proprietà che serve: è già la forma che un query builder disegna (gruppi di
  righe in OR, righe in AND), quindi fra la UI e il contratto non c'è nessuna
  traduzione.
- **`full_text` e `properties` erano la stessa domanda in due lingue.** Adesso
  sono `documents`, e non è una fusione di comodo: finché erano due varianti, il
  join fra le due era **inesprimibile** — «le note `tipo: progetto` che parlano
  di rust» erano due domande e un'intersezione fatta a mano da chi disegna, cioè
  una cosa che la shell poteva fare e un plugin no. Per la stessa ragione
  `SearchHit` e `DocumentProperties` sono diventati un `DocumentMatch`: una riga
  porta la rilevanza e l'estratto se a selezionare è stato (anche) del testo, e
  le proprietà se sono state chieste.
- **Una foglia è un fatto, una variante è una risposta**, ed è la distinzione su
  cui poggia tutto il routing. Una **famiglia** ha un proprietario solo, perché
  lì la risposta si *compone* — il conteggio dei tag, l'elenco dei backlink, il
  verdetto di un controllo di salute — e due autori per la stessa risposta vuol
  dire che vince l'ordine di montaggio. Una **foglia** può averne più d'uno,
  perché `#rust` seleziona le stesse note per chiunque le conti: chi la rivendica
  promette la stessa risposta degli altri, e a chi sia andata davvero risponde il
  piano, che è ispezionabile. È ciò che permette a tantivy di dichiarare `Tag` e
  `Folder` — che ha indicizzato apposta — e al pianificatore di consegnargli
  `testo AND cartella` come una clausola sola invece di spezzarla: cioè il filtro
  **dentro** il motore, che è ciò che la 0005 aveva costruito con l'ambito e che
  una decomposizione ingenua avrebbe buttato via.
- **Il conflitto ha finalmente dove accadere, ed è la disciplina della
  [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md).** Due indici che
  rivendicano `Tags` non si oscurano più a vicenda: il secondo riceve un
  `RouteConflict` e **non si registra affatto** — nemmeno per le rotte libere che
  portava con sé, perché un indice registrato a metà risponde ad alcune domande e
  non ad altre senza che nessuno sappia quali. Sostituire resta possibile e si
  chiede per nome (`Workspace::replace_index_provider`), ed è anche il modo in cui
  l'indice del **kernel** si scavalca: `Backlinks`, `Tags` e gli altri non sono
  più un ramo privilegiato, sono rotte come le altre.
- **Il pianificatore è del kernel, e la struttura è del contratto.** Chi decide a
  chi va una foglia è [`index::plan`](../../crates/fub-kernel/src/index/plan.rs);
  cosa significhino OR, AND e la negazione è scritto **una volta**, in
  `QueryEvaluator`, e lo usano il pianificatore, l'indice del kernel e chiunque
  implementi un indice senza voler tradurre l'albero nel proprio motore. Due
  implementazioni della stessa algebra divergerebbero sul caso che nessuno prova
  — il `NOT` di un insieme vuoto, l'AND senza letterali — e la divergenza sarebbe
  muta.
- **Ciò che il destinatario non saprebbe valutare arriva già risolto**, dentro un
  `QueryPredicate::Docs`. Vale per le domande che portano un'espressione ma le
  serve un altro (i tag di un sottoinsieme, i vicini di una selezione): chi la
  riceve non deve sapere da quale domanda venisse, e non deve saper valutare
  foglie che non ha dichiarato.
- **Le faccette che la 0005 aveva dichiarato fuori portata adesso ci sono, e non
  sono costate un campo.** Quel verbale diceva: «le faccette sul risultato
  full-text servono un campo facet in tantivy e la decisione di chi le calcola».
  Con un linguaggio non servono nessuna delle due cose — `Tags { matching }` è i
  tag di *quel* sottoinsieme, il sottoinsieme è una query e i tag li conta chi li
  ha in cache. È il primo caso in cui una voce chiusa qui **toglie** lavoro a una
  voce futura invece di aggiungerne.
- **I semi dei vicini sono un'espressione, non un documento.** `Neighbors { seeds
  }` con i semi su tutto il vault, un passo, verso uscente **è** l'elenco degli
  archi: il grafo intero in una domanda sola. Senza, il §5.4 non si poteva
  chiudere — la 0005 aveva scritto che il grafo si ricostruisce «un documento
  alla volta», che dentro il kernel è ragionevole e sull'IPC vuol dire mille
  viaggi per disegnare un grafo, cioè un comando bespoke che resta.
- **`Unserved` è un errore a sé.** «Nessuno serve questa domanda» e «chi la serve
  ha fallito» arrivavano al chiamante nella stessa forma — un `BadArgs`, per
  giunta quello dell'**ultimo** interpellato mentre ogni altro errore tornava dal
  **primo** che lo dava — e chi disegna non poteva scegliere fra «installa un
  indice» e «qualcosa è andato storto». È il §12.2 applicato al canale più usato
  dopo la lista documenti, e arriva gratis col routing.
- **`BadArgs` è tornato a significare quello che dice.** Era il protocollo con
  cui un indice diceva «non è roba mia», quindi ogni provider doveva elencare in
  un `match` tutte le famiglie che *non* serviva. Adesso quel `match` è
  irraggiungibile per costruzione, e `BadArgs` vuol dire di nuovo una cosa sola:
  gli argomenti non stanno in piedi.
- **`select` ha tre casi e non una convenzione.** Era un `Vec<String>` con
  «vuoto = tutte», e la convenzione si è rotta quando le due domande sono
  diventate una: un elenco di risultati di ricerca che si trascina l'intero
  frontmatter di mille note è il default sbagliato, e «tutte» non si dice con una
  lista di chiavi che non si conoscono. `PropertySelect { None, All, Keys }`.
- **`list_documents` prende una finestra, e la cache dei metadati è ordinata per
  costruzione.** Le due cose vanno insieme: la finestra senza un ordine totale
  ripete e salta righe, e l'ordine imposto a ogni chiamata era un `sort` sul
  vault intero per rispondere a chi ne voleva venti. `HashMap` → `BTreeMap`: si
  paga un `log n` per lettura, si smette di pagare un riordino per interrogazione
  e una clonazione del vault per chiamata.
- **Le spec di view e comandi sono dato di registrazione.** `view_owner`
  chiamava `views()` su *ogni* provider per risolvere un id, e `check_params` la
  richiamava sul vincitore per convalidare i parametri: due giri di allocazioni
  per azione, sul percorso caldo di ogni render — e con le istanze della
  [0016](0016-cosa-e-una-view.md) quel percorso è quello di ogni click. La
  domanda però non era di prestazioni ma di **forma**: chi possiede la verità su
  cosa un provider offre. La risposta è il kernel, dal momento in cui il provider
  gliel'ha detta; chi cambia idea lo dichiara (`Workspace::refresh_specs`) invece
  di farlo scoprire a chi interroga. **I comandi avevano lo stesso difetto e si
  chiudono con la stessa riga**: `command_owner` rifaceva `commands()` su ogni
  provider a ogni invocazione.
- **La shell ha le stesse capacità di un plugin.** Erano quattro comandi Tauri —
  `search`, `list_tags`, `graph_data` e `backlinks` — e i primi tre avvolgevano
  lo stesso `query_index` mentre il quarto lo **scavalcava**, chiamando il grafo
  del kernel diretto. Adesso è un comando solo che porta una `IndexQuery`: il
  grafo smette di avere un canale privilegiato, i backlink smettono di avere il
  proprio, e la dieta dell'IPC del §16.6 diventa praticabile — un'allowlist che
  vieta i comandi bespoke non deve più dire di no a feature che non hanno altra
  strada. `GraphData` non è più nemmeno un tipo dell'app: il grafo è due query e
  la shell compone.

## Trovato per strada, e chiuso

**`IndexResult` non era serializzabile.** Tag interno (`kind`) con `Outline` che
porta una lista e `Custom` che può portare uno scalare: `serde_json` fallisce a
**runtime**, non in compilazione. Era latente finché nessuno metteva un
`IndexResult` sul filo — e il §5.4 ce lo mette a ogni ricerca. È lo stesso
difetto che la [0005](0005-canale-dati-verso-le-view.md) aveva trovato su
`PropertyValue`, `LinkTarget` e `Inline`, ed è stato trovato nello stesso modo:
mettendo un campione di ogni variante in un test che li serializza tutti (il
mirror TS↔Rust). Adesso il tag è adiacente (`kind` + `value`).

## Il dogfooding, che è dove si è scoperto se regge

[`canale_dati_e2e.rs`](../../crates/fub-features/tests/canale_dati_e2e.rs):
due indici veri — quello del kernel e tantivy — su un vault in cui testo e
frontmatter dicono cose **diverse**, che è l'unico modo perché un join possa
sbagliare in modo visibile.

Il test che conta di più è
[`le_note_di_un_tipo_che_parlano_di_qualcosa`](../../crates/fub-features/tests/canale_dati_e2e.rs):
senza di lui gli altri provano due canali che funzionano ognuno per conto suo,
che è esattamente ciò che c'era prima. La domanda ha due foglie di due
proprietari, nessuno dei due può rispondere da solo, e la risposta non è né
l'una né l'altra — le due metà, prese da sole, danno insiemi diversi, ed è la
prova che l'intersezione non è una delle due travestita.

Tre cose sono venute fuori solo scrivendolo:

- **Il pushdown non è un'ottimizzazione ma una promessa da mantenere.** La 0005
  aveva costruito l'ambito *dentro* tantivy proprio perché il totale e le pagine
  restassero veri; con le cartelle diventate foglie, una decomposizione ingenua
  le avrebbe valutate nel kernel e post-filtrate — cioè avrebbe rotto in silenzio
  una proprietà decisa. È da lì che nasce la regola «una foglia può avere più
  valutatori»: senza, tantivy non avrebbe potuto rivendicare `Folder` e il filtro
  sarebbe uscito dal motore.
- **La frase esatta non aveva bisogno di una sintassi.** `TextMode::Phrase` è un
  campo della foglia, e le virgolette che l'utente digitava (interpretate dal
  parser di una dipendenza) diventano una scelta esplicita di chi compone la
  query.
- **La negazione attraversa il confine fra due indici** senza che nessuno dei due
  la sappia fare: `rust AND NOT in Archivio` è una clausola dove una foglia è di
  tantivy e l'altra del kernel, e il complemento si prende sull'universo del
  vault — che è una cosa che solo il kernel sa qual è.

## La linea di base ritagliata

Il presidio dell'additività ha nominato le rotture, ed è il suo mestiere: sono
deliberate, sono pre-freeze, e la baseline è stata ritagliata con la ragione
scritta dentro `crates/fub-abi/wit/frozen/0.1.0.wit` (più la riga nella tabella dei ritagli del
suo README).

| cosa | perché |
|---|---|
| `index-query`: via `full-text` e `properties`, entra `documents` | erano la stessa domanda in due lingue che non si potevano comporre (§5.3) |
| `index-result`: via `search` e `properties`, entra `documents` | idem, dal lato della risposta: `search-hit` + `document-properties` → `document-match` |
| via `search-scope` | «dove cercare» è diventato due foglie del linguaggio (`folder`, `tag`) |
| `index-query-tags` / `-neighbors` / `-property-values`: primo campo | un'espressione al posto di un documento o di una lista di filtri |
| `index`: `routes` in più | senza, il dispatch resta per tentativi (§5.2) |
| `host-api.list-documents`: prende una `page`, risponde una pagina | è il metodo con cui un provider si guarda intorno (§5.5) |

Tutto il resto è **additivo**: i tipi del linguaggio, `property-select`,
`query-kind`/`predicate-kind`/`query-route`, `doc-ids-page`, e il caso
`unserved` in coda a `plugin-error`.

## Cosa NON è stato fatto, e perché

- **L'explain plan non è una superficie del contratto.** Il piano c'è ed è
  ispezionabile (`Workspace::query_plan`), ed è quello che rende il routing
  **provabile** invece che descritto — ma resta kernel-side. Farlo attraversare
  il confine vorrebbe dire una `IndexQuery` che ne contiene un'altra, cioè un
  tipo ricorsivo, cioè l'arena; e il cliente vero è il profiler del 9.2, che non
  esiste. Quando esisterà, saprà anche che forma vuole.
- **La shell non ha un query builder**, e la casella di ricerca manda una foglia
  di testo e basta. C'è una perdita dichiarata: `tags:rust` digitato nella
  casella non filtra più per tag, perché era **sintassi di tantivy** — cioè
  esattamente ciò che il §5.3 esiste per togliere. Le due strade per riaverlo
  sono entrambe aperte e nessuna è urgente: un builder (9.2) o un pugno di
  prefissi riconosciuti *dalla shell* e tradotti in foglie, che è una scelta di
  UI e non di contratto.
- **Il kernel non compone le rilevanze.** Quando due rami portano un punteggio
  resta il **maggiore**: sommarli vorrebbe dire inventare uno scoring che nessuno
  ha misurato. Comporle davvero è mestiere di chi indicizza, e ci arriva col
  pushdown — cioè quando la clausola gli va intera.
- **Il pushdown non porta giù `sort` e `select` verso un indice registrato.**
  Ordinare per una proprietà del frontmatter e riempire le colonne li fa chi il
  frontmatter ce l'ha in cache; un indice che ricevesse un `sort` che non sa
  onorare risponde `BadArgs` invece di ignorarlo, che è l'unica delle due
  risposte che non mente.
- **`QueryPredicate::Custom` non ha ancora clienti**, come `IndexQuery::Custom`.
  È il varco, e sta lì perché il giorno che un plugin vorrà un predicato suo non
  debba anche chiedere una migrazione del contratto.
- **Il §5.1 doveva andare col §8.1, e ne ha fatta la metà.** Il canale dati è
  adesso un sottosistema con un confine (`kernel/src/index/`), che è ciò che la
  scomposizione del `Workspace` deve accogliere; ma il `Workspace` resta un
  oggetto-dio con quindici campi, e la seconda metà — gli altri sottosistemi —
  è ancora il §8.1. Farla adesso avrebbe voluto dire scomporre tutto in un giro
  che ha già cambiato il contratto in sei punti.
- **`CoreIndex` copia i metadati invece di prenderli.** L'alimentazione è quella
  di ogni indice (`&DocumentModel`), quindi frontmatter, outline e link si
  clonano dove prima si spostavano. È il prezzo dichiarato del §5.1, ed è più
  piccolo di quanto sembri: il **corpo** in cache non ci va (è lo split
  metadata/body), quindi la copia è più piccola del modello che l'ha generata.
- **Nessuna cache dei piani.** Il piano si ricalcola a ogni query: è una
  camminata su una manciata di letterali e una lettura di due mappe. Metterci una
  cache adesso vorrebbe dire inventarne l'invalidazione (le rotte cambiano a
  ogni registrazione) per un costo che nessuno ha misurato.

## Verifica

`cargo test --workspace`: **518 verdi** (erano 497), fra cui la conformità
abi↔WIT coi tipi nuovi e la funzione `routes`, l'additività col ritaglio
dichiarato, i nove end-to-end del canale con due indici veri, i tre della
registrazione e della finestra, e i quattro del routing (nessuno interpella chi
non ha dichiarato, il conflitto al montaggio, la sostituzione per nome,
`Unserved`). `npx tsc` pulito, **165 test vitest** (erano 160: cinque li porta il
mirror del canale dati), `vite build` ok.

**Non verificato visivamente nell'app Tauri.** Tre cose meriterebbero un occhio
quando qualcuno la aprirà, e sono le tre che i test di questa shell non possono
vedere: la **ricerca** (la stringa dell'utente adesso è una foglia di termini, e
`tags:` non è più sintassi), il **grafo** (due query invece di un comando, e i
nodi arrivano da `documents`), e l'**autocompletamento dei tag**, che passa dallo
stesso canale generico.
