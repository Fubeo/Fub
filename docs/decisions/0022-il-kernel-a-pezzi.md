# 0022 — Il kernel a pezzi: cinque proprietari invece di ventiquattro campi

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §8.1 (seduta 8, *ex* §2.19) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/08-il-kernel-a-pezzi.md)

---

Una voce sola, e una precedenza dura che il quarto giro aveva scritto:
**l'8.1 va prima dell'8.2 e dell'8.3**, o il crate host nasce attorno
all'oggetto-dio e il lock non potrà mai essere a grana fine. È anche il posto
dove tutte le altre voci del piano andranno ad atterrare — una alla volta, come
campi.

La voce è chiusa. L'8.2 e l'8.3 restano aperte, e adesso hanno su cosa poggiare.

## La risposta, in una frase

**`Workspace` ha cinque campi, e ognuno ha un nome che dice di cosa risponde.**

| Componente | File | Cosa possiede |
|---|---|---|
| [`DocumentStore`](../../crates/fub-kernel/src/documents.rs) | `documents.rs` | il disco, e come ciò che ci sta sopra diventa un modello: vault, registro dei formati, sintassi innestate (§3.1), renderer dei blocchi custom (§3.2) |
| [`Indexes`](../../crates/fub-kernel/src/index/mod.rs) | `index/` | il canale dati: metadati, grafo, tag, gli indici registrati e il routing (§5.1, §5.2) |
| [`ProviderRegistry`](../../crates/fub-kernel/src/providers.rs) | `providers.rs` | chi è registrato, cosa ha dichiarato, chi possiede quale nome: le sei tabelle, il registro dei plugin (0021), le due catene di chiamate in corso |
| [`Dispatcher`](../../crates/fub-kernel/src/dispatcher.rs) | `dispatcher.rs` | quando un evento parte, con che nome e per quanto: bus, coda, lotto (0011), origine (0012), budget, coda dei job |
| [`Session`](../../crates/fub-kernel/src/session.rs) | `session.rs` | cosa sta guardando l'utente adesso: il contesto del pannello con il focus (0007) |

Da **ventiquattro** campi piatti a **cinque** proprietari. Nessun cambiamento di
comportamento: le 51 suite di test passano identiche, prima e dopo.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Il taglio passa fra *decidere* e *chiamare*, non fra sottosistemi.** È la
  scoperta che ha dato forma a tutto il resto. Ogni chiamata a un provider vuole
  un `HostApi`, e un `HostApi` è costruito su `&mut Workspace` — cioè su
  **tutto** il workspace, non su un componente. Quindi `render_view`,
  `view_action`, `invoke_command`, `import`, `export`, `call_service`,
  `deliver_to_handlers` e `dispatch_pending` **restano orchestratori sul
  `Workspace`**, e nei componenti c'è solo ciò a cui si risponde *senza
  svegliare nessuno*. Non è un compromesso: è la linea lungo cui il `RwLock`
  del §8.3 potrà davvero diventare a grana fine, perché è la linea che separa
  le letture pure dalle chiamate rientranti.
- **I componenti sono raggruppamenti di proprietà, non muri.** I campi di
  `DocumentStore` e `ProviderRegistry` sono `pub(crate)`. La ragione è che le
  operazioni composte del `Workspace` (rinomina, cestino, riscrittura dei link)
  usano una dozzina di verbi diversi del vault, e una facciata che li ripetesse
  tutti sarebbe una seconda copia della `Vault` senza esserne una. Ciò che è
  *dentro* i componenti è la logica che ha una regola da difendere — la
  pipeline di parse, il budget del drenaggio, la coalescenza del lotto, il
  confronto dei contesti — non i getter.
- **Le guardie di stato sono coppie, non funzioni con chiusura.** `as_actor` e
  `with_provider_call` prendevano una `impl FnOnce(&mut Workspace)`. Nel
  `Dispatcher` sono diventate `swap_actor`/`restore_actor` e
  `enter_provider_call`/`restore_provider_call`, e il `Workspace` ci avvolge
  sopra le versioni con chiusura. Il motivo è lo stesso di sopra: la chiusura
  vorrebbe `&mut Workspace`, che è esattamente ciò che il componente non deve
  avere.
- **Il budget del drenaggio sta nel `Dispatcher`, il ciclo sul `Workspace`.**
  `next_to_deliver` rende un `ToDeliver::Notice` o un `ToDeliver::Overflow`, e
  con esso decide quando fermarsi, cosa scartare e cosa mettere al posto di ciò
  che si scarta. Il ciclo che sta sul `Workspace` non conta nulla e non sa cosa
  sia un `Overflow`: chiede il prossimo e lo passa agli handler. La semantica di
  consegna — che è **contratto** dal freeze di M4 — è quindi scritta in un posto
  solo, e quel posto non è quello che presta l'host.
- **`Session::publish` rende la maschera, non gli id delle view.** Pubblicare un
  contesto vuol dire anche dire alla shell quali view ridisegnare, e
  quell'elenco si calcola sulle spec dei provider. Il componente risponde a
  *cosa è cambiato* (`ContextMask`); il `Workspace` traduce la maschera in id.
  È deliberato che la sessione non sappia che le view esistono.

## Trovato per strada, e chiuso

- **I campi erano ventiquattro, non ventitré.** Il conto del piano era vecchio
  di un sottosistema. La voce diceva anche che il conto si era mosso «da 1750
  righe e ~20 campi a 2903 e 23 **mentre il piano veniva scritto**»: ha
  continuato a muoversi.
- **Non esiste una cache dei modelli parsati.** Il §8.1 dava `DocumentStore` =
  «vault + cache + parse», ma la cache non c'è: lo split metadata/body vuole che
  il corpo si rilegga dal disco a ogni richiesta (`parse_from_disk`), e la cache
  tiene i soli metadati. Ciò che *sembrava* la cache è
  `indexes.core.metas`, ed è la cache **dei metadati dell'indice** — usata come
  prova di esistenza da `is_taken`, `read_model`, `render_preview` e
  `render_embed`. È il motivo per cui quei quattro metodi incrociano due
  componenti e non uno: la domanda «questo documento esiste?» ha come risposta
  l'indice, non il vault. Scritto in testa a `documents.rs`, perché è
  esattamente il presupposto che il piano dava per buono.
- **`extension_of` usava `rsplit_once('.')`, non `Utf8Path::extension`.** Le due
  danno risposte diverse per un file che comincia con un punto. Migrata com'era.

## Cosa NON è stato fatto, e perché

- **`Indexes` non è stato rinominato `MetadataIndex`.** Il §8.1 lo nominava così,
  ma il componente esiste già, ha già il suo modulo (`index/`) e il nome
  `Indexes` dice una cosa in più che è vera: sono l'indice del kernel **e**
  quelli registrati. Rinominarlo avrebbe cambiato le citazioni senza cambiare la
  forma.
- **`CoreIndex` resta un oggetto-dio annidato.** Trenta accessi a `indexes` su
  trentuno passano da `indexes.core`. È il prossimo giro dello stesso lavoro, e
  non è questa voce.
- **`KernelHost` continua a tenere `&mut Workspace`.** Tocca tutti e cinque i
  componenti, ed è per costruzione la facciata dell'oggetto: spezzarlo per
  famiglia di capacità è una domanda diversa (§7.1 l'ha già decisa per la forma
  del *trait*; questa sarebbe la forma dell'*impl*), e nessuna voce aperta la
  chiede.
- **Il `RwLock` non è stato messo.** È il §8.3, è **P2**, e la sua prima riga è
  «misurare prima». Ciò che questa voce doveva garantire è che quando lo si
  metterà ci sia qualcosa da lockare separatamente — e adesso c'è.

## Verifica

- `cargo build --workspace` — pulita, zero warning.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **51 suite, 0 fallimenti**, identiche alla baseline
  presa prima di toccare il file. È la prova che conta per un refactor che non
  deve cambiare comportamento: nessun test è stato aggiunto, tolto o adattato.
- `cargo fmt` — i file toccati sono a posto. (`syntax.rs` e
  `fub-features/tests/custom_blocks_e2e.rs` hanno diff di formato
  **preesistenti**, non introdotti qui e non sistemati qui.)
