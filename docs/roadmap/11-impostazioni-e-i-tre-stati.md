# 11. Le impostazioni, e i tre stati in cerca di un contenitore

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md).
I tre stati richiedono tre meccanismi coerenti.
La [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha risolto il primo stato. Ha stabilito la posizione degli altri due.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La [decisione 0007](../decisions/0007-contesto-di-sessione.md) sul contesto di sessione ha avviato questa analisi.
Il §11.2 richiedeva una decisione congiunta con il ~~§11.1~~.
L'obiettivo è creare tre meccanismi comunicanti.

I tre sono:
* **Impostazioni**: persistono e seguono il vault (la cartella di progetto).
* **Stato di vista/sessione**: specifico per macchina e per pane (il riquadro dell'interfaccia).
* **Layout**: configurazione salvabile e ripristinabile.

La [decisione 0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) chiude il ~~§11.1~~.
Le novità includono:
* Schema dichiarato nel manifest.
* Registro dei vault.
* Interruttori sostitutivi delle variabili d'ambiente.
* Comandi dedicati per import, export e reset.

La stessa decisione definisce la natura degli altri due:
* Lo stato di vista mappa i valori tramite `PaneId`. È specifico per macchina e per pannello.
* Il layout organizza configurazioni multiple per utente. È un insieme nominato.

Questi due stati hanno posizioni separate dallo store principale. Il file `fub_abi::settings` documenta queste regole per chi sviluppa.

La [0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md) riduce a uno i due livelli previsti dalla 0036 per il §11.1.
Il sistema salva un valore direttamente nel file del vault, in modo simile a `.obsidian/`.
Il meccanismo utilizza un accesso diretto.
Le impostazioni della macchina conservano solo la diagnostica (`log.*`). Questo garantisce l'accesso ai log prima dell'apertura del vault.
La voce mantiene lo stato chiuso. La modifica riguarda la posizione del valore. Il documento tratta i casi residui, come il ripristino delle impostazioni di fabbrica per un nuovo vault, in attesa della funzione di copia esplicita.

La [0037](../decisions/0037-lo-stato-di-vista.md) implementa metà del ~~§11.2~~ sullo stato di vista.
La shell (l'interfaccia utente principale) utilizza questa struttura:
* Due famiglie di capacità.
* Un file di macchina gestito dal kernel (il nucleo del sistema).
* Una chiave basata sull'host (il sistema ospite) contenente l'esemplare.

La [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md) completa l'altra metà sul layout. Lo fa omettendo di costruire un terzo contenitore.
Il layout si divide in due oggetti distinti, con destinazioni precise:
* **Stato della finestra**: indica la disposizione corrente a schermo. Risiede nel file della macchina in forma anonima. Rimane confinato al monitor locale.
* **Workspace salvato**: rappresenta una configurazione con nome. Segue il vault insieme alle note.

La [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) fornisce il criterio:
* Un'impostazione conserva uno specifico valore attivo.
* Un layout ne gestisce uno per nome.
Il concetto di terzo stato privo di contenitore non descriveva un vero e proprio terzo elemento.

La [0038](../decisions/0038-il-kernel-possiede-il-sidecar.md) assorbe il sidecar (un servizio di supporto) dell'organizzazione (~~11.3~~).
Il kernel gestisce ora il sidecar applicando le stesse regole degli altri file di sistema. Questa standardizzazione garantisce una posizione univoca per le nuove funzioni.

La 0036 risolve anche il primo dei due punti in sospeso della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md).
Definisce la scrivibilità delle chiavi di impostazione da parte dei programmi.
La granularità dei permessi si applica alla singola chiave (tramite `SettingSpec.program_writable`, disattivato di default, con valore di base `false`).
Questo metodo garantisce la sicurezza dei dati sensibili, come privacy e intelligenza artificiale. I permessi dipendono esclusivamente dalle caratteristiche del dato scritto. Un sistema sicuro blocca i componenti in grado di auto-assegnarsi i privilegi.

### ~~11.2 Tre stati diversi, zero contenitori~~

*ex §3.10 · shell · **P2** — **chiusa in due tempi**: lo stato di vista con la [0037](../decisions/0037-lo-stato-di-vista.md), il layout con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). Resta attiva **una casella**, richiedendo la definizione di un formato in attesa del suo primo cliente.*

- [x] **Un `ViewProvider` necessita di uno spazio per il proprio stato di vista.**
      Questo stato include scroll, sezioni collassate, filtro corrente e tab attiva.
      La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ritira la soluzione volatile `storage_*` a chiave→valore.
      L'intervento richiede un contenitore specifico per evitare conflitti.
      Le alternative disponibili gestiscono ambiti differenti:
      * I `data_*` (`abi/traits.rs`) offrono persistenza su path e viaggiano col vault. Rappresentano l'unica opzione attualmente offerta dal contratto.
      * Le impostazioni della [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) possiedono logiche proprie.
      Lo stato di vista resta confinato alla macchina e al pane.
      La [0037](../decisions/0037-lo-stato-di-vista.md) chiude il problema offrendo questa struttura:
      * Due famiglie di capacità (`view_state` / `set_view_state`).
      * Un file locale gestito dal kernel.
      * Una chiave formata dall'host e dall'**esemplare**.
      La chiave sostituisce l'obsoleto `PaneId` illustrato nella 0036. Questo sistema garantisce la persistenza per esemplare in locale, superando l'approccio generico del vecchio `storage_*`.

- [x] **La gestione unitaria di tre elementi previene le incompatibilità.**
      Gli elementi sono:
      * Le **impostazioni**: persistenti e associate al vault.
      * Lo **stato di vista/sessione**: specifico per macchina e per pane ([decisione 0007](../decisions/0007-contesto-di-sessione.md)).
      * Il **layout**: salvabile e ripristinabile (il requisito 3.3 richiede *workspace salvabili*, *switch rapido* e *restore layout all'avvio*).
      La [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) risolve il primo elemento. Stabilisce inoltre la natura degli altri due:
      * Lo stato di vista mappa i valori tramite `PaneId` per macchina e pannello.
      * Il layout raggruppa configurazioni multiple per utente. Forma un insieme nominato.
      Le loro caratteristiche escludono l'uso delle classiche chiavi di configurazione. Il file `fub_abi::settings` documenta i motivi di queste scelte.

- [x] ~~**Il layout necessita di un contenitore dedicato.**~~ L'obiettivo è **chiuso** con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md).
      La soluzione impiega i due contenitori preesistenti.
      Il §1.2 crea i riquadri, fornendo gli elementi da disporre nell'area principale.
      La separazione dei concetti smentisce a metà il problema:
      * Lo **stato di vista** salva la disposizione corrente della finestra. Rimane locale, anonimo e risiede nel file di macchina fornito dalla 0037.
      * Il formato in attesa riguarda esclusivamente l'altro oggetto.

- [ ] **I workspace salvati con un nome.**
      I workspace risiedono nel vault all'interno di `.fub/` ([0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md)).
      Costituiscono contenuti generati dall'utente, al pari di note e scorciatoie.
      Il formato richiede l'analisi di **assetti veri**. Serve valutare l'inclusione dei pannelli laterali oltre ai riquadri.
      Questa casella rappresenta l'elemento residuo di una voce chiusa.
      La posizione è definitiva.
      La definizione del formato attende il primo utilizzo reale. Anticipare le specifiche aumenta il rischio di migrazioni future.
