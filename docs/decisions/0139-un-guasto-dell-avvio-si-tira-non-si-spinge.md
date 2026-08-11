# 0139 — Un guasto dell'avvio si tira, non si spinge

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: la [§25.5](../roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#255-quando-la-cartella-di-configurazione-non-si-può-scrivere)
— *«Quando la cartella di configurazione non si può scrivere»* — nella forma
**(a)** che la voce stessa raccomandava, con la clausola che è il verbale a
fissare: la porta è un **tiraggio**, non una spinta all'avvio.
**Commit**: *(questo commit)*

---

**La regola che questo verbale fissa.** La cartella di configurazione che non si
può scrivere — e la cartella che non c'è — si dicono **una volta per sessione**
su un `Event::Trouble` di severità `Warning` (`subject: None`, `PluginError::Io`
col testo del pavimento), nel canale che la shell mostra. La diagnosi nasce in
[`fub_host::config::pavimento`](../../crates/fub-host/src/config.rs) — il primo
a provare a scrivere in quella cartella è il log — e la riga di `stderr` resta
dov'è: il log è il pavimento, l'evento è la porta (0062). Ciò che la voce non
diceva è **quando**: la porta non può essere una spinta all'avvio, perché a
quell'ora non esiste nessun ascoltatore — il ponte eventi nasce dentro
`Host::open`, al primo vault aperto, e la shell si iscrive agli eventi ancora
dopo — quindi è un **tiraggio**: un comando IPC (`avviso_di_sessione`, il 38°
dell'allowlist, dichiarato con la ragione di `pending_keybindings`: risponde con
un dato che non si ricava dal vault) che la shell chiede in `init()` appena il
router è in piedi, prima di `initial_vault`. L'ordine dell'IPC garantisce la
consegna: l'ascoltatore è iscritto prima che la `invoke` parta. L'avviso viaggia
da `install_logging` (che ora lo restituisce), entra nell'host con
`with_avviso_di_sessione` e si consuma con un **`take`**: la «una volta per
sessione» è strutturale, la seconda chiamata — da un secondo comando, da un
secondo thread, da un secondo frontend — riceve `None`.

I due rami dicono due cose diverse, perché sono due guasti diversi: «la cartella
`X` non si può scrivere» (il testo del pavimento, che nomina la cartella e il
marcatore portable) e «nessuna cartella di configurazione (un ambiente senza
`HOME`): Fub lavora in memoria, e impostazioni, registro dei vault e stato di
vista non si salveranno da nessuna parte». Stessa severità, stesso canale,
stessa una-volta: un messaggio solo avrebbe mentito su uno dei due rami.

**Cosa si scarta, e perché.** La **(b)** — rifiutare di partire — contraddice la
riga scritta a `config.rs:40-45` («perdere il tema è meglio di un'app che non
parte») e farebbe pagare ogni chiosco e ogni disco pieno passeggero come se
fosse un guasto dell'app. La **(c)** — ripiegare su `~/.config/fub` — tradisce
la promessa del portable: lo stato finisce su una macchina invece che sulla
chiavetta. E si scarta anche la forma che la voce non nominava ma che la sua
frase suggeriva: **la spinta all'avvio**, che sarebbe stata verde e muta — il
guasto che questo giro esiste per non lasciare in giro.

**Le premesse cadute, col perché sembravano vere.**

1. **«La (a) si parte e si dice» non diceva quando, ed è il quando che decideva
   la forma.** Un `Trouble` emesso all'avvio si perde **in ogni caso**: prima
   del `setup` di Tauri il sink ha il `OnceLock` vuoto e risponde
   `Consegna::Persa`; dopo il `setup` ma prima che la shell carichi il JS,
   `app.emit` torna `Ok` — consegnato alla webview, non a un ascoltatore, perché
   Tauri non accoda. Il ponte non c'entra nemmeno: a quell'ora non esiste (nasce
   in `Host::open`, `session.rs:591`). Sembrava vera perché la voce diceva
   «forma (a)» e nessuno aveva chiesto *quando* — ed è la domanda che ha
   trasformato la forma da spinta a tiraggio.
2. **Un banco presidiava il silenzio che questa voce rovescia.**
   `senza_cartella_di_configurazione_stderr_non_e_un_guasto` (`config.rs`)
   asseriva `pavimento(None)` → `avviso == None`: la scelta della 0062 — «stderr
   è il canale normale, non c'è niente da spiegare» — era **deliberata e
   presidiata**, non dimenticata. Il banco è stato riscritto nel verso nuovo
   (`senza_cartella_lo_stesso_si_dice`), e va detto perché chi lo troverà
   rovesciato sappia che la vecchia riga era una decisione, non una svista.
3. **La citazione «undici derivati, zero originali» non sta nella 0076.**
   `grep -i derivat docs/decisions/0076-*.md` dà **zero** occorrenze: la frase
   vive solo nel roadmap. La **sostanza** della 0076 regge — il titolo stesso
   del verbale dice che le impostazioni vivono nel vault e la macchina tiene
   solo ciò che serve quando il vault non si apre — ma la citazione è del
   roadmap. Sembrava vera perché la 0076 sposta davvero tema e scorciatoie nel
   vault, e attribuire la frase a quel verbale era un gesto naturale.
4. **Il `take` è più forte della richiesta della voce.** Non dà solo «una volta
   per sessione»: dà che il **secondo chiamante** — un test, un altro frontend,
   la CI — riceva `None` e non la diagnosi di qualcun altro. La garanzia vale
   fra clienti diversi, e nessun `AtomicU32` serve: la diagnosi nasce una volta
   e si consuma una volta, e la forma di `Custodia::denuncia` è per chi deve
   rispondere a ogni chiamata. Sembrava che servisse un latch perché «una volta»
   evoca un conto; qui è una struttura.
5. **`PluginError::Io` è la variante onesta, e la 0132 la lascia passare.** Il
   punto 7 della voce elenca l'incoerenza dei percorsi di errore — e misurata è
   più fine di come la voce la dipinge: il «String nudo» dello stato di vista
   sta nel kernel (`workspace.rs:5825`) ed è già vestito da `Io` alla frontiera
   (`lib.rs:692`); il registro vault ha *entrambe* (`vaults.rs:343-344`). La
   scelta di `Io` per il nuovo evento non risolve quell'incoerenza (non è il
   mandato della forma (a)) e non la cementa: è la classe giusta — un errore di
   I/O — dove `Internal` direbbe «bug di Fub» e `PermissionDenied` mentirebbe
   sul ramo senza `HOME`. La 0132 ha giudicato le varianti per i dati dichiarati
   nel contratto; qui non ce ne sono, e la prosa composta resta prosa del
   kernel, la zona cieca dichiarata della 0132 stessa.
6. **La lezione di metodo.** Un rosso in un file che non è tuo, mentre altri
   scrivono, non è instabilità: durante la suite il test `custom_blocks_e2e` è
   andato rosso una volta e poi verde per tre giri e in corsa intera — il file
   era a metà scrittura di un collega. Prima di costruirci una diagnosi,
   chiedersi chi altro sta toccando quel file.

**La tensione dichiarata, da non risolvere qui.** `set_setting` che fallisce
produce un toast di tono `guasto` (il punto 7 della voce), la porta dell'avvio è
`info`. Non confliggono — l'una dice «non ho scritto adesso», l'altra «non
scriverà mai» — ma qualcuno potrebbe leggerle come incoerenti: il verbale le
distingue per nome, e la normalizzazione dei tre percorsi di errore del punto 7
resta fuori (non ha un innesco, e una casella senza innesco è una riga scritta a
vuoto).

**Cosa resta scoperto.** La normalizzazione dei tre percorsi di errore
(`Io`/`Internal`/`String`), dichiarata sopra. Il testo dell'avviso resta prosa
italiana del kernel non traducibile, nella zona cieca della 0132. E il cablaggio
`install_logging → run → with_avviso_di_sessione` non è provabile dai banchi (il
collettore è globale al processo): lo presidiano la firma di `install_logging` e
i banchi di `pavimento` — la zona cieca è scritta nel commento del banco
dell'host, non taciuta.
