# 0124 — Una fetta dell'apertura è un piano anche lei

**Stato**: accolta
**Data**: 2026-08-06
**Commit**: *(questo commit)*

---

## La domanda

La [0119](0119-il-piano-si-fa-in-lettura-e-si-applica-in-scrittura.md) aveva
nominato il proprio secondo sito e non l'aveva toccato:

> Il censimento dei siti che tengono `workspace.write()` in `fub-host` —
> ventuno — ne ha trovato un secondo con la stessa forma esatta:
> `Runner::avanza_apertura`, che sotto un `write()` chiama
> `Workspace::index_batch`, che legge e parsa una fetta di documenti dal disco.
> È la scansione dell'apertura, cioè il posto dove i file da leggere non sono
> quattro ma quattromila.

Quello che l'utente vede è la differenza fra i due siti. Il lotto del watcher
morde quando qualcuno tocca dei file da fuori; l'apertura morde **sempre**, e
morde all'avvio: si apre un vault grosso e per qualche secondo la ricerca non
risponde, l'albero non si disegna, il pannello dei tag aspetta — mentre il
centro attività, che il progresso ce l'ha già dalla
[0035](0035-il-lavoro-lungo-si-racconta.md), racconta diligentemente un
avanzamento a un'interfaccia che non lo può leggere.

## Il censimento, contro l'uno dichiarato

Il difetto dichiarato era uno. Contati: in `fub-host` e `fub-app` ci sono
**cinquantacinque** `.write()`, di cui **venticinque** sul workspace. Quelli che
tengono il prestito esclusivo attraverso un'I/O o un giro su N file sono
**quattro**, e solo il primo si poteva riparare qui:

1. `Runner::avanza_apertura` → `Workspace::index_batch` — legge e parsa fino a
   `FEED_BATCH` documenti. **È questa voce.**
2. `Runner::avanza_apertura` → `Workspace::finish_index` — `rebuild_graph` su
   tutto il vault, `reconcile`, `flush_indexes`, `collect_doc_data` (un giro sul
   disco) e `store_entries`. Tutto lavoro che *deve* mutare, più il flush che la
   0119 ha già dichiarato inamovibile.
3. `ExternalSync::flush` → `Workspace::flush_indexes` — lo stesso muro, e la
   stessa riga di prosa nella 0119.
4. `Host::read_version` → `VersionStore::read` — legge uno snapshot dal disco
   sotto `write()`, e **la firma di quella funzione non lo chiede**: prende
   `&dyn HostApi`, non `&mut`. Ci sta sotto solo perché `Workspace::with_host`
   costruisce il `KernelHost` su `&mut Workspace` (0021), che è esattamente il
   muro del punto 2 e 3 visto da un terzo lato.

Il rapporto fra dichiarato e misurato è quindi 4:1, e tre quarti hanno **la
stessa causa unica**: `HostApi` si ottiene solo da un `&mut Workspace`. Non è
un difetto per volta, è una firma.

## La decisione

**Una fetta dell'apertura si prepara sotto prestito condiviso e si applica sotto
quello esclusivo, e il piano dichiara — per documento — l'impronta che
l'anagrafe aveva quando l'ha letto.**

Nel kernel sono due funzioni e un tipo, e il nome dice la parentela:

- `Workspace::plan_batch(&self, &mut Indicizzazione) -> ParsedBatch` legge,
  parsa e non muta niente;
- `Workspace::index_batch_prepared(&mut self, ParsedBatch)` applica;
- `ParsedBatch` è il `ParsedChange` di un lotto invece che di un file, ed è
  opaco per la stessa ragione: chi ne tiene uno in mano ha per forza già
  rilasciato il prestito condiviso.

Il cursore avanza **nella fase che legge**, e si può perché
l'`Indicizzazione` vive fuori dal `Workspace` (0070): prenderne la fetta
successiva non chiede nessun prestito.

## Cosa questa voce **estende**, e non ripete

Tre cose, e la seconda è quella che vale.

**L'impronta è per documento, non per lotto.** Nella 0119 il piano era di un
file solo e la domanda non si poneva. Qui una fetta ne porta cento: buttarla
tutta perché l'utente ha salvato *una* nota vorrebbe dire rileggere dal disco
novantanove file per arrivare allo stesso risultato. La `seen` è quindi una
mappa `DocId → Option<Revision>`, e il cancello si apre e si chiude una voce
alla volta.

**Un documento invecchiato si butta e basta — non si rifà la strada.** È il
punto in cui questa voce diverge dalla 0119, dove il piano scartato era
l'*unica* notizia che quel file fosse cambiato, e non riapplicarlo avrebbe
lasciato il kernel fermo a prima. Qui è il contrario: l'impronta è cambiata
perché **qualcuno ha scritto attraverso il kernel**, e chi scrive attraverso il
kernel ha già parsato, già alimentato gli indici e già messo l'impronta giusta
in anagrafe (`ingest_model` → `touch_entry`). Rileggere quel file sarebbe rifare
il lavoro di qualcun altro per ottenere ciò che c'è già. Il documento è
**fatto**, e il cursore che lo ha contato ha ragione.

**La forma sbagliata non si scrive più.** `Workspace::index_batch` diventa
`pub(crate)`: resta perché `reindex` è sincrono per definizione — chi lo chiama
ha già il `&mut` e non c'è nessuno da non far aspettare — ma da fuori dal kernel
l'unico modo di portare avanti un'indicizzazione è la coppia. È il passo che la
0119 non aveva fatto (`sync_path` è rimasta pubblica), ed è la prova della
barra: *il secondo chiamante la eredita gratis?* Qui sì, perché non ha
alternativa che compili.

E l'ordine delle fette non ha un test perché ha un **tipo**, come nella 0119:
`plan_batch` prende `&mut Indicizzazione`, e `avanza_apertura` la `take()` dalla
propria custodia. Due fette insieme sulla stessa apertura non compilano.

## Le premesse cadute

**«Basta spostare il `write()` in `read()`».** Falso, ed è la stessa lezione
della 0119 pagata due volte: spezzare la fetta **crea** la finestra. Su
un'apertura la finestra è larga — il vault è utilizzabile dalla fine della
scansione, quindi «l'utente salva mentre indicizza» non è una patologia, è il
comportamento normale di chi apre l'app e comincia a scrivere. Senza il
confronto delle impronte questo commit avrebbe scambiato una lentezza con una
perdita silenziosa di testo.

**«Il `write()` esclusivo era l'unica cosa in mezzo».** Falso: `index_batch`
faceva *anche* `set_entry` dentro lo stesso ciclo che legge, cioè mutava
l'anagrafe mentre parsava. Le due cose sembravano una perché stavano in un `for`
solo; separarle in due fasi ha reso visibile che la prima non aveva niente da
mutare.

**«Un tempo dice se ha funzionato».** Già sfatata dalla
[0113](0113-il-banco-conta-le-operazioni.md), e qui vale il verso della 0119: la
proprietà comprata non è «più veloce», è che *durante* quella lettura il
prestito condiviso si prende ancora. Un banco cronometrico non l'avrebbe
distinta da un disco veloce.

## Il rosso

Tre presidi, ognuno visto rosso rimettendo il codice vecchio, e **nessuno
dorme**.

- `crates/fub-host/src/runner.rs::chi_legge_entra_mentre_la_fetta_dell_apertura_legge_il_disco`
  — sta *dentro* il crate e non in `tests/` perché la proprietà è di
  `avanza_apertura`, che è privata: un presidio scritto sulla coppia del kernel
  avrebbe provato il proprio codice, non quello del runner. Un formato di prova
  si ferma dentro `parse` e avvisa su un canale; il test fa **`try_read()`**
  nel mezzo, e `try_read` e non `read` perché un `read` che aspettasse sarebbe
  verde anche col prestito esclusivo. Rosso con `read()` riscritto in `write()`:
  *«il workspace non si presta mentre la fetta dell'apertura legge il disco»*.
- `crates/fub-kernel/tests/la_fetta_dell_apertura.rs::un_piano_invecchiato_non_cancella_chi_ha_salvato_durante_l_apertura`
  — la corsa **si costruisce**: le tre chiamate sono in fila in un test solo, e
  il salvataggio sta fra la prima e la terza. Niente thread, nessun istante da
  indovinare. Rosso tolto il confronto delle impronte: l'ultimo testo arrivato
  all'indice è quello di prima del salvataggio.
- `crates/fub-kernel/tests/la_fetta_dell_apertura.rs::senza_nessuno_in_mezzo_la_fetta_entra_intera`
  — la metà che si rompe in silenzio. Un confronto scritto al contrario
  butterebbe *ogni* documento della fetta, e il vault si aprirebbe con la
  ricerca vuota: rosso con `!=` riscritto in `==`, dove il primo presidio resta
  verde e nessun test funzionale se ne accorge.

Il presidio del kernel guarda **il testo arrivato all'indice** e non solo
l'impronta in anagrafe: le due cose si perdono insieme, ma è la seconda che
l'utente vede — cerca una parola che ha appena scritto e non la trova.

Non c'è un banco di prestazioni, e non per pigrizia: un conto di operazioni
misurerebbe letture di disco, che non sono cambiate. Ciò che è cambiato è **chi
aspetta**, e quello si osserva, non si cronometra.

## Cosa resta scoperto

- **I tre siti del punto 2, 3 e 4 del censimento**, che hanno una causa sola:
  `HostApi` nasce da un `&mut Workspace`. Finché quella è la firma, flush,
  `collect_doc_data` e la lettura di una versione stanno sotto il prestito
  esclusivo. Non è un difetto per sito: è una decisione che non è stata presa.
- **`Host::read_version` è il caso più netto dei tre**, perché la funzione che
  chiama prende già `&dyn HostApi`: manca solo un modo di ottenerne uno da
  `&self`.
- Un piano resta valido rispetto a chi scrive **attraverso il kernel**. Un
  secondo programma che riscrivesse un file fra il piano e l'applicazione non
  alza nessuna impronta; lo corregge il lotto seguente del rilevatore, come già
  scritto nella 0119.
