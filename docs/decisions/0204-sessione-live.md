# 0204 — La sessione live è un servizio dell'app con un canale verso la shell

- **Stato:** proposta
- **Data:** 2026-10-03
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Con la superficie di disegno della [0203](0203-superfici-spaziali.md) un
tablet deve poter scrivere su un disegno aperto sul PC, e il PC deve mostrare il
tratto mentre nasce, per esempio su un proiettore. Servono due flussi:
l'inchiostro in corso, frequente ed effimero, e il commit al sollevamento della
penna, raro e affidabile. L'autorità resta la `DocumentSession` del PC.

I vincoli che contano:

- `fub-host` non ha un runtime asincrono, per scelta dichiarata nel suo
  `Cargo.toml`; `fub-app` ha quello di Tauri;
- l'IPC è un adattatore sottile e tipizzato
  ([0189](0189-ipc-sottile-e-tipizzato.md)): lista chiusa di comandi in
  `lean_ipc.rs`, `u64` come stringhe, mirror generati, fake host, nessuna
  callback attraverso il contratto salvo i ponti dichiarati, che sono sei;
- un canale con budget non è una risposta autorevole
  ([0184](0184-eventi-accodati-e-job.md));
- le operazioni sul disegno le valida e le applica la shell (0203);
- i segreti non sono impostazioni: l'unico deposito è un file del solo
  proprietario nella cartella di configurazione della macchina;
- su `http` della rete locale i browser tolgono gli eventi coalescenti, quindi il
  client del tablet dipende dal dispositivo, e le misure lo decidono.

## Decisione

1. Il servizio è un crate nuovo, `crates/fub-live`: tipi del protocollo,
   validazione di forma, dimensione e frequenza dei messaggi, server e client.
   Porta nel workspace `tokio` senza feature di default (è già nell'albero con
   Tauri), `tokio-tungstenite` per il solo handshake, `tokio-rustls` e `rustls`
   con il solo provider `ring` e il solo TLS 1.3, `rcgen` con `ring`, `qrcode`
   con il solo SVG e `if-addrs`. Non dipende da `fub-abi`, `fub-kernel`,
   `fub-host` o Tauri, e `dependency_invariant` lo verifica. Lo stesso crate fa
   da client per i percorsi che girano in Rust.
2. Lo compone `fub-app` sul runtime di Tauri; `fub-host` resta senza runtime.
   Nell'app la sessione appartiene alla finestra che l'ha aperta, e le altre
   finestre non la vedono; nella shell appartiene alla `DocumentSession`, con
   owner e teardown come chiede la
   [0193](0193-ownership-lifecycle-e-teardown.md). La chiudono `live_stop`,
   che la shell chiama anche quando il documento si chiude, il ricaricamento o
   la distruzione della finestra, un canale che non consegna più e l'uscita
   dall'app, che aspetta al più 3 secondi il `bye` allo scrittore. Il listener
   si chiude con lei.
3. Fra shell e host:
   - cinque comandi, `live_start`, `live_pairing`, `live_send`, `live_status`
     e `live_stop`, con tipi in specchio generato da `ts_mirror_app`, voce in
     `lean_ipc.rs`, permesso in `allow-shell` e implementazione nel fake host.
     `live_pairing` mostra di nuovo il QR o ne chiede uno nuovo; `live_send`
     porta `ack`, `nack`, `ops` e `snapshot`, e il `bye` allo scrittore lo
     manda `live_stop`. Gli errori sono chiavi del catalogo del core;
   - un `tauri::ipc::Channel` per sessione, passato a `live_start`: è il
     settimo ponte. Porta l'arrivo e l'uscita dello scrittore, l'inchiostro in
     corso, la vista, i commit e i campioni di latenza. L'host inoltra ogni
     messaggio appena arriva e raccoglie in un solo invio quelli arrivati mentre
     il precedente era in corso; la shell disegna una volta per frame;
   - il canale non è autorevole: un commit resta in attesa nell'host finché la
     shell non risponde `ack` o `nack`, e `live_status` lo restituisce. Un invio
     perso o una finestra ricaricata non perdono commit; l'inchiostro perso lo
     sostituisce il commit;
   - i contatori `seq`, `c` e `lastC` viaggiano come stringhe decimali.
4. L'autorità resta nella shell. La shell applica i commit con il motore delle
   operazioni della 0203, ricalcola `d` dai campioni e produce l'eco canonica;
   l'host controlla solo forma, dimensioni e frequenza. Un tratto remoto e uno
   locale passano dallo stesso codice.
5. Rete:
   - il listener è spento per default, si apre con `live_start` e ascolta solo
     sull'indirizzo IPv4 privato scritto nel QR (10/8, 172.16/12, 192.168/16).
     Con più interfacce si propone quella della rotta predefinita e l'utente
     può sceglierne un'altra;
   - la porta è libera, scelta a ogni sessione. L'impostazione di macchina
     `live.port` la fissa per le reti con regole firewall;
   - niente ritrovamento automatico (mDNS): basta il QR.
6. Fiducia:
   - l'abbinamento usa un segreto monouso di 128 bit da `ring::rand`, valido 5
     minuti e consumato dal primo `hello` valido; il gettone di ripresa cambia a
     ogni riconnessione;
   - per i client in Rust il certificato è effimero: ECDSA P-256, generato a
     ogni sessione, con la chiave solo in memoria. Il QR porta l'impronta
     SHA-256 e il client confronta l'impronta, non le date, perché l'orologio
     del tablet può essere sbagliato;
   - per il client web, se le misure lo scelgono: una CA locale generata al
     primo uso con il consenso esplicito, con vincoli di nome che ammettono solo
     indirizzi IP privati ed escludono ogni nome DNS. La chiave sta in un file
     del solo proprietario, con le regole di `services-token` più il controllo
     delle ACL su Windows, che quel lettore non fa. Ogni sessione emette un
     certificato per il suo indirizzo;
   - una sessione espone un solo documento e un solo scrittore, e nessun
     comando oltre al protocollo di disegno.
7. Il percorso del client resta aperto fino alle misure: Fub desktop come
   client live sul tablet Windows, un'app compagna Tauri per Android e iPadOS,
   oppure un client web servito da `fub-live`. Finché la scelta non c'è si
   costruisce solo ciò che vale per ogni percorso: crate, adattatore e lato PC.

## Conseguenze

### Positive

- un tratto dal tablet e uno locale producono lo stesso testo e lo stesso undo;
- `fub-host` e il kernel restano senza runtime asincrono e senza rete in
  ingresso;
- il listener esiste solo durante una sessione e solo sulla rete locale;
- nessun commit si perde per un invio fallito del canale.

### Negative

- un ponte e cinque comandi in più nella lista chiusa dell'IPC;
- un server in ascolto nel processo dell'app, finché la sessione è aperta;
- dipendenze nuove per WebSocket, TLS, certificati e QR, tutte da far passare
  da `cargo deny`;
- al primo avvio su Windows il sistema chiede il permesso del firewall;
- per il client web, una CA locale da custodire e da installare sul tablet.

## Alternative scartate

### Server in `fub-host`

Avrebbe messo il servizio accanto agli altri dell'host. È scartato perché
richiede un runtime asincrono che l'host esclude per scelta; il server bloccante
di `fub-services` è un processo a parte, solo su loopback e senza TLS, e
rifarne WebSocket, heartbeat, limiti e ripresa su thread bloccanti duplicherebbe
`tokio-tungstenite`.

### Eventi `fub://event` invece del canale

Gli eventi esistono già. Sono scartati perché passano dal percorso degli avvisi
del kernel, che si può compattare, e non appartengono a una sessione: il canale
nasce con `live_start`, ha un solo destinatario e si chiude con la sessione.

### Una porta generica

Nessuna porta esistente esprime una sessione bidirezionale in streaming con un
proprietario e una fine; piegarne una avrebbe nascosto il ponte invece di
dichiararlo.

### Inoltro attraverso un servizio in rete

Avrebbe evitato i problemi delle reti scolastiche. È scartato perché richiede
Internet e porta fuori dalla rete locale i disegni, spesso di minori.

## Verifica

- un test con un client in-process per ogni limite e ogni codice di chiusura
  del protocollo;
- segreto riusato o scaduto, gettone di ripresa scaduto, impronta diversa e
  secondo scrittore rifiutati;
- dopo `live_stop` la porta è libera e nessun task resta vivo;
- un'altra finestra non vede la sessione, e il ricaricamento, la distruzione
  della finestra e l'uscita dall'app la chiudono;
- un commit non confermato sopravvive alla perdita del canale e torna da
  `live_status`;
- `lean_ipc`, mirror generati e fake host aggiornati;
- `cargo deny check` verde con le dipendenze nuove.
