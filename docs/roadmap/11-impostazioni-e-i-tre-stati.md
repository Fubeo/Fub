# 11. Le impostazioni, e i tre stati che non hanno un contenitore

Una **seduta** della [roadmap infrastrutturale](../todo.md): i tre stati nascono con tre meccanismi che non si parlano, se non si decidono insieme.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il §11.2 va deciso *insieme* al §11.1 e al contesto di sessione
([decisione 0007](../decisions/0007-contesto-di-sessione.md)), anche se si
implementa dopo, **o i tre stati nascono con tre meccanismi che non si parlano**.
I tre sono: le impostazioni (durano e viaggiano col vault), lo stato di
vista/sessione (per-macchina, per-pane) e il layout (salvabile e ripristinabile).
Oggi il primo è una variabile d'ambiente, il secondo sta in `localStorage` per la
shell e da nessuna parte per i provider, e il terzo non esiste.

Con loro il sidecar dell'organizzazione (11.3), che lo store di configurazione
deve **assorbire** e non affiancare — è già un precedente fuori da ogni
disciplina, e ogni feature che scriverà qualcosa sceglierà il posto per
imitazione dell'ultima che ha guardato.

Questa seduta chiude anche il primo dei due residui aperti della
[decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): **quali
chiavi di impostazione sono scrivibili da un programma**. Il vocabolario c'è
(`CommandReach::Settings`), lo schema no, perché non ci sono ancora
impostazioni; la riga non negoziabile è che le impostazioni di privacy e dell'AI
non siano fra quelle, perché un componente che può allargarsi i permessi da sé
non ha permessi.

### 11.1 Impostazioni e spegnibilità — oggi sono variabili d'ambiente

*ex §1.3 · contratto · **P1** — porta con sé il residuo della decisione 0010*

- [ ] **`SettingsProvider`** (o `PluginManifest.settings_schema`): il provider
      dichiara uno **schema** di impostazioni (chiave, tipo, default, etichetta,
      gruppo); la shell genera il form dai nodi di input, che dalla
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ci sono; i valori tornano al
      provider via `HostApi`.
- [ ] **Store di configurazione nel kernel**, su tre livelli con precedenza
      dichiarata: globale (cartella di configurazione utente) → vault
      (`.fubmd/settings.json`, autorevole, viaggia col vault) → profilo/portable.
      Oggi il livello globale **non esiste affatto**: non c'è dove tenere vault
      recenti, preferiti, tema, hotkey.
- [ ] **Interruttore di feature nel registry**: `FUBMD_VERSIONING` diventa una
      impostazione; "spento = non registrato" resta la semantica (D7), ma
      decisa a runtime e non da `std::env`.
- [ ] **Import/export/reset delle impostazioni** come comandi ([decisione 0009](../decisions/0009-registro-dei-comandi.md)), non come
      codice dell'app.

*Sblocca:* 28 per intero, 20.1 (impostazioni plugin), 3.1 (impostazioni per
vault), 1.1 (telemetria opt-in ha bisogno di un posto dove stare spenta).

### 11.2 Tre stati diversi, zero contenitori

*ex §3.10 · shell · **P2** — da decidere **adesso**, insieme all'11.1, anche se si implementa dopo*

- [ ] **Un `ViewProvider` non ha dove tenere il proprio stato di vista**:
      scroll, sezioni collassate, filtro corrente, tab attiva. Non ha **niente**,
      e da poco ha meno di prima: la [decisione 0013](../decisions/0013-elenco-delle-capacita.md)
      ha **ritirato** lo `storage_*` volatile a chiave→valore — l'unica rottura
      della linea di base di quel giro — perché fra i `data_*` da una parte e le
      impostazioni del §11.1 dall'altra non gli restava un caso proprio. Il caso
      proprio è questo, ed è rimasto senza contenitore: ciò che il contratto offre
      oggi è il solo `data_*` (`abi/traits.rs`), che è persistente, su
      path e pensato per i dati che durano e viaggiano col vault — mentre lo stato
      di vista è per-macchina e per-pane, e non deve viaggiare. Il ritiro non ha
      creato il buco: ha tolto l'illusione che fosse tappato.
- [ ] **Sono tre cose distinte, e vanno decise insieme o nasceranno con tre
      meccanismi incompatibili**: le **impostazioni** (durano e viaggiano col
      vault — §11.1), lo **stato di vista/sessione** (per-macchina, per-pane —
      [decisione 0007](../decisions/0007-contesto-di-sessione.md)), il **layout** (salvabile e ripristinabile: 3.3 chiede *workspace
      salvabili*, *switch rapido*, *restore layout all'avvio*). Oggi lo stato di
      vista della shell sta in `localStorage` (spazio attivo, cartelle
      espanse), quello dei provider non sta da nessuna parte, e il layout non
      esiste.

### 11.3 Il sidecar dell'organizzazione, da assorbire

*ex §2.14 · kernel · **P2** — da **assorbire**, non da affiancare*

- [ ] **`.fubmd/workspace.json` è un precedente fuori da ogni disciplina**: lo
      legge e scrive l'app con `std::fs` (`app/lib.rs`). Sono dati
      **autorevoli** — icone, appuntate, ordinamenti, spazi — senza scrittura
      atomica, senza versione di schema (§15.3), fuori dal cestino e dal
      versioning, con la migrazione sui rename in TypeScript
      (`migrateOrganization`, `state/organization.ts`):
      una nota rinominata da un'altra app **a FubMD chiusa** orfanizza icona,
      pin e ordinamento in silenzio, perché quell'evento non lo vede nessuno.
- [ ] Lo store di configurazione del §11.1 deve **assorbirlo**, non affiancarlo:
      spazio dati proprio, migrazione della chiave lato kernel sull'evento
      `DocumentRenamed`, stessa disciplina del resto.
