# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo spegnimento è chiuso per intero — un componente, il vault, le sessioni, il rilevamento che si può chiedere — e con lui chi possiede i bundle e chi esegue il lavoro lungo; qui non resta niente.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiedeva di decidere insieme ~~§9.2~~, ~~§9.4~~ e ~~§9.1~~ — «tre
facce del momento in cui un componente smette, e oggi nessuna delle tre ha una
risposta» — e ~~§9.5~~ andava con ~~§9.6~~, perché «chiudere una sessione» e
«chiuderle tutte» sono lo stesso codice. La ~~9.3~~ stava qui perché è chi
**possiede** i bundle: senza di lui non c'era nessuno che aprisse e chiudesse
alcunché, e il runner dei job non aveva un chiamante in produzione. Adesso ce
l'ha.

**Le tre facce sono chiuse.** La ~~9.1~~ andava sopra tutte per la ragione del
quarto giro — non allargava una capacità, ne rendeva una **inesprimibile** — ed è
chiusa dalla [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md):
un job riceve l'`HostApi` intero, e lo riceve *per chiamata*. Le altre due —
~~9.2~~ (il contratto non ha uno spegnimento) e ~~9.4~~ (si può solo *non
registrare*) — le chiude la [decisione 0028](../decisions/0028-come-un-componente-smette.md):
`IndexProvider::close` è **obbligatoria**, e `Workspace::deactivate_plugin` è
l'inverso esatto della strada di registrazione. Lì è finita anche la terza faccia
per intero: i job in coda di chi si spegne ricevono un esito, e le capacità di un
job in volo evaporano da sé — la politica se la fa dare dal registro a ogni
chiamata, e un id che nessuno ha più dichiarato non ottiene niente.

**E il vault si chiude.** La ~~9.5~~ e la ~~9.6~~ le chiude insieme, com'era
previsto, la [decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md):
chiudere è `VaultClosed` mentre tutti sono ancora vivi, poi un flush di tutti gli
indici — il punto di consistenza che non è il watcher — e poi ogni plugin che
smette in ordine inverso di dichiarazione. Sotto, `Host` ha smesso di tenere una
sessione sola: i vault aperti sono una mappa, ogni comando IPC accetta un
`vault` opzionale, e il "corrente" è tornato a essere ciò che diceva di essere —
una comodità della shell. Del §9.6 è rimasto fuori un punto solo, il **registro
dei vault** (recenti, preferiti, icone), che è configurazione globale e si è
spostato al ~~§11.1~~ — dove la
[0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) lo ha chiuso,
appoggiandolo al livello macchina che quel giorno non esisteva ancora.

**E il rilevamento si può chiedere.** La ~~9.7~~ l'aveva aggiunta il settimo
giro perché era la 9.5 sull'altro asse: là il watcher assente costava la
**durabilità** di un indice — e quel costo l'ha tolto la 0029, perché adesso il
flush ha un chiamante che non è il watcher — qui costava il fatto stesso di
sapere che il vault è cambiato, e nessuno chiedeva mai se il watcher fosse vivo.
La chiude la [decisione 0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md):
`IndexQuery::VaultStatus` è la domanda, la bandiera del rilevamento è **una
sola** e la tiene chi guarda, e ogni sincronizzazione per-path che fallisce resta
scritta nel vault anche quando il chiamante butta via il proprio `Result`. Con
lei è a verbale anche **cosa promette Fub dove il rilevamento non c'è**, che
era la decisione vera della voce. Ne è rimasto fuori un residuo, nominato: la
`base` che manca a `write_document`, che è il conflitto buffer↔disco del
[§18.1](18-editor-e-tastiera.md).

**E chi possiede i bundle ha un nome.** Il primo punto della 9.3 lo chiude la
[decisione 0031](../decisions/0031-chi-possiede-i-bundle.md): un bundle si monta
in quattro passi sempre uguali — la versione del contratto, la dichiarazione,
`Plugin::activate`, i provider — e li percorre un registry che sta **dalla parte
dell'host**, perché l'`HostApi` non ha capacità di registrazione ([0013](../decisions/0013-elenco-delle-capacita.md))
e un plugin non può registrarsi da sé. Da lì vengono le due cose che non avevano
un posto: `Plugin::deactivate` ha un chiamante — e arriva **prima** che il kernel
tolga i provider, che è l'unico momento in cui il suo `host` serve a qualcosa —
e `abi_compatible`, che era una regola senza applicazione, si applica.

**E il lavoro lungo ha chi lo esegue.** La seconda metà della ~~9.3~~ la chiude
la [decisione 0032](../decisions/0032-il-runner-dei-job.md), e sono le tre cose
che il §9.3 chiedeva di decidere **insieme**, perché un pool che non nasce
cancellabile si riscrive per diventarlo. Un pool di thread che aspetta un
campanello del kernel invece di interrogare la coda a intervalli — la stessa
mossa della bandiera della [0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md),
il kernel presta un pezzetto di stato a chi fa il mestiere che lui non fa.
L'annullamento che **non aggiunge nessuna capacità**: chi è annullato riceve
rifiuti dal proprio host alla chiamata successiva, e un job puro che non chiama
mai l'host arriva in fondo comunque — è il limite, ed è dichiarato. E la risposta
alla domanda che la voce poneva, *chi chiude aspetta chi?*: **prima si smette di
guardare, poi si smette di lavorare, poi si chiude**, che è la stessa regola del
watcher letta due volte.

Con lei è chiuso anche il **safe mode**, e non come lo chiedeva la voce: la rete
contro i panici c'è a tutte e otto le porte da cui si entra in un plugin — e sta
attorno alla chiamata del provider e a niente di più, perché il kernel ha
invarianti da rimettere a posto e quel codice era già scritto per il ramo
dell'errore — mentre la **disattivazione automatica no**, perché il meccanismo
c'è ([0031](../decisions/0031-chi-possiede-i-bundle.md)) e mancavano le due metà
della frase: l'avviso (§20.2) e il modo di riaccendere. La seconda è arrivata con
la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) — il registry tiene
adesso anche i bundle **non** montati, e `plugins.disabled` dice fra un avvio e
l'altro chi è spento — quindi ne resta una sola.

Qui non resta niente.
