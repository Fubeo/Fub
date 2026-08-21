# 0138 — Una finestra di 220 caratteri attorno al link

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: la [§25.4](../roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#254-quanto-contesto-porta-un-backlink)
— *«Quanto contesto porta un backlink»* — nella forma **(b)** che la voce
stessa raccomandava, e con lei il difetto misurato **0110**, chiuso come
«vera e trascurabile, detta coi numeri» e non come «riparata con la fetta
condivisa» che la riga proponeva.
**Commit**: *(questo commit)*

---

**La regola che questo verbale fissa.** Il contesto di un backlink è una
**finestra di 220 caratteri attorno al link**, ritagliata sul testo renderizzato
del blocco che lo contiene, con l'ellissi ai bordi dove taglia — `…` in testa,
in coda, o in entrambe, e il link non si taglia mai: è il riferimento di cui la
riga parla. La regola sta in
[`fub_abi::rules::snippet`](../../crates/fub-abi/src/rules/snippet.rs)
(`window(testo, intervallo) -> String`, con la costante `SNIPPET_CHARS` accanto)
perché il provider WASM di M5 la erediti invece di reinventarla
([0020](0020-le-regole-in-un-posto-solo.md)), e il tetto resta una **costante
Rust fuori dal contratto**, visibile quando morde e mai interrogabile
([0094](0094-un-tetto-che-si-fa-sentire.md)): il WIT continua a dire
`context: option<string>` (`frozen/0.1.0.wit:130`, `:1738`), e la (b) ci mette
meno byte dentro. Il numero è lo stesso dello snippet di ricerca:
`SNIPPET_CHARS` è migrata da `fub-features/src/search.rs` a
`fub_abi::rules::snippet` **senza cambiare nome**, e la ricerca e i backlink
smettono di avere due idee di quanto sia un estratto. Il taglio è in
**caratteri**, non byte — 220 caratteri CJK sono 660 byte — e cade su confini di
carattere: mai un panic su un `String`, e un'emoji ZWJ può essere divisa a metà,
che è il limite dichiarato.

**Il conto.** Misure della voce a `bc1d27d`: 4.367 link, **53.994.565 byte** di
contesti (16,6× il vault), mediana 341, massimo 195.738. Dopo la finestra: 4.367
× ≤222 caratteri ≈ **969 KB**, l'**1,8%** — con la clausola che il tetto è in
caratteri e la stima vale per l'ASCII (220 char CJK = 660 byte, fino a ~2,9 MB).
`entries.json` scende da 54.934.932 B a circa un megabyte, e il pannello dei
backlink riceve ≤222 caratteri per riga invece dei 203 KB mediani che la voce
misurava all'IPC.

**Cosa si scarta, e perché.** La **(a)** — tetto in testa — mostra la cosa
sbagliata: su un blocco da 195 KB taglia prima del link e il frammento non
contiene il riferimento di cui parla; è l'unica differenza fra le due che
l'utente vede. La **(c)** — niente contesto memorizzato, si rilegge quando serve
— sposta il costo dall'indice alla lettura, e il pannello backlink si ridisegna
a ogni cambio di documento in un punto in cui oggi non c'è I/O. La **(d)** —
blocco intero condiviso — non ripara il disco: `entries.json` è JSON e
serializza N volte lo stesso. La prova che decide, *il secondo chiamante la
eredita gratis?*, dà **sì** per la (b): la regola sta nelle `rules` e il
markdown nativo e il provider di M5 la chiamano identica.

**Le premesse cadute, col perché sembravano vere.**

1. **«Il contesto è copiato per intero tre volte lungo la catena» (`0110`) è
   falso nel conto: sono due copie e una move.** `parse.rs:607` crea la `String`
   (copia 1), `graph.rs:495` la clona in `register_links` (copia 2),
   `graph.rs:589` fa `context: link.context` — una **move**, non una copia — e
   la tappa non è `backlinks()` ma `link_document` nel kernel. In più la riga
   non conta il clone del render (`backlinks.rs:190`) né la serializzazione in
   `entries.json`. Sembrava vera perché `BacklinkRef` porta il proprio `context`
   — campo per campo sembra una copia — e `backlinks()` è il nome che chi legge
   associa alla fine della catena.
2. **Perché `0110` si chiude lo stesso.** La riga proponeva la fetta condivisa
   del sorgente; la (b) non la fa — le copie restano strutturalmente — ma quando
   ogni copia vale ≤222 caratteri, una fetta condivisa risparmierebbe ~970 KB,
   non i 54 MB: **il difetto non era la duplicazione, era la dimensione**. È la
   chiusura piena che il giro chiama «vera e trascurabile, detta coi numeri»,
   con un numero per lato.
3. **La domanda «una costante o due» era già decisa dalla voce stessa** (punto
   6: «lo stesso numero di `SNIPPET_CHARS`, e in un posto solo, non due»). La
   novità misurata è la **terza copia** della costante:
   `examples/una_ricerca.rs:62` la ridefiniva a mano. Sembrava che fossero due,
   perché un `grep` sui file `src/` non cammina gli `examples/`.
4. **La voce sottostima il costo della (b).** «Costa un `char_indices` e due
   numeri» — costa anche **registrare la posizione del link nel testo
   renderizzato**, che non esisteva da nessuna parte: il modello ha lo span
   assoluto nel documento, il contesto è il render, e i due non coincidono (un
   wikilink è otto byte nella sorgente e quattro nel render). È il punto in cui
   la forma poteva nascere sbagliata in silenzio: se la posizione manca, la
   finestra si centra sul nulla. La registrazione avviene in `convert_inlines`
   al momento del `push_str` dell'etichetta, in un contenitore unico —
   `Acc.links: Vec<(Link, Range<usize>)>` — che non può disallinearsi. Sembrava
   vera perché «due numeri» descriveva il ritaglio, non la sua precondizione.
5. **Il tetto è in caratteri e non in byte**, e la stima «≈960 KB, 1,8%» è il
   caso ASCII. Un tetto in byte darebbe righe di lunghezza visiva diversa a
   seconda della lingua; la metrica giusta è la riga visibile, che il CSS tronca
   in pixel.
6. **Un presidio che nessuno aveva nominato aggancia `search.rs` per numero di
   riga**: `crates/fub-app/tests/schemi_su_disco.rs` pretende che
   `docs/versionamento.md` punti alla riga esatta di `SCHEMA_VERSION`, e
   togliere `SNIPPET_CHARS` da `search.rs` — una riga di costante in meno, un
   `use` in più — ha spostato la costante di una riga e acceso il banco. È una
   **classe** di trappola: nel repo esistono ancoraggi per riga, e chi tocca un
   file agganciato li sposta senza saperlo. La riga di `versionamento.md` è
   stata aggiornata nello stesso commit, ed è il genere di presidio che va
   cercato per nome prima di toccare un file molto citato.
7. **Il banco delle divergenze dichiarate del corpus ha preso in fallo il primo
   giro del codice**: aggiungendo per sbaglio l'`alt` dell'immagine al testo del
   blocco (un `push_str` in più nel ramo `Image`), il banco
   `le_divergenze_sono_quelle_dichiarate` è andato rosso — la divergenza
   dichiarata «l'alt di un'immagine non entra nel testo indicizzato» non si
   presentava più. Un presidio che si prova da solo è la cosa che questo repo
   cerca, e ha funzionato al primo colpo.

**I due fatti tecnici pagati.** `Range<usize>` **non è `Copy`** — il chiamante
fa `clone()`, due `usize`, costo nullo — e
`str::floor_char_boundary`/`ceil_char_boundary` sono stabili da **1.91** mentre
l'MSRV del workspace è **1.89**: implementati a mano nel modulo, e
`clippy::incompatible-msrv` li ha beccati prima che arrivassero in CI. Sono la
ragione per cui `snippet.rs` ha codice che sembra ridondante e non lo è.

**Cosa resta scoperto.** Il campo `Link.context: option<string>` resta nel WIT
congelato: il contratto non cambia, e la politica si cambia domani finché la
regola sta scritta in un posto solo. Il pannello dei backlink non tocca una
riga: i byte arrivano già corti dal basso. E il tetto della finestra non è un
tetto di byte: chi avrà un caso d'uso per contesti più lunghi alza la costante
in `fub-abi` e la ricerca la segue — a patto di scriverlo nel doc della
costante, che è il posto in cui la 0094 dice di farlo sentire.
