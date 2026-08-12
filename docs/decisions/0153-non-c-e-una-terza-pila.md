# 0153 — Non c'è una terza pila, e il prezzo di non averla è il metro per averla

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §26.8 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.8](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#268-la-terza-pila-lannulla-dentro-una-view-che-non-è-del-core)
chiedeva se una view di terzi con stato manipolabile — un canvas, una griglia —
possa avere il proprio annulla, e chi arbitri fra le pile quando i fuochi
possibili diventano tre.

## La premessa, rimisurata

Rimisurata a `45ccb13`.

- **Le pile sono due e nessuna variante ne porta una terza.** `ViewUpdate` ha
  sette varianti — `Replace`, `None`, `Navigate`, `Reveal`, `RunSearch`,
  `Custom`, `Patch` — e nessuna è un annulla.
- **La strada che c'è funziona davvero, e va detto perché non è ovvio.** Una
  view invoca `run-command`; il workspace mette in pila l'inverso di un comando
  quando `mode == InvokeMode::Apply` **e** `self.providers.command_stack` è
  vuoto (`crates/fub-kernel/src/workspace.rs`). Una view che invoca dall'esterno
  di un comando è esattamente il caso a pila vuota: il suo passo **entra**. La
  forma (b) non è una speranza, è una misura.
- **Il redo non c'è, e le quattro righe che lo nominano dicono tutte che non
  c'è** (`grep -rn '\bredo\b' crates/` → quattro, tutte prosa). Nel testo
  esiste, ma per via di `historyKeymap` dentro `basicSetup`: è una libreria, non
  una decisione di questo repo.
- **`CommandOutcome.undo` attraversa l'IPC e nella shell non lo legge
  nessuno.** Le occorrenze di `.undo` fuori da `host/contract.ts` sono tre e
  sono tutte presidi (`__fixtures__/command-keys.json`, `ui/commands.test.ts`,
  `host/mirror.test.ts`). L'utente ha `Mod-Alt-z` e nessun modo di sapere che
  cosa disferà.
- **Il tasto, comunque, non arriva.** Nei due registri dichiarati nessun comando
  rivendica `Mod-z`; il registro di `basicSetup` ce l'ha, e sotto una view
  montata su `main` il tasto scende all'elemento col fuoco e non lo raccoglie
  nessuno. Questa metà non è di questa voce: è la prima delle due porte
  dichiarate in `plugin-boundary.md`, ed è una **precondizione** della (a) che
  la (a) non porta con sé.

## La decisione

**(b): nessuna terza pila. Una view di terzi che vuole il proprio annulla
compone comandi**, e ogni comando dichiara il proprio inverso come tutti gli
altri.

Non è la forma che costa meno: è la sola per cui esista un cliente. Il campo su
`view-spec` della forma (a) è additivo — non scade col freeze
(`wit_additivity.rs`) — e aggiungerlo oggi vorrebbe dire scriverlo per una terza
superficie che non esiste, che è precisamente ciò che la
[0013](0013-elenco-delle-capacita.md) vieta. Peggio: la (a) **obbliga a scrivere
l'arbitro del fuoco**, che la [0045](0045-l-undo-ha-due-pile.md) ha enunciato
(«a decidere quale risponde è il fuoco») senza doverlo mai implementare, perché
con due pile e due superfici la risposta era ovvia. Scrivere un arbitro per un
terzo contendente immaginario vuol dire fissarne la regola prima di aver visto
un caso in cui sbagli.

**Il prezzo della (b) è dichiarato, ed è il metro della decisione contraria.**
Ogni view che vuole un annulla proprio deve chiedere `fub:run-command`, il
permesso che la [0021](0021-il-confine.md) chiama *«quello che moltiplica»*, e
i suoi passi si siedono nella pila del kernel accanto alle operazioni sul vault,
sotto lo stesso tetto di cento. Non è gratis e non si finge che lo sia: è il
conto che rende **misurabile** il momento della (a). Il giorno in cui tre view
di terzi avranno dovuto chiedere quel permesso solo per fare `Ctrl+Z`, la (a) si
sarà pagata da sé — e sarà la stessa forma di prova che questo repo ha già usato
per il secondo chiamante, contata invece che immaginata.

**Il lavoro portato è il fatto scritto dove ci si inciampa**, che è la lezione
della [0147](0147-il-contratto-osserva-dopo-e-non-si-interpone.md): il doc di `ViewUpdate` e quello
di `variant view-update` dicono adesso che nessuna variante porta un annulla e
perché, e `plugin-boundary.md` lo dice accanto alle due porte della superficie
di scrittura — che è il punto in cui un terzo si ferma a chiedersi se può, e
dove finora avrebbe trovato la risposta solo per la tastiera.

**Presidio: nessuno, e la ragione è che sarebbe sbagliato.** Il solo banco
possibile per un «non si aggiunge» è un lucchetto sulla forma del record, come
quello che la [0152](0152-il-bersaglio-di-un-clic-non-e-uno-stato.md) ha messo
su `ViewContext`. Lì era giusto perché quel record ha una ragione dichiarata per
restare di quattro campi; qui sarebbe un ostacolo, perché `view-spec` **deve**
poter crescere per altri motivi — la 0150 ha appena stabilito che una superficie
nuova è la mossa additiva prevista. Un lucchetto che diventa rosso per la mossa
giusta è peggio di nessun lucchetto.

## Le forme scartate

- **(a) Il fuoco decide, e la view lo dichiara** — scartata sopra: nessun
  cliente, e obbligherebbe a scrivere l'arbitro del fuoco al buio. Resta
  additiva e riapribile per sempre; ciò che si irrigidisce è la posizione del
  campo, che è cosmetica.
- **(c) Il redo come seconda pila del kernel** — non risponde alla domanda: un
  canvas non chiede il redo *delle operazioni sul vault*. E il pezzo che la 0045
  aveva rimandato — chi invalida la pila del redo — resta da decidere lì, non
  qui.
- **(d) `ViewUpdate::Custom` con un `ns` privato** — tre pezzi cablati (un `ns`,
  un ramo `if` nella shell, e una shell che deve sapere chi ha il fuoco) per un
  gesto che la [0009](0009-registro-dei-comandi.md) dà gratis a qualunque
  comando. È il `Custom` come strada unica che la
  [0019](0019-il-canale-dati.md) ha già chiuso.

## Cosa resta scoperto

- **`Ctrl+Z` dentro una view di terzi continua a non fare niente**, e la (b) non
  lo cambia: l'annulla di una view composta di comandi si invoca dalla palette.
  La porta che manca è **l'evento di tastiera**, che sta scritta in
  `plugin-boundary.md` e non in questa voce.
- **`CommandOutcome.undo` non lo disegna nessuno.** Il campo attraversa l'IPC,
  la shell lo rispecchia, e l'utente non vede mai «Annulla: rinomina di
  Nota.md». Il corpus lo chiede per nome (`app-e-piattaforma.md:19`); è lavoro
  di shell, non una domanda di contratto, e questo verbale non lo fa.
- **Il redo delle operazioni non c'è**, e adesso un cliente scritto ce l'ha
  (`canvas-e-database.md:27`, `block-editor-parita.md:98`). La 0045 lo aveva
  messo fra le cose scoperte «perché nessun cliente l'ha chiesta»: quella
  ragione è caduta, la cosa resta scoperta, e la regola che la 0045 rimandava —
  che cosa invalida un redo — è ancora da scrivere.
- **Un indirizzo morto, raccolto.** La 0045 scriveva che le mutazioni fuori dai
  comandi sarebbero entrate in pila «il giorno che diventeranno comandi
  (§18.2)», e la §18.2 si è chiusa dichiarando che di lei non restava niente. È
  lo stesso incidente della keymap dell'editor (0081 → §18.2), ed è la seconda
  volta che questa seduta lo incontra: la busta è persa, il debito no, e da oggi
  l'indirizzo è questo verbale.
