# 9. Il lavoro lungo, e come un componente smette

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md). Lo
spegnimento è chiuso per intero. Questo include:
* Un componente.
* Il vault (la cartella di lavoro).
* Le sessioni.
* Il rilevamento (il sistema di osservazione dei file) attivabile a richiesta.
* Chi possiede i bundle (i pacchetti dei plugin).
* Chi esegue il lavoro lungo.

Qui il lavoro è concluso.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiedeva di decidere insieme ~~§9.2~~, ~~§9.4~~ e ~~§9.1~~.
Queste sono tre facce del momento in cui un componente smette. In origine, tutte
e tre queste facce richiedevano una risposta. La ~~§9.5~~ andava con ~~§9.6~~.
"Chiudere una sessione" e "chiuderle tutte" usano lo stesso codice. La ~~9.3~~
stava qui per definire chi **possiede** i bundle. Questo attore è necessario per
aprire e chiudere gli elementi. Il runner dei job (l'esecutore delle attività
asincrone) ha ora un chiamante in produzione.

**Le tre facce sono chiuse.**
* **~~9.1~~ (visibilità)**: Chiusa dalla
  [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md). Andava
  sopra tutte per la ragione del quarto giro. La sua assenza rendeva una
  capacità **inesprimibile**. Ora un job riceve l'`HostApi` (l'interfaccia verso
  l'ambiente) intero *per chiamata*.
* **~~9.2~~ (il contratto non ha uno spegnimento) e ~~9.4~~ (si può solo *non
  registrare*)**: le altre due sono chiuse dalla
  [decisione 0028](../decisions/0028-come-un-componente-smette.md):
  * `IndexProvider::close` è **obbligatoria**.
  * `Workspace::deactivate_plugin` inverte il percorso di registrazione.
  * I job in coda di un componente spento ricevono un esito. Questa regola
    chiude la terza faccia per intero.
  * Le capacità di un job in volo terminano da sole. Il registro fornisce la
    politica a ogni chiamata. Un id dismesso riceve un rifiuto.

**E il vault si chiude.** La ~~9.5~~ e la ~~9.6~~ sono chiuse insieme dalla
[decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md). La
chiusura avviene in questo ordine:
1. Emissione di `VaultClosed` con tutti i componenti attivi.
2. Flush (scrittura su disco) di tutti gli indici (le strutture dati di
   ricerca). Questo crea un punto di consistenza indipendente dal watcher (il
   rilevatore di eventi file).
3. Spegnimento di ogni plugin in ordine inverso di dichiarazione.

Cambiamenti in `Host` (il gestore centrale):
* I vault aperti formano una mappa. L'host gestisce sessioni multiple.
* Ogni comando IPC (comunicazione tra processi) accetta un `vault` opzionale.
* Il vault "corrente" è solo una comodità della shell.

Il **registro dei vault** (recenti, preferiti, icone) è configurazione globale.
Rimane un punto solo del §9.6. Si è spostato al ~~§11.1~~. La
[0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) lo ha chiuso. Questo
livello appoggia sul livello macchina (le impostazioni globali).

**E il rilevamento si può chiedere.** Il settimo giro ha aggiunto la ~~9.7~~.
Era la 9.5 sull'altro asse. Prima, l'assenza del watcher comprometteva la
**durabilità** di un indice. La 0029 ha rimosso questo costo. Ora il flush
possiede un chiamante alternativo. L'assenza del watcher impediva anche di
rilevare i cambiamenti nel vault.

La [decisione 0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md) risolve
la voce:
* `IndexQuery::VaultStatus` interroga lo stato del rilevamento.
* Esiste **una sola** bandiera di rilevamento. La mantiene l'osservatore.
* Il vault registra ogni sincronizzazione per-path fallita. Questo avviene
  indipendentemente dall'uso del `Result` da parte del chiamante.
* Il verbale definisce le promesse di Fub con il rilevamento disattivato.

Un residuo rimane: la `base` mancante a `write_document`. Questo rappresenta il
conflitto buffer↔disco del [§18.1](18-editor-e-tastiera.md).

**E chi possiede i bundle ha un nome.** Il primo punto della 9.3 lo chiude la
[decisione 0031](../decisions/0031-chi-possiede-i-bundle.md). Un bundle si monta
in quattro passi identici:
1. La versione del contratto.
2. La dichiarazione.
3. `Plugin::activate`.
4. I provider (i fornitori di servizi del plugin).

Un registry (il gestore dei moduli) esegue questi passi. Il registry si trova
**dalla parte dell'host**. L'`HostApi` omette le capacità di registrazione
([0013](../decisions/0013-elenco-delle-capacita.md)). L'host esegue la
registrazione al posto del plugin. Questo sistema colloca due cose che mancavano
di un posto:
* `Plugin::deactivate` ottiene un chiamante. Questo arriva **prima** della
  rimozione dei provider da parte del kernel (il motore centrale). In questo
  unico momento l'`host` è utile.
* `abi_compatible` diventa una regola applicata.

**E il lavoro lungo ha chi lo esegue.** La
[decisione 0032](../decisions/0032-il-runner-dei-job.md) chiude la seconda metà
della ~~9.3~~. Questo include tre cose del §9.3 da decidere **insieme**. La
progettazione simultanea evita di riscrivere un pool (un gruppo di thread) per
aggiungere la cancellazione nativa.

I tre elementi sono:
* **Un pool guidato da eventi**: I thread aspettano un segnale dal kernel invece
  di interrogare la coda a intervalli. Questa è la stessa logica della bandiera
  nella [0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md). Il kernel
  presta un pezzetto di stato all'esecutore esterno.
* **L'annullamento basato su rifiuti**: L'annullamento mantiene i permessi
  invariati. Un job annullato riceve rifiuti dall'host alla chiamata successiva.
  Un job puro completa comunque l'esecuzione. Questo è il limite dichiarato.
* **L'ordine di spegnimento**: Risponde alla domanda *chi chiude aspetta chi?*.
  La sequenza è:
  1. Si smette di guardare.
  2. Si smette di lavorare.
  3. Si chiude il sistema. Questa è la stessa regola del watcher letta due
     volte.

Il **safe mode** (la modalità sicura) è chiuso con un approccio alternativo:
* **La rete contro i panici**: Esiste su tutte e otto le porte di ingresso di un
  plugin. Avvolge esclusivamente la chiamata del provider. Il kernel possiede
  invarianti da ripristinare e sfrutta il codice del ramo di errore esistente.
* **La disattivazione automatica**: È rimandata. Il meccanismo esiste
  ([0031](../decisions/0031-chi-possiede-i-bundle.md)). Richiede due metà:
  l'avviso (§20.2) e il modo di riaccendere. La seconda è arrivata con la
  [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md). Il registry
  conserva anche i bundle smontati. L'impostazione `plugins.disabled` memorizza
  chi è spento fra un avvio e l'altro. Resta una sola metà da completare.

Qui il lavoro è concluso.
