# Temi da una cartella

> **Ambito:** le regole di sicurezza per installare un tema da una cartella
> scelta dalla persona e per collegare la cartella di un tema in sviluppo:
> il permesso, le porte, la sostituzione di un id già installato.
> **Fonti autorevoli:** `crates/fub-host/src/theme.rs`,
> `crates/fub-host/src/theme/`, `crates/fub-host/src/theme_watch.rs`,
> `crates/fub-app/src/lib.rs`.

Le regole comuni a ogni tema (motori, manifest, limiti) sono in
[Temi installati](permissions-and-security.md#temi-installati), caratteri,
icone e impostazioni in [un'altra pagina](theme-assets.md); le forme e gli
esiti dei comandi sono nelle [porte dei temi](theme-ipc.md).

## Installare da una cartella

Oltre al catalogo firmato, un tema si installa da una cartella scelta dalla
persona, ma solo con la modalità sviluppatore accesa (`developer.mode`:
interruttore di macchina, spento di default). La regola sta nell'host
(`Host::check_theme_folder`, `Host::install_theme_from_folder`), che rilegge
la chiave a ogni chiamata e risponde `permission_denied` se è spenta; il
bottone che la shell nasconde non è la difesa. La chiave non basta da sola:
plugin e automazioni non la scrivono, ma la webview sì, con `set_setting`,
come ogni impostazione della persona. Per questo la cartella la sceglie la
persona nella finestra **nativa** che l'app apre dentro `check_theme_folder`,
solo per la shell principale, col titolo scritto dall'host: la webview non
passa né il path né il titolo. Su Android e iOS il plugin del dialogo non
sceglie cartelle: `check_theme_folder` e `link_theme_folder` rispondono
`unserved` (`host.theme_folder.desktop_only`) e non si apre niente.

L'host tiene la cartella controllata, l'impronta dei suoi byte e il manifest
letto da quei byte, ed è un permesso che vale **una volta e per un esito**: `install_theme_from_folder`
riceve solo l'impronta, installa soltanto quella cartella e consuma il
permesso. Una collisione lo rinnova solo per la risposta «Sostituisci», una
volta; il «no», il rifiuto del cancello della shell e ogni nuova apertura
della finestra lo scartano (`discard_theme_folder`, o l'apertura stessa).
Dopo una collisione anche una richiesta senza `replace` vale come il «no»:
consuma il permesso, e un «Sostituisci» che arriva dopo è `unchecked`.
Senza permesso l'esito è `unchecked`, e niente si scrive. Ogni controllo e
ogni scarto aprono una generazione nuova del permesso: un controllo lento, o
il rinnovo dopo una collisione, non tornano sopra un controllo o un «no»
arrivati nel frattempo. Una webview
compromessa con la modalità accesa può al più aprire la finestra di scelta:
senza il gesto della persona non legge né installa niente, e dopo un «no» non
sostituisce niente.

Prima di scrivere, la shell passa i fasci letti dal cancello del catalogo: un
tema che la shell rifiuterebbe non arriva in `themes/`. Non è questo il
presidio: l'host rifà le sue porte sulla sorgente e sulla staging
(`ThemeBundle::load`: manifest, permessi, limiti, caratteri, icone, niente
symlink né traversal), e la shell rivalida ogni tema che monta
(`mountThemeBundle` chiama `validateThemeBundle` su ogni fascio, anche su
quello letto con `read_theme` fuori dal catalogo; la cache del primo
fotogramma tiene solo l'id). La cartella non può portare lo stato del
catalogo che scrive solo Fub: un `.fub-current.json` (che `read_theme`
seguirebbe), una sua copia temporanea o `.generations` nella radice sono un
rifiuto tipizzato (`catalog_state`). L'installazione sonda prima la
destinazione col manifest del controllo, senza scrivere; poi legge la
sorgente **una volta**, copiandola nella staging e prendendone l'impronta
nello stesso passaggio, e confronta l'impronta con quella del controllo: i
byte pubblicati sono quelli dell'impronta, l'esito parla solo dei byte
controllati, e una cartella cambiata (o tolta, o rinominata) nel frattempo è
`changed` e non si pubblica. Le porte si ripassano sulla staging, e la sonda
della destinazione si rifà subito prima di pubblicare, sotto lo
stesso lucchetto per id che prendono l'installazione dal catalogo, la
revoca, l'aggiornamento e la disinstallazione (un lucchetto del processo,
non del file system): una revoca arrivata durante la copia ferma la
sostituzione (`revoked`), e un'installazione dal catalogo dello stesso id
non pubblica a metà di uno scambio. Una
lettura che non riesce con la cartella invariata è `unreadable` (dalla parte
della cartella scelta o di quella dei temi), non un guasto di scrittura. Per
il resto l'installazione passa dalle stesse regole di `install_theme` (serie
riservata, rename atomico) e il tema ha la fiducia di ogni tema non di
serie.

## Il tema collegato

Il **tema collegato** (`Host::link_theme_folder`) segue le stesse regole
d'ingresso: modalità sviluppatore accesa, cartella scelta nella finestra
nativa dell'app, letta con le porte di `ThemeBundle::load` a ogni lettura (un
link simbolico che esce, un `.fub-current.json`, un manifest a metà sono un
rifiuto tipizzato). Il path canonico va nella chiave di macchina
`developer.theme-folder`, che nessun programma scrive e che la webview non
scrive con `set_setting` (`permission_denied`): la scrive solo il gesto
«Collega una cartella…», e «Scollega» la azzera. La chiave non viaggia coi
profili di macchina: importare o copiare un profilo la scarta, esportarlo non
la porta fuori, cambiare o azzerare il profilo attivo lascia il valore di
prima. Così un profilo arrivato da fuori non collega una cartella. La
cartella non si copia in
`themes/`, e un tema installato con lo stesso id vince (`collision`). Il tema
ha la fiducia `development`, e la shell lo passa dallo stesso cancello di ogni
altro tema a ogni rimontaggio: un fascio rifiutato non si monta, resta
l'ultimo buono. L'osservatore della cartella vive nell'host (lo stesso
`notify` del vault, senza seguire i link simbolici), solo con la modalità
accesa e una cartella collegata che le porte dicono `ready`: una radice
qualunque, come `/`, non apre mai un osservatore ricorsivo. Montarlo e
smontarlo non passa dal thread principale. Spenta la modalità (anche con un
vault aperto), scollegata la cartella o chiusa l'app, smette di guardare e
non manda più eventi.

## Un id già installato

Un id già installato non si tocca: l'esito è `collision`, e solo la risposta
«Sostituisci» (`replace`) lo sostituisce. Un tema installato revocato dal
catalogo non si sostituisce mai da cartella (`revoked`): la copia nuova non ha
puntatore e cancellerebbe la revoca. Per la stessa ragione un puntatore del
catalogo che non si legge (rotto, o che non si lascia aprire) ferma
l'installazione (`blocked`, `pointer`): potrebbe dire «revocato». Neanche un
link simbolico al posto del tema installato o della cartella dei temi si
attraversa (`blocked`, `link`), né una forma che non è una cartella (`blocked`,
`layout`): non sono difetti della cartella scelta, e l'esito lo dice. Un tema
installato senza puntatore che non si legge (il manifest rotto, una radice
che non è una cartella) è invece una `collision` senza versione, e si può
sostituire: lo decide la persona. La sostituzione non
toglie il vecchio prima: la copia nuova si verifica accanto, il vecchio si
sposta da parte (una voce `.tmp-old-` che la scansione salta), il nuovo prende
il suo nome, e solo allora il vecchio si cancella. Se il vecchio non si lascia
cancellare lo dice il log (`fub.host`), cambia nome in `.tmp-drop-` e lo
spazza l'installazione successiva. Se il nuovo non entra il vecchio torna, e
l'esito è `failed` col perché del disco (`full`, `denied`, `other`);
`replace_failed` resta per il caso in cui il vecchio non riesce a tornare, e
il suo campo `kept` dice sotto quale nome `.tmp-old-` è rimasto nella
cartella dei temi: è l'unica copia del vecchio, e niente la cancella da sola.
