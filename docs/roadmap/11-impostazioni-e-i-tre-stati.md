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
~~§11.1~~ — schema dichiarato nel manifest, il registro dei vault, gli
interruttori al posto delle variabili d'ambiente, import/export/reset come
comandi — e degli altri due
ha deciso la sola cosa che col contratto scadeva: **dove non vanno**. Lo stato di
vista è per-macchina *e per-pannello*, quindi non è una chiave di configurazione
ma una mappa indicizzata da `PaneId`; il layout ha più configurazioni per lo
stesso utente, quindi non è un valore ma un insieme nominato. Nessuno dei due
entra in quello store, e la ragione sta scritta in `fub_abi::settings` — dove
la leggerà chi fosse tentato di infilarceli.

I **due livelli** che la 0036 aveva dato al §11.1 sono poi diventati **uno**, con
la [0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md): un valore sta
nel file del vault, come in `.obsidian/`, e la precedenza «prima guardo qui, poi
lì» non c'è più. Della macchina resta la sola diagnostica (`log.*`), che deve
valere anche quando un vault non si apre. La voce era già chiusa e resta chiusa:
è cambiato **dove sta un valore**, non chi lo dichiara — e ciò che quella
decisione lascia scoperto (un vault nuovo riparte dalle impostazioni di fabbrica,
finché non nascerà la copia esplicita alla creazione) è nominato lì, non qui.

Poi la [0037](../decisions/0037-lo-stato-di-vista.md) ha eseguito **metà** del
~~§11.2~~: lo stato di vista c'è — due famiglie di capacità, un file della
macchina che il kernel possiede, la chiave composta dall'host con dentro
l'esemplare — e la shell ci è dentro. L'altra metà, il *layout*, l'ha chiusa la
[0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md) **senza
costruire un terzo contenitore**, ed è la parte che vale la pena raccontare: «il
layout» erano due oggetti diversi, e ognuno aveva già la sua casa. *Com'era
aperta la finestra* non ha un nome — è stato di vista, va nel file della
macchina, non viaggia perché dipende dal monitor che uno ha davanti. *Un
workspace salvato* un nome ce l'ha, e viaggia col vault come le note. Il criterio
è quello che la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) aveva
scritto e non applicato: **un'impostazione ha un valore alla volta, un layout ne
ha uno per nome**. Il «terzo stato senza contenitore» del titolo non era terzo.

Il sidecar dell'organizzazione (~~11.3~~) è **assorbito**, con la
[0038](../decisions/0038-il-kernel-possiede-il-sidecar.md): lo possiede il
kernel, con la disciplina degli altri suoi file, e la voce si ritira. Era un
precedente fuori da ogni disciplina, e ogni feature che avesse scritto qualcosa
avrebbe scelto il posto per imitazione dell'ultima che aveva guardato.

Con la 0036 si è chiuso anche il primo dei due residui aperti della
[decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): **quali
chiavi di impostazione sono scrivibili da un programma**. La risposta è **per
chiave** (`SettingSpec.program_writable`, che di default è `false`) e non per
famiglia, perché la riga non negoziabile — le impostazioni di privacy e dell'AI
non stanno fra quelle, e un componente che può allargarsi i permessi da sé non ha
permessi — non è una proprietà di chi chiede: è una proprietà di ciò che si
scrive.

### ~~11.2 Tre stati diversi, zero contenitori~~

*ex §3.10 · shell · **P2** — **chiusa in due tempi**: lo stato di vista con la [0037](../decisions/0037-lo-stato-di-vista.md), il layout con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). Resta **una casella**, e non è un contenitore che manca: è un formato che aspetta il suo primo cliente*

- [x] **Un `ViewProvider` non ha dove tenere il proprio stato di vista**:
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
      creato il buco: ha tolto l'illusione che fosse tappato. **Chiuso** con la
      [0037](../decisions/0037-lo-stato-di-vista.md): due famiglie di capacità
      (`view_state` / `set_view_state`), un file della macchina che il kernel
      possiede, e la chiave composta dall'host con dentro l'**esemplare** — non
      un `PaneId`, che la 0036 aveva nominato per illustrazione e che oggi non
      esiste. Non è lo `storage_*` che rientra dalla finestra: quello era
      volatile, di chiunque e senza recinto; questo dura, è per esemplare, e non
      viaggia col vault.
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
      un insieme nominato. La ragione sta in `fub_abi::settings`, dove la
      legge chi fosse tentato di infilarceli.
- [x] ~~**Resta il layout** — l'altro contenitore.~~ **Chiuso** con la
      [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md), e non
      costruendo il contenitore che questa riga si aspettava: **i due contenitori
      c'erano già entrambi**. La riga diceva che il layout «aspetta» perché l'area
      principale è un pannello solo, e su quello aveva ragione — il §1.2 ha fatto
      i riquadri, e con loro c'è finalmente qualcosa da disporre. Ma diceva anche
      «un formato deciso adesso descriverebbe una cosa che non c'è ancora», e lì
      la separazione l'ha smentita a metà: *com'era aperta la finestra* è **stato
      di vista** (nessun nome, file della macchina, non viaggia) e si è fatto
      subito, perché è il contenitore che la 0037 aveva già costruito; il formato
      che aspetta è solo quello dell'altro oggetto.
- [ ] **I workspace salvati con un nome.** La casa è decisa — nel vault
      (`.fub/`, [0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md)),
      perché li ha creati l'utente apposta, come le note e le scorciatoie — e il
      formato aspetta di vedere **assetti veri**: quali disposizioni la gente
      salva davvero, e se un workspace nomini anche i pannelli laterali o solo i
      riquadri. È la casella residua di una voce chiusa, non una decisione
      rimandata: la domanda «dove vive» ha una risposta, e indovinare un formato
      prima del primo cliente è indovinare un formato da migrare.
