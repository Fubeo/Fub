# Decisioni del lavoro a piani

Questo file serve al workflow a piani (`/pianifica`, `/orchestra`, vedi
`CLAUDE.md`). Dice che cosa l'orchestratore decide da solo e che cosa chiede,
e tiene il registro delle scelte fatte durante il lavoro, perché il piano dopo
ne tenga conto. Le scelte di architettura vere vanno in un ADR
(`docs/decisions/`); qui resta una riga che lo nomina.

## Il criterio

Il risultato migliore, anche quando costa più tempo, più lavoro o più coder:
fra due strade si sceglie quella più solida, non quella più corta. E poche
domande: l'utente decide ciò che vede e ciò che non si può disfare; il resto lo
decide l'orchestratore, lo scrive nel registro e lo dice nel resoconto. Nel
dubbio su una scelta tecnica si decide, non si chiede.

## L'orchestratore decide da solo

- l'ordine dei task pronti. Lavorano due coder alla volta (Opus,
  ragionamento medio) e nessun altro agente: è la regola dell'utente dal
  2026-11-07 (dal 2026-11-04 era un coder solo), e la cambia solo l'utente;
- il come che il piano approvato lascia aperto: nomi, tipi, dove sta una
  funzione, la forma di un messaggio d'errore, la forma dei test;
- un piccolo refactor dentro i file del task;
- i formati interni che solo Fub legge e scrive (chiavi delle impostazioni,
  file di cache, il canale fra CLI e app), dentro ciò che il piano ha approvato;
- una dipendenza nuova fra crate del workspace che il piano implica, con il
  diagramma di `docs/architecture/overview.md` e `dependency_invariant`
  aggiornati;
- allargare il perimetro di un task a un file strettamente legato (il suo
  test, un chiamante, un file generato, la pagina di `docs/` che lo descrive),
  anche su richiesta del coder;
- i conflitti banali quando unisce (una riga in una lista, un indice, una
  tabella di testi);
- rilanciare un coder con un'indicazione più precisa, o finire da sé una
  correzione piccola;
- correggere un rosso di fmt, clippy o test causato dal task;
- dividere un task troppo grande in due, senza cambiarne il «Fatto quando».

Ogni decisione presa da solo che un altro piano dovrebbe conoscere va nel
registro.

## Decide da solo, con più cura

Dal 2026-11-08 l'utente lascia all'orchestratore anche le scelte che prima
chiedeva, merge compresi: «fai sempre la scelta più adatta per ottenere il
massimo risultato, anche mettendoci un po' di più. E ti lascio libero anche
di fondere le branch con il main quando vuoi tu, quindi non aspettare le mie
risposte. Basta che ottieni il massimo risultato e la massima
personalizzazione e libertà dell'utente. E ovviamente mantenendo un certo
grado di sicurezza e affidabilità del progetto.»

Queste scelte l'orchestratore le prende da solo, ma con una soglia più alta,
le scrive nel registro e le dice nel resoconto:

- **il merge in `main`** di una consegna o di un ramo di piano: solo con la
  PR pronta (non bozza), la CI completa verde sull'ultima testa (Linux,
  Windows e macOS, banchi compresi quando tocca `apps/client/`), la
  revisione del diff fatta, le baseline prese dal runner e guardate, e
  nessun rosso tranne un instabile noto con la sua issue, rilanciato una
  volta e passato. Mai `--admin`, mai saltare un controllo richiesto, mai
  forzare. Dopo il merge, `origin/main` entra nei rami di piano puliti;
- ciò che chi usa Fub vede o fa in modo diverso dal piano approvato: si
  sceglie la strada che dà più qualità, più personalizzazione e più libertà
  a chi usa Fub, e si fotografa;
- il contratto pubblico (ABI, WIT, IPC, formati su disco letti da altri):
  solo additivo, con le guardie di compatibilità verdi; mai rompere un
  formato già pubblicato;
- sicurezza e permessi: si sceglie sempre la strada più stretta; mai
  allargare un permesso, una CSP o una capacità WASM per comodità;
- una dipendenza esterna nuova: solo se il piano la implica, con licenza
  compatibile e `cargo deny check` verde; mai cambiare la politica delle
  licenze o della catena di fornitura;
- cambiare «Fatto quando» o «Fuori scope», rinviare o dividere un task:
  solo per un risultato migliore, mai per chiudere prima;
- un test: si corregge la causa. Disattivarlo o metterlo in quarantena solo
  se è instabile per una causa fuori da Fub, con una issue aperta, e mai un
  test che prova sicurezza o dati.

## Resta all'utente

Solo ciò che l'orchestratore non può fare o che esce dal repository:

- ciò che si fa con le mani o con persone: la prova di K2 con una persona,
  la prova con cinque persone, il giro su un Mac, avviare il piano del
  telefono;
- licenze di opere altrui (il logo e ArtCraft), account e segreti
  (SignPath, chiavi di firma);
- la pubblicazione della pre-release (il tag `v0.2.0-prealpha.1` e la
  release su GitHub): l'orchestratore la prepara e la dice pronta, l'utente
  la pubblica o dice di pubblicarla.

Quando chiede: le domande di un momento tutte insieme, solo quelle la cui
risposta cambia davvero il risultato, con la conseguenza pratica di ogni
scelta e la raccomandazione per prima. Non si ferma ad aspettare: lavora su
ciò che non dipende dalla risposta.

## Registro

La più recente in cima: data · piano · decisione · perché.

- 2026-11-09 · K2 · la prova di D-2 è fatta dall'utente da solo sulla 1432
  (i cinque compiti: «mi sembrava che funzionasse»), dopo tre correzioni
  della sola 1432 (componenti, «Annota il PDF» e il `.fubann` dal ponte;
  SHA-256 in JavaScript fuori da https): #290 si allinea a `main` e si segna
  pronta. Dalla prova tre difetti del programma, da mettere in un task: la
  «Struttura» ferma sulla nota di prima quando si apre un PDF, la nota
  d'errore delle annotazioni alta un riquadro, i tratti fuori pagina dopo il
  ripiego A4 · D-2 chiede il resoconto prima di segnarla pronta, e l'utente
  ha detto che le prove con altre persone si rinviano.
- 2026-11-09 · K5 T6 · integrato senza aspettare la licenza IJG di
  `jpeg-encoder` (lo usa `render` per il JPEG): oggi `cargo deny` di Fub è
  verde perché nessun crate di Fub dipende dal motore, diventa rosso a T9; la
  scelta (eccezione in `deny.toml`, IJG nell'elenco, o una patch 0003 che usa
  l'encoder di `image`) è dell'utente, perché tocca la politica delle licenze ·
  la regola «deny.toml solo chiedendo»; T7 e i task del client non ne
  dipendono. In CI: due passi `check` e i test del workspace di VectorCraft
  accanto a GridCraft; `vectorcraft` nella matrice di `motori-upstream.yml`,
  le due librerie di craft-libs no (lo stesso repository aprirebbe due issue
  per un tag).
- 2026-11-09 · pre-alpha (utente) · rinviati: la prova con cinque persone
  (PA T17, e ciò che la usa), il giro a mano sugli installer (PA T23,
  «con calma quando avrò tempo») e la firma di Windows (PA T50, D20
  sospesa: niente spese ora, si decide alla release); la prova di K2 (D-2)
  la fa l'utente da solo · «tu fai il codice […] accontentiamoci di me che
  provo il codice»; i coder lavorano sui task sbloccati di ogni fase mentre
  un task aspetta l'utente.
- 2026-11-09 · k5 (orchestratore) · K5 T6: il PDF del motore si spegne
  togliendo `vectorcraft-pdf` ed `eps` dal grafo di `engine` (patch 0002,
  codice dietro `cfg`), non con una feature spenta; `vendor.mjs check` si
  allarga in T6 (righe radice facoltative fino a T9, nomi come
  `craft-docpath`, percorsi con il trattino) e le due librerie hanno un
  `Cargo.toml` di workspace di Fub · Cargo risolve nel lock anche le
  dipendenze facoltative dei membri, e `craft-pdf` non è su crates.io né si
  copia (D-2 (a) dell'utente: il PDF resta spento); copiarlo (D-2 (b)) o
  prenderlo da Git cambierebbe la risposta dell'utente o la politica delle
  fonti. La patch è grande (circa 56 file): si propone a monte.
- 2026-11-09 · scrittoio-2 (orchestratore) · S2 T9 aggiunge l'intento
  non privilegiato `fub.inspector.tab` (`fub_abi::ui::INSPECTOR_TAB_NS`,
  payload `{ view }`): «e altri N» sotto la Struttura porta ai Collegamenti;
  si accetta come aggiunta additiva, documentata nel contratto IPC · il
  registro delle view non aveva un modo di cambiare scheda dell'ispettore,
  e l'intento cambia solo ciò che si guarda, quindi non serve privilegio.
- 2026-11-09 · scrittoio-2 (orchestratore) · `bench:a11y` rosso in 119
  scene su «3 collegamenti» (S2 T12, già integrato): Invio e Spazio
  lanciavano l'azione senza un clic; corretto dall'orchestratore (b22a6650)
  perché sono poche righe, prima di integrare T27, T28, T9 e T13 · da ora
  ogni integrazione chiude su `bench:a11y` sul ramo unito, non solo su
  quello del coder; il disco pieno (ENOSPC, 0 byte) aveva fermato i giri
  finali dei coder, ora si fa `cargo clean` nei worktree finiti.
- 2026-11-09 · scrittoio-2 (orchestratore) · S2 T21 si integra con il
  banco dell'accessibilità rosso solo su `conflitto-lettura` (il clic sulla
  riga della nota va in timeout), rosso già prima del task e fuori dai suoi
  file; il gruppo «Carattere» del documento entra fra quelli che si
  raccolgono, in T28 · il clic rosso è un seguito già aperto del ramo;
  senza «Carattere» fra i raccolti il telefono non è come il prototipo
  approvato e a 700 px il gruppo resta tagliato.
- 2026-11-09 · scrittoio-2 (utente, orchestratore) · nuovo S2 T28: la
  barra a schede del documento accende il movimento del kit
  (`motion: true`) come la barra dei fogli, con la tenda sopra il vassoio;
  dopo T21, che le dà l'apertura sul posto · l'utente vuole le animazioni
  della barra dei fogli (K3 T18–T19) in tutte le barre a schede; il piano
  S2 le aveva lasciate fuori, e una sonda ha misurato che nel documento si
  muove solo il segno della sezione. Il movimento resta scritto una volta,
  nel kit; le barre in una fila non hanno sezioni né tenda, e restano come
  sono.
- 2026-11-09 · fub-pre-alpha · nuovo PA T62: un gancio di fub-app, spento
  di serie e acceso solo dal banco, fa raccogliere la WebView prima di ogni
  lettura di R1 (#284) · T21 ha mostrato che il minimo in 60 s non basta, e
  ogni rosso a caso allunga una consegna di mezz'ora; le soglie non si
  alzano, perché nasconderebbero una perdita vera.
- 2026-11-08 · fub-pre-alpha (utente) · le consegne diventano più grandi e
  più rare: una ogni 12–15 task integrati, o una per traguardo (per esempio
  «Scrittoio 2 completo»); la CI completa (Windows, macOS, banchi e baseline
  dal runner) gira solo sulle consegne; sul ramo del piano resta la CI corta
  di ogni push, che l'orchestratore non aspetta; i coder lavorano ai task
  successivi mentre la CI va avanti · la CI non ferma la scrittura del
  codice, ma la CI completa e le baseline costano; una CI sola alla fine
  mescolerebbe i difetti di centinaia di task, e le baseline non si
  potrebbero più guardare una per una.
- 2026-11-08 · fub-pre-alpha (utente) · i coder restano Opus medio, mai
  Sonnet né Haiku · la rilavorazione e i giri di CI in più costano più del
  tempo che un modello più leggero risparmierebbe.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T40 si integra anche se
  10.000 icone cambiate si ridisegnano in 18–35 ms (headless, macchina
  carica) e non sotto i 16 ms del piano · il ridisegno è già un passaggio
  solo con un modello per nome, il costo resta nel DOM, e la shell vera ha
  qualche centinaio di icone; il limite di 512 nomi resta, e S2 T14, che ne
  aggiunge, guarda il margine (oggi 440).
- 2026-11-08 · fub-pre-alpha (orchestratore) · la correzione del difetto
  di PA T47 trovato dalle baseline del runner (la maniglia del cassetto a
  44 px) la faccio io, e le esclusioni della regola dei 44 px stanno in
  `:not(:where(…))` · è una riga, il difetto è di peso dei selettori, e un
  `:not(.classe)` avrebbe tolto a ogni classe del telefono il diritto di
  smentire la regola.
- 2026-11-08 · fub-pre-alpha (orchestratore) · in PA T61 anche
  `Cargo.lock` fa partire la CI Mobile; le righe `cfg` del telefono nei
  crate comuni no · un aggiornamento delle dipendenze Tauri può rompere
  solo Android o iOS ed è raro; i crate comuni cambiano spesso, e quelle
  righe si provano sul push in `main`.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T47 si allarga al
  pallino dello stato della testata dei documenti (`pane-standing-chip`),
  che la regola dei 44 px faceva diventare un cerchio · è lo stesso difetto
  della stessa regola, e il task nasce per toglierlo.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T39 non si integra finché
  la regola dei caratteri, scritta in Rust e in TS, non è legata dal mirror
  delle regole (`rules_mirror.rs`) · due copie senza legame divergono, e il
  repo ha già il posto per legarle.
- 2026-11-08 · fub-pre-alpha (utente) · l'orchestratore decide da solo
  anche il merge in `main` e le scelte che prima chiedeva, con la soglia
  più alta di «Decide da solo, con più cura»; restano all'utente solo le
  prove con persone, licenze e segreti, e la pubblicazione della
  pre-release · l'utente vuole il risultato migliore senza aspettare le sue
  risposte, tenendo sicurezza e affidabilità.
- 2026-11-08 · fub-pre-alpha (utente) · nuovo task PA T61: i `paths` di
  `mobile.yml` coprono anche la cornice del telefono · una PR che cambia
  solo `shells/scrittoio/mobile/` non costruiva l'APK (trovato da PA T8).
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T35 accolto con le sue
  differenze: il fascio porta `inherited: { skin }` e un `extends` senza di
  esso è rifiutato; la pelle di serie ereditata non ripassa dal
  sanificatore; `replaceTheme` inserisce prima del primo canale dopo
  `pelle-tema`, quindi senza preferenze i frammenti restano ultimi (prima
  la pelle finiva dopo di loro) · la serie è codice nostro, e l'ordine
  dichiarato dei canali deve valere anche quando un canale manca.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T60 si allarga alle 4
  sonde di test di `crates/fub-host/src/session.rs`, fuori dal suo `Tocca`
  · hanno lo stesso schema a un colpo solo delle cadute, e nessun altro
  task toccava il file; il codice vero di `session.rs` non cambia.
- 2026-11-08 · fub-pre-alpha (orchestratore) · nuovo task PA T60: tutte
  le prove che aspettano libero il lucchetto del workspace lo chiedono con
  una scadenza, come quelle corrette da PA T19; quelle che lo aspettano
  preso restano a un colpo solo · due prove dello stesso schema sono cadute
  dopo T19 (in locale e su macOS nella CI della consegna 1), e la
  pre-alpha chiede la CI completa verde sul commit del tag.

- 2026-11-08 · fub-pre-alpha · dove le persone leggono, «FubDraw» diventa
  «Fub» o «il disegno» (frasi della shell, dei disegni, dei descrittori dei
  formati e degli errori che arrivano alla shell, in italiano e in inglese);
  resta solo come nome tecnico del formato, una riga nell'«Ambito» di
  `docs/reference/scene-format.md` e una nota in coda all'ADR 0203, che non
  si riscrive; una guardia in Vitest e due test Rust lo tengono fuori (PA
  T33) · D14 A dell'utente (2026-11-07): FubDraw vive dentro Fub e la sua
  app è archiviata (ADR 0231)

- 2026-11-08 · fub-pre-alpha · un file senza permesso di scrittura (0444
  su Unix, l'attributo di sola lettura su Windows) non si sovrascrive: il
  kernel rifiuta con `PermissionDenied` tipizzato e i byte restano (nuovo
  task PA T59) · T13 ha trovato che oggi su Linux il rename del salvataggio
  atomico lo sovrascrive; alla domanda fra rifiutare e scrivere lo stesso
  l'utente: «Rifiutare (Consigliato)»

- 2026-11-08 · k3-motori · il piano è concluso: #295 è in `main`
  (fb722164) col sì dell'utente, e `PLAN.md` e
  `PLAN-ui/menu-comandi-fogli.html` escono da `main` come per gli altri
  piani conclusi · erano entrati con l'unione, e ogni ramo di piano aperto
  andava in conflitto su `PLAN.md` a ogni allineamento con `main`.

- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T1: il finto del banco
  porta tutto il gruppo Aspetto dell'host (18 voci, nell'ordine di
  `appearance_settings`), non solo «Animazioni»; lo stato `aspetto` del
  simulatore ne mostra meno, ed è una differenza del simulatore · il task
  chiede «le voci che mancano», e ne mancavano nove: il finto deve dire
  quello che fa l'host, i testi vengono dai cataloghi Rust.

- 2026-11-08 · fub-pre-alpha · da 0.2.0 in poi un `enum` o un `variant`
  che attraversa il confine non prende casi nuovi, e un'interfaccia
  esportata dal plugin non prende funzioni nuove: le novità arrivano con
  interfacce nuove, come per i record; la guardia, l'ADR 0235 e i commenti
  di `abi.wit` lo dicono (nuovo task PA T58, che prova prima anche gli
  import) · T7 ha provato con componenti veri che l'una e l'altra cosa
  impediscono di caricare un plugin già compilato; alla domanda fra
  stringere la guardia e scriverlo solo nella pagina l'utente: «non importa
  quanto tempo ci vorrà, meglio la qualità»

- 2026-11-08 · fub-pre-alpha (orchestratore) · #295 unita in `main` col sì
  dell'utente (fb722164); i file del piano K3 entrati con lei escono da
  `main` con #316 (PLAN.md e PLAN-ui erano in conflitto con ogni ramo di
  piano); gli altri rami si allineano a `main` dopo #316 · l'utente: «Sì,
  unisci #295»

- 2026-11-08 · fub-pre-alpha (orchestratore) · ogni componente
  d'esempio (`esempi/*/Cargo.toml`) e `tools/varco-wasm` ha un
  `[workspace]` suo, vuoto (844c5f5b) · i coder lavorano in worktree
  annidati sotto `~/Progetti/Fub/.claude/worktrees/`: lì cargo risaliva al
  `Cargo.toml` del checkout esterno, che non li elenca, e i passi WASM di
  `check.sh` cadevano. Il comportamento fuori dai worktree annidati non
  cambia (erano già esclusi dalla radice). Serve prima di PA T7, che prova
  un componente vero.

- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T3 si divide in due
  parti fatte dallo stesso coder: prima `fub-kernel` dà ai comandi in sola
  lettura (`!spec.scope.writes`) un frame tutto loro (niente batch, nessun
  cambio dell'attore condiviso, `in_provider_call` giù, la ricorsione
  controllata nel prepared, mai undo), poi `fub-host` toglie loro il turno;
  il perimetro si allarga a `workspace.rs` (e `jobs.rs` se è lo stesso
  schema); il «Fatto quando» non cambia; un comando che scrive in DryRun
  tiene il turno · il coder ha trovato che il frame di `prepare` vive nello
  stato condiviso fino a `finish` ed è il turno a isolarlo: senza turno gli
  eventi di una scrittura parallela restavano chiusi nel batch della
  lettura, e due letture MCP insieme si rifiutavano a vicenda. Il «Non
  toccare `fub-kernel`» del piano partiva da un'ipotesi sbagliata.

- 2026-11-08 · fub-pre-alpha (orchestratore) · la prima coppia è PA T3 e
  PA T4, non T3 e T13 come dice l'ondata; PA T13 parte quando #295 è in
  `main` · T13 chiede di aprire fogli e documenti come la shell, con
  `open_key` e `document_closed` dei motori, che arrivano con #295: fatto
  prima, il corpus coprirebbe metà del percorso e andrebbe rifatto. T4
  invece non aspetta niente, sta in un altro strato (il client) e sblocca
  T5 e T30.

- 2026-11-07 · fub-pre-alpha · il piano è approvato, coi 130 stati
  composti e nuovi del simulatore; resta da confermare solo la licenza del
  logo, prima di PA T49 · l'utente: «Per il resto il piano è approvato»
- 2026-11-07 · fub-pre-alpha · lavorano due coder alla volta, Opus con
  ragionamento medio, e nessun altro agente; il pianificatore del telefono
  (D1 B) lo avvia l'utente · l'utente: «il prompt per l'orchestratore che
  si occuperà di avviare 2 sub-agent per volta, Opus con effort medio che
  saranno i coder»
- 2026-11-07 · fub-pre-alpha (pianificatore) · i task PA si integrano sul
  ramo del piano ed entrano in `main` con rami di consegna
  `pre-alpha/consegna-<n>` (i commit di codice portati da `origin/main`
  con `cherry-pick -x`, la PR pronta con la CI completa, l'OK dell'utente);
  il ramo del piano non si unisce · porta `PLAN-ui/` (13 MB), e la Fase B
  ha bisogno di T48 e della skin facile già in `main`; regole in «Come si
  implementa», «Il ramo, le consegne e i due coder»
- 2026-11-07 · fub-pre-alpha (D20) · la firma di Apple per ora non si fa:
  PA T50 firma solo Windows (SignPath Foundation, o un certificato OV), il
  dmg esce con la firma ad hoc e senza notarizzazione, e «Prova la
  pre-alpha» spiega «Apri comunque» · l'utente: «Quello di Apple per ora ce
  ne freghiamo assolutamente»
- 2026-11-07 · fub-pre-alpha (D28) · Marcuzzo è un disegno dell'utente,
  ritoccato con l'AI in ArtCraft e poi passato in VectorCraft; prima di PA
  T49 l'orchestratore chiede la licenza (consiglio: CC BY-SA 4.0 con la
  nota per i fork) e il modello usato in ArtCraft, e ne legge le
  condizioni · l'utente: «Ho fatto il logo di Marcuzzo. Con l'intelligenza
  artificiale l'ho ritoccato dopo con Artcraft. Vectorcraft.»
- 2026-11-07 · fub-pre-alpha (il logo) · le forme piccole di Marcuzzo
  (minima 24, minima 16 e la simbolica che ne viene) tolgono solo i
  dettagli minuti e non ingrandiscono niente: l'occhio, la pupilla,
  l'occhiolino e il becco restano quelli del disegno · l'utente: «non mi
  piace l'icona con l'occhio strizzato ingrandito»; la prima minima aveva
  l'occhiolino più spesso e la pupilla più grande per leggersi a 16 px
- 2026-11-07 · fub-pre-alpha (il logo) · Marcuzzo, il gufo nella cartella
  dell'utente, è il logo (D26); il gufo ha colori fissi, la cartella e i
  fogli seguono la tinta, il tema e il contrasto con `logoColors()` della
  ricetta, e la cartella e il retro reggono la soglia dei controlli (3, o
  4,5 col contrasto alto) contro `--bg` e `--bg-elev` · l'utente: «la
  cartella dovrà avere il colore del tema scelto […] in modo tale che non si
  vada a sovrapporre il colore attuale con quello di sfondo»; i fondi sono
  quelli dove sta il logo (la barra e l'avvio su `--bg`, le Informazioni su
  `--bg-elev`), e le 42 varianti misurate reggono tutte
  (`logo/misure.json`).
- 2026-11-07 · fub-pre-alpha (il logo) · un tema installato che non
  dichiara `--logo-*` li riceve dalla serie al montaggio (un campo
  facoltativo nuovo di `ThemeSeries`, chiamato da `theme.ts` prima di
  `mountThemeBundle`), non dal caricatore dei temi né da un file del tema ·
  il bundle è già per luce e il contrasto si legge lì; il caricatore non
  conosce la ricetta, e chiedere i colori del logo a chi scrive un tema
  sarebbe un obbligo nuovo nel contratto. I gettoni restano facoltativi.
- 2026-11-07 · fub-pre-alpha (il logo) · l'icona del sistema è Smeraldo
  (scelta del pianificatore, l'utente la può cambiare); Menta è la scala di
  notte della ricetta, Kraft resta fra gli originali · Smeraldo è il verde di
  serie (160) e regge sia su una barra delle applicazioni chiara sia su una
  scura; Menta su una barra chiara si perde.
- 2026-11-07 · fub-pre-alpha (il logo) · la forma simbolica si fa dalla
  forma a 24 px con un filo vuoto di 45 unità dentro la cartella davanti,
  tagliato nell'ordine del disegno (`logo-simbolico.mjs`, valori di
  partenza) · un filo fuori dalla cartella o tagliato dopo tutto il disegno
  mangiava la faccia e l'ala; un filo limitato a una distanza lasciava gli
  angoli seghettati. La cartella davanti si stringe un poco ai lati e sotto,
  e a 16–24 px non si vede.
- 2026-11-07 · fub-pre-alpha (il logo) · D28 resta aperta e PA T49 aspetta
  lei; il consiglio è CC BY-SA 4.0 per i file del logo, con una nota che
  chiede ai fork di cambiare nome e logo · la risposta «A, AI» di prima
  riguardava il primo logo; per Marcuzzo servono lo strumento (le sue
  condizioni d'uso) e la licenza, che sono dell'utente.

- 2026-11-07 · fub-pre-alpha (D19) · i difetti veri del controllo di tutte
  le viste vanno in due task nuovi, PA T56 (la carta del file e il fuoco) e
  PA T57 (i bersagli e i nomi interi), più due punti in PA T47 (le righe
  che si toccano, il tondo della modalità); il simulatore li mostra già
  corretti (`92-prealpha-viste.css`) · un difetto che il coder copia dal
  simulatore torna nel prodotto: si corregge prima, e la guardia di PA T55
  lo tiene lontano.
- 2026-11-07 · fub-pre-alpha (D19) · la carta del file al buio prende
  l'anello, la sintassi e i segni della griglia dai `--paper-*` che ci sono,
  senza ruoli nuovi nel contratto del tema; la formula nella cella in
  modifica è d'inchiostro, come in Excel, e solo i riferimenti hanno colore ·
  un ruolo nuovo è un contratto pubblico (temi di terzi), e la carta ne ha
  già abbastanza; l'utente può chiedere la formula colorata, ma allora
  servono colori pensati per il bianco.
- 2026-11-07 · fub-pre-alpha (D19) · la freccia di un pulsante diviso
  della barra a schede è larga 24 px (prima 14): la fila si allunga di 10 px
  per pulsante diviso, e a piena larghezza ci sta ancora · WCAG 2.5.8 vuole
  24 px o la distanza dai vicini, e la freccia è attaccata al pulsante; è
  il cambio che si vede di più (27 stati dei fogli), quindi l'utente lo
  guarda nel simulatore.
- 2026-11-07 · fub-pre-alpha (D19) · i riscontri della sonda al telefono,
  tranne ciò che deforma la regola dei 44 px, vanno al piano del telefono
  (`prompt-piano-telefono.md`); quelli dentro le pagine dei piani (gli
  strati) vanno ai piani che le possiedono · il telefono si ridisegna (D1
  B) e una correzione di adesso sarebbe buttata; una pagina di un altro
  piano si cambia nel suo piano.

- 2026-11-07 · fub-pre-alpha (il verde) · la tinta di serie è 160
  «Smeraldo», non 159 come ha detto l'utente guardando il logo · le tinte
  della «f» del logo vanno da 157,6 a 164 e il suo foglio scuro è 160,6; i
  campioni dell'accento vanno a passi di 5°, e fra 159 e 160 l'occhio non
  vede differenza. Prima di PA T48 si chiede il sì su 160 col logo
  definitivo. (Superata lo stesso giorno: la cartella di Marcuzzo sta a
  160,1 in Smeraldo e in Menta, quindi il logo conferma 160 e PA T48 non
  aspetta altro.)
- 2026-11-07 · fub-pre-alpha (il verde) · il vassoio delle barre di S2 T16
  segue la tinta da solo (col verde #f8faf8 di giorno, #18211c di notte):
  né PA T11 né PA T48 toccano la ricetta per il vassoio · è la formula di
  S2 (`paper` = tinta − 10 di giorno, − 3 di notte); i valori a metà strada
  scritti prima erano sbagliati.
- 2026-11-07 · fub-pre-alpha (il verde) · le catture si rifanno verdi con
  due toppe sopra quelle del finto (`verde.patch`, `verde-avvio.patch`), le
  pagine dei piani con la mappa dei colori (`verde-mappa.json`); la lavagna
  (`s2/lavagna*`) resta una foto blu col DOM verde, unica eccezione ai pixel
  · il simulatore resta il client che PA T48 scriverà, e si rifà da
  un'altra macchina; la lavagna non ha una definizione per rifarla.
- 2026-11-07 · fub-pre-alpha (il logo) · il logo resta quello provvisorio
  (il nastro «f» con la pagina davanti) finché l'utente porta i file; PA T49
  aspetta i file e D28 · l'utente: «intanto lascia il logo che avevi fatto
  prima, poi ci penso io al logo, te pensa a finire il progetto».
  (Superata lo stesso giorno: l'utente ha portato Marcuzzo, D26.)
- 2026-11-07 · fub-pre-alpha (le scelte) · i consigli delle domande si
  pesano solo sulla qualità del risultato (aperto, personalizzabile, senza
  problemi), e il tempo non conta. Cambiano sei consigli (D1 B, D6 C, D8 B,
  D9 B, D11 B, D17 C), e arrivano D19–D24 dalle voci di «Fuori scope» che
  urtano col criterio (il controllo di tutte le viste, la firma, #237
  R05–R08 e A03, #242, le parti della finestra, K6). D23 e D24 consigliano
  comunque di aspettare, per una ragione di qualità. Le risposte e i 118
  stati, in 14 gruppi, si danno nella pagina «Le scelte di Fub pre-alpha»
  (https://claude.ai/artifact/Q5Lydynyn4DV8xwFDLZt18, `scelte.html`). Le
  risposte stanno nel db dell'artifact (`risposte/<D>`, `stati/<gruppo>`):
  solo il proprietario scrive, e il pianificatore le legge con
  ArtifactData. · L'utente l'ha chiesto il 2026-11-07: «voglio la qualità
  massima… open, personalizzabile… che funzioni da Dio».
- 2026-11-07 · fub-pre-alpha (simulatore v2) · il simulatore mostra il
  telefono corretto da PA T47 (`92-prealpha-telefono.css`): l'interruttore
  resta il binario di 32 × 18 della pelle, con un tocco di 44 px dato da un
  `::after` trasparente, e le schede delle impostazioni scorrono intere. Il
  confronto dei pixel toglie interruttori e schede e misura le righe che si
  accorciano · il cerchio di 44 px e i nomi in «…» sono un difetto di
  `shells/mobile/mobile.css` (differenza 47), non una forma da approvare;
  l'aspetto dell'interruttore è già approvato con Scrittoio 2. Un
  interruttore più grande solo sul telefono sarebbe stato una forma nuova
  da approvare, e non serve: il tocco di 44 px non deve per forza vedersi.
- 2026-11-07 · fub-pre-alpha (simulatore v2) · la scheda di un componente
  fermato porta `data-state="stopped"` nelle toppe, e il rosso del
  pericolo vale solo per la sua riga dello stato (`.setting-source[role=
  "status"]`) · la riscrittura delle toppe dal codice l'aveva perso, e la
  riga «Fermato…» usciva grigia come le altre; «Rimuovi» e le altre righe
  della scheda restano col loro colore.

- 2026-11-07 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel lo
  spazio che il DOM nuovo prende si misura: il simulatore si riprova scorso
  di quanto il DOM nuovo spinge giù il resto, e un quadretto di 16 px che
  differisce conta come spiegato solo se si ritrova uguale nella foto del
  client spostato (in verticale o di lato, al massimo l'altezza del DOM
  nuovo più 64 px, mai oltre 480). Si tolgono anche gli elementi a cui una
  toppa cambia testo, attributi o classi · prima «spazio che il DOM nuovo
  prende» era una frase senza misura, e 37 righe restavano sopra la soglia
  con quella sola spiegazione; il quadretto deve ritrovarsi uguale, quindi
  un colore, un carattere o un CSS sbagliato resta una differenza.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le toppe dei componenti
  (S204–S208) copiano `renderInstalledComponent` e la richiesta del
  consenso com'è oggi («Abilitato», «Consenso all'esecuzione», «Rimuovi»,
  «Concedere i permessi»); le righe nuove (lo stato «Fermato…», «Riavvia»,
  «Copia il motivo») hanno il loro commento · il codice vince sul piano
  finché l'utente non risponde a D18; il primo giro aveva inventato
  «Disinstalla» e un dialogo «Installare …?» che il codice non ha. D18
  consiglia A perché la regola del 2026-10-30 («Accendi, Spegni… Togli»)
  e il commento di `i18n/lexicon.ts` dicono «dappertutto».
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nei livelli senza script
  (le pagine dei piani dentro la cornice) ogni `canvas` è sostituito da
  un'`img` con le sue misure · in un documento senza script il canvas non
  ha misura propria, e la pagina del PDF della lavagna usciva bianca.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel
  una differenza sopra lo 0,5 % è spiegata solo se togliendo la sua zona
  (il bottone della modalità spostato di S2 T3, l'anello del fuoco) il resto
  scende sotto la soglia; `script/foto-sim.mjs` scrive nella riga quanto
  resta. Il tema d'esempio e l'ispettore compatto di S2 T9 sono spiegati
  per stato, senza zona · una spiegazione che non si misura copre anche gli
  errori veri; così ogni riga dice se basta.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · con la finestra compatta il
  simulatore mostra l'ispettore di S2 T9 (264 → 216 px in cinque passi,
  `measures.ts`), non quello della foto: nella foto i blocchi, montati dopo
  le preferenze, lo tengono a 264 · nell'app `structure.css` viene prima
  delle preferenze e il passo compatto vince; il simulatore deve far vedere
  il prodotto dopo T9, non l'ordine dei fogli del banco.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nelle pagine dei piani i
  caratteri di Google (Hanken Grotesk, Newsreader, IBM Plex Mono) si
  prendono dai file `@fontsource` del client · il simulatore gira senza rete
  (dentro l'artifact e da `file://`), e senza quei caratteri lo strato si
  disegnava con quelli di riserva e andava a capo altrove.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `cattura.mjs` aspetta che
  menu, dialoghi e finestrelle di CodeMirror restino fermi due fotogrammi
  prima della foto; le tre catture del menu «/» sono rifatte così · la foto
  vecchia era presa mentre il menu si sistemava, e non coincideva col DOM
  copiato subito dopo.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · la pagina dell'artifact
  (`script/costruisci-hub.mjs`) non tiene più numeri scritti a mano: stati,
  scenari e quanti aspettano un sì vengono da `sim-stati.js`; la fase di
  ogni task dalle tabelle di «L'ordine» (con «aspetta Dn» quando la riga lo
  dice); una domanda è decisa quando il suo corpo comincia con «**Decisa
  dall'utente…**», e allora la tabella riassuntiva mostra la decisione al
  posto del consiglio · nel primo giro le fasi e i conti erano copiati
  nello script, e al secondo giro erano già sbagliati (T1–T24 contro
  T1–T45, D5 data per decisa).
- 2026-11-06 · fub-pre-alpha (simulatore v2) · gli script del ramo trovano
  Playwright, pngjs, pixelmatch, happy-dom e i caratteri in `FUB_CLIENT`
  (`script/client.mjs`), di serie `apps/client` del repository che li
  contiene; nessun percorso della macchina resta negli script del ramo
  (`script/ricattura-tutto.sh` prende i due client come argomenti) · uno
  script che punta a `~/.cache/…` non gira su un'altra macchina, e la
  richiesta del secondo giro vuole il simulatore rifacibile dal repository.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · D12 B è fatta come la
  pagina Aspetto dell'app: densità, contrasto e accento si scelgono in S234
  e restano negli altri stati finché «Aspetto di serie» non li toglie; non
  c'è una riga apposta sopra lo schermo · è il gesto del prodotto, e una
  seconda via nel simulatore sarebbe un comando che l'app non ha.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · tutte le catture si sono
  rifatte in un colpo (`script/ricattura.mjs`, 632 foto del client più 248
  delle pagine dei piani), e le vecchie stanno in `prove/catture-vecchie/`
  sulla macchina; restano le sole `s2/lavagna*`, senza definizione · metà
  delle foto vecchie aveva il CSS di prima dei blocchi o un cassetto aperto
  per sbaglio, e il confronto dei pixel non diceva più niente. Una foto
  vecchia superata da una cartella più in alto (`aspetto`, `toast`, le note
  in Blocchi, Sorgente e Lettura, «Comandi» del foglio) non si rifà: non la
  usa nessuno.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le pagine dei piani si
  fotografano con gli argomenti di Chromium del banco anche quando la foto
  vecchia era diversa: le schede della lavagna (`p-lav-*`) vanno a capo in
  un altro punto (2–3 % dei pixel) perché le foto vecchie avevano il
  «hinting» dei caratteri acceso · la pagina è la stessa byte per byte, e
  la foto nuova si rifà uguale (0 pixel diversi) con lo script del ramo.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `piani/ricette.html` si
  fotografa dalla copia avvolta del simulatore (con `<!doctype html>`), non
  dal file grezzo · grezzo il browser lo apre in «quirks mode» e le misure
  cambiano; nel simulatore e nell'artifact la pagina è sempre avvolta.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i due temi d'esempio
  (`blocchi/93-tema-*`) non entrano nelle catture (`cattura.mjs` li salta) e
  il simulatore li monta solo sugli stati che li vestono · non sono CSS del
  prodotto; montati sempre, avrebbero vestito ogni foto.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · «il DOM» nel piano vuol dire
  una cosa sola per provenienza: per una cattura il DOM del client di oggi
  (uguale o cambiato da un task di Scrittoio 2), per una composta quello
  della pagina del piano, per una nuova quello di `toppe/*.html` · la
  richiesta del secondo giro diceva che la frase «si copia il DOM» non
  diceva quale.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il file nuovo col tipo
  diventa tre task: PA T43 (il menu «Nuovo» chiede il tipo, S34), PA T44
  (il documento e il foglio vuoti, in `fub-host`) e PA T45 (la misura con
  5.000 file, S253) · un task che tocca client, host e banco non sta nella
  misura di un coder medio; il menu mostra solo i tipi che hanno un comando
  dichiarato, così T43 non aspetta T44.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `t-foglio-errore` diventa uno
  stato suo (S286, «Telefono: l'errore di un comando») e non è più il
  telefono di «Foglio: una formula sbagliata» · la cattura è l'errore di un
  comando della griglia, non un #DIV/0! in una cella: mostrarla come la
  stessa cosa al telefono era sbagliato.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel menu «Nuovo» la voce
  «Cartella» non ha scorciatoia · Ctrl+Shift+N l'avevo scritta io, e il
  client non la ha: una scorciatoia inventata nel prototipo finirebbe nel
  codice.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · ogni stato ha una
  provenienza (cattura, composta, nuova) e un numero S che non cambia più
  (`script/numeri-sim.json` cresce soltanto); da approvare sono le composte
  e le nuove, 118 su 286 · l'utente approva per numero («approvo tutto
  tranne S23»), e un numero che cambiasse farebbe approvare la cosa
  sbagliata.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il CSS nuovo ha una fonte
  sola. Per Scrittoio 2 vince il prototipo approvato del suo piano
  (`PLAN-ui/scrittoio-2.html` di `piano/scrittoio-2`), e
  `script/prova-css-fonte.mjs` controlla che i 18 blocchi del simulatore
  che vengono da lì coincidano con i suoi, tolte le varianti «com'era», i
  commenti e gli spazi. Per i pezzi di questo giro la fonte è il blocco del
  simulatore (`blocchi/92-*` e `93-*`), con destinazione e task. La
  cattura monta i blocchi per la foto ma non li copia (`cattura.mjs`), e il
  simulatore li rimonta sopra ogni cattura · due copie dello stesso CSS
  prima o poi divergono, e il coder copierebbe quella vecchia.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le catture (560 MB) restano
  fuori dal repository; nel repository la fonte delle catture sono i dati
  già impacchettati (`sim-dati-*.js`), e `DATI=<cartella> node
  script/costruisci-sim.mjs <uscita>` rifà la pagina uguale byte per byte ·
  così blocchi, toppe, scenari e vista si cambiano dal repository senza il
  server, e la prova dice se la ricostruzione è fedele.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · una cattura presa prima di
  un cambio dei blocchi si rifà (`script/ricattura.mjs`, coi blocchi e coi
  mod di oggi) · il simulatore monta i blocchi di oggi: una foto col CSS di
  allora non confronta più niente.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le foto del confronto, anche
  quelle delle pagine dei piani (`script/cattura-piani.mjs`), usano gli
  argomenti di Chromium del banco (`bench/stage.mjs`) · senza, il testo si
  disegna diverso e ogni parola conta come differenza.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel si
  nasconde la riga dei dati della nota (il mod `datiNota` la mette nel DOM
  da copiare, la foto del client non ce l'ha), si coprono le toppe e i
  pezzi composti, e gli strati si confrontano solo a tutta larghezza · la
  pagina approvata è fotografata alla sua misura; a 700 px e al telefono lo
  strato è la stessa pagina che si adatta, e la differenza è attesa.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i gesti del telefono sono
  provvisori come il telaio A (D1): una strisciata orizzontale di almeno
  60 px apre e chiude i cassetti, dal bordo (24 px) torna indietro, la
  pressione lunga (500 ms) apre il menu del tocco; vale anche sul testo, e
  il documento ha `touch-action: pan-y pinch-zoom` · senza `pan-y` il
  browser prende la strisciata per sé (`pointercancel`); il guscio mobile
  vero li decide nel piano del telefono.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i tempi del simulatore
  (`setTimeout`) stanno sulla finestra del simulatore, non nello schermo ·
  lo schermo è un iframe senza `allow-scripts`, e lì un timer non scatta mai.
  Solo simulatore.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · Indietro salta lo stato di
  adesso nella storia e, senza storia, torna alla «casa» dello stato (il
  foglio per un dialogo del foglio) · Indietro deve portare sempre altrove.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il clic sul velo di un
  dialogo del kit annulla (`kit/dialog.ts`); il velo delle impostazioni le
  chiude come × (`preferences/scrim.ts`); l'icona del binario del pannello
  già davanti chiude e riapre la colonna (`panels/rail.ts`, `railClick`);
  l'indice delle impostazioni scorre, dà il fuoco al titolo e segna la voce
  con `aria-current` (`jumpTo` di `panels/settings.ts`) · il simulatore fa
  ciò che fa il prodotto, anche dove la foto non c'è.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · la colonna della lavagna
  (toppa `lav-colonna`) scrive `data-tool` e `data-tools` come
  `kit/tool-rail.ts:126` e `:244` · è lo stesso kit del disegno, e il coder
  copia il DOM che il kit produce davvero.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `prova-sim.mjs` conta come
  «coperto» solo un controllo sotto qualcosa che non è un controllo; non
  conta chi è tagliato da un antenato che scorre o ritaglia, né chi sta
  sotto un velo, uno strato, un pannello o un menu aperto, o sotto la
  striscia del bordo del cassetto (`frame/peek.ts`); dopo ogni montaggio
  aspetta le animazioni finite (al più 1,5 s) · senza, l'elenco dei
  controlli cambia fra il movimento calmo e il ridotto, e i falsi allarmi
  nascondono quelli veri.
- 2026-11-05 · fub-pre-alpha (skin facile) · la richiesta del manutentore
  («se non è facile creare una skin non andiamo da nessuna parte») entra nel
  piano come PA T34–T42 e «Fatto quando» 9, con tre domande (D15 il nome del
  campo, D16 le icone, D17 l'aspetto dei due temi) · è una scelta di
  prodotto già presa dal manutentore; il pianificatore ha deciso solo il
  come, qui sotto.
- 2026-11-05 · fub-pre-alpha (skin facile) · l'ordine: la pelle che eredita
  e i caratteri in Fase A (T34, T35, T39, T40); gli strumenti dell'autore in
  Fase B dopo le Impostazioni di S2 (T36–T38); gli hook congelati per
  ultimi, dopo tutta la Fase C (T41); i temi d'esempio dopo il congelamento
  (T42) · si congela solo ciò che la pre-alpha mostra, quando non cambia
  più; i temi d'esempio provano lo snapshot, non un contratto che si muove.
- 2026-11-05 · fub-pre-alpha (skin facile) · i canali del loader diventano
  `caratteri`, `caratteri-tema`, `foglio`, `pelle`, `pelle-tema`,
  `preferenze`, `snippets`; senza `extends` tutto resta come oggi, byte per
  byte · un canale separato, e non una fusione dei testi, tiene le
  preferenze dell'utente sopra ogni pelle e lascia smontare il tema senza
  toccare la serie.
- 2026-11-05 · fub-pre-alpha (skin facile) · `extends` accetta solo
  `fub.serie`; ereditare da un altro tema è fuori · una catena di temi
  vorrebbe un ordine, i cicli e le versioni; nessun caso lo chiede adesso.
- 2026-11-05 · fub-pre-alpha (skin facile) · una «Modalità sviluppatore»
  (`developer.mode`, gruppo «Sviluppo», livello macchina, spenta) apre
  installare e collegare da cartella; la regola sta nell'host, non solo nel
  bottone; un tema collegato alla volta, con fiducia «In sviluppo» · è la
  stessa idea dei temi in sviluppo che `TRUST_LABELS` sa già dire, e un
  programma non può accenderla da sé.
- 2026-11-05 · fub-pre-alpha (skin facile) · i caratteri del tema: le regole
  `@font-face` le scrive il loader dai campi del manifest (woff2 fra gli
  asset, firma `wOF2`, 8 file, 2 MiB l'uno, 6 MiB in tutto); `@font-face`
  resta vietato nel CSS · un `src:` scritto a mano potrebbe chiamare la
  rete; la CSP non cambia (ha già `font-src data:`).
- 2026-11-05 · fub-pre-alpha (skin facile) · le icone del tema (se D16 è A o
  C) passano `PATH_DATA` come il registro di oggi; un nome che nessuno
  disegna è un avviso nella diagnosi, non un rifiuto · i moduli registrano
  le loro icone quando si caricano, quindi al montaggio del tema non tutti i
  nomi ci sono ancora.
- 2026-11-05 · fub-pre-alpha (skin facile) · al ricaricamento di un tema
  collegato, un fascio rifiutato lascia montato l'ultimo buono (non la
  serie) e mostra la diagnosi con l'ora · chi scrive il tema salva spesso
  file a metà; cadere sulla serie a ogni errore farebbe lampeggiare l'app.
- 2026-11-05 · fub-pre-alpha (skin facile) · il codice vince sulla
  richiesta: `contract.json` è cambiato in 12 commit (non 11); `install_theme`
  c'è già nell'host senza IPC; la fiducia `development` c'è già · scritto in
  «Differenze fra piani e codice», 28–36.
- 2026-11-05 · fub-pre-alpha (secondo giro) · un coder alla volta, più al
  massimo un pianificatore, anche in questo file (prima diceva «al massimo
  tre») · è la regola dell'utente dal 2026-11-04; le «ondate» del piano sono
  file, una dopo l'altra. Stima scritta in «L'ordine»: 7–9 settimane.
- 2026-11-05 · fub-pre-alpha (secondo giro) · task nuovi decisi dal
  pianificatore: PA T25 (il controllo degli aggiornamenti vede le
  pre-release: `/releases/latest` non le dà), T26–T30 (T14 diviso in sei
  task, 27 compiti), T31 (l'APK di debug x86_64 parte in un emulatore della
  CI, senza action di terzi), T32 (`![[x.pdf#page=3]]`) · ognuno chiude un
  buco fra «Fatto quando» e il codice; le ragioni sono nelle loro sezioni.
- 2026-11-05 · fub-pre-alpha (secondo giro) · PA T4: R01 si prova con un
  test sui tre chiamanti di `release()` prima di correggere, e si chiude se
  non si riproduce; niente `demo.unsaved` · `release()` ritorna già
  `CloseResult` e `dismissIfUnwatched` tiene il testo non salvato.
- 2026-11-05 · fub-pre-alpha (secondo giro) · l'MSI usa
  `bundle.windows.wix.version = 0.2.0.N` (N di `prealpha.N`), con la
  guardia; se l'aggiornamento su Windows lascia due voci, le note dicono di
  disinstallare prima (PA T22, T23) · il `MajorUpgrade` di Tauri sostituisce
  la voce di prima, ma va visto su Windows.
- 2026-11-05 · fub-pre-alpha (secondo giro) · la proposta MCP «vista e
  accettata in Fub» esce dalla pre-alpha e va in A1 F5 («L'assistente
  dentro Fub»); PA T23 prova i flussi MCP che ci sono (`fub_write` con la
  base, `fub_canvas_apply` in prova e davvero, la ricetta proposta) ·
  nessun task la costruiva.
- 2026-11-05 · fub-pre-alpha (secondo giro) · due domande nuove per
  l'utente: D13 (la prova di K2 prima del merge di #290, come dice K2 D-2;
  consiglio A) e D14 (il nome «FubDraw» nelle frasi che le persone leggono;
  consiglio A). PA T33 aspetta D14 · cambiano ciò che si vede o una regola
  che l'utente aveva scritto.
- 2026-11-05 · fub-pre-alpha (secondo giro) · scelte dell'utente: D3 = A
  (disegnare ora N6 T26–T28 nel simulatore), D4 = A (le pagine dei piani
  composte nella cornice di Scrittoio 2, con le barre nel kit), D5 composte
  tutte e due, D12 = B (densità, contrasto e accento cambiano davvero il
  simulatore).
- 2026-11-05 · fub-pre-alpha (pianificatore) · definizione confermata
  dall'utente: gli otto punti di «Fatto quando» del piano; dentro tutti i
  piani aperti tranne K6; computer più un APK Android di prova segnato
  «sperimentale»; pre-release pubblica `v0.2.0-prealpha.1`, con #289 · scelte
  dell'utente, date con le domande della pianificazione.
- 2026-11-05 · fub-pre-alpha · «il blocco di scrittura in sola lettura» entra
  come PA T3: i comandi in sola lettura non prendono `write_turn()` in
  `FubSession::invoke_command` · nella pre-alpha l'AI legge (MCP,
  `canvas.read`) mentre la persona scrive; l'issue che N7 (2026-11-04)
  prometteva non è mai stata aperta, e il task la sostituisce.
- 2026-11-05 · fub-pre-alpha · N6 «v1 senza T79» vuol dire senza T79–T85 e
  T88 · T80–T84 dipendono da T79 e da PdfCraft P1, P2 e P4, T85 da T82, T88
  da D-20 (il piano dei CSV, che non c'è): sono le dipendenze scritte nel
  piano di N6.
- 2026-11-05 · fub-pre-alpha · `fub:abi@0.2.0` si congela nella fase A (PA
  T6, T7), non alla fine · nessun piano dentro tocca `wit/fub/abi.wit`
  (verificato su tutti i rami): la guardia stretta protegge da subito il
  lavoro delle fasi B e C.
- 2026-11-05 · fub-pre-alpha · il corpus senza perdite (PA T13) entra nella
  fase A e si allarga quando K5 e N4 entrano · ogni piano unito dopo lo deve
  tenere verde, e un difetto si trova presto.
- 2026-11-05 · fub-pre-alpha · Scrittoio 2 T23 contro N6 sulla lavagna: vince
  N6, e S2 T23 aggiunge solo l'icona · N6 ha il prototipo approvato
  `lavagna-schede` (T25, 2026-11-04). S2 T22 contro K5 (la testa del
  disegno) resta una domanda (D5), perché cambia ciò che si vede.
- 2026-11-05 · fub-pre-alpha · il simulatore scrive il corpo del testo a 18,
  il valore di S2 T11, anche dove il prototipo approvato di S2 mostra il 17
  del finto del banco · il simulatore mostra il prodotto dopo S2; è la sola
  differenza col prototipo approvato (stato `impostazioni`).
- 2026-11-05 · fub-pre-alpha · i sedici test instabili aperti entrano come tre
  task (PA T19–T21): 200 corse o la causa; la quarantena la decide l'utente ·
  la pre-alpha chiede la CI completa verde sul commit del tag.

- 2026-11-05 · k3-motori · T17, la scena `window-document` aspetta di nuovo
  che lo strato d'avvio se ne sia andato dopo aver ricaricato la pagina, come
  fa `prepareScene` · perché: la corsa 42045342312 l'ha fotografata col
  marchio fermo (93% di pixel diversi, nelle due luci). È una gara del banco
  arrivata con il piano del caricamento (#308), uguale su `main`: la scena
  ricarica la pagina dopo l'attesa comune, e quell'attesa non la copriva più.
  Correzione piccola del banco, la baseline non cambia; in prova locale 0 su
  24 foto con lo strato.
- 2026-11-05 · k3-motori · T17, il finto host del banco dichiara
  `chrome.sidebar.visible` e `chrome.inspector.visible` quando la scena apre
  una cartella di Excel (`workbook=1`), come l'host vero (`fub-host`) · perché:
  le scene della barra dei fogli chiudono i due pannelli e senza la
  dichiarazione la scrittura falliva, così le foto del runner tenevano
  l'avviso «Non ho potuto ricordare come hai lasciato i pannelli» e il 2 sulla
  campanella. Correzione piccola del banco, nessun cambio di ciò che l'utente
  vede nel prodotto; le scene delle Impostazioni non cambiano (d90a09d0).
- 2026-11-05 · k3-motori · T19, risposta dell'utente alla scelta aperta qui
  sotto: D, la griglia non cambia altezza durante la tenda, senza salti né
  bande scure. Fatto così: per la durata della corsa la griglia e chi le sta
  sotto tengono l'altezza che avevano prima del gesto, con un margine
  negativo in fondo che li fa passare sotto la barra dei fogli; a corsa
  finita (e allo smontaggio) il margine se ne va e la griglia è alta quanto
  la parte che si vede · perché: la D alla lettera, la griglia sempre alta
  come a nastro chiuso, nasconderebbe sotto la barra dei fogli la barra di
  scorrimento orizzontale e le ultime righe, e il motore usa `clientHeight`
  in più di dieci posti. Così si vede la D durante la corsa e a riposo non si
  nasconde niente. Il margine è uno stile fermo, non animato: la regola 3 del
  banco resta verde. Un'inversione a metà corsa riparte dalle altezze di
  prima del primo gesto.
- 2026-11-05 · k3-motori · T19, ciò che cambia forma o se ne va mentre era
  ancora in corsa (un foglietto che si richiude a metà apertura, i foglietti
  di una sezione lasciata a metà entrata, la scheda della tabella che
  scompare mentre compariva) lascia un'immagine (`moto/prepareExit`) che
  svanisce da dove si vedeva; chi tiene la forma prosegue dalla sua posa ·
  perché: con solo `transform` e `opacity` un riquadro che cambia misura non
  può proseguire, e la regola 4 del banco vuole che niente salti. Il banco
  dice ora com'era e com'è il riquadro che salta (`was`, `is`). Provato e
  tolto: misurare soltanto la parte visibile dei riquadri, che faceva saltare
  concentration e rich-reading senza aiutare il ritiro. Aperto: nel ritiro a
  metà riapertura la griglia cambia altezza (92 px) e il suo bordo di sotto
  non può proseguire; la scelta è dell'utente.
- 2026-11-04 · k3-motori · T18, al telefono i bottoni della barra dei fogli
  restano a 44 px, la regola della shell mobile, e non 38/88 come nel
  prototipo; la risposta dell'utente: «i tasti ok a 44px» · perché: la
  misura del tocco vale per tutta la shell mobile, e un'eccezione solo per
  la barra la romperebbe.
- K3 T15, le differenze accettate: in sola lettura un esito con modifiche si
  scarta e il provider riparte dal giornale confermato
  (`#openWorkbook(#confirmedJournal)`), invece di applicarlo;
  `setCommandEffects` e `servesCommands` nel motore, perché sia lui a sapere
  quali comandi passano in sola lettura; `READ_ONLY_DIALOGS` lascia aprire
  in sola lettura le finestre scritte a mano che non cambiano niente (find,
  goTo, goToSpecial, printPreview, nameManager); un comando `legge` con un
  parametro obbligatorio apre prima il modulo. Nella finestra del risultato
  i valori lunghi vanno a capo (`overflow-wrap: anywhere`), i numeri restano
  a precisione piena (il prototipo arrotondava a due decimali, che per un
  risultato da copiare perde dati), e `.grid-dialog-error` usa il colore del
  testo perché il rosso scuro del prototipo stava a 4.01:1. Le foto strette
  del banco sono a 1016 px (foglio 700 px), perché sotto 800 px parte la
  shell del telefono. Restano note per T17: in sola lettura «trova e
  sostituisci» rifiuta le sostituzioni dal motore, le voci di menu che
  cambiano non fanno niente, «1 celle» viene dal prototipo.
- K3 T14 (e3b8afc0): il menu «Comandi» è `editors/grid/menu-comandi.ts`
  (`openCommandMenu`) agganciato alla fila `quick` della barra; i comandi
  che la barra non ha passano da una seconda istanza della tavolozza
  (`mountGridPalette` dentro `ribbon/ribbon.ts`, vive quanto la barra).
  `ui/menu.ts` ha tre opzioni nuove (`label`, `fullSearch`,
  `reachDisabled`); la ricerca piena tiene l'altezza del posto e scorre.
  Scarti dal prototipo: il tooltip del gettone è «Comandi» e «Tutti i
  comandi del foglio» è l'aria-label del menu; l'icona è `outline` perché
  `ribbon/icons.ts` era fuori dai Tocca (da rivedere in T17 col prototipo);
  la scena `grid-commands-search` usa una ricerca senza risultati perché con
  testo lo Spazio scrive nella ricerca e la regola tastiera dell'a11y la
  boccerebbe; nessuna scena sotto 560 px (scene.test vuole finestre ≥ 800
  px; il gettone senza nome lo mostra `mobile-grid-ribbon`). Restano: il
  piede del menu non resta fisso in fondo nelle ricerche lunghe; le baseline
  delle scene nuove e di `mobile-grid-ribbon` dal runner (T17).
- K3 T13, dopo la CI di 8493f177: effetto.rs cadeva sul runner perché
  review.spelling chiede l'elenco di parole del sistema
  (/usr/share/dict/words), che il runner non ha, e GridCraft rifiuta il
  controllo prima di toccare la cartella. L'orchestratore accetta quel solo
  rifiuto, per i comandi review.*, come «non provato» (lo stampa); con
  l'elenco il comando gira e la prova vale. Provato in locale nei due modi
  (con l'elenco, e con l'elenco coperto in uno spazio dei nomi).
- K3 T13 integrata (4f244e0d). Gli effetti sono 250 cambia, 31 legge, 22
  mostra (il prototipo ne dice 250/29/24, il piano 249/29/24).
  L'orchestratore tiene la regola del piano, provata da effetto.rs, al posto
  dei conti: view.normal, view.split, view.customViews e
  formulas.watchWindow scrivono nel giornale e passano fra i Cambia (il
  prototipo li dice mostra o legge); insert.chartRecommendations,
  data.scenarioManager e file.printPreview (legge) e file.exportPdf (mostra)
  lasciano commit.edit vuoto e restano accesi in sola lettura (il prototipo
  li dice cambia). La tavolozza scrive «Scheda X della barra» solo se la
  barra mostra la scheda e il gruppo del posto, altrimenti «Comando del
  foglio di calcolo»: file, draw e pivot non hanno testi della barra, e i
  testi del menu sono di T14. Toccati in più palette/form.ts e form.test.ts,
  dove sta il tipo CatalogCommand. Rischio: l'effetto vale per comando, non
  per parametri.
- 2026-11-04 · K3 · T18 integrato con i bottoni a 44 px al telefono. La
  shell mobile impone ai bottoni almeno 44×44 (`mobile.css`), e il prototipo
  non ne teneva conto: al telefono i gruppi chiusi impilati sono alti 44
  invece di 38, il vassoio 100 invece di 88, Dati ha 0 gruppi aperti su 4
  invece di 1, Inserisci scorre di 61 invece di 54. Perché: abbassare un
  bersaglio del dito sotto il minimo della shell è una scelta di
  accessibilità e cambia il «Fatto quando», quindi è dell'utente; finché non
  risponde resta la regola della shell, che non tocca il resto del lavoro
  (un'eccezione sarebbe solo CSS dentro `.grid-ribbon`). Le baseline delle 9
  scene nuove arrivano dal runner con T17; fino ad allora `bench/scene.test`
  «ci sono tutte» resta rosso.
- K3 · D-7 (il foglietto chiuso della variante C): l'utente ha scelto
  l'ibrida il 2026-11-03, due o più chiusi a pila alti 38 px, uno rimasto
  solo a tessera alta quanto la barra (80 px). Il pianificatore l'ha scritta
  in T18, nella tabella «Dal prototipo» e nel Cancello; pila, tessera e
  dorso restano nel prototipo solo per confronto. Le varianti A e B non
  cambiano. Il piano delle celle della griglia (16 difetti misurati) è un
  piano a parte, piano/griglia-celle, perché tocca gli stessi file di T14,
  T15, T18 e T19.
- 2026-11-03 · K3 · risposta dell'utente al terzo prototipo della barra: la
  variante C (i riquadri sollevati) e le animazioni piacciono («stupenda»,
  l'apertura sul posto di Allineamento e Carattere «bellissima e comoda»,
  anche pensando al telefono). D-6 = C; A e B non piacciono e restano come sono, senza altro lavoro. Un solo difetto di C, che blocca
  l'approvazione del gruppo chiuso: il gruppo ripiegato (nome sopra, icona e
  freccia sotto, tanto spazio vuoto, proporzioni sbilanciate) è «grezzo» e
  va ridisegnato dal pianificatore prima di T18. Chiesto anche di
  pianificare le celle della griglia (oggi sulla 1432 ci sono difetti di
  disegno e animazioni povere) allo stesso livello della barra.
- 2026-11-03 · K3 · T11 integrato (95cd097e..1cfcca49): ogni DocumentSession
  ha una chiave di apertura, fatta prima della lettura e chiusa da un'uscita
  sola (#release), e tutte le letture e scritture della sessione la passano;
  RICH_FORMAT_IDS è tolto; un presidio sull'AST di TypeScript vieta
  openDocument, documentClosed e la scrittura con chiave fuori dalle
  sessioni; fuori da «Tocca» il coder ha aggiornato sei helper dei banchi e
  tre e2e, perché documentClosed è ora obbligatorio nell'API, senza
  indebolire asserzioni · dopo un ricaricamento della finestra le chiavi
  vecchie restano nell'host fino alla chiusura del vault o al tetto di 1024:
  è scritto in motori.md, e non serve codice perché il tetto LRU le
  richiude.
- 2026-11-03 · K3 · T10 integrato (d94cd18f..ed10cc56): le letture semplici
  non aprono un documento nel motore, solo una chiave di apertura (OpenKey)
  lo tiene aperto; quando le chiavi sono troppe si chiude quella usata meno
  di recente (LRU) e non la più vecchia, perché un documento appena
  riguardato non deve perdere la sua prova; Host::open_keys esiste per i
  test e per l'host finto; la pagina motori.md la aggiorna T11 · il piano
  diceva «la più vecchia», ma con l'LRU un documento in uso non si richiude
  sotto le mani.
- 2026-11-03 · K3 · D-5 (b): i nomi dei gruppi sulla barra dei fogli
  restano, ma discreti (grigi, poco evidenti, eleganti); il prototipo
  rifatto non è approvato e si rifà una terza volta, con un'organizzazione
  della barra nuova invece di quella di Excel, più identità di Fub, meno
  spazio vuoto sotto e le animazioni predisposte · parole dell'utente («mi
  piace la variante B con i nomi … un po' più discreti … in un grigio»,
  «l'organizzazione della barra mi sembra proprio una copia rispetto a
  Excel. vorrei qualcosa di nuovo, qualcosa di più bello … predisposte anche
  le animazioni»).
- 2026-11-03 · K3 · T10: l'utente dà l'OK al cambio dell'IPC (read_document
  e write_document con open?, document_closed con {open}, al più 1024 chiavi
  per vault) · parole dell'utente («ok»): le letture semplici non tengono
  più aperti i documenti; la riga nel piano la scrive l'orchestratore quando
  il pianificatore della barra ha finito.
- 2026-11-03 · K3 · il prototipo di T12 non è approvato: la barra
  multifunzione dei fogli va ridisegnata nello stile di Fub (moderno,
  minimale, stondato) invece che come Excel; si comincia dai fogli, e i
  documenti e le altre modalità la riprenderanno più avanti, quindi in K3 la
  barra degli altri editor non cambia · parole dell'utente; il menu
  «Comandi» resta, con la barra nuova.
- 2026-11-02 · K3 · Le risposte dell'utente a D-1…D-4 (e merge-k3,
  ci-soglia): D-2 (c), T8 unito e una lettura conta come apertura solo con
  la chiave di una sessione della shell, che la chiude in ogni uscita
  (contratto IPC cambiato: T10, T11); D-3 (c), un menu «Comandi» vero per i
  fogli, con il prototipo T12 da approvare prima di T13–T15, un posto e un
  effetto per ogni comando; D-4 (a), K3 si chiude e la memoria della WebView
  va in un piano a parte; il merge solo dopo la CI completa e la revisione
  (T17); il limite di R1 non si alza · ogni cosa che apre un documento lo
  deve chiudere, un comando che si trova solo con una scorciatoia è
  nascosto, e un numero rosso non si nasconde alzando la soglia.
- 2026-11-02 · K3 · T9: la misura del cancello prima (cb4213ec, codice di
  620f0acd) e dopo (c5851334) sulla stessa macchina, tre giri R1/S1/S6
  alternati per lato sotto Xvfb e i banchi; T8 non misurato. L'avvio e i
  banchi passano; gli obiettivi di R1 no, per la WebView: lo segno come
  fatto perché il «Fatto quando» di T9 è la pagina col giudizio, e il
  cancello va all'utente come D-4. In tempi.rs la lettura dopo un'altra
  cartella chiusa costa 6–15% in più (malloc_trim di T5): annotato, non
  abbassato nessun tetto.
- 2026-11-02 · K3 · T7: i titoli dei 303 comandi e i nomi dei campi stanno
  in un catalogo dei testi a parte (`editors/grid/palette/strings.ts`),
  caricato col foglio, e non in `i18n/catalog.ts`, per non gonfiare i testi
  della shell; i valori delle scelte restano come li scrive il catalogo. La
  finestra costruita dai campi serve ai 106 comandi con parametri
  obbligatori e chiede solo la forma principale; i 197 senza partono subito
  sulla selezione, come il pulsante della barra; quelli con una finestra
  scritta a mano aprono quella. Un comando spento resta in elenco col motivo.
  I comandi compaiono anche nel lanciatore dello Scrittoio. Limiti noti: i
  comandi che leggono soltanto non mostrano il risultato; due comandi hanno
  lo stesso titolo «Riempimento rapido» e si distinguono dalla scheda.

- 2026-11-02 · K3 · T8 (branch `piano/k3-ipc-motori`, in attesa di D-2):
  `Host::warm_engine` e `Host::document_closed` hanno nomi inglesi come il
  resto di `fub-host`; l'host sa quali documenti ricchi sono aperti dalle
  revisioni che ha dato alla shell (al più otto per documento) e dimentica la
  prova a vuoto per revisione (`MotoreDocumenti::dimentica`, pubblica); il
  client scalda dopo 300 ms di puntatore fermo e solo i tipi con un motore,
  e avvisa la chiusura da `DocumentSessionCollection.close`. · La revisione è
  già l'impronta dei byte con cui il motore ricorda la prova: niente disco da
  rileggere. Limite noto: le letture fuori da una sessione (l'anteprima della
  ricerca) contano come aperture senza chiusura, e allora la cache resta fino
  alla chiusura del vault.
- 2026-11-02 · K3 · `scripts/check.sh --rapido` fa girare i test di
  `fub-abi` anche quando il diff tocca soltanto documenti. · Un riquadro
  doppio nel grafo di `overview.md` è passato verde in locale e rosso in CI:
  `dependency_invariant` legge i documenti ma girava solo se cambiava un
  crate.
- 2026-11-02 · K3 · T4: `importa` e `verifica_copertura` ricevono un
  `Adattamento` dell'adattatore (posti dei menu, lessico dei nomi nudi dei
  parametri, correzioni per comando) e restituiscono tutte le mancanze, non la
  prima; `Modulo::da_schema` prende il lessico, differenza dal piano che lo
  voleva dal solo schema. Il catalogo dei fogli ha 303 comandi, 43 non serviti
  con il loro perché e 75 solo nella tavolozza. · Lo schema del motore scrive
  spesso nomi nudi (`range`, `at`) senza tipo: senza lessico i campi
  sarebbero tutti testo libero. I tipi del lessico vengono dal codice di
  GridCraft; alcune scelte portano nomi del motore (il tema «Craft») che la
  shell non deve mostrare così come sono.
- 2026-11-02 · K3 · T5 e T6: il motore dei fogli conta le istanze aperte con
  una `Presa` (cade l'ultima, si svuotano le sue cache); le cache dei documenti
  (le prove a vuoto, `documenti.prove`, con la stima dei byte misurata sul
  corpus) e i dizionari del correttore (`correttore.dizionari`) si svuotano
  alla chiusura dell'ultimo vault, passando da `fub-host/src/rich.rs` e da
  `fub_features::proof` senza nominare WordCraft · perché: chi chiude non deve
  sapere quali motori ci sono. Rischi annotati: lo svuotamento dei fogli gira
  sotto il lucchetto della superficie della griglia del kernel (toglierlo vuol
  dire toccare `fub-kernel`/`fub-host`); svuotare i dizionari toglie anche la
  sillabazione, che si ricostruisce alla prima richiesta.
- 2026-11-02 · K3 · Il test di copertura dei comandi (T4): la regola sta in
  `fub-motori` (`catalogo`, provata con specifiche finte in
  `crates/fub-motori/tests/copertura.rs`), il test vero sul motore dei fogli
  in `crates/fub-format-xlsx/tests/copertura.rs`; `fub-motori` non dipende
  da nessun adattatore, nemmeno nei test (differenza dal piano, che diceva
  una dev-dipendenza da `fub-format-xlsx`) · perché: ADR 0236, e ogni motore
  che verrà usa la stessa regola dal suo adattatore.
- 2026-11-02 · K3 · `check-motori.mjs` ammette `rfd` solo se lo porta
  `tauri-plugin-dialog` (i dialoghi di sistema della shell di Fub, non
  l'interfaccia di un motore); «librerie doppie» sono i nomi in due o più
  versioni (45 con tutte le feature e tutte le piattaforme), non i 61 nomi di
  `cargo tree -d`, che conta anche la stessa versione ripetuta · fonte:
  report del coder di T2, accettato dall'orchestratore.
- 2026-11-02 · K3 · Lavoro di notte senza l'utente: le domande del «Chiede
  sempre» si raccolgono in `PLAN.md` (D-1…D-3) e intanto vale la scelta più
  sicura e reversibile; i due IPC nuovi (scaldare, «documento chiuso») si
  scrivono su un branch a parte, `piano/k3-ipc-motori`, e non entrano nel
  branch del piano senza un sì; nessun merge · fonte: l'utente («voglio che
  tu implementi più parti possibili durante la notte … segui il piano»).
- 2026-11-02 · K3 · `fub-motori` non nomina nessun motore: dà `Pigro<T>`,
  `Servizi`, `Budget`, `Cache`, il catalogo e un registro `Motori` dinamico in
  cui ogni adattatore iscrive il suo motore («fogli», «documenti»); servizi e
  registro unici nel processo · perché: solo gli adattatori nominano i motori
  (`check-engine-boundary.mjs`, `GRIDCRAFT_OWNERS`, `WORDCRAFT_OWNERS`) e un
  campo per motore farebbe un ciclo fra `fub-motori` e gli adattatori; ADR
  0236.
- 2026-11-02 · K3 · `rayon` (gruppo di thread dei motori, suo e con un nome)
  e `libc` (`malloc_trim` su glibc) diretti in `fub-motori`: erano già
  nell'albero, nessun crate nuovo · fonte: `Cargo.lock` (rayon 1.12 da
  tantivy; libc 0.2 come in `fub-kernel`).
- 2026-11-02 · K3 · Scheda grafica e archivio dei caratteri non entrano in K3:
  nessun motore acceso li usa e `wgpu` sarebbe una dipendenza nuova; arrivano
  col primo motore che li chiede · domanda D-1 per l'utente.
- 2026-11-05 · caricamento · scelta dell'utente (A): il banco del moto non
  conta come residuo la `transform: scale(1, 1)` che CodeMirror lascia sui
  suoi strati (`.cm-layer`) dopo la cascata d'avvio, che scala il riquadro a
  0,98; la cascata resta com'è. L'eccezione vale solo per la scala neutra e
  solo sull'elemento `.cm-layer` (`editorLayerIdentity` in
  `bench/motion-rules.mjs`) · l'altra strada era togliere la scala dalla
  cascata, cioè cambiare ciò che si vede all'avvio.

- 2026-11-04 · caricamento · piano concluso. `bench:lampo` entra in CI nel
  job del banco visivo e in `ci-required`. Il controllo completo locale è
  verde salvo le otto baseline `avvio-*`, che arrivano dal runner, e quattro
  test a tempo (`runtime`, `engine`, `diagnostics`, `tips`) scaduti sotto
  carico e verdi da soli. Il rosso di «i test del workspace» nella corsa
  41910733616 era il runner senza spazio su disco: rifatto, verde.

- 2026-11-04 · caricamento (orchestratore) · lo stile dello strato d'avvio
  esce dai tre HTML: `<link id="avvio-stile">` verso `public/avvio/avvio.css`,
  e il `<noscript>` carica `public/avvio/senza-js.css`. Il piano lo voleva in
  linea, contando su `style-src 'unsafe-inline'`, ma Tauri mette un nonce a
  ogni `<style>` delle pagine e lo aggiunge a `style-src`, e con un nonce la
  WebView ignora `'unsafe-inline'`: i sei `<style>` che CodeMirror aggiunge a
  pagina avviata erano rifiutati (senza foglio) e gli editor dell'app vera
  restavano senza stile. Lo ha mostrato S7 di `bench:webview`, rosso da T1 in
  tutte le corse (la maniglia a y≈38.200: `.cm-scroller` alto quanto la nota),
  riprodotto su server-di-fub; il banco Chromium passa da Vite e non ha la CSP
  di Tauri. `pagine.test.ts` ora tiene le pagine senza `<style>` né script in
  linea. `R1.giri.pendenza` sopra soglia nelle stesse corse non è del piano:
  su main va da 3,6 a 56,8 MiB (run 41809459543, 41538788842, 41325487648).

- 2026-11-04 · caricamento T4 · perimetro allargato dall'orchestratore per due
  difetti di T1 trovati dalle scene: col moto ridotto il guasto e l'attesa
  sono visibili subito e solo l'opacità dissolve (prima `visibility` arrivava
  dopo 90 ms e «Riprova» non prendeva il fuoco); lo strato è `role=region`
  col nome `app.avvio.regione`. Nel banco `openPage` riporta a zero
  `performance.now()` a ogni documento, perché l'orologio finto di Playwright
  lo tiene per contesto e lo strato passerebbe al guasto per tempo dopo
  qualche scena. `openStage` prende `port`, `bench:lampo` `--port`.
- 2026-11-04 · caricamento T2 · tolto da «Fatto quando» il limite di 25 ms
  fra due fotogrammi con la CPU rallentata 4×. Su server-di-fub, senza
  scheda grafica, il primo fotogramma ne prende 50–67 e la pulizia 67–83;
  alla domanda l'utente ha scelto «Lasciar perdere». Restano le foto della
  cascata e `bench:motion`.
- 2026-11-04 · caricamento · prototipo approvato dall'utente: attesa «scia» e
  passaggio «cascata» (le regioni dell'app entrano in ordine di lettura con la
  molla `elastic` di `moto`, 30 ms l'una dall'altra); il passaggio «si posa»
  resta solo nel prototipo · l'utente trovava il primo passaggio «troppo
  noioso» e ha voluto un effetto elastico in linea con lo stile di Fub.
- 2026-11-04 · caricamento · lo strato d'avvio sta in linea nei tre HTML (uno
  `<style>` uguale, due script classici in `public/avvio/`, una cache
  `fub.avvio` sua) e lo consegna la shell con `moto` a finestra e vault
  pronti · deve valere al primo disegno, prima di ogni modulo e col JS spento;
  la CSP vieta lo script in linea e la pelle arriva solo dopo il sanitizer.

- CI di PR #297 (orchestratore): i job dei banchi (visual, a11y, graph,
  benches) non avevano il toolchain Rust col bersaglio wasm32-unknown-
  unknown, e Vite non poteva compilare il nucleo della lavagna quando
  serviva la pagina: la shell del banco non partiva. Aggiunto lo stesso
  passo del job client. Nella stessa corsa la WebView vera è caduta solo su
  S1 per GTK che non si inizializza sotto Xvfb (tao event_loop), con tutte
  le altre misure, L1 compreso, sotto soglia: non è di N3 · fonte: log dei
  job 126262963796, 126262963801, 126262963812, 126262963882, 126262787875
- Orchestratore, CI di #297 (client in OOM): la causa è la prima build
  fredda del nucleo WebAssembly dentro il tempo massimo della prima prova
  (shell.e2e): con target/canvas-wasm vuoto le prove scadevano una dopo
  l'altra e la memoria cresceva. Riprodotto in locale (16 prove scadute a
  freddo). Correzione: un globalSetup di Vitest (build/canvas-wasm.global-
  setup.mjs) compila il modulo una volta prima delle prove; se cargo manca
  la suite parte lo stesso e falliscono solo le prove della lavagna, col
  messaggio del plugin. A freddo dopo la correzione: 117/117, compilazione
  23 s, memoria massima come su main (circa 1,4 GB). Commit d2783ebf.
- N3 T22 (6d5fb197, dal coder ed4d8c1c): una lavagna con una chiave doppia
  si apre in sola lettura con l'avviso `canvas.unwritable` (IT ed EN, le
  sole lingue del catalogo) e torna scrivibile da sola quando la chiave se
  ne va. Differenze dal piano: la domanda al nucleo è `preview([])` e non
  `commit([])` (stessi passi, non tocca la lavagna e tiene la regola di T16
  «mai una lista vuota a commit»); la sola lettura è `#unwritable` sommata a
  `#panelReadOnly` in un getter `#readOnly`; l'avviso si calcola in
  `#drawToolbar` (prima l'avviso dell'ultimo gesto, se no
  `canvas.unwritable`, mai oltre il limite interattivo); `syncDoc` chiede al
  nucleo solo se il testo è cambiato. Aspetta: l'avviso sta in fondo alla
  barra, che va oltre lo schermo anche a 1280 px, quindi senza scorrerla non
  si vede (vale già per gli avvisi di prima); spostarlo cambia la pelle o il
  layout, fuori dal Tocca: chiesto all'utente (all'inizio della barra, una
  striscia sopra la lavagna, o com'è). Rischi: un testo con la chiave doppia
  che arriva da un'altra superficie mentre si scrive in una scheda chiude il
  campo e quel testo si perde, come con `setReadOnly` del pannello; ogni
  testo nuovo costa una `preview` in più nel nucleo, non misurata.
- N3 T21 (b652f0c1, dal coder cbdc32cf): annulla e ripeti della tela
  rimettono il tratto di prima byte per byte con un `reset` quando il testo
  è ancora quello lasciato dal passo; se no passano le toppe inverse al
  nucleo, come prima. Differenze dal piano: la versione non è un contatore
  che cresce soltanto: ogni testo nuovo (gesto, annulla per toppe, `setDoc`,
  `syncDoc` che cambia il testo) prende un numero mai usato, mentre un
  annulla o ripeti a byte ridà al testo il numero che aveva (ogni passo
  tiene `version` e `restores`), se no dopo annulla e ripeti la storia più
  vecchia ricadeva sulle toppe; il passo tiene anche le toppe dirette
  (`back`) per il passo opposto, perché un `reset` non dà inverse; oltre
  alla versione si controlla che il tratto sia davvero nel testo, e se
  `reset` rifiuta restano le toppe. Controprova del coder: forzando la via
  delle toppe cadono 11 test su 13. Rischio: un passo grande tiene in
  memoria il testo tolto, al massimo 100 passi e senza limite di byte.
- N3 T20 (1c3c37c0, dal coder f42acbcb): la riscrittura di una lavagna tiene
  i null dei campi noti, non aggiunge gli array `nodes`/`edges` assenti e le
  toppe dei collegamenti portano `at`; spostare una scheda di Obsidian
  cambia solo i byte della coordinata (test in `fub-
  features/src/lavagna/apply.rs`). Differenze dal piano: il coder ha
  rigenerato `canvas-mirror.json` con UPDATE_MIRROR, che la nota diceva di
  non toccare ma è un file derivato (25 casi cambiati, verificati uno per
  uno: solo collegamenti, null e tratti più piccoli); `operation.test.ts`
  ora ha `at: 0`; una scheda ricomposta tiene i byte dei campi che non
  cambiano; il vettore 18 è diventato `18-null-kept-on-rewrite.json`.
  Rischio: un null che prende un valore e poi si annulla sparisce del tutto
  (vettori 74 e 86), scritto nella pagina del formato; i casi del null
  richiesto e di BOM+CRLF su una riga stanno in `source_edit.rs`.
- 2026-11-03 · N3 T18 · Il TypeScript della lavagna è tolto (model.ts resta
  solo tipi; parseCanvas, serializeCanvas, isValidCanvas, emptyCanvas,
  isCanvasOperation, source-edit.ts e i loro test via): i 101 casi tolti
  sono diventati vettori canvas-read/01–81 e canvas-patches/46–70, letti da
  Rust (tests/read_vectors.rs) e dal mirror wasm; la tabella caso → vettore
  è nel resoconto del coder. Una lavagna rotta tenuta mentre il nucleo si
  carica passa alla superficie d'errore per un canale onFail
  (SurfaceCallbacks → document-controller.failSurface), toccando
  editors/canvas/surface.ts; due e2e aspettano con waitFor la superficie
  d'errore e controllano che nel frattempo non si veda niente di
  modificabile. Scartato un ready?() nel registro: rallenterebbe l'apertura
  di una lavagna buona e toglierebbe il riquadro aria-busy. I vettori di
  lettura hanno un campo extra. Rischi rimasti: commit([]) arriva al nucleo,
  che su una sorgente vuota scrive la lavagna intera (il motore non lo manda
  mai; scritto in canvas-format.md e wasm/core.test.ts); i disegni
  (spatial/lazy.ts) mostrano ancora avviso più toast invece della superficie
  d'errore; il messaggio di panic di ts_mirror.rs nomina ancora il vecchio
  mirror.test.ts · perché la regola del formato vive una volta sola, in Rust
- N3 T19 (orchestratore): `settlePending()` è pubblico invece di
  `#settlePending`, perché anche i metodi della collezione (release,
  discardUnsaved, handleExternalRemoval, il congedo) lo chiamano prima di
  leggere `dirty`. La porta ha anche `watchPending`, un'iscrizione col suo
  disposer, per check-listeners. La descrizione della porta e della cadenza
  sta in frontend-and-ipc.md («Il testo in sospeso») perché editor-
  surfaces.md era al limite delle 450 righe: lì c'è un rimando. `written()`
  usa il documento mostrato dal riquadro, perché durante un cambio di tab il
  testo registrato allo stacco è del documento di prima. Un salvataggio
  riuscito con testo ancora in sospeso tiene la bozza e la riscrive sulla
  base nuova. Ho rimesso al suo posto il commento di `renderMarkdownForCard`
  (f56444dc).
- T16 (7592cc3a): la tela usa il nucleo. Il campo di una scheda resta aperto
  attraverso `syncDoc` e il suo testo in sospeso si registra subito dopo,
  sulla scheda com'è nel testo nuovo; Invio in una scheda di testo registra
  all'input che segue (l'a capo); `setReadOnly(true)` chiude il campo; la
  seconda trappola di fila mostra l'avviso e non riprova fino al testo dopo.
  Durante il caricamento pigro la superficie usa ancora `parseCanvas` per
  dire subito che un testo non è una lavagna: T18, che toglie il modello
  TypeScript, lo sostituisce. Chiave nuova `canvas.card_invalid` accanto a
  `canvas.card_too_long` e `canvas.core_unavailable`. La porta del nucleo è
  iniettabile (`CanvasEngineOptions.core`) per i test che contano le
  chiamate; `registry.test.ts` carica il nucleo in un `beforeAll`. La tela
  non manda mai una lista vuota a `Core::commit` (risponde `request`), così
  il rischio di T14 non si presenta. Resta: un intero oltre 2^53 in un campo
  sconosciuto si arrotonda passando dal JavaScript; a 700 px la barra degli
  strumenti della tela esce a destra (già così sulla base). Il banco apre un
  `.canvas` solo dal lanciatore: l'host finto lo elenca senza visualizzatore
  (già così).
- 2026-11-03 · N3 · T15 integrato (d3c348be la CSP, il test e la decisione
  0237; 4b45dbd0 lo scenario L1; 8adf925e la misura). La CSP apre solo
  `'wasm-unsafe-eval'` in `script-src`; il test di `platform_configs.rs`
  legge la config fusa di ogni piattaforma e `devCsp`, con 16 casi in
  negativo (anche `script-src-elem`/`-attr` e una direttiva doppia). L1 in
  `bench:webview` fallisce con un messaggio chiaro su un errore di CSP;
  l'orchestratore l'ha messo nel job `webview` (57f11a32, solo il nome del
  passo e `--only`: il nome del job resta, perché lo cita il cancello del
  rilascio). Misure: modulo 449,5 KiB grezzi, 164 182 B gzip (contro i ~56
  KB della prova 1 del piano), commit su 2000 schede 5–8 ms al p95 in Node e
  in WebKitGTK 2.54; soglie ci di L1 provvisorie (3× il peggiore locale,
  minimo 10 ms), da ritarare a 1,5× il peggiore del runner dopo il primo
  giro (T23). Da sapere su server-di-fub: con sccache un cambio della sola
  `tauri.conf.json` non ricompila `generate_context!` e il binario tiene la
  CSP vecchia; per provarla si tocca `crates/fub-app/src/lib.rs` o si
  compila senza sccache.
- 2026-11-03 · N3 · le risposte dell'utente alle domande nuove: D-9 (b), le
  lavagne con valori sconosciuti in un campo noto si aprono dentro N3 (un
  prototipo e due task prima di T23, li scrive il pianificatore); D-10 (a),
  Esc registra e chiude; A14–A18 approvate; la riga di CLAUDE.md di T14
  approvata · D-9 (b) è il consiglio dell'orchestratore contro quello del
  pianificatore (a): N3 cambia già il modello della lavagna, e un file
  dell'utente che non si apre è il difetto più grave.
- 2026-11-02 · N3 · Le risposte dell'utente a D-1…D-8 e a merge-n3n4: le non
  ovvie sono tre. D-5 (c): il testo di una scheda si registra a pause di
  circa 250 ms, Esc registra invece di buttare (la D-10 nuova chiede
  conferma), il testo ancora nel campo va nelle bozze, e il ritardo della
  bozza diventa una cadenza per ogni documento (T16, T19). D-7 (c): Fub
  riscrive conservando i null dei campi noti, gli array assenti e il posto
  degli archi, l'annulla della tela torna ai byte di prima, e una lavagna
  che non si riscrive senza perdere niente si apre in sola lettura (T20–T22;
  i valori sconosciuti dei campi noti restano fuori, D-9). merge-n3n4 (b):
  N3 entra in main solo finito, dopo la CI completa e una revisione riga per
  riga (T23) · non perdere dati e non cambiare senza dirlo i file degli
  altri programmi vengono prima della comodità, e N3 a metà in main
  lascerebbe due copie della logica.
- 2026-11-02 · N3 · T17: fatto con D-4 (a), solo la misura: il banco
  `tools/ink-wasm-banco/` (nessuna crate nuova nel lock) e `wasm.bench.ts`,
  che si salta senza il `.wasm`. Il primo giro era a macchina carica; la
  pagina tiene i tre giri rifatti con il carico sotto 2,5. La condizione del
  passo 12a non è vera per intero: un evento per chiamata, il WebAssembly è
  4,3 volte più lento col mouse e il 16% con lo stabilizzatore, pari con la
  penna; il riduttore da solo è pari o più veloce. La pagina non dice che
  cosa fare: resta all'utente con D-4.
- 2026-11-02 · N3 · ADR 0234 allineato: la lavagna non è più fra i
  componenti senza bundle, perché da T10 è il bundle fub.lavagna. Perché:
  l'ADR deve dire com'è fatto il codice.
- 2026-11-02 · N3 · T12: gli strumenti MCP fub_canvas_create e
  fub_canvas_apply chiamano canvas.create e canvas.apply con gli id scritti
  come costanti, come note.create, perché fub-cli non dipende da fub-
  features; fub_canvas_apply risponde {doc, dry_run, outcome} in prova e
  {doc, dry_run, created, revision} applicato, e check_read più check_write
  valgono anche in prova (in sola lettura nemmeno la prova passa); l'MCP non
  passa il seme, quindi gli id nuovi vengono dalla revisione. Se
  fub_canvas_create crea un nome diverso da quello provato, lo dice invece
  di tacerlo. Perché: un agente crea e riempie una lavagna con le stesse
  regole di accesso degli altri strumenti.
- 2026-11-02 · N3 · T11: canvas.create scrive come sorgente la lavagna vuota
  del nucleo (patch_source su Canvas::default, riletta con Core::open prima
  di scrivere), perché il nucleo non ha una funzione apposta; senza nome
  prende il primo libero («Lavagna», «Lavagna 1», in inglese «Whiteboard»),
  e un nome preso è un conflitto che non sovrascrive. Il codice dei nomi è
  una copia di drawing.create, perché le feature non si importano fra loro;
  l'annulla porta la lavagna nel cestino e richiede la feature commands,
  come drawing.create. Perché: un file nuovo è già una lavagna che il nucleo
  apre.
- 2026-11-02 · N3 · T10: il componente «Lavagna» (fub.lavagna) porta
  canvas.apply; il seme degli id usa l'Fnv1a del contratto; spegnere
  fub.lavagna toglie solo canvas.apply, e il test fub-cli
  spegnere_la_lavagna_dice_che_la_penna_non_serve_piu è stato aggiornato di
  conseguenza (opzione a: dice con precisione che cosa sparisce, non è
  indebolito). Resta da allineare l'ADR 0234, che mette ancora la Lavagna
  fra i componenti senza bundle. Perché: la lavagna diventa un componente
  che si scrive come gli altri, e un componente spento toglie solo ciò che
  porta.
- 2026-11-02 · N3 · T9: lo specchio a caso fra fub-canvas-core e la lavagna
  TypeScript ha 2051 casi (1333 sorgenti, 718 prove con toppe) in una
  fixture di 501 KB, un sorgente per riga con le sue prove per stare sotto i
  512 KB. Ha trovato una divergenza (26 casi): in una toppa il TS trattava
  un campo noto a null diversamente dal nucleo Rust; corretto il lato TS
  secondo R7 (null vale come assente, sia nel dopo sia nel confronto del
  prima), vettori 44 e 45.
- 2026-11-02 · N3 T7 · il commit in Rust (`fub-canvas-core/src/commit.rs`:
  `Core`, `Committed{source,inverse,edit}`, `Edit::between/apply` ai confini
  di carattere, `CommitError` Stale/Invalid/Rejected/Unstable con
  `reason()`) e 43 vettori in `apps/client/src/__fixtures__/canvas-patches/`
  letti da Rust e da TS; in TS `canvasCommitOutcome` accanto a
  `commitCanvasPatches`, che non cambia; `parseNode` di `model.ts` allineato
  a Rust (limiti solo per il campo del tipo della scheda, niente limite
  sullo sfondo) · i due lati devono dare gli stessi byte; rischi: il TS ora
  scrive i campi nuovi nell'ordine di Rust (stesso valore, byte diversi),
  un'immagine con le chiavi in un altro ordine e uno sfondo di 9000 byte ora
  si aprono; manca un vettore «unstable»; una lista di toppe vuota fa in
  Rust un commit che non cambia niente, in TS dà null.
- 2026-11-02 · N3 T8 · operazioni d'intento (`ops.rs`): un id che non è né
  scheda né arco in `remove`/`set` dà `UnknownEdge`; `set` vale anche sugli
  archi; un id dato già preso o ripetuto in `ids` dà `DuplicateId`; `reorder
  {ids}` porta in cima gli id dati, nell'ordine dato; gli id nuovi vengono
  da SplitMix64 sul seme (`IdSource`, sedici cifre esadecimali); ogni scheda
  e arco messi passano `Canvas::validate`; l'`at` delle `remove-node` è la
  posizione all'inizio della serie, anche fra due operazioni; i vettori
  hanno l'esito `malformed` per un'operazione che non si legge · così il
  TypeScript (T14, T16) rifà lo stesso generatore e le stesse posizioni dai
  vettori, e l'inversa rimette ogni scheda al suo posto.
- 2026-11-02 · N3 · T5: `patch_source` ritocca il sorgente con uno
  scanner suo, più severo di quello TypeScript (rifiuta virgola finale e
  valori vuoti, si ferma a 256 livelli, `SourceError::TooDeep`); gli archi
  nuovi si scrivono nell'ordine di R10 (fromNode, fromSide, fromEnd,
  toNode…), costruito in `edge_value` e non dall'ordine della struct; una
  radice ricomposta senza `edges` lo riceve in fondo, come in TypeScript; un
  array che non corrisponde al modello di prima si riscrive per intero. Le
  schede si confrontano come struct e diventano JSON solo se cambiate: 2000
  schede, una cambiata, ~0,8 ms in release (macchina carica). Il confronto
  per valore è uno solo, `patch::same_value`, usato anche dal ritocco.
  Perché: stessi byte di TypeScript dove TypeScript segue R1–R10; T7 porta
  il TypeScript all'ordine R10 degli archi e lo specchio di T9 lo controlla.
- 2026-11-02 · N3 · T6: `PatchError` ha una variante per ogni rifiuto
  (`Stale` con il soggetto, `AtOutOfRange`, `NodeHasEdges`,
  `MissingEndpoint`, `NotAPermutation`), tutte con la posizione della toppa,
  dove TypeScript dà solo `null`; `after: null` si legge solo da `null`;
  `at` negativo o con la virgola è un errore di lettura (TypeScript lo
  scarta nella bozza); `draft` non chiama `Canvas::validate`, come
  `canvasDraft`: il modello di dopo lo controlla il commit (T7). Portate
  anche `upsert_node_patch` e le sorelle, che servono a T8. Restano come in
  TypeScript l'inversa di un inserimento senza `at` e l'arco rimesso in
  fondo, fissati da un test. Perché: errori tipati e stessa forma JSON.
- 2026-11-02 · N3 · T3: in Rust R2 è un solo visitor (`SafeInteger`) che
  porta il nome del campo nell'errore, R7 un `null_as_empty` su `nodes` ed
  `edges`; il nucleo espone `read::is_blank` (la regola di
  `isBlankCanvasSource`) e `model::MAX_SAFE_INTEGER`, nessuna variante nuova
  di `CanvasError`. R3, R4 e R5 li rifiutava già `serde_json`: i test li
  fissano. Fuori da R1-R10 la validazione diverge ancora: TypeScript limita
  `background` a 8192 byte e `subpath`/`url` su ogni scheda, Rust no e solo
  sul loro tipo; per la regola «nel dubbio si apre» si allinea il
  TypeScript a Rust in T7, e lo specchio di T9 lo controlla.

- 2026-11-02 · N3 · T4: `js.rs` espone, oltre a `js_number`, `js_string`,
  `encode` ed `encode_pretty`, anche `js_json_number`, `is_array_index` e
  `js_entries` (l'ordine delle chiavi di JavaScript, che serve a T5 per
  R10); `encode_pretty` non mette il `"\n"` finale, lo aggiunge chi scrive il
  file; `js_number` su `NaN` e infiniti fa come `String(x)`. Il pareggio
  esatto si cerca sull'espansione decimale solo quando è possibile
  (`x = M·2^E` con `E = unit − 1`): in release un numero costava circa 2 µs,
  ora 0,1-0,3; i test confrontano la strada veloce con l'espansione intera su
  202 000 numeri, e fuori dal repo 400 000 numeri contro Node non danno
  differenze.

- 2026-11-02 · N3 · T1: `fub-canvas-core` ha un blocco suo nel grafo delle
  dipendenze di `overview.md` (il quarto diagramma), perché il primo era già
  a 20 riquadri; `read.rs` tiene il BOM e gli spazi come li leggeva
  `fub-format-canvas` (le regole di R1-R8 sono di T3); il nucleo riesporta
  `PresetColor` e `parse`, e `fub-format-canvas/src/model.rs` è un `pub use`
  del nucleo più `FORMAT_ID` e `SCHEMA_VERSION`. Il controllo per
  `wasm32-unknown-unknown` sta nel giro completo di `scripts/check.sh` e nel
  job `invariants` della CI, che l'orchestratore ha aggiunto.

- 2026-11-02 · N3 · T2: in TypeScript i controlli di R3, R4 e R5 stanno
  nello scanner di `source-edit.ts` (`inspectCanvasJson`), una passata sola
  sul testo dopo `JSON.parse`, e non in un reviver: misurato a 2000 schede,
  il reviver portava la lettura da circa 17 a 23 ms, lo scanner la lascia a
  13-14. La regola del vuoto (`isBlankCanvasSource`) è una sola, per il
  lettore e per il riscrittore. `backgroundStyle` è qualunque stringa senza
  limite suo (resta quello di 16 MiB del file), come in Rust; `-0` si legge
  `0`, come un intero Rust.

- T33 integrata (fino a 1e104305). Differenze accettate: un RAW con più di
  64 intervalli distinti è TooLarge; le chiavi JSON doppie contano una per
  una; Contents.json sostituito dai link; la pulizia delle cartelle private
  lasciate (prefisso fub-craft-render-, di questo utente, 0700, ferme da più
  di 1 h, mai un link) gira al montaggio e solo su unix, perché senza
  permessi unix non si può dire di chi è una cartella; la CLI delle
  anteprime muore con Fub solo su Linux (PR_SET_PDEATHSIG, legato al thread
  che l'avvia: lo stesso thread la aspetta fino alla fine, le app staccate
  non lo hanno); waitid NOWAIT esclude OpenBSD, che Fub non costruisce.
- CI completa su 1ba7a3c6 (run 41779586263), le cause rosse: (1) Windows,
  craft::channel a_closed_port_is_unreachable_at_once dava TimedOut perché
  Windows ritenta circa 2 s una porta chiusa invece di rifiutare; deciso che
  sul loopback una connessione che non riesce è sempre Unreachable (TimedOut
  solo per un'app che ha accettato e tace), il test su Windows ammette
  2×CONNECT_TIME+1 s, Linux e macOS restano «subito»; pagina permissions-
  and-security aggiornata. (2) Windows, session::snapshot_command_tests con
  os error 32 (file in uso) sullo spostamento della radice: codice che N7
  non tocca, trattato come instabile di Windows, da riguardare se torna. (3)
  banchi del movimento, rich-review-list 1 prova su 5 (37 px): verde nella
  run precedente, instabile. (4) scene.test, banco visivo e a11y: attesi, li
  chiudono T34 e le baseline di T32.
- N7 T32, la revisione riga per riga del client (un revisore in sola lettura
  sul diff di apps/client/src): otto difetti, verificati da me i due più
  seri leggendo il codice. (1) Il clic su una figura passa da
  `openWikilink`, che per un bersaglio che non risolve crea una nota: un
  clic poteva scrivere nel vault. (2) Fra `reserveLend` e `commit` del
  prestito la scheda resta scrivibile. Gli altri: il fuoco perso nella
  domanda sulle anteprime, un `job_done` vecchio preso per attuale, il
  biglietto condiviso fra render e load in `surface.ts`, `asking` non pulito
  nelle miniature, i `row.close()` che si accumulano in `photo-data.ts`.
  Diventano T34 con i tre difetti del visore PDF; la causa del percorso Tab
  interrotto è la pagina PDF che scorre e che Chromium rende raggiungibile
  con `tabIndex` -1. Il visore PDF è codice di main: si corregge qui perché
  la scena nuova di N7 lo prova e il banco lo vuole verde, non per allargare
  il piano. Lasciati fuori, perché minori e senza un caso che fallisca:
  `figure.ts` che ignora un annuncio vuoto, e l'errore tradotto di `open-
  with.ts` (`new Error(t("lend.save_failed"))`) che nessuno distingue per
  tipo. Le lingue diverse da IT/EN del catalogo non le ha guardate il
  revisore: il test del catalogo le conta.
- N7 T32, la CI completa su ceee30de (run 41776318335): rossi quattro
  lavori, ognuno con la sua causa. (1) Windows: `crates/fub-
  cli/tests/mcp.rs` (T-MCP, 85bbb4d1) usava
  `std::os::unix::fs::PermissionsExt` senza cfg; corretto dall'orchestratore
  come parte di T32 (solo un test, nessun comportamento): la sezione Craft
  del file sta in un modulo `#[cfg(unix)]`, come i test Craft di `fub-host`
  (`craft_cli.rs`, `craft_open_with.rs` hanno `#![cfg(all(unix, feature =
  "craft"))]`), perché le app finte sono script `/bin/sh`. (2) contrasto e
  tastiera, in tutte e due le luci: la scena nuova `pdf-domanda` è la prima
  che apre il visore PDF (`editors/media/pdf-view.ts`, già in main e non
  toccato da N7) e ne trova tre difetti: `.media-pdf-page` scorre ma non si
  raggiunge con Tab, la casella di ricerca non ha nome accessibile, e il
  percorso Tab finisce su nessun elemento. Diventano un task (T34) e non si
  tolgono dalla scena: nascondere la scena sarebbe indebolire un test. (3)
  banco visivo: 36 foto senza baseline (le scene nuove di T14–T31), nessuna
  differenza sulle 240 che c'erano; le baseline si prendono dal runner
  sull'ultimo giro, dopo T33 e T34, guardate una per una contro il
  prototipo. (4) client: solo `bench/scene.test` «ci sono tutte», che segue
  il (3). macOS e Ubuntu verdi.
- 2026-11-04 · N7 · La revisione Rust di T32 (un revisore in sola lettura)
  ha trovato difetti medi e bassi, nessuno alto: il RAW ostile senza budget
  di lavoro, il JSON intero in `Value`, la coda ZIP, l'XMP letto fino a 64
  MiB e poi scartato, l'errore non tipizzato di `craft_render`, «Apri con»
  su una cartella, `stop_group` dopo la raccolta, la CLI orfana se Fub esce
  di colpo, e `craft.preview` che calcola la revisione di un file grande col
  turno dello scrittore preso. Li correggo tutti in un task nuovo, T33,
  senza cambiare né ciò che si vede né il contratto. Resta fuori il turno
  dei comandi in sola lettura in `session.rs`: è di tutto l'host (vale anche
  su `main` per ogni comando di un provider), va in un'issue e nel
  resoconto. Il Job Object di Windows resta fuori perché vuole `windows-
  sys`.
- 2026-11-04 · N7 · T26 è entrato con questi scarti presi da me: una nota
  con un'icona scelta da chi scrive tiene l'icona e non prende la miniatura
  (`data-own-icon`); le miniature compaiono solo se `craftServed()`, cioè
  col componente acceso; la miniatura resta in memoria finché la riga è
  nell'albero (niente richiesta di nuovo a ogni ridisegno); l'osservatore
  guarda 64 px oltre la vista; il decoder base64 è locale in `state/tree-
  thumbnails.ts` perché quello di `figure.ts` è privato; tocca anche
  `bench/fake-ipc.ts` (`?albero=`), `bench/raw-fixture.ts` (un `export`) e i
  derivati del tema con l'hook `tree-thumb`. Un vault con soli XMP nascosti
  non mostra il richiamo del vault vuoto.
- 2026-11-04 · N7 · T31 è entrato con quattro scarti dal piano, presi da me:
  tocca anche `ui/link-preview.ts` e `markdown/mount.ts`
  (`hydrateVaultMedia` riceve un sesto parametro `open`), perché la figura
  di un PDF o di un documento nella nota passa da lì; `craftServed()` in
  `state/craft-previews.ts` chiede `craft.preview` solo se il componente lo
  serve, altrimenti l'apertura di un PDF senza componente rompeva le
  annotazioni (annotations.e2e); la scena del prestito del banco usa un
  `.docx` invece del PDF; `craft-subjects.test.ts` gira in node, non nel
  DOM. `noticeLinesOf` passa da `action` ad `actions` (lista di uno per la
  riga del prestito di T17). T26 parte sulla base 977dc88b con le miniature
  da 16 px del prototipo approvato, quindi senza `--tree-thumb` né la regola
  da 24 px.
- N7 T28 (1d0f8949, 6660e5f4): un RAW va al profilo `media-raw` della
  famiglia `viewer` (il registro ha un solo legame per i byte), che monta la
  superficie di `editors/craft` col profilo `raw`; `selectSourceProfile` lo
  sceglie solo se `craft.preview` è nell'elenco dei comandi, altrimenti il
  RAW resta senza vista. Alla revisione l'orchestratore ha trovato che
  l'elenco arriva dopo l'apertura del vault, quindi una scheda RAW
  ripristinata all'avvio restava sulla via del testo: la correzione
  (6660e5f4) aggiunge `Pane.bytes` e `commandsChanged` in `state/document-
  controller.ts`, che su `on("commands")` rimonta senza gesto solo i
  riquadri il cui legame coi byte è cambiato (e riprova quelli rimasti senza
  tab mostrata), con `craft-raw.e2e.test.ts` che fallisce senza.
  `state/craft-photos.ts` e `editors/craft/index.ts` toccati fuori dai Tocca
  (identità della superficie, riga «Foto RAW · CR3 · peso»). Con il JPEG la
  scheda non chiama mai `craftRender`. Da guardare in T32: in `crates/fub-
  host/src/craft/preview.rs`, senza prestito, `hosted_preview` → `raw::read`
  dà absent e `offer()` propone LightCraft anche per un RAW col JPEG (il job
  ricontrolla e la CLI non parte); la linguetta mostra il nome senza la
  sigla CR3, che sta nell'intestazione.
- N7 T23 (6a50629f): il gesto vive in `gestureBirths` per riquadro, solo per
  la durata dell'apertura che fa nascere la scheda; passano il gesto
  l'albero (clic, Invio, «Apri»), la ricerca, il passaggio veloce, i link e
  le figure nelle note (anche nella finestra staccata). Restano senza gesto,
  per scelta, le riaperture all'avvio, il ripristino della sessione, le
  aperture «accanto», le viste, il grafo, le note create o duplicate e il
  tocco su mobile (il piano non lo elenca: al telefono una scheda Craft
  mostra il pulsante e non fa partire l'app da sola; da riprendere se
  l'utente lo vuole). «No» chiama forgetConsent; l'errore di salvataggio del
  consenso usa la classe esistente `.setting-error`; i link alle
  impostazioni compaiono solo se la shell passa onOpenSettings
  (`openSettingsAt` in panels/settings.ts). Le 12 scene craft-* aspettano le
  baseline dal runner (T32).
- N7 T29 integrata (e31e9b9b). Decisioni dell'orchestratore, senza contratti
  toccati: la copia si chiama in.<estensione così come è scritta> solo se
  PreviewSubject::of_extension la riconosce come del soggetto (input_name al
  posto di input_extension), senza regole nuove; read_png diventa read_image
  (PNG o JPEG dalla firma), MAX_PNG_BYTES diventa MAX_IMAGE_BYTES,
  Failure::BadPng diventa BadImage, la chiave render.bad_png resta con il
  testo «PNG o JPEG» nel catalogo del bundle; il file d'uscita resta out.png
  anche per un JPEG. Non verificati su app vere: gli argomenti delle tre CLI
  (dal passo 12c e dalle misure large) e l'orientamento di un JPEG scritto
  dalla CLI (preso come 1). La via senza lease di preview.rs offrirebbe
  LightCraft anche per un RAW col JPEG, ma il job ricontrolla con la lease e
  la CLI non parte: da guardare in T28 o T32.
- N7 T17 integrata (cecb7d85..f9853a5d). Decisioni dell'orchestratore, senza
  contratti toccati: lend.ts esporta anche la prenotazione (reserveLend, che
  segue la rinomina e muore con il vault, così una risposta vecchia di
  openWith non presta), la porta LendGate che il controller registra e
  mountLends; open-with.ts avvolge l'host in lendingHost senza toccare
  external-editors.ts. Si presta solo un documento con una scheda aperta che
  non mostra soli byte (immagini, PDF, media no: lì c'è il solo openWith).
  Il visore media ora riceve openExternal = handToSystem(id, true), così la
  voce «Apri con» di T16 compare anche lì. Toccati in più panels/open-
  with.test.ts e docs/product/editor-menus.md. Resta, fuori da N7: durante
  il prestito (come già con una cancellazione in sospeso) il bollino della
  barra dei documenti dice «Si scrive» e la barra Home sembra attiva, perché
  lo stato del bollino guarda il formato e non il sola lettura della
  sessione (editors/rich/standing.ts); da segnalare all'utente.
- T16 integrata (b8a20bf1). Scostamenti dal piano, decisi dall'orchestratore
  perché non toccano contratti: le voci del sottomenu usano
  `description`/`disabled` già esistenti in SurfaceMenuItem invece di
  `hint`/`enabled:false`; SurfaceMenuItem ha un campo additivo `load?` per
  caricare le scelte quando il sottomenu si apre (solo TypeScript, nessun
  IPC). Nel visore dei media la voce «Apri con» c'è ma in produzione non
  compare perché document-controller non passa `openExternal`: il
  collegamento passa a T17, che tocca lo stesso controller.
- 2026-11-03 · n7-file-craft · L'aiuto di «fub help mcp» elenca fub_preview,
  fub_external_editors e fub_open_with già dopo T13 (non in T16, come diceva
  la voce sotto) · T16 non tocca fub-cli; aiuto e strumenti devono dire la
  stessa cosa.
- 2026-11-03 · n7-file-craft · T13: sopra gli 8 MiB fub_preview risponde
  missing:"absent" invece di troncare, e l'aiuto di cli.rs non elenca ancora
  gli strumenti nuovi · un'anteprima tagliata sembrerebbe vera; l'aiuto lo
  aggiorna T16 insieme alla pagina degli strumenti.
- 2026-11-03 · n7-file-craft · T12: fub-app prende CraftPreview e
  PreviewSize da fub_host::craft_render (riesportate sotto la feature craft)
  e non dipende da fub-format-craft · la colla IPC non deve conoscere i
  crate dei formati (strati di dependency_invariant);
  docs/architecture/overview.md torna com'era.
- N7 T30 (b8131b11, dal coder 22ae7bf3): un `.docx` o un `.odt` dà la
  miniatura che porta dentro, letta a pezzi (la coda dello ZIP,
  `_rels/.rels` fino a 64 KiB, la voce della miniatura fino a 8 MiB), senza
  revisione e senza cache; un PDF, un `.rtf` o un `.doc` restano `absent`.
  Differenze dal piano: errori `OfficeError { NotZip, TooLarge,
  BadRelationships }`; conta solo la prima relazione miniatura; rifiutati
  `TargetMode=External` e i bersagli con segmenti vuoti, `.`, `..` o `\\`;
  una miniatura oltre 8 MiB o in EMF/WMF è `absent`, relazioni rotte o
  troppo grandi `unreadable`, come un docx cifrato; il tipo di pacchetto lo
  dicono le voci e non l'estensione; l'apertura dello ZIP ripete la sequenza
  di `zip_preview` perché `container.rs` è cambiato solo nella visibilità
  (anche `zip_tail.rs` e `craft_files.rs`, fuori dal Tocca); nuova regola di
  case-fold ASCII `office.rs::is_package_extension` in
  `a_named_rule_is_declared.rs`; sulla via dell'host senza lease i documenti
  restano `absent`, come i RAW. Rischi:
  `mounting_external_path_does_not_take_workspace_lock` (3 s) e
  `crossed_moves_take_the_locks_in_one_order` (30 s) sono caduti sotto
  carico e possono cadere in CI; nessuna prova con un docx salvato da Word
  vero, solo pacchetti fatti nei test.
- N7 T11 (9790d2ef): le anteprime con la CLI dopo un gesto, col biglietto.
  Differenze dal piano: `Host::craft_render` accoda con `Host::spawn_job`
  (l'esito arriva con `JobDone`) ed è dietro `#[cfg(feature = "craft")]`,
  perché `CraftPreview` e `PreviewSize` vivono in `fub-format-craft`, che è
  facoltativo: senza la feature il metodo non c'è (il piano lo voleva sempre
  compilato con `host.craft_render.off`); T12 e T23 lo chiamano sotto la
  stessa feature. I biglietti usati, scaduti, di un altro doc o misura, di
  un vault chiuso e il consenso ritirato si provano negli unit test di
  `craft/render.rs` (il biglietto non esce mai); i biglietti di un vault
  chiuso cadono alla riapertura e quando il lettore risulta chiuso; un
  errore di copia o I/O non segna «già provato»; l'offerta `render` vuole la
  CLI trovata e la revisione non già fallita. L'annullamento passa dal
  `JobHost` che smette di servire (il consenso letto dal job non risulta più
  `on`). Rischi: i test di tempo scaduto e annullamento allungano
  `craft_cli` di circa 25 s; `craft::open_with::tests::channel::a_single_ins
  tance_app_is_forwarded_on_its_systems` è caduto sotto carico nel check del
  coder (non toccato, verde da solo); `craft::launch::tests` cade in
  parallelo e passa con un thread solo, dalla base. Niente prova con una CLI
  vera.
- N7 T25 (a7b9223c): i dati dell'XMP di LightCraft sotto la foto. Differenze
  dal piano: acceso o spento si legge dal kernel (`craft.photo` fra i
  comandi), bootstrap passa sempre `photoData`; tre file fuori da «Tocca»
  (desktop-shell.ts per mountCraftPhotos, bench/fake-ipc.ts con
  `?photo=xmp|senza`, bench/photo-fixture.ts); `LABEL_COLORS` e
  `COLOR_NAMES` esportati da xmp-view.ts; la domanda parte dopo che la foto
  è disegnata (o dopo la frase d'errore di TIFF/HEIC); craft-photos ascolta
  anche gli eventi `entry_*` (una foto è una risorsa); il fake host elenca
  `craft.preview` e `craft.photo` col componente acceso; il voto -1 mostra
  «Scartata». Rischi: i RAW non contano come foto (`isPhotoDoc`), T28 deve
  allargarlo; il fake host copia la regola dei candidati XMP; le baseline
  delle 2 scene nuove vengono dal runner; niente prova sull'host vero. Nel
  check, block-id.test (seme fisso) è caduto sotto carico: il campo si
  calcola con l'albero a metà e `ensureSyntaxTree` dopo non lo ricalcola;
  verde da solo, non è di T25.
- 2026-11-03 · N7 · T22 (fd595ce4, cb2bd25e): l'orchestratore ha permesso al
  coder di toccare `craft/preview.rs` (`limit_of`, `over_limit(limit)`,
  `fill(limit)`), perché il tetto per formato vive lì e nessun altro task lo
  possiede ora. `embedded_preview_from` restituisce `Embedded`; il nuovo
  `zip_tail.rs` legge la coda dello ZIP con un budget (`Budgeted`). La
  versione di FigCraft si legge da `document.json` con un tetto di 1 MiB;
  uno ZIP sulla via dell'host senza lease ha un tetto di 64 MiB. Toccata una
  riga di `product/craft-files.md`. La prova da 1 GiB dura circa 33 s;
  `Stale` è provato solo da un test unitario. L'orchestratore ha rimesso a
  misura un commento troppo lungo (cb2bd25e). Check d'integrazione
  `--rapido` verde (21 passi).
- T27 (0284ab88, d8562abf): il coder si è fermato sul filo in
  `craft/preview.rs` (in «Non toccare» per non scontrarsi con T19 e T24, e
  nessun task lo possedeva). L'orchestratore l'ha applicato (una decina di
  righe in `ranged_preview`: un RAW passa da `raw::read_from`, `Stale`
  riprova, ogni altro errore torna alla via dell'host), perché nessun task
  in corso tocca quel file. Il test vecchio
  `a_raw_photo_is_a_subject_from_its_extension` aspettava `absent` per un
  `.CR3` di 9 byte che non è un RAW: ora è `unreadable`, come vuole il piano
  (un `.CR3` che non è un RAW). Differenze dal piano: `JpegRange` ha anche
  `width` e `height`; costanti in più `MAX_BOXES` (10 000) e
  `MAX_CANDIDATES` (64); un JPEG senza perdita (SOF C3, C7, CB, CF) si
  scarta perché sono dati del sensore, un JPEG progressivo si tiene;
  l'orientamento di un RAF viene dall'EXIF del suo JPEG; un ORF dà `absent`
  (le sue anteprime stanno nella MakerNote, che non si legge); il test delle
  «70 000 voci» usa 65 535 e 1001 perché il conteggio è un u16; il cammino
  dei segmenti JPEG ricalca `jpeg::size` perché `jpeg.rs` non si tocca.
  Rischio: provato solo su file costruiti nei test, non su RAW di fotocamere
  vere (resta per T32 e per le prove a mano).
- T24 (a62ce774): craft.photo ha un suo elenco paginato della cartella,
  perché `Folder` sta in preview.rs, che è di T27 (quando T27 lo tocca, le
  due letture si possono unire). Una foto senza XMP dà `photo.missing`
  (NotFound); le chiavi del catalogo sono `cmd.photo` e `cmd.photo.doc`. Un
  XMP troppo grande conta come rotto e una lettura fallita passa al
  candidato dopo; un documento `.xmp` si riconosce da `CraftApp::Xmp` e ha
  modifiche vuote. Rischio accettato e provato da un test: `a.b.jpg` prende
  `a.b.xmp` come secondo candidato, mentre l'anteprima di quell'XMP punta ad
  «a.b» (asimmetria scritta in `docs/reference/xmp-sidecars.md`).
- 2026-11-03 · N7 · T19 integrato (3bda61f1). `craft.cli-previews` è una
  scelta ask/on/off di macchina e non `program_writable` (un bundle riceve
  `PermissionDenied`, un vault importato non la cambia); i valori vecchi
  (true, false, "forse") valgono `ask` per la regola di risoluzione del
  kernel, senza migrazione, e il valore salvato resta com'è.
  `consent::current` e `consent::max_bytes` per T11 e T22. Allargato a `fub-
  cli/src/login.rs`: `config --set` prende la specie dallo schema (prima
  `on` diventava un interruttore e la scelta veniva rifiutata), con un test
  unitario e uno e2e. Restano: le 2 baseline della scena `settings-external-
  apps` (chiara e scura) vanno prese dal runner in T32, e fino ad allora
  `bench/scene.test.ts` resta rosso in locale e in CI; `cargo test -p fub-
  host --no-default-features` non compila già alla base (import di
  fub_features), da guardare in T32; `fub-wasm-
  host::the_instance_and_the_turn::an_index_feed_and_a_job…` è caduto dopo
  353 s sotto il carico di tre build ed è verde da solo.
- 2026-11-03 · N7 · T21 integrato (921de8db il lettore nel kernel, 30038ed9
  le anteprime a pezzi, 14a0947d lo scrittore di fuori). Il kernel ha
  `ResourceReader` (`Workspace::resource_reader()`): apre e legge le lease
  fuori dal lucchetto del workspace, con un `AtomicBool` che `prepare_close`
  spegne; fub-host lo passa ai comandi Craft con `Registrar::craft_reader()`
  (pub(crate), solo con la feature `craft`). Differenze dal piano:
  `mount.rs` non toccato; i percorsi delle lease rispondono `revision: null`
  per RAW, PDF, documenti e file oltre il limite; senza lettore si ricade
  sul percorso dell'host; il caso /etc/passwd tolto (la / iniziale si
  toglie). Rischi: il lettore non passa dal Guard di `HostApi` (A14, come
  `fub-asset:`): va ricordato nella revisione di T32; la ricaduta è provata
  solo con MemoryHost; `ranged::revision` resta inutilizzato fino a T11.
- 2026-11-03 · N7 · T10 integrato (279c1859): Started.channel è
  Option<Arc<Channel>> e si usa fuori dal lucchetto del registro; gli errori
  sono off=Unserved, unknown_editor e wrong_kind=BadArgs, not_installed e
  missing=NotFound, launch_failed=Io; su macOS la pagina va dopo --args di
  open; senza il programma flatpak l'errore è launch_failed; sul canale page
  si ignora · InRunning non scatta con nessuna delle sette app (nessuna ha
  un canale col token, D-2) ed è provato solo con un editor di prova nei
  test unitari.
- 2026-11-03 · N7 · T20 integrato (ecf05750 lo spostamento, 1c3ed3df la
  forma 2): il parametro render resta dichiarato e invoke lo ignora, perché
  senza la dichiarazione l'host rifiuterebbe una domanda della versione 1;
  craft.preview non avvia mai l'app, quindi la shell non chiede più
  l'anteprima da sola e il pulsante richiede soltanto; unreadable e failed
  mostrano craft.no_preview finché le frasi non arrivano in catalog.ts; un
  file che comincia col punto (.pdf) non ha soggetto · le foto T14/T15 sono
  15 su 16 uguali, xmp-dark-1280 cambia 10 pixel dell'angolo arrotondato di
  1–2 livelli, contenuto identico.
- 2026-11-03 · N7 · T9 integrato (d331e67f): Framing è lo stesso tipo di
  Protocol di T7, Channel::new restituisce io::Result perché il token può
  mancare, Channel::for_control decide con un match esaustivo su Auth,
  l'autenticazione è {method: auth, params: {token}} scritta solo in
  auth_request · il formato non è documentato dalle app, così si cambia in
  un punto solo; T10 prende il token da Channel::token.
- 2026-11-03 · N7 · T8: l'avvio sta in `craft/launch.rs`; il gruppo di una
  CLI si ferma con `rustix::process::kill_process_group` (la feature
  `process` di rustix, che cap-primitives accendeva già: nessun crate nuovo
  e Cargo.lock uguale), anche dopo un'uscita normale; il registro delle
  uscite è `on_exit(pid, callback)` più `running(pid)`; un programma con un
  percorso non assoluto è `NotFound`, mai una ricerca nel PATH; un'uscita da
  segnale è `Failed(-segnale)`; il filtro `FUB_` su Windows non distingue il
  maiuscolo (la sua voce in `a_named_rule_is_declared`). Restano scritti
  nella pagina: su Windows il tempo ferma solo la CLI e non i suoi figli
  (servirebbe un job object, cioè windows-sys, una dipendenza nuova), e una
  CLI lasciata da Fub che esce arriva in fondo da sola · un programma
  esterno non passa mai da una shell e non lascia processi dietro di sé.
- 2026-11-03 · N7 · il prototipo delle anteprime (T18) è approvato così
  com'è, con le sei scelte da decidere guardando come le propone (le due
  risposte con lo stesso peso, le miniature da 16 px, la tendina, le parole
  chiave su tre righe che poi scorrono, la riga dei dati senza etichette
  scritte, il PDF con filo e ombra); D-10 (a), le cinque cose restano fuori
  · parole dell'utente («si, mi piace» e «si»); T19, T23, T25, T26, T28 e
  T31 possono partire quando tocca a loro.
- 2026-11-02 · N7 · Le risposte dell'utente a D-1…D-9: D-1 (b), le anteprime
  fatte dalle app spente finché chi usa Fub non le accende, con la domanda
  la prima volta («Chiedi la prima volta», non un permesso dei plugin), e
  un'app parte solo dal core, per la shell principale, dopo un gesto, col
  biglietto del job (T11, T12, T19, T23); D-5 (d), i dati dell'XMP anche
  sulla foto e un'impostazione per nascondere gli `.xmp` dall'albero
  (T24–T26); D-7 (d), le miniature nell'albero dietro un'impostazione
  spenta, che non avviano mai un'app (T26); D-8 (c), per l'anteprima Fub
  legge solo il pezzo che serve con le lease del kernel, senza porte nuove
  nell'ABI, e i 64 MiB restano per ciò che va letto intero come impostazione
  (T21, T22); D-9 (c), N7 comprende i RAW, PdfCraft e WordCraft (T27–T31) e
  si chiude con la CI completa e la revisione (T32); il contratto
  `CraftPreview` passa alla versione 2 in un task solo (T20), con `revision`
  vuota per ciò che si legge a pezzi; il prototipo
  `PLAN-ui/craft-anteprime.html` va approvato prima dei task che si vedono
  (T18); D-10 nuova, il piano segue la (a) · avviare un programma è
  un'azione e la decide chi usa Fub, non un plugin, un agente o un file
  riaperto; un file grande non deve costare la sua lettura intera, e una
  forma che cambia una volta sola non lascia la shell e l'host a parlare due
  lingue.
- 2026-11-02 · N7 · T15: la figura di un file Craft in una nota e nella
  finestrella al passaggio (`editors/craft/figure.ts`) chiede sempre
  `render: false`: un test in ognuno dei tre file lo controlla. Un embed da
  solo nel paragrafo ha già la didascalia K10, come i disegni, quindi la
  figura non ne aggiunge una seconda e il riquadro senza anteprima non
  ripete il nome; la didascalia propria compare solo nella finestrella e in
  un embed dentro una riga. Il clic nella nota apre il file con
  `openWikilink` (se non riesce, `preview.open_failed`); nella finestrella
  la figura non ha clic, come il resto. Niente CSS nuovo: il riquadro usa
  `.image-missing`, l'immagine le regole delle immagini della nota. Perché:
  un'anteprima in una nota non deve mai avviare un'app.
- 2026-11-02 · N7 · T14: la scheda dei file Craft e degli XMP è in sola
  lettura (`editors/craft/`). Con l'anteprima si vede nella vista delle
  immagini con la riga dei dati sotto; senza, la riga dei dati sta dentro il
  riquadro (niente riga doppia), con lo stato e il pulsante «Crea
  l'anteprima con …». L'anteprima con `render: true` si chiede da sola una
  volta per montaggio della scheda (D-1, prima opzione). Lo store
  `state/craft-previews.ts` si monta da `desktop-shell.ts` come
  `mountLinkCards` (un file fuori dal «Tocca», una riga). Il componente
  spento si riconosce dall'errore `unknown_command` e mostra «Nessuna
  superficie disponibile». Le etichette XMP sono tradotte (Red → «Rossa»);
  il tetto di 64 MiB e la regola dei tag sono quelli di `xmp.rs`. Restano
  fuori: la Struttura mostra lo schema della nota precedente su un file
  Craft, e il toast generico dei job scrive l'id grezzo `craft.render`.
  Perché: un file Craft si guarda in Fub e si cambia nella sua app.
- 2026-11-02 · N7 · T7: il registro delle sette app Craft sta in
  `craft/editors.rs` e trova i programmi senza mai avviarne uno (un test lo
  controlla). `Env` ha in più `root` (`/` fuori dai test), per provare
  `/usr/bin` e `/Applications` su una cartella finta. `detect` dà una riga
  per ognuna delle 7 app, con `How::Missing` per quelle che non trova. Una
  riga di `craft.editor-paths` che punta a un file sparito non ferma la
  ricerca: si passa ai posti standard. Per gli AppImage il nome va seguito
  da `-`, `_` o `.` e deve finire in `.AppImage`; i `-cli` sono esclusi, e
  fra più file vince il nome più grande in ordine di byte. La cache di 30 s
  (`FindCache`) si rifà da sola quando cambiano l'ambiente o le righe. I
  nomi dei campi di installed.json vanno confermati con un file vero.
  Perché: «Apri con» deve sapere quali app ci sono senza lanciare niente.
- 2026-11-02 · N7 · T6: il bundle fub.craft sta in fub-host dietro la
  feature `craft`, nel default, sul modello di LinkCardBundle; il comando
  craft.preview è in sola lettura e il job craft.render per ora risponde
  «niente CLI» (lo riempie T11). I test dell'inventario e delle estensioni
  conoscono fub.craft. Il check è rosso solo per i due test a tempo di fub-
  services (stalled publish/vault), che rilanciati da soli passano. Perché:
  il formato si monta come gli altri componenti e si spegne con la sua
  feature.
- 2026-11-02 · N7 · T5: un file a byte che non sa riscriversi (provider
  assente o `Ok(None)`) non ferma più la rinomina;
  `invoke_prepared_link_rewrites` restituisce `PreparedLinkRewriteOutcome {
  edits, unwritable_bytes }`, le righe «un file a byte non si riscrive, il
  link punta ancora a …» passano per Parsed/Pending/Completed in
  `stale_byte_links` e si aggiungono ai `rewrite_failures` solo in
  `finish_*`, così l'intent di recupero si chiude; l'unione di note
  (`PreparedLinkRetarget::edits`) invece si ferma ancora con l'errore di
  prima · D-3 (a): la rinomina si fa e Fub avvisa; nell'unione non c'è una
  rinomina già fatta a cui appendere l'avviso, e si cestinerebbe un file a
  cui il link punta ancora.
- 2026-11-02 · N7 T4 · `linked.rs` prende come file collegati i valori
  stringa dei campi `href`, `src`, `path`, `file`, `uri` e `link` a ogni
  profondità fino a 64 livelli, al massimo 1000 senza doppioni, ripuliti
  come un URL e senza la parte da `#` o `?`; in un file Craft un percorso
  che comincia con `/` è del disco e si scarta come `C:` e gli schemi, a
  differenza dei disegni SVG dove `/` è la radice del vault; il `%20` resta
  scritto e lo decodifica il kernel; Fub non riscrive mai il file Craft
  quando il file collegato si sposta; integrato dopo T2, perché i suoi test
  vogliono il documento vero di `read_meta`.
- 2026-11-02 · N7 T2 · `container.rs` legge i tre contenitori con un tetto a
  ogni lettura: prima di aprire uno ZIP conta le voci che dichiara la fine
  della directory centrale (anche ZIP64), poi ricontrolla quelle aperte,
  così un file ostile di 64 MiB non fa leggere un milione di voci; una voce
  che si dichiara piccola e si scompatta grande la ferma il crate zip (CRC,
  NotZip) e dopo il `take`; fra le due anteprime di un `.pcraft` si passa
  alla riserva anche quando la voce c'è ma non è un PNG o è troppo grande;
  il base64 di `/preview/data` accetta il riempimento mancante e gli a capo
  e ha il tetto sulla stringa e sul decodificato; titolo e versione vuoti
  contano come assenti; il testo si raccoglie con una pila, non per
  ricorsione; il documento di FigCraft e VectorCraft sta in `Contents.json`,
  che serve ai file collegati di T4; il modello del documento non ha un
  posto per la versione, che si legge da `read_meta`.
- 2026-11-02 · N7 T3 · `xmp.rs` legge `xmp:Rating`, `lc:label`, `lc:flag`
  (pick, reject, none) e `dc:subject` dalle forme attributo ed elemento, con
  un lettore XML ristretto: le entità non predefinite non si espandono mai e
  il DOCTYPE si ignora, così un XMP ostile non gonfia la memoria; un voto
  scritto "5.0" vale 5; l'URI dello spazio `lc:` e i valori di `lc:flag`
  vengono dal piano e vanno confermati con un XMP vero di LightCraft, perché
  nel repo non ce n'è uno.
- 2026-11-02 · N7 T1 · il crate `fub-format-craft` con i quattro provider a
  byte in sola lettura, `CraftApp` (con `id()` ed `editor_name()` in più del
  piano) e il contratto `CraftPreview` v1 con la gemella TS `host/craft.ts`
  legata dalla fixture `craft-preview.json` (UPDATE_MIRROR=1); `revision` è
  `fub_abi::Revision`, in JSON una stringa; il lettore TS accetta solo
  `image/png`; le costanti dei limiti stanno in container, xmp e linked per
  T2–T4; nel grafo di `overview.md` il crate ha un blocco suo, perché il
  primo superava 20 nodi · i provider non sono ancora registrati: chi usa
  Fub non vede niente finché non arriva il task che li monta.
- 2026-11-01 · regole · L'orchestratore e i coder decidono da soli il come
  tecnico, i formati interni, le dipendenze fra crate del workspace e i file
  legati al task; «Chiede sempre» resta per ciò che si vede, il contratto
  pubblico, sicurezza, dipendenze esterne, scope, test e merge; il criterio è
  il risultato migliore, non la strada più corta · fonte: l'utente («mi stai
  facendo troppe domande … ti voglio più autonomo»; «voglio sempre ottenere il
  risultato migliore, non importa se ci mettiamo più tempo o più risorse»).
- 2026-11-01 · K1 · L'assunzione A2 era sbagliata: un campo in coda a un
  record rompe i plugin compilati prima (il guest a undici campi del manifest
  non si istanzia nell'host a sedici); `0.2.0` non è pubblicata e K1 resta, ma
  dal primo rilascio un record pubblicato non cresce e le novità passano da
  interfacce nuove · fonte: prova dell'orchestratore con `ping-wasm` compilato
  su `d235d3f6`, decisione con l'utente; ADR 0235. Fuori dal Tocca, con
  l'OK dell'utente: la riga dell'esempio in `exclude` del `Cargo.toml` della
  radice e la frase sull'additività in `docs/architecture/document-model.md`.
- 2026-11-01 · K1 · Via MCP accendere e spegnere un componente con `apply`
  vogliono tutto il vault fra le radici di scrittura, come un piano che non
  dice quali note tocca: un componente cambia il comportamento di tutto il
  vault · fonte: revisione dell'orchestratore su T4 (il coder chiedeva una
  radice qualsiasi); ADR 0234.
- 2026-11-01 · K1 · `fub-cli` dipende da `fub-componenti` (con la freccia nel
  grafo di `overview.md`): i tipi del risolutore (`Stato`, `Effetto`,
  `Perche`, `Errore`) non sono riesportati da `fub-features` e la CLI li
  usa nelle firme e nei `match` · fonte: blocco del coder di T4, scelta
  dell'orchestratore (l'alternativa toccava `fub-features`, fuori dal Tocca).
- 2026-11-01 · K1 · La mappa vera (`fub-features::componenti`): le righe
  senza feature Cargo sono 7, non 4 (anche `fub.core`, `fub.maintenance`,
  `fub.importers`, che oggi si compilano sempre); `SOLO_DELLA_MAPPA` è
  `fub.markdown`, `fub.dizionari`, `fub.penna` e i due motori, ognuno col suo
  perché; una feature marcatore nuova `http-client` per le righe di sync,
  publish, updates e linkcard; `rich` e `xlsx` portano con sé i loro motori ·
  fonte: report del coder di T3; il codice vince sul «Fatto quando» del piano.
- 2026-11-01 · K1 · I requisiti che esistono solo per la mappa
  (`fub.markdown`, `fub.dizionari`: nucleo e componenti senza bundle) stanno
  nella riga di `fub-features::componenti`, non nel manifest; il manifest tiene
  i `requires` di oggi, perché il kernel soddisfa un requisito solo col
  `provides` di un bundle montato (`provider_of`) · fonte: risposta
  dell'utente al blocco del coder di T3; altrimenti le feature delle note non
  si monterebbero più.
- 2026-11-01 · K1 · T3 tocca anche i due blocchi di `mount.rs` che montano
  `fub.rich` e `fub.xlsx` fuori dal ciclo ufficiale (~376–404), solo per i
  campi della riga; righe anche per `fub.core` e `fub.maintenance` (il nucleo
  deve avere una riga); `fub.draw` resta fuori dal `default` come oggi e non
  richiede `fub.markdown` · fonte: risposta dell'utente; il resto deciso
  dall'orchestratore (il codice vince).
- 2026-11-01 · K1 · `Delivery` nel JSON è un enum con tag interno `kind`
  (`{"kind":"download","url":…}`), e la validazione di `fub-wasm-host` accetta
  lo sha256 in esadecimale maiuscolo o minuscolo; la conversione WIT → Rust di
  0.2.0 sta in `translate.rs`, `compat.rs` (ABI legacy) prende i default ·
  fonte: report del coder di T1.
- 2026-11-01 · K1 · Le regole di `fub-componenti` che il piano lasciava aperte:
  un requisito offerto via `provides` da più componenti è un errore della mappa
  (`RequisitoAmbiguo`); `attivi` segue i `requires` anche dal nucleo;
  `applica_profilo` svuota `in_attesa`; `Richiesto { da }` elenca i dipendenti
  a catena, e `spegni_con_dipendenti` dà `Nucleo` se la catena lo tocca;
  `perche` ha anche `Nucleo` e `Sconosciuto` · fonte: report del coder di T2,
  accettato dall'orchestratore; chi costruisce la mappa (T3) non può dichiarare
  due offerenti dello stesso requisito.
- 2026-11-01 · K1 · T1 tocca anche `crates/fub-abi/src/lib.rs` (`ComponentKind`
  e `Delivery` nel `pub use`, per `superficie_della_radice`) e
  `apps/client/src/host/enums.generated.ts`, solo rigenerato con
  `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums` · fonte: risposta
  dell'utente al blocco del coder; un enum senza payload in `fub-abi` porta
  sempre con sé la sua riga nel derivato TS.
- 2026-11-01 · K1 · Le PR #261–#269 (N13, N1, N2, K0) sono tutte in `main`:
  #269 è stata unita con lo stack intero, le altre chiuse perché contenute,
  #264 unita il 31/10 · fonte: `gh pr list`; nessun task di K1 aspetta una PR.
- 2026-10-31 · K0 · Il livello 3 della consegna sono le **edizioni**; niente
  librerie caricate a runtime (ADR 0233) · fonte: `piani/STATO.md`, risposte
  del 31/10 mattina; in K1 è il caso `Delivery::Edition` del manifest.
- 2026-10-31 · K0 · La tolleranza di R1 sta in
  `apps/client/bench/webview/budgets.json` (residuo 50 MiB, pendenza 1 MiB a
  giro; nella CI 480 e 20) · fonte: `piani/STATO.md`; è il metro di «spento non
  costa» per i task che misurano.
- 2026-10-31 · N2 · Il server MCP sta in `fub-cli mcp` sulla stessa
  `Connection` (passa dall'app se tiene il vault), protocollo scritto a mano
  (stdio, JSON-RPC sincrono), niente `rmcp` (ADR 0232,
  `docs/reference/mcp-server.md`) · fonte: `piani/STATO.md`; gli strumenti
  nuovi (i componenti di K1) seguono la stessa forma e i nomi `fub_*`.
- 2026-10-31 · N2 · Senza `--automation-write-root` il server è in sola
  lettura; senza `--automation-read-root` si legge tutto il vault;
  `fub_invoke` senza `apply` è una prova · fonte: `piani/STATO.md`; vale anche
  per accendere e spegnere componenti via MCP.
- 2026-10-30 · tasto destro (piano 2) · Le parole dei componenti sono
  Accendi, Spegni, Serve a…, Non serve più, Togli, Tienili, «Accendi…»; regola
  12: un componente spento non ha voci · fonte: `piani/STATO.md`; K1 le usa
  nei testi della CLI, K2 nel client.
- 2026-10-31 · piani · Le domande aperte dei piani seguono il loro
  «Consiglio» se l'utente non dice altro · fonte: `piani/STATO.md`,
  «Questions for the user».

- 2026-10-31 · workflow · Il piano vive in `PLAN.md` (e il prototipo in
  `PLAN-ui/`) sul branch del piano, e se ne va con l'ultimo commit prima del
  merge · una sessione sul web vede solo ciò che è su GitHub; dopo il merge
  restano il codice e questo registro.
- 2026-10-31 · workflow · Una PR in bozza ha la CI corta (Linux); segnata
  pronta ha la CI completa. I banchi del client girano sulle PR pronte solo se
  cambia `apps/client/`; su `main` gira sempre tutto · Windows, macOS e banchi
  costano tanto e servono una volta per piano, prima del merge.
- 2026-10-31 · workflow · I coder non lanciano altri agenti, non pushano e non
  toccano la CI; pusha solo l'orchestratore, una volta per task unito · un solo
  punto che integra, e la CI di ogni push copre tutto ciò che c'è prima.
