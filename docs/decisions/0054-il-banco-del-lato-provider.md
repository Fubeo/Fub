# 0054 — Il banco del lato provider: dove si prova un provider contro il contratto

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §16.1 (seduta 16) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) ·
[il gemello, lato host](0055-il-banco-del-lato-host.md)

---

Questa decisione e la [0055](0055-il-banco-del-lato-host.md) sono la seconda
coppia decisa in una volta sola dopo la [0049](0049-una-posizione-dentro-un-documento.md)/[0050](0050-cosa-si-chiede-a-una-ricerca.md)
e la [0051](0051-l-alimentazione-risponde.md)/[0052](0052-cio-che-va-storto-e-un-evento.md),
e il taglio è di nuovo per **ragionamento**: qui si decide cosa promette il
contratto a chi lo implementa, là cosa costa montarlo. Sul perché siano due
verbali e non uno, e su cosa questo dice del cappello di una seduta, sta in
fondo alla [0055](0055-il-banco-del-lato-host.md#il-cappello-di-una-seduta-può-dichiarare-anche-una-separazione).

## La domanda della seduta, e la risposta

Il cappello della seduta 16 dichiarava in anticipo che i due banchi sono
**due**: *«l'SDK è il lato provider, il testkit è il lato host, e non possono
stare nello stesso crate: `fub-kernel` nel grafo dell'SDK violerebbe
l'invariante che `dependency_invariant.rs` presidia»*.

La conclusione regge. La ragione no, ed è il punto da cui parte tutto il resto.

## L'invariante che la seduta invoca non era presidiata

`crates/fub-abi/tests/dependency_invariant.rs`, letto riga per riga, **non
nomina `fub-sdk` da nessuna parte**. Le sue reti sono:

| rete | su chi |
|---|---|
| denylist transitiva | `fub-abi`, `fub-kernel` |
| allowlist delle dipendenze dirette | `fub-abi`, `fub-kernel` |
| allowlist transitiva | `fub-abi` |
| il diagramma di `mappa-visuale.md` | tutti i membri |
| confine feature↔kernel | `fub-features` |
| confine host↔app | `fub-host` |

Un `fub-sdk` che avesse dichiarato `fub-kernel` sarebbe passato per tutte tranne
la quarta — e la quarta si sarebbe accontentata che qualcuno disegnasse la
freccia. L'invariante era nelle intenzioni, non nel test.

È la **sesta specie** della famiglia che il §16.7 tiene — quattro di conteggi
falsi, la quinta è il *limite dichiarato* che non c'è più, e questa: una
**garanzia dichiarata che non è mai esistita**. Le prime cinque sono descrizioni
invecchiate di qualcosa che esiste, e si curano aggiornandole; qui non c'è
niente da aggiornare, perché non c'è mai stato niente. Fa lo stesso danno del
limite invecchiato in direzione opposta — un limite falso fa **sotto**valutare
una copertura, una garanzia falsa la fa **sopra**valutare — e passa più a lungo
inosservata di tutte, perché il motivo per cui si scrive una garanzia è smettere
di doverci pensare. Aggiunta al §16.7, che è la voce che quell'elenco lo tiene.

**Deciso**: il presidio si scrive, in questo giro. Sono due test nuovi in
`dependency_invariant.rs` — `l_sdk_non_vede_il_kernel` e
`il_banco_di_prova_non_entra_in_nessuna_libreria` — e da adesso la frase della
seduta è vera perché c'è un test che la tiene, non perché è scritta.

## E la ragione vera è più forte di quella che la seduta dava

`fub-sdk` è **dipendenza normale** di `fub-format-markdown`
(`crates/fub-format-markdown/Cargo.toml`, `fub-sdk = { workspace = true }`). Non
è una relazione ipotetica di M5: è nel `Cargo.toml` oggi, perché il parser
markdown usa `fub_sdk::scan`.

Quindi il kernel dentro l'SDK non finirebbe «nel grafo di un futuro guest»:
finirebbe **nella libreria di un provider di formato che esiste**, subito. E non
basta metterlo dietro una cargo feature: l'unificazione delle feature nel
workspace la accende per tutti appena un membro la chiede, che è precisamente il
modo in cui un confine dietro una feature smette di essere un confine.

## Cosa c'era, e dove stava davvero

Il §16.1 diceva: *«il `MemoryHost` è `#[cfg(test)] mod testing` dentro
`fub-features` (`features/src/lib.rs`). Nessun autore di plugin, e nemmeno un
futuro modulo FubSuite in un crate a parte, può usarlo.»*

Il file era sbagliato — stava in `crates/fub-features/src/testing.rs`,
dichiarato da `lib.rs` — ma il fatto vero è **più forte** di quello che la voce
diceva. La riga era:

```rust
#[cfg(test)]
mod testing;
```

`#[cfg(test)]` **e privato**. Non «nessun autore di plugin»: nessuno tranne
`features/src/*`. Nemmeno gli integration test di `fub-features` stesso — che
stanno in `tests/`, compilano come crate separato e non vedono né un `mod`
privato né ciò che `cfg(test)` accende. Settecentonovantadue righe di doppio
dell'host, con l'orologio pilotabile che è il guadagno di aver messo il tempo
nel contratto, raggiungibili da quattro file.

## Deciso

**`fub_sdk::testing` è il banco del lato provider**, e contiene tre cose.

**1. `MemoryHost`**, spostato lì intero e reso pubblico. Dipendeva solo da
`fub_abi`, quindi il trasloco è un `git mv` più un `use`: il fatto che sia
costato zero è la misura di quanto fosse fuori posto.

**2. La suite di conformità**, `fub_sdk::testing::conformita`, che è la parte
che scade davvero — è ciò con cui un autore di plugin dirà «il mio provider
rispetta il contratto». Ogni funzione corrisponde a una frase del doc-comment di
un trait, e la porta nel messaggio d'errore.

**3. `fub_sdk::ui`** — e non `testing`, come il §16.1 proponeva. Un costruttore
di albero di view **non è codice di prova**: sotto `testing` sarebbe stato a
disposizione di un provider solo nei suoi test, cioè nel posto in cui non serve.

## Le proprietà erano scritte su metodi che non esistono più

Il §16.1 elencava *«un `IndexProvider` che non perde documenti fra
`on_document_*` e `flush`»*. Quei metodi si chiamano `on_documents_indexed` e
`on_documents_removed` dalla [0051](0051-l-alimentazione-risponde.md), prendono
un **lotto**, e restituiscono `Vec<IndexLoss>`.

Non è un rinominare. **La proprietà è cambiata di natura.** Quando la perdita
era muta, una suite poteva solo dedurla: indicizza, interroga, e se non trovi
concludi. Adesso la perdita è **dicibile**, e ciò che si verifica è la coerenza
fra quel che il provider dichiara di aver perso e quel che ha davvero — che è
più forte e più preciso. Un indice che ingoia un documento e restituisce un
elenco vuoto non è più «un indice che perde»: è un indice che **mente**, ed è
una condizione che ha un nome.

Le proprietà, ricavate da `abi/src/traits.rs`:

| funzione | la frase del contratto |
|---|---|
| `le_rotte_sono_stabili` | *«Cosa serve, dichiarato una volta alla registrazione»* |
| `le_perdite_nominano_solo_cio_che_e_stato_dato` | *«Ciò che si elenca è perduto, ciò che non si elenca è preso»* |
| `un_lotto_vuoto_non_perde_niente` | *«Un elenco vuoto vuol dire che è andato tutto bene»* |
| `up_to_date_risponde_solo_di_cio_che_ha_visto` | *«un indice che rispondesse di sì per sbaglio resterebbe indietro in silenzio»* |
| `cio_che_non_e_perduto_si_ritrova` | la proprietà del §16.1, riscritta |
| `chi_si_ridisegna_su_index_updated_dichiara_anche_batch_ended` | la [0011](0011-il-lotto.md), dal lato di chi scrive la view |
| `render_view_non_ha_memoria` | *«un `ViewProvider` che non muta durante `render_view`»* |
| `un_provider_testuale_rifiuta_i_byte` | *«risponde `Unsupported` invece di indovinare l'encoding»* |
| `gli_id_delle_view_sono_distinti` | due `ViewSpec` con lo stesso id sono due view che il kernel non sa distinguere |
| `ogni_view_dichiarata_si_disegna` | `views()` è una promessa: una `ViewSpec` che `render_view` non serve è una voce di menu che si apre su un errore |
| `il_descrittore_dichiara_almeno_una_estensione` | il registro instrada per estensione, e un formato che non ne dichiara nessuna non riceverà mai un file |

Più tre **aggregatori** — `un_indice_rispetta_il_contratto`,
`una_view_rispetta_il_contratto`, `un_formato_rispetta_il_contratto` — che non
sono proprietà: chiamano in fila quelle del loro trait, ed esistono perché chi
scrive un provider abbia una riga sola da scrivere.

> **Correzione.** Le ultime tre righe e questo paragrafo sono stati aggiunti dalla
> [decisione 0060](0060-il-modello-dice-il-vero-sui-byte.md): la tabella ne
> elencava otto quando il file che questo verbale creava ne aveva già quattordici.
> Un conteggio dei sorgenti scritto a mano in un documento invecchia da sé, e
> questo era falso il giorno in cui è stato scritto — il caso è consegnato alla
> [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md), che è la voce che tiene
> quell'elenco. La stessa decisione ha riscritto la sezione `FormatProvider`, che
> qui nasce con due proprietà e **nessun cliente**.

Due meritano una riga.

**`render_view_non_ha_memoria`** — la forma in cui il §16.1 la chiedeva è **già
garantita dal tipo**: `render_view` prende `&self`, mutare non compila. Ciò che
resta da verificare non è la mutazione, è la **mutabilità interna** — una cache
dietro un `Mutex` che renda il secondo disegno diverso dal primo a host fermo.
La voce chiedeva una cosa che il compilatore già fa; la proprietà utile è quella
accanto.

**`chi_si_ridisegna_su_index_updated…`** non riscrive la regola: chiama
`EventMask::misses_batches()`, che è del contratto. È la
[0020](0020-le-regole-in-un-posto-solo.md) applicata a un banco di prova — una
seconda idea della stessa regola, scritta dentro una suite, è il modo in cui due
presidi finiscono per non essere d'accordo.

## La suite ha un cliente vero, ed è un requisito

`crates/fub-features/tests/conformita.rs` fa passare la suite alle quattro view
ufficiali, a host vuoto e a host con un documento aperto. Non è una
dimostrazione: **una suite di conformità che nessuna implementazione vera passa
non è una suite, è un'opinione.** Se un'asserzione è troppo stretta lo si scopre
lì, su codice che il progetto controlla, invece che addosso al primo plugin di
terzi — che non ha modo di distinguere «ho sbagliato io» da «la suite pretende
troppo».

## Una copia che esisteva solo per via del posto sbagliato

Trovata spostando: `crates/fub-sdk/src/ids.rs` aveva un doppio dell'host scritto
a mano nei propri unit test, e il commento accanto ne dava la ragione:

> Non è `MemoryHost` perché quello sta in `fub-features`, che dipende da questo
> crate — e l'SDK non può dipendere da chi lo usa.

Il ragionamento era giusto, e la premessa è quella che questo verbale ha appena
tolto di mezzo. Il `random_bytes` di quel doppio era **identico riga per riga**
a quello di `MemoryHost` — stesso contatore little-endian, stesso orologio a
`1_700_000_000_000` — e l'unica cosa che aveva in più era un asse: un host che
**nega l'entropia**, per provare che chi costruisce un id se ne accorga invece
di produrne uno tutto a zeri.

Quell'asse è diventato `MemoryHost::senza_entropia()`, tre righe, e il doppio
locale è sparito: **cinquantatré righe in meno** in un crate che ne aveva
trecentocinquanta. Vale più della sua misura, perché è la forma generale del
danno: un banco di prova nel posto sbagliato non produce l'assenza di un banco,
produce **copie con una ragione scritta accanto** — e una ragione scritta
accanto è ciò che impedisce a chiunque di accorgersi che è una copia.

## Il §16.1 misurava una duplicazione che non c'è

La voce diceva: *«le feature ufficiali costruiscono già lo stesso albero tre
volte — una lista di voci con azione, e un segnaposto per il vuoto»*. Contato:

- `backlinks.rs` → colonna(intestazione, lista)
- `outline.rs` → colonna(albero)
- `tags.rs` → colonna(campo di filtro, lista)

**Non è lo stesso albero.** Ciò che è davvero scritto tre volte è una funzione
di **due righe** —
`fn placeholder(key) { UiNode::empty_state(Text::key(key)) }`, verbatim in
`backlinks.rs` e `outline.rs`, inline in `tags.rs` — più la convenzione con cui
una riga porta il proprio dato nel payload dell'azione.

Sono due funzioni in `fub_sdk::ui`, e il modulo è piccolo perché la duplicazione
lo era: raccogliere le tre copie di un albero che non esiste avrebbe voluto dire
inventarne uno che nessuno dei tre voleva. È la stessa disciplina che la
[0053](0053-il-contratto-ha-una-sorgente.md) ha imposto ai conteggi, applicata a
un conteggio che questa volta era **gonfio** invece che magro — ed è il primo di
questo verso.

## Cosa si è scartato

- **Lasciare `MemoryHost` dov'era e renderlo `pub`.** Toglie il `cfg(test)` ma
  non il problema: chi vuole provare un provider dovrebbe dipendere da
  `fub-features`, cioè da tantivy e dalle quattro view ufficiali, per avere un
  doppio dell'host. Il banco del contratto non può stare dentro un cliente del
  contratto.
- **Un crate `fub-conformance` a sé.** Un terzo crate per una suite che ha
  esattamente le stesse dipendenze dell'SDK — la frase qui contava le funzioni,
  e il numero non le serviva ([0060](0060-il-modello-dice-il-vero-sui-byte.md)).
  La linea che divide i crate qui è il **grafo delle dipendenze**, non
  l'argomento: `testing` e `conformita` stanno con `scan` e `ids` perché vedono
  le stesse cose, e il testkit sta fuori perché vede il kernel.
- **Generare la suite dal WIT.** Le proprietà stanno nella **prosa** dei
  doc-comment, che la [0053](0053-il-contratto-ha-una-sorgente.md) ha già
  stabilito essere il vincolo che tiene aperto quel verso. Un generatore avrebbe
  prodotto i controlli di forma, che `wit_conformance.rs` fa già, e nessuna
  delle proprietà di comportamento, che sono l'unica ragione per cui questa
  suite esiste.

## Cosa resta scoperto, dichiarato

- **`cio_che_non_e_perduto_si_ritrova` non ha ancora un cliente**: richiede un
  indice che dichiari rotte, e i due veri sono `CoreIndex` (che è `pub(crate)`
  nel kernel, quindi irraggiungibile da fuori) e `SearchIndex` (che ha bisogno
  di uno spazio dati su disco, cioè del banco della
  [0055](0055-il-banco-del-lato-host.md)). La funzione restituisce `false`
  quando non c'era niente da verificare, apposta perché chi la chiama non creda
  di essere stato promosso.
- **Il `TriesEverything` del §16.7** non è toccato: le sue capacità restano un
  elenco scritto a mano — fino alla
  [decisione 0056](0056-un-elenco-che-e-la-sorgente.md), che le ha smesse di
  elencare calcolandole da `Capability::ALL`. La suite di conformità non è il
  posto — quelle sono capacità dell'**host**, non proprietà di un provider.
