# 0039 — Il locale e il caso: ciò che l'host sa e nessuno gli aveva chiesto

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §12.3 (seduta 12) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/12-stringhe-errori-locale.md)

---

Il versioning, facendo dogfooding, aveva trovato un buco e l'argomento giusto per
tapparlo: sotto sandbox un componente **non ha orologio** — WASI lo può negare —
e uno che chiamasse `SystemTime::now` per conto proprio sarebbe non testabile e
non funzionante. Da lì è nato `HostEnv::now_unix_millis`, e il tempo è diventato
una capacità come le altre.

Quell'argomento, però, non era stato applicato fino in fondo. Restavano fuori tre
cose, e il §12.3 le aveva elencate senza deciderle:

- **Il caso.** Sotto WASI l'entropia non c'è più dell'orologio, ed è
  letteralmente lo stesso buco un metodo più in là. Ogni identità che Fub
  genererà lo chiede: UUID per nota (FEATURES 2.2), id Zettelkasten (8.3), id di
  blocco (5.2, e la [0003](0003-modello-del-documento.md)), id di annotazione
  (13.3).
- **Il tempo civile e il fuso.** `now_unix_millis` dà millisecondi UTC: sa dire
  *quando* è successo e **non sa dirlo a nessuno**. Note periodiche (8.3),
  calendario con «first day of week» e «workweek localization» (10.4), promemoria
  ricorrenti (10.5, 10.1), ricerca per date relative (9.1) hanno bisogno del fuso
  e del calendario *dell'utente*.
- **Il locale.** Qualunque risposta si dia al §12.1 sulle stringhe di UI, un
  provider ne ha comunque bisogno per l'ordinamento e la collazione («locale-aware
  sorting/collation», 25.2) e per formattare numeri, date, valute e unità.

Il buco non era teorico. Il pannello dei tag ordina; le statistiche contano; il
cestino stampa una data nel nome di un file. Nessuno di questi, oggi, sa in che
lingua o in che fuso lo sta facendo — e ognuno di essi, il giorno che serve, se
lo sarebbe preso da sé, ognuno a modo suo.

## La risposta, in una frase

**Il locale è un fatto dell'host come l'orologio, e chi lo sa davvero è la
shell: lo pubblica lei, il kernel lo custodisce senza derivarlo, le chiavi
`locale.*` gli stanno sopra, e chi sta dentro il confine lo chiede con
`user_locale()` — un record solo, per una domanda sola. Il caso è la stessa
famiglia, un metodo più in là: l'host dà i byte, l'SDK dà le forme.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Un record solo, e non quattro capacità

`Locale` porta cinque campi — lingua, fuso, offset, primo giorno della settimana,
orologio — e li porta **insieme**. Chi lo chiede lo chiede tutto: formattare una
data vuole il fuso *e* la lingua *e* l'orologio. Quattro chiamate avrebbero dato
quattro istantanee che possono venire da momenti diversi, e il caso in cui
divergono non è ipotetico — l'offset cambia da solo l'ultima domenica di ottobre,
in mezzo a un job che dura.

È lo stesso argomento di
[`SettingEntry`](../../crates/fub-abi/src/settings.rs), che tiene insieme
schema, valore e provenienza per non farli riconciliare a chi disegna.

### Lo pubblica la shell, e non lo deriva il kernel

La webview porta un ICU intero: `navigator.language`,
`Intl.DateTimeFormat().resolvedOptions().timeZone`, `getTimezoneOffset()`,
`Intl.Locale.getWeekInfo()` — quattro righe. Il lato Rust, per rispondere alla
stessa domanda, avrebbe avuto bisogno di un **database dei fusi orari**, cioè di
una dipendenza che il kernel per regola non porta, **e avrebbe dato una risposta
peggiore**.

Quindi il locale segue la strada già battuta dal contesto di sessione
([0007](0007-contesto-di-sessione.md)): lo pubblica la shell, il kernel lo
custodisce senza derivarlo, chi sta dentro lo chiede. E come `active_context`,
**non ha un gemello che scrive nell'`HostApi`**: in che lingua legge l'utente è
una decisione dell'utente sull'app, non una capacità da concedere a un plugin.

### Ma è dell'host e non del vault, e la differenza si vede in una riga

`set_active_context` si pubblica **per vault**, perché un contesto è di un
pannello di quel vault. `set_system_locale` si pubblica **per host**, e vale per
tutti i vault aperti insieme: la lingua di chi guarda non cambia perché si apre
un secondo vault. Vive quindi accanto al livello macchina delle impostazioni e
allo stato di vista — le altre due cose che sono una per installazione e non una
per vault — e come quelle è un `Arc` condiviso.

### Un gradino nuovo nella precedenza, e sta sotto la configurazione

La [0036](0036-le-impostazioni-e-i-tre-stati.md) aveva fissato **vault → macchina
→ default dello schema**. Il locale ne aggiunge uno in mezzo agli ultimi due:

> **vault → macchina → ciò che la shell riporta del sistema → `Locale::default()`**

Il gradino nuovo sta *sotto* la configurazione e *sopra* il default del
contratto, ed è l'unico posto in cui poteva stare. Un fatto del sistema non ha
titolo a scavalcare una scelta dell'utente — chi ha scelto l'italiano su un
sistema inglese ha scelto — e ha tutto il titolo a scavalcare un default scritto
in un contratto che non sa dove gira.

Le chiavi sono **quattro e non una**, e la ragione è il caso che serve davvero:
scegliere la lingua senza toccare il fuso, che è la condizione di chiunque lavori
in una lingua diversa da quella del posto in cui vive. Un'impostazione ha un
valore, e `Locale` ne ha cinque.

### «Come il sistema» è la stringa vuota, non una parola

Il valore sentinella è `""`. Con una parola come `"system"` ci sarebbero stati
**due** modi di dire la stessa cosa — il default dello schema e la parola — e un
file scritto a mano con `""` ne avrebbe voluto dire una terza. La stringa vuota è
ciò che si ottiene *non scegliendo*, quindi è anche il default naturale, e le due
cose non possono divergere.

### Il default del contratto non nomina nessun paese

`Locale::default()` è `und` (BCP-47: *lingua indeterminata*), UTC, lunedì, 24
ore. Le ultime tre sono ciò che dice ISO 8601; la prima è ciò che dice BCP-47
quando nessuno ha detto niente.

Un default `it-IT` avrebbe cablato un paese dentro il contratto, e — peggio —
avrebbe reso indistinguibili «l'utente ha scelto l'italiano» e «nessuno ha ancora
parlato». Con `und` chi risolve una traduzione sa di dover andare dritto alla
lingua di default del catalogo, invece di cercarne uno che nessuno scriverà mai.

Il default è anche **deterministico**, ed è la stessa ragione per cui l'orologio è
una capacità: è ciò che riceve la CLI (27.1), un test, un job che gira prima che
la finestra si sia aperta.

### L'offset è minuti, e vale per adesso

`utc_offset_minutes` è un `s16` in **minuti** e non in ore, perché i fusi a
mezz'ora (`Asia/Kolkata`, +330) e a tre quarti d'ora (`Asia/Kathmandu`, +345)
esistono: un campo in ore avrebbe reso inesprimibile il fuso di un miliardo e
mezzo di persone.

E porta con sé un limite dichiarato, scritto nel doc del modulo, nel WIT e nel
mirror TS: **è l'offset di adesso, e vale per adesso**. Applicarlo a una data di
sei mesi fa sbaglia di un'ora in mezzo mondo. Chi formatta l'istante corrente —
che è quasi tutto — sta a posto; chi fa aritmetica su date passate usa
`timezone`, che è il nome IANA e porta le regole. Un offset presentato come «il
fuso» sarebbe la promessa vera a metà del quinto giro: funziona per sei mesi
l'anno.

### Chi sceglie un altro fuso perde l'offset di quello vecchio

Se l'utente scrive `locale.timezone = Europe/Rome` su una macchina in
`America/New_York`, l'offset che la shell ha riportato **non è più il suo**, e
tenerlo darebbe la combinazione peggiore di tutte: il nome di un fuso con l'ora
di un altro. Il campo va a zero. Chi ha il database dei fusi legge il nome e fa
il conto giusto; chi non ce l'ha vede UTC e sa di star guardando UTC — sbagliato
in modo **dichiarato**, che è l'unico modo accettabile di sbagliare.

### Byte di caso, e non un UUID

`random_bytes(n)` e non `new_uuid()`. Le identità che FEATURES chiede sono
**quattro forme diverse**, e un metodo che ne rendesse una avrebbe lasciato le
altre tre a reimplementarsi ognuna a modo suo: è la sesta domanda del piano — il
moltiplicatore che non si paga aggiungendo la voce, si paga a ogni voce
successiva.

Il taglio è: **la capacità è l'entropia**, che solo l'host ha; **la forma è
codice di libreria**, e sta in [`fub_sdk::ids`](../../crates/fub-sdk/src/ids.rs)
— UUID v4, UUID v7, id corti in base32 leggibile. Nell'SDK e non nel kernel
perché a M5 chi ne ha bisogno è il *guest*: un plugin WASM linka quel crate e
chiama `random_bytes` attraverso il confine come lo chiama un provider nativo.

Il v7 c'è accanto al v4 perché **si ordina**: due id nati in ordine si
confrontano in ordine anche come stringhe, quindi un indice che li usa come
chiave scrive in coda invece che in mezzo. È la forma da preferire per l'identità
di una nota.

### Per l'identità, non per i segreti — e lo dice il contratto

Questa capacità promette che due chiamate non diano lo stesso valore. **Non**
promette che il prossimo valore sia imprevedibile. La riga sta nel doc del trait,
nel WIT e nel modulo del kernel che la implementa, perché è esattamente il genere
di cosa che qualcuno, fra un anno, userebbe per generare un token di sessione.

Il kernel la implementa senza dipendenze, da `RandomState` — che la libreria
standard semina dal sistema operativo — fatta avanzare da un contatore. Il *seme*
è buono, il *flusso* non è di qualità crittografica, e prendere un crate che
promettesse il contrario avrebbe messo in casa una promessa più grande dell'uso:
è così che una promessa vera a metà entra in un progetto.

Quando servirà un generatore crittografico sarà una capacità sua, con una firma
sua — come il portachiavi di sistema per i segreti, che
[`fub_abi::settings`](../../crates/fub-abi/src/settings.rs) già nomina.

### Un tetto, e chi lo supera riceve il tetto

`MAX_RANDOM_BYTES = 1024`. Sedici byte sono un UUID, trentadue una chiave: mille
sono due ordini di grandezza sopra ogni identità immaginabile. Il tetto c'è
perché una capacità senza tetto è un modo di far allocare all'host quanto pare a
chi chiama — la stessa disciplina del freno degli eventi
([0034](0034-il-freno-e-il-raggruppamento.md)), dove il tetto sta con chi ritira.
Chi chiede di più riceve mille byte e **non** un errore: una richiesta assurda
non deve far fallire la generazione di un id.

### Chi non ha la capacità riceve il default, non una bugia

Nel `Guard` (§7.2) le due capacità nuove stanno sotto `Capability::Env`, con le
altre due della famiglia. Negate:

- `user_locale()` rende `Locale::default()`, che è già la risposta del contratto
  per «nessuno me l'ha detto»: chi non ha la capacità riceve ciò che riceverebbe
  un host senza shell, non un locale plausibile e falso;
- `random_bytes()` rende **il vuoto**, e da lì `fub_sdk::ids` rende `None`. Dei
  byte fissi sarebbero identità che collidono, e chi le genera non se ne
  accorgerebbe finché due note non hanno lo stesso id. *Un id che non si è potuto
  generare non è un id di zeri.*

### Si ricompone a ogni chiamata

`Workspace::locale()` non tiene una copia risolta. Le due sorgenti cambiano da
due parti — la shell che ripubblica, l'utente che scrive un'impostazione — e una
copia che non si accorge di una delle due è il modo in cui la lingua resta quella
di prima finché non si riavvia.

### La shell ripubblica al ritorno del focus

Le due sorgenti di cambio del sistema sono l'utente che tocca le impostazioni e
l'ora legale che scatta da sola. Nessuna delle due manda un evento alla webview,
e un timer che le inseguisse resterebbe acceso per sempre su una cosa che cambia
due volte l'anno. Il ritorno del focus è il momento in cui l'utente sta per
**guardare** l'app: è l'unico in cui vale accorgersene. E il ridisegno scatta solo
se qualcosa è davvero cambiato — `set_system_locale` risponde `true` o `false` —
o si ridisegnerebbe a ogni alt-tab.

## Cosa si è scartato, e perché

- **Il kernel deduce il locale da `LANG` e da `/etc/localtime`.** Sarebbe stato
  un ICU in miniatura: `LANG=it_IT.UTF-8` si sa leggere, ma il primo giorno della
  settimana no, l'orologio no, e l'offset richiede di parsare un file TZif. Il
  risultato sarebbe stato *più codice* per una risposta **peggiore** di quella
  che la webview dà gratis, e sbagliata in silenzio nei paesi che nessuno ha
  guardato.
- **Una tabella lingua → primo giorno della settimana, come riserva.** Stessa
  ragione, in piccolo. Quando il motore non sa dire `getWeekInfo()`, il kernel
  tiene il suo default (lunedì, ISO 8601) e resta la chiave per chi vuole
  decidere: meglio un default dichiarato che una tabella che sbaglia sui paesi
  che chi l'ha scritta non conosceva.
- **Una sola chiave `locale`, con dentro un JSON.** Avrebbe reso impossibile la
  cosa che serve — cambiare la lingua senza toccare il fuso — e non avrebbe avuto
  una specie che il pannello del §11.1 sappia disegnare: `SettingKind` ha
  `Text`, `Choice`, `Toggle`, `Number`, `List`, e nessuno di questi è «un
  oggetto».
- **`Locale` dentro le impostazioni come valore.** È il divieto che la 0036 ha
  già scritto in `fub_abi::settings` per lo stato di vista e per il layout, e
  vale qui per la stessa forma: un'impostazione ha *un valore*, e questo è un
  record. Le impostazioni ci sono lo stesso — quattro chiavi scalari — ma
  descrivono uno **scarto** dal sistema, non il locale.
- **`new_uuid()` nel contratto.** Vedi sopra: una forma su quattro, e le altre
  tre a reimplementarsi.
- **Un CSPRNG preso da un crate.** Avrebbe promesso in casa una qualità che la
  capacità dichiara di non avere, e quella promessa qualcuno l'avrebbe usata.
- **`locale()` come nome del metodo.** Scartato per una ragione tecnica e una di
  merito. Tecnica: nel WIT il record si chiama `locale`, e una funzione omonima
  nella stessa interfaccia non si può dichiarare. Di merito: `user_locale` dice
  **di chi** — non del processo, non del vault, ma della persona davanti allo
  schermo, che è l'unico locale che conti quando si decide come mostrarle una
  data.

## Cosa resta scoperto (e dove è scritto)

- **Nessuno formatta ancora niente.** Questa voce mette il *fatto* nel contratto;
  chi lo usa per stampare una data leggibile, ordinare due titoli per collazione
  o disegnare un calendario arriva con le feature che lo chiedono (10.4, 8.3,
  9.1). L'SDK ha per ora `ids` e non `fmt`: aggiungerlo non tocca nessuna firma.
- **L'aritmetica del calendario dell'utente.** `Locale::to_civil_millis` sposta un
  istante di un offset, e non è un calendario: mesi, settimane e ricorrenze su
  date lontane vogliono il database dei fusi, che chi lo vuole si porta. Il
  contratto dà il nome IANA proprio perché quel giorno sia possibile senza
  cambiarlo.
- **Il locale non è ancora un evento.** Quando cambia, la shell ridisegna le view
  dichiarate; un `EventHandler` che volesse saperlo non ha un `EventKind` suo.
  Non serve a nessuno oggi, e aggiungerlo è additivo: sta scritto qui perché il
  giorno che serve non si ridiscuta la forma.
- **Le chiavi `locale.*` sono di livello macchina, quindi il pannello le mostra e
  un vault non le decide** — e questo è ciò che si voleva. Resta però che un
  *profilo di vault* («questo vault è in inglese») non è esprimibile, e non lo
  sarà: sarebbe un file che arriva da fuori e cambia l'interfaccia di chi lo apre,
  che è la riga della 0036 e non si tocca.
- **Il §12.1 e il §12.2 restano aperti**, e sono il resto di questa seduta: dove
  quelle stringhe vengono composte, e da chi. Il locale c'è perché serve **a
  prescindere** dalla risposta che si darà lì — è l'osservazione con cui il §12.3
  chiudeva il cerchio — ma con questa voce sola nessuna frase italiana cablata in
  un provider si è ancora mossa.
