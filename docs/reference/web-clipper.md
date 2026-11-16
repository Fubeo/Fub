# Il clipper del browser

> **Ambito:** come il clipper del browser consegna una cattura all'app, che
> cosa vale per ogni canale, i permessi dell'estensione, la chiave
> dell'assistente e la conversione della pagina in Markdown.
> **Fonti autorevoli:** `apps/clipper/src/` (`channel.js`, `capture.js`,
> `keystore.js`, `interpreter.js`, `convert.js`), `crates/fub-host/src/automation.rs`,
> `crates/fub-host/src/uri_inbox.rs`, `crates/fub-cli/src/native_host.rs` e le
> prove in `apps/clipper/tests/` e `crates/fub-host/tests/uri_inbox.rs`.

Il modello di fiducia generale è in
[Permessi e sicurezza](permissions-and-security.md#clipper-del-browser).

## Host nativo del clipper

Il clipper del browser consegna prima a `fub-clipper-host` (nome
`local.fub.clipper`), per messaggistica nativa: è il solo canale autenticato,
perché l'host accetta soltanto un'estensione abbinata con
`fub-cli pair pair --extension-id ID`. `fub://capture` e il file
`.fubcapture.json` sono il ripiego, senza autenticazione e con
un'approvazione per ogni cattura.

Il browser trova l'host da un manifest dell'utente, mai di sistema.
`fub-cli native-install --extension-id ID` dice dove lo scriverebbe; con
`--yes` lo scrive in ogni browser installato, o in quelli dati con
`--browser`. Su Windows scrive anche la chiave di `HKEY_CURRENT_USER` che punta
al manifest. L'id decide la famiglia: le 32 lettere di un'estensione Chromium
danno `allowed_origins`, l'id di Firefox `allowed_extensions`, e un id della
famiglia sbagliata per il browser nominato è un errore d'uso. Un file con quel
nome che non è un manifest dell'host resta com'è; `--uninstall` toglie
soltanto ciò che l'host ha scritto. Quando l'invio ripiega, il popup scrive i
due comandi con l'id vero dell'estensione.

## `fub://capture` e il file

Un `fub://capture` lo può aprire qualunque pagina web, con i parametri che
vuole. L'`origin` e il `timestamp_ms` della busta del clipper si controllano
(l'`origin` dev'essere `clipper-extension`) ma sono soltanto etichette: non
decidono niente e non provano chi ha mandato il collegamento. Per questo:

- una cattura chiede sempre conferma nella finestra principale, con il titolo,
  la nota che nascerà, l'inizio del testo, la fonte dichiarata e la frase che
  la provenienza non è verificata; `uri.allowed` non la può saltare (un
  `capture` scritto lì da una versione vecchia non vale), mentre può saltarla
  per una nota nuova, la giornaliera e la nota unica;
- le conferme arrivano una alla volta, nell'ordine della coda dell'host
  (`crates/fub-host/src/uri_inbox.rs`), che tiene al più 32 collegamenti e,
  fra questi, al più 4 catture: oltre si rifiutano e la finestra dice quanti;
- il `nonce` lega i tentativi di una stessa cattura: un collegamento con il
  `nonce` di una cattura già in coda non si accoda di nuovo, e quello di una
  cattura già scritta non si scrive più, nemmeno confermato (`uri.apply`
  risponde con un conflitto). L'host ricorda gli ultimi 256 `nonce` scritti
  finché l'app resta aperta; una scrittura fallita non consuma il suo.

Il clipper scrive i parametri con `encodeURIComponent`, perché l'host legge
la query di `fub://` con la sola decodifica percentuale e un `+` resta `+`.
Un test del clipper e uno dell'host leggono lo stesso URI
(`apps/clipper/tests/fixtures/capture-uri.txt`), così i due lati non si
separano.

## Permessi dell'estensione

L'estensione non ha permessi di host all'installazione. Quelli che può
chiedere dopo, uno per uno dalle opzioni, per l'assistente e per le immagini
da scaricare, sono i siti `https` e il loopback `http` (`127.0.0.1`,
`localhost`), uguali nel manifest di Chromium (MV3) e in quello di Firefox
(MV2); mai `<all_urls>`. Il permesso del browser non basta: una richiesta a un
sito remoto parte soltanto se l'utente ha concesso quell'origine anche nelle opzioni
(`apps/clipper/src/interpreter.js`).

## La chiave dell'assistente

La chiave dell'assistente remoto, se l'utente la scrive nelle opzioni, passa
da `apps/clipper/src/keystore.js`. Di serie sta in `storage.session` (voce
`fub-ai-key`): resta nella memoria del browser, non tocca il disco, non è
visibile agli script di contenuto e sparisce alla chiusura del browser
(Chromium dalla 102, Firefox dalla 115 anche in MV2, Safari dalla 16.4). Solo
se l'utente accende «Ricorda la chiave su questo dispositivo» (spenta di
serie, preferenza `fub-ai-key-remember`) va in `storage.local`, nel profilo
del browser; la frase sotto la casella dice il rischio. Senza
`storage.session` il salvataggio di una chiave da non ricordare fallisce con
un messaggio: mai `storage.local` di nascosto. Una chiave che una versione
vecchia aveva messo in `storage.local` resta lì e la casella appare accesa.
Spostando la chiave da un'area all'altra si scrive prima la copia nuova e poi
si toglie la vecchia. «Dimentica la chiave» la toglie da tutte e due le aree.

Il campo è di tipo password, con un pulsante che la mostra o la nasconde, e
non viene mai riempito con la chiave salvata. Il popup la legge al momento di
«Chiedi», per quella sola richiesta, e non la tiene in memoria; non entra mai
in una pagina, in un indirizzo `fub://` o in una cattura. Il rischio che
resta: con «Ricorda» acceso, chi legge il profilo del browser con i diritti
dell'utente legge anche la chiave; in ogni caso un difetto che esegua codice
nella pagina delle opzioni o nel popup la può leggere mentre il browser è
aperto.

## Dalla pagina al Markdown

La conversione della pagina in Markdown (`apps/clipper/src/convert.js`, gemella
di `crates/fub-importers/src/html.rs`, che la usano anche gli importatori e il
salvataggio del visore) legge un `href` come lo legge il browser: senza
caratteri di controllo ai bordi, senza tab e a capo in mezzo. Lo schema si
giudica sull'indirizzo che il Markdown risolverà, con escape ed entità sciolti.
Con `javascript:`, `vbscript:` o `data:`, anche mascherati da un'entità
(`javascript&colon;`, `&#106;avascript:`) o da un escape (`javascript\:`), il
link cade e la sua etichetta resta testo, senza parentesi quadre. Gli altri
schemi e i percorsi relativi (`a&amp;b.html`) restano destinazioni, perché un
importatore porta i suoi (`evernote://`): la resa li filtra di nuovo.
