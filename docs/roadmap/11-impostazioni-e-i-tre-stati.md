# 11. Le impostazioni, e i tre stati che non hanno un contenitore

Una **seduta** della [roadmap infrastrutturale](../todo.md): i tre stati, decisi separati, nascono con tre meccanismi che non si parlano — e la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha chiuso il primo e detto degli altri due dove non vanno.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La seduta è nata da una condizione: il §11.2 andava deciso *insieme* al ~~§11.1~~
e al contesto di sessione
([decisione 0007](../decisions/0007-contesto-di-sessione.md)), anche se si
implementa dopo, **o i tre stati nascono con tre meccanismi che non si parlano**.
I tre sono: le impostazioni (durano e viaggiano col vault), lo stato di
vista/sessione (per-macchina, per-pane) e il layout (salvabile e ripristinabile).

La condizione è soddisfatta. La
[decisione 0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha chiuso il
~~§11.1~~ — schema dichiarato nel manifest, due livelli con una precedenza sola
(vault → macchina → default), il registro dei vault, gli interruttori al posto
delle variabili d'ambiente, import/export/reset come comandi — e degli altri due
ha deciso la sola cosa che col contratto scadeva: **dove non vanno**. Lo stato di
vista è per-macchina *e per-pannello*, quindi non è una chiave di configurazione
ma una mappa indicizzata da `PaneId`; il layout ha più configurazioni per lo
stesso utente, quindi non è un valore ma un insieme nominato. Nessuno dei due
entra in quello store, e la ragione sta scritta in `fubmd_abi::settings` — dove
la leggerà chi fosse tentato di infilarceli. Di questa seduta resta quindi
l'**esecuzione** del §11.2: i due contenitori non ci sono ancora.

Con loro il sidecar dell'organizzazione (11.3), che lo store di configurazione
deve **assorbire** e non affiancare — è già un precedente fuori da ogni
disciplina, e ogni feature che scriverà qualcosa sceglierà il posto per
imitazione dell'ultima che ha guardato.

Con la 0036 si è chiuso anche il primo dei due residui aperti della
[decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): **quali
chiavi di impostazione sono scrivibili da un programma**. La risposta è **per
chiave** (`SettingSpec.program_writable`, che di default è `false`) e non per
famiglia, perché la riga non negoziabile — le impostazioni di privacy e dell'AI
non stanno fra quelle, e un componente che può allargarsi i permessi da sé non ha
permessi — non è una proprietà di chi chiede: è una proprietà di ciò che si
scrive.

### 11.2 Tre stati diversi, zero contenitori

*ex §3.10 · shell · **P2** — **deciso** con la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md), che ha detto dove i due stati non vanno; resta l'esecuzione*

- [ ] **Un `ViewProvider` non ha dove tenere il proprio stato di vista**:
      scroll, sezioni collassate, filtro corrente, tab attiva. Non ha **niente**,
      e da poco ha meno di prima: la [decisione 0013](../decisions/0013-elenco-delle-capacita.md)
      ha **ritirato** lo `storage_*` volatile a chiave→valore — l'unica rottura
      della linea di base di quel giro — perché fra i `data_*` da una parte e le
      impostazioni ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md))
      dall'altra non gli restava un caso proprio. Il caso
      proprio è questo, ed è rimasto senza contenitore: ciò che il contratto offre
      oggi è il solo `data_*` (`abi/traits.rs`), che è persistente, su
      path e pensato per i dati che durano e viaggiano col vault — mentre lo stato
      di vista è per-macchina e per-pane, e non deve viaggiare. Il ritiro non ha
      creato il buco: ha tolto l'illusione che fosse tappato.
- [x] **Sono tre cose distinte, e vanno decise insieme o nasceranno con tre
      meccanismi incompatibili**: le **impostazioni** (durano e viaggiano col
      vault), lo **stato di vista/sessione** (per-macchina, per-pane —
      [decisione 0007](../decisions/0007-contesto-di-sessione.md)), il **layout** (salvabile e ripristinabile: 3.3 chiede *workspace
      salvabili*, *switch rapido*, *restore layout all'avvio*). Deciso con la
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md), che ha chiuso il
      primo e ha detto degli altri due la sola cosa che scadeva: **non sono
      chiavi di configurazione**. Lo stato di vista è per-macchina *e
      per-pannello* — una mappa indicizzata da `PaneId`, non un valore per
      chiave — e il layout ha più configurazioni per lo stesso utente, quindi è
      un insieme nominato. La ragione sta in `fubmd_abi::settings`, dove la
      legge chi fosse tentato di infilarceli.
- [ ] **Restano i due contenitori**: oggi lo stato di vista della shell sta in
      `localStorage` (spazio attivo, cartelle espanse), quello dei provider non
      sta da nessuna parte, e il layout non esiste. È l'esecuzione di questa
      voce, e non ha più niente da decidere sopra di sé: la disciplina della
      cartella (`.fubmd/`, scrittura atomica, versione di schema) c'è già.

### 11.3 Il sidecar dell'organizzazione, da assorbire

*ex §2.14 · kernel · **P2** — da **assorbire**, non da affiancare*

- [ ] **`.fubmd/workspace.json` è un precedente fuori da ogni disciplina**: lo
      leggono e scrivono due funzioni con `std::fs` (`host/records.rs`). Sono dati
      **autorevoli** — icone, appuntate, ordinamenti, spazi — senza scrittura
      atomica, senza versione di schema (§15.3), fuori dal cestino e dal
      versioning, con la migrazione sui rename in TypeScript
      (`migrateOrganization`, `state/organization.ts`):
      una nota rinominata da un'altra app **a FubMD chiusa** orfanizza icona,
      pin e ordinamento in silenzio, perché quell'evento non lo vede nessuno.
- [ ] Lo store di configurazione deve **assorbirlo**, non affiancarlo: spazio
      dati proprio, migrazione della chiave lato kernel sull'evento
      `DocumentRenamed`, stessa disciplina del resto. Lo store adesso **esiste**
      ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)) e porta con sé
      esattamente ciò che a questo file manca: la stessa cartella (`.fubmd/`), la
      scrittura atomica (`write_atomic`, che il §15.3 sposterà senza riscriverla)
      e una versione di schema. Non resta da inventare la disciplina, ma da
      applicarla a un file che è nato senza.
