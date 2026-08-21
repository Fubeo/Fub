# 0119 — Il piano si fa in lettura e si applica in scrittura

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto *«il lucchetto
esclusivo del watcher tiene dentro il disco»* di
[«I difetti da correggere»](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

Il lotto del watcher prendeva `workspace.write()` e sotto quel lucchetto faceva
due cose lunghe: il **parse** di ogni file cambiato — che vuol dire aprirlo,
leggerlo e passarlo al provider di formato — e `flush_indexes()`, che scrive gli
indici sul disco. Chi legge — la ricerca, l'autocompletamento, il disegno dei
pannelli — aspettava la fine di un'I/O che non lo riguarda.

La regola era già scritta: è quella della
[0024](0024-chi-legge-non-aspetta-chi-legge.md), *mutare in memoria sotto il
lucchetto, rilasciarlo, rendere durevole fuori*. Quello che la voce non diceva è
che le due metà non si comportano allo stesso modo, e che una delle due **non si
può** fare oggi.

## Cosa è risultato vero, e cosa no

**Vero: il parse stava sotto il prestito esclusivo e non aveva ragione di
starci.** `DocumentStore::parse` prende `&self`, `Vault::read` prende `&self`:
il lavoro lungo del lotto era già scrivibile in lettura, e stava in scrittura
solo perché il chiamante aveva una guardia sola.

**Falso: che il flush possa uscire dal prestito esclusivo.**
`IndexProvider::flush` riceve un `&mut dyn HostApi`, e l'unico host che
implementa `HostApi` è `KernelHost`, che il kernel costruisce su
`&mut Workspace` (0021). Finché quella firma è quella, la durevolezza degli
indici sta sotto `write()` — e non è un dettaglio di implementazione da
sistemare in questa voce: sarebbe un host nuovo, o una firma nuova nel
contratto, cioè un'altra decisione. Ciò che si è fatto è darle **una fase sua**:
fra la mutazione e la durevolezza il lucchetto si rilascia, quindi chi aspetta
non aspetta più il lotto intero.

**Falso anche: che due lotti possano accavallarsi oggi.** Il debouncer di
`notify` chiama il proprio handler da un thread solo, e l'handler è un `FnMut`.
Ma «oggi non succede» è esattamente la forma di garanzia che la 0024 aveva già
dovuto scrivere in prosa una volta («niente vieta a un chiamante futuro di
riprendere il lock mentre lo tiene… non c'è un presidio che lo impedisca»), e
con una fase in più il costo di sbagliare è cresciuto: due lotti sovrapposti
potrebbero applicare in ordine invertito, e il secondo lascerebbe nel workspace
lo stato più vecchio dei due. Qui l'ordine lo dice il prestito, non la prosa.

## La decisione

**Una sincronizzazione da fuori si fa in due tempi: il piano sotto prestito
condiviso, l'applicazione sotto quello esclusivo — e il piano dichiara cosa
credeva di sapere, così chi applica lo verifica.**

Nel kernel sono due funzioni e un tipo:

- `Workspace::plan_sync(&self, abs) -> Option<ParsedChange>` legge e parsa, e
  non muta niente;
- `Workspace::sync_path_prepared(&mut self, abs, piano)` applica;
- `ParsedChange` è opaco, e lo è apposta: **chi ne tiene uno in mano ha per
  forza già rilasciato il prestito condiviso**, perché il tipo non ne porta con
  sé nessun pezzo. È la stessa idea del difetto (3) di questo giro — la funzione
  restituisce ciò che va reso durevole e il chiamante lo persiste fuori — letta
  dal lato della lettura invece che da quello della scrittura.

`None` non è un fallimento: vuol dire «qui non c'è niente da preparare» (un path
ignorato, un file di un'altra specie, un file sparito, una lettura che non è
riuscita), e `sync_path_prepared` rifà la strada intera, che è dove quei rami
stavano già.

Nell'host il lotto diventa un tipo, `ExternalSync`, con tre fasi e un
vocabolario suo (`ExternalChange::Touched` / `Renamed`): i tipi di `notify`
restano dietro la cargo feature, e il primo cliente non-`notify` del lotto è il
presidio qui sotto.

## Il pezzo che non era nel difetto: il piano invecchia

Fra la fase che legge e quella che muta il prestito esclusivo passa di mano, e
in mezzo può entrarci un salvataggio dell'utente. Applicare lì un modello
parsato *prima* di quella scrittura la cancellerebbe dalla memoria del kernel:
sul disco resta, in anagrafe e negli indici no, e non se ne accorge nessuno fino
alla riapertura. È il difetto peggiore di tutta la voce, e nasce dalla
riparazione — il codice vecchio non poteva averlo, perché non rilasciava mai.

La risposta non è un lucchetto in più: il piano si porta dietro **l'impronta che
l'anagrafe aveva quando è stato fatto**, e chi applica la confronta con quella
di adesso. Se sono diverse il piano si butta e si rifà la strada intera. Un
piano non descrive solo cosa ha letto: descrive anche il mondo in cui l'ha
letto.

## La regola

**In `fub-host`, un'I/O non si fa sotto il prestito esclusivo del workspace: si
fa prima, sotto quello condiviso, e ciò che ne esce si applica dopo.** Quando
l'applicazione dipende da uno stato che nel frattempo può essere cambiato, ciò
che si è letto porta con sé la versione dello stato su cui è stato letto.

Non vale solo qui, ed è la ragione per cui questa è una decisione e non un
commit. Il censimento dei siti che tengono `workspace.write()` in `fub-host` —
ventuno — ne ha trovato un secondo con la stessa forma esatta:
`Runner::avanza_apertura` (`crates/fub-host/src/runner.rs`), che sotto un
`write()` chiama `Workspace::index_batch`, che legge e parsa una fetta di
documenti dal disco. È la scansione dell'apertura, cioè il posto dove i file da
leggere non sono quattro ma quattromila. Non è stato toccato in questa voce — è
un job, ha un cursore suo e una cancellazione sua — e la strada è la stessa:
preparare la fetta in lettura, applicarla in scrittura.

## Il rosso

Il presidio è `crates/fub-host/tests/il_lotto_del_watcher.rs`, e **non
cronometra niente**: un tempo su una macchina condivisa non è un segnale, e la
proprietà comprata non è «più veloce» — è che durante quella lettura il prestito
condiviso si prende ancora. La si osserva direttamente, con la sincronizzazione
fatta da un canale e non da un `sleep`: un formato di prova si ferma dentro
`parse`, dice al test che è entrato, e aspetta il permesso di uscire. Nel mezzo
il test fa `try_read()` e deve **riuscire**. `try_read` e non `read`: un `read`
che aspettasse sarebbe verde anche col prestito esclusivo.

- `chi_legge_entra_mentre_il_lotto_legge_il_disco` — con `read()` riscritto in
  `write()` nella fase 1 (cioè col codice di prima, che è la stessa forma di
  termine di paragone della 0024): *«il workspace non si presta mentre il lotto
  legge il disco»*.
- `un_piano_invecchiato_non_cancella_chi_ha_scritto_in_mezzo` — tolto il
  confronto delle impronte: l'anagrafe finisce con l'impronta del testo letto da
  fuori invece di quella del salvataggio dell'utente.

L'ordine dei lotti non ha un test perché ha un **tipo**: `ExternalSync::batch`
prende `&mut self`, e da un `&mut` non se ne ricava un secondo. Due lotti sullo
stesso sincronizzatore non compilano; non c'è un rosso da mostrare perché non
c'è un verde da produrre.

## Cosa resta scoperto

- **Il flush è ancora esclusivo**, e lo sarà finché `IndexProvider::flush`
  riceve un `HostApi`. Sta scritto sul tipo che lo chiama, non solo qui.
- **`index_batch` ha la stessa forma e non è stato toccato** (sopra). Lo ha
  preso la [0124](0124-una-fetta-dell-apertura-e-un-piano-anche-lei.md).
- Un piano resta valido rispetto a chi scrive **attraverso il kernel**. Un
  secondo programma che riscrivesse lo stesso file fra il piano e l'applicazione
  non alza nessuna impronta: il piano vince, e il lotto seguente del rilevatore
  corregge. È la stessa convergenza che il codice vecchio aveva fra la lettura e
  la fine del proprio lotto, spostata di qualche millisecondo.
