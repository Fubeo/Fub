# 0166 — Il banco che vede, e il primo difetto che ha visto

**Stato**: accolta **Data**: 2026-08-19 **Chiude**: [§31.1](../roadmap/31-da-dove-viene-cio-che-si-vede.md)
**Commit**: *(questo commit)*

---

## La domanda

La [seduta 31](../roadmap/31-da-dove-viene-cio-che-si-vede.md) si è aperta con
una constatazione: dei quattro presidi del tema, tre leggono i CSS **come
testo** e il quarto conta gli elementi montati in un DOM finto. È la scelta
giusta per ciò che provano — un rapporto di contrasto è aritmetica, non
rendering — e lascia scoperta esattamente la specie di difetto che le altre otto
voci vanno a cercare: un gradino che non si vede, un allineamento che salta,
un'ombra che non stacca. L'unico oracolo visivo era aprire l'app.

La domanda di questa voce è quindi: **come si guarda ciò che si vede, in un modo
che lasci un «prima»?** Senza un «prima» le otto tappe che seguono possono
dimostrare di aver *cambiato* il tema e non di averlo *migliorato*, che è la
differenza fra un rifacimento e una seduta.

## Un secondo ingresso, non una seconda shell

**Il banco monta `index.html` vero e `main.ts` vero, e sostituisce due moduli
soli.** La cucitura è la stessa che il [§1.3](../roadmap/01-forma-della-shell.md)
ha già ridotto a un file: `src/host/ipc.ts` e `src/host/dialog.ts` sono gli unici
moduli che parlano con `@tauri-apps`, e sono anche gli unici due che il banco
scambia.

Lo scambio è un plugin di Vite con `resolveId` e non un `resolve.alias`, e la
ragione è misurata: quei due moduli sono importati con path **relativi** da
tredici punti diversi, a profondità diverse. Un alias è una regola sul testo di
un import — `../host/ipc` e `../../host/ipc` sono due testi — e sarebbe stata
una regola che funziona finché nessuno sposta un file. `resolveId` risolve prima
e confronta **il file risolto**, che è la cosa di cui si stava parlando.

Nessuna riga di produzione cambia, e non è cortesia: il presidio
`no-tauri-outside-host.test.ts` legge i sorgenti di `src/` e resterebbe verde
comunque, ma un banco che avesse bisogno di un gancio nel codice della shell
starebbe fotografando una shell diversa da quella che si spedisce.

Che il montaggio sia finito lo dice `main.ts`, che esporta `avvio` da prima: il
banco lo aspetta e timbra `document.documentElement.dataset.banco = "pronto"`.
Non c'è nessuna attesa a tempo in tutto il banco — ogni attesa è una condizione,
e dove non ce n'era una si è scritta.

## L'host finto non basta, e il perché è una regola sua

`creaHostFinto` ha una regola terza — *ciò che non sa fare **lancia*** — che è
giusta per il test end-to-end e sbagliata per una fotografia: un test vuole
sapere che una porta non è cablata, una foto vuole una schermata piena. Il banco
non l'ha ammorbidita, perché ammorbidirla avrebbe tolto la garanzia anche a chi
la usava bene. Ci ha messo sopra una **scenografia**: un vault fisso, un elenco
di comandi, sei impostazioni, quattro risposte al canale dati, sei alberi di
`UiNode` per le view. Ciò che la scenografia non nomina passa all'host finto
intatto, regola del lancio compresa.

Il corpus è fisso e sta in repo, generato dove sarebbe stato lungo: la nota da
diecimila parole nasce da un generatore con seme, perché mezzo megabyte di prosa
in un file `.ts` è un file che nessuno rilegge mai più.

## La stabilità è sei decisioni, e una l'ha insegnata la prima corsa

Un banco visivo che sfarfalla si spegne da solo: il rosso che si impara a
rilanciare finché non passa è il momento in cui ha smesso di servire. Le
decisioni sono scritte una per una in `banco/palco.mjs` — caratteri attesi
(`document.fonts.ready`, due volte: prima e dopo i gesti), ora congelata, moto
ridotto acceso, viewport e fattore di scala fissi, cursore dell'editor nascosto,
baseline solo Linux.

La sesta è arrivata dalla prima corsa e non da un ragionamento: **il locale**.
Chromium headless dice `en-US`, la shell risolve la lingua da
`navigator.language`, e il banco stava fotografando un'app in inglese
convintissimo di ritrarre quella italiana. Sta scritta accanto alle altre cinque
con la nota di come si è saputa.

E c'è una misura che non è una configurazione: **uno scatto vale solo se è
uguale a sé stesso.** Il fotografo scatta, aspetta, riscatta, e accetta solo
quando i due sono identici byte a byte. È la sola cosa che distingua «il tema è
cambiato» da «questa scena non sta ferma», e senza di lei la seconda si presenta
come la prima.

## Il primo difetto l'ha trovato prima di scattare

Tre scene non stavano ferme, e nessuna delle tre per colpa del banco.

La prima era il centro attività. Il movimento erano settanta pixel in una
striscia alta due: la barra di un lavoro **senza conteggio**, cioè una
`<progress>` indeterminata. Una `<progress>` resta un widget del **sistema
operativo** finché qualcuno non dice il contrario, e un widget del sistema
operativo dentro un'app tematizzata è tre difetti in uno: non segue `--accent`,
si dipinge diverso su ogni macchina, e da indeterminata si anima **anche** con
`prefers-reduced-motion: reduce`, perché quell'animazione non è CSS — è il motore
nativo, e una preferenza CSS non lo raggiunge.

Il terzo è quello che l'ha fatta trovare. Gli altri due c'erano da prima e non
li vedeva nessuno, perché sulla macchina di chi guardava il widget nativo era
grigio e piccolo come il resto. `appearance: none` più le due pseudo-classi dei
due motori porta la barra dentro il tema e, insieme, spegne l'animazione: è la
riparazione, e sta in `pelle.css` con scritto accanto come è venuta fuori.

La seconda era il grafo, che si raffredda da solo ma più lentamente della
finestra in cui il fotografo verifica la quiete — e in mezzo ha un **secondo
inquadra** che riparte proprio quando la prima quiete sembrava arrivata. Non si
è allungata l'attesa dello scatto (allungarla vuol dire spegnere la misura): si
aspetta la condizione, due fotogrammi del canvas identici.

La terza erano le due scene che aprono una nota, e il difetto era nel banco:
`:has-text()` di Playwright risale agli **antenati**, e in un albero l'antenato
di una nota è la sua cartella, che contiene il testo di tutti i suoi figli. Il
primo `li` che «contiene *Sintassi di Fub*» era la cartella. L'esploratore mette
il path in `title` su ogni riga: è una chiave, e una chiave non si somiglia — si
eguaglia.

## Il contrasto reso è una seconda misura, non la stessa altrove

`src/theme/contrast.test.ts` legge i fogli come testo e verifica le coppie che il
tema promette. È una misura sulle **intenzioni**, ed è l'unica che possa dire
*quale token* è sbagliato. `banco/a11y.mjs` fa girare `axe-core` sulla pagina
vera, negli stessi gesti e con lo stesso corpus. Le due condividono l'aritmetica
— `src/theme/contrasto.ts`, estratto apposta, perché due misure della stessa
promessa non devono avere due formule — e non condividono l'occhio.

Che non sia la stessa misura fatta due volte lo dicono le cinque coppie sotto la
soglia che sono venute fuori. **Sono tutte e cinque nella luce chiara**, che è
metà della ragione per cui questo banco fotografa in due luci: lo scuro è il tema
in cui si lavora, quindi è quello che qualcuno guarda tutti i giorni. E tre delle
cinque la tabella dei token non poteva vederle:

- `--syn-name` sulla **riga attiva** invece che sul fondo del documento. La
  tabella misura ogni specie di sintassi contro `--doc-bg`, che è l'unico fondo
  che sappia esistere; la riga sotto il cursore ne è un altro, e lo si scopre
  guardando dove il testo è finito.
- `--doc-heading` su `h3`, `h4`, `h5`. Alla coppia la tabella chiede 3:1 e non
  4,5:1 perché «un titolo è testo grande»: vero per un `h1`, falso dal terzo
  livello in giù, dove il corpo torna quello del testo. È un'assunzione che si
  può fare solo **prima** di rendere.
- `--doc-link` sopra `--doc-fill`, che è `rgb(135 135 135 / 16%)`: un **velo**,
  non un colore. La formula dei token si rifiuta — giustamente — di misurare ciò
  che ha un alpha, perché senza sapere cosa c'è sotto il numero sarebbe
  inventato. Il browser lo sa, perché sotto ci ha già dipinto: questa coppia è
  strutturalmente invisibile al presidio dei token, e non lo sarebbe diventata
  cambiandolo.

Le altre due sono la tavolozza di sintassi, debito **già dichiarato** in
`contrast.test.ts` con la sua ragione, che paga la
[25.1](../features/25-accessibilita-localizzazione.md).

Tutte e cinque stanno in un `DEBITO` che ha la stessa forma del `SOTTO_AA` di
`contrast.test.ts`, e per la stessa ragione: un elenco, non un'esenzione.
Un'esenzione si scrive una volta e non si guarda più; un elenco è un lucchetto
che si chiude in **tutte e due i versi** — una coppia che scende sotto la soglia
senza essere scritta è rossa, e una scritta che nessuna scena produce più è rossa
pure lei, perché è la foto di un difetto riparato che nessuno ha tolto dal muro.

## Un elenco che si svuota, e una regola che non trova niente

Due presidi diversi, stessa lezione — la
[0109](0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md).

`banco/scene.test.ts` tiene l'elenco delle scene chiuso in due direzioni: ogni
scena ha la sua baseline in **entrambe** le luci, e nessuna baseline avanza senza
la sua scena. Senza la prima, una scena nuova che nessuno ha fotografato passa
per verde; senza la seconda, una scena cancellata lascia in repo il ritratto di
un'interfaccia che non esiste più, e la prossima persona che lo guarda cerca di
capire cosa è cambiato in una schermata che è stata rimossa. C'è anche un
pavimento sul numero, perché una `SCENE = []` sarebbe verde.

Lo stesso in `a11y.mjs`: una regola che non si applica a nessun elemento e una
che passa su tutti danno lo stesso verde. Si conta quanti elementi `axe` ha
davvero esaminato, e una scena che ne esamina **zero** è rossa.

E lo stesso per il catalogo dei componenti, che è l'affermazione più facile da
fare a vuoto: «ogni componente in ogni stato». Il presidio la dimostra
confrontando l'elenco dei campioni coi `case` dello `switch` di `disegna()` in
`ui/node.ts`, che è l'unica definizione verificabile a macchina di «ogni
componente» — `UiKind` è un'unione del contratto, ma ciò che si **disegna** è ciò
che quel corpo sa disegnare. Il confronto è nei due versi anche qui, e c'è una
riga che verifica che il ritaglio del corpo abbia trovato qualcosa: se sbagliasse
a ritagliare, tutto il resto passerebbe a vuoto.

## Cosa entra in CI, e la riga che separa

Il banco entra in CI **per metà**, e la riga è: *cosa dipende dalla macchina.*

Il confronto a pixel no. Un browser pinnato garantisce lo stesso motore, non gli
stessi **caratteri**: la scala che la shell chiede si risolve nel carattere di
sistema, che è diverso su sistemi diversi e diverso anche fra due Linux. È un
cancello **locale** finché la §31.3 non porta i caratteri dentro l'applicazione —
e allora la riga si sposta.

Il contrasto reso sì: `axe` legge i colori calcolati, che dai caratteri non
dipendono. E il presidio delle scene pure, perché è una domanda sui file.

Il cancello umano è il **foglio di contatto**: le due luci affiancate, scena per
scena, rigenerato a ogni corsa. Ogni tappa di questa seduta si chiude
guardandolo, e sta scritto in `docs/CONTRIBUTING.md` perché non resti l'abitudine
di una persona sola.

## Le forme scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| revisione a occhio, aprendo l'app | zero infrastruttura | non lascia un «prima»: non prova nessun miglioramento e non vede nessuna regressione |
| presidi di layout in `happy-dom` | niente motore da installare | non c'è CSS e non ci sono misure: il presidio passerebbe **a vuoto** |
| foto senza baseline in repo | niente PNG versionati | un diff che non ha un termine di paragone non è un diff, è una foto |
| una seconda shell per il banco | nessun rischio di toccare la produzione | fotograferebbe un'altra app, ed è il modo in cui un banco smette di dire la verità senza che nessuno se ne accorga |
| `resolve.alias` per la cucitura | tre righe di configurazione | l'alias è una regola sul **testo** di un import, e i due moduli sono importati con path relativi a profondità diverse |
| ammorbidire `creaHostFinto` | un finto solo invece di finto + scenografia | toglierebbe la garanzia del lancio anche a chi la usa bene (il test end-to-end) |
| accendere tutto `axe`, non solo il contrasto | più accessibilità gratis | centinaia di rilievi che nessuno ha deciso di riparare, cioè un rosso che si impara a ignorare — e un presidio ignorato occupa il posto di quello che servirebbe |
| tollerare la deriva delle scene che si muovono | nessuna caccia alle animazioni | è la scelta che trasforma un banco in un rosso da rilanciare; e le tre animazioni trovate erano tre difetti veri |

## Cosa resta fuori

- **Il confronto a pixel non è in CI**, e ci entrerà quando i caratteri saranno
  in bundle (§31.3). È l'unica casella residua di questa voce, ed è dichiarata
  in `banco/foto.mjs`, in `ci.yml` e in `docs/CONTRIBUTING.md`.
- **Le cinque coppie sotto la soglia non sono riparate.** Non è questa la voce
  che le paga: due sono della 25.1 e tre della §31.7. Sono nel `DEBITO`, col
  numero di oggi e la voce accanto.
- **`axe` gira con una regola sola.** L'accessibilità completa è una voce sua, e
  quando arriverà si aggiungeranno regole a quell'elenco invece di riscrivere il
  file.
- **Il banco non prova un tema che non è la serie.** È la §31.9, e la dice.
