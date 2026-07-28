# 0041 — Un errore è testo che qualcuno legge

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §12.2 (seduta 12) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/12-stringhe-errori-locale.md)

---

Il §12.2 chiedeva errori **tipizzati** al confine invece che `String`, e la
[0040](0040-chi-localizza.md) — decisa un'ora prima, nella stessa seduta —
chiudeva elencando fra ciò che restava scoperto proprio questa voce:

> `PluginError` porta ancora `String` in ogni variante, quindi un errore è
> **l'unica cosa che attraversa il confine verso uno schermo e non si può ancora
> tradurre**.

Le due voci sono gemelle e la seconda non è il completamento burocratico della
prima. La 0040 ha reso traducibile ciò che si legge quando le cose vanno bene;
questa fa la stessa cosa per quando vanno male — che è, statisticamente, quando
una persona ha più bisogno di capire cosa le si sta dicendo.

Ma il §12.2 aveva anche un secondo lato, che non è la traduzione ed è quello che
ha guidato le scelte: **un errore non serve solo a essere letto, serve a essere
distinto**. E questo era rotto in modo dimostrabile.

## La riga che ha deciso tutto il resto

In `frontend/src/panels/trash.ts`, il ripristino dal cestino:

```ts
try {
  restored = await restoreFromTrash(trashId);
} catch {
  // Il path originale è di nuovo occupato: […]
  const proposta = await proposeFreeName(original);
  const ok = await confirm(`«…» esiste di nuovo. Ripristinare come «…»?`);
```

Un `catch` **nudo**. Qualunque fallimento — disco pieno, permesso negato,
cartella sparita — veniva letto come «il path è di nuovo occupato», e l'utente si
vedeva porre la domanda sbagliata. Rispondendo «Ripristina» ritentava con un nome
libero, che sul disco pieno falliva di nuovo, per la ragione vera, che nessuno
gli aveva mai detto.

Il difetto non era la pigrizia di chi ha scritto quel `catch`: **non c'era niente
su cui ramificare**. Il confine Tauri stringava ogni errore, e da questa parte
arrivava una frase italiana. L'unica alternativa al `catch` nudo era cercare una
sottostringa nella prosa — cioè trasformare un messaggio in un'API, che è peggio.

## La risposta, in una frase

**Un errore è testo che qualcuno legge (quindi il payload è un `Text`) ed è una
domanda su cui qualcuno rama (quindi la specie sta in un `kind` discriminabile, e
le specie sono quelle che qualcuno distingue davvero).**

## Le decisioni prese, da NON ridiscutere senza motivo

### Il payload di ogni variante è un `Text`

Stessa scelta della 0040, stesso ragionamento, non lo si ripete. Ciò che va detto
è la cosa che le etichette di una UI non hanno, ed è la ragione per cui
`thiserror` è ancora lì:

> **`Display` è per chi legge un log, `Text` è per chi legge uno schermo.**

Le due forme convivono senza contendersi. `#[error("non trovato: {0}")]` compone
la riga che finisce su `stderr` — dove un `Text::Message` si stampa come la sua
chiave e i suoi argomenti, che è esattamente ciò che serve a chi cerca — e il
kernel risolve lo stesso valore quando l'errore esce verso una persona.

### La forma sul filo è **adiacente**, ed è stata scelta quando ha guadagnato un lettore

```rust
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
```

`{"kind": "already_exists", "message": "Progetti/Idee.md"}`, come
[`UiValue`](0016-cosa-e-una-view.md) e `ArgValue`. Prima serializzava nella forma
di default di serde (`{"BadArgs": …}`), e la ragione per cui nessuno se n'era mai
accorto è la stessa per cui la voce esisteva: **quella forma non arrivava a
nessuno**, perché il confine buttava via il tipo.

### Le varianti sono dodici, e le tre nuove sono nate da un cliente

`not-found`, `already-exists`, `io` **in coda** alle nove che c'erano.

Non sono una tassonomia completata per simmetria: sono esattamente i tre
fallimenti che il ripristino dal cestino deve saper distinguere per fare la cosa
giusta. Prima attraversavano il confine come `Internal` — cioè come «errore
interno del plugin» scritto sotto un'azione che l'utente aveva appena chiesto — e
chi li riceveva poteva solo leggerne la prosa.

La regola che ne esce, e che vale per la prossima: **una variante nasce quando
qualcuno la legge.** È la stessa con cui la forma sul filo è stata scelta adesso
e non due sedute fa.

Le tre distinzioni, dette in termini di *cosa fa chi le riceve*:

- **`not-found` non è `bad-args`** perché l'argomento *era* ben formato:
  `a/Uno.md` è un `DocId` valido e chi l'ha chiesto non ha sbagliato a scriverlo
  — semmai qualcuno l'ha cancellato nel frattempo. Chi disegna dice «non esiste
  più» invece di «hai sbagliato a chiedere»; chi automatizza smette invece di
  correggere.
- **`already-exists`** è la variante che rende vero il ramo del cestino, ed è
  l'unico posto in cui la domanda «lo ripristino con un altro nome?» è quella
  giusta.
- **`io` non è `internal`**, e la differenza è *chi ha sbagliato*: `internal` è un
  difetto di chi ha scritto il codice («segnala un bug»), `io` è il mondo
  («riprova»). Chi riprova su un `io` ha ragione di farlo.

### `FormatError` resta a `String`, e non è una dimenticanza

Lo produce un parser su un sorgente, dice *dove* e *cosa* di un documento — un
numero di riga, un delimitatore non chiuso — e chi lo consuma è il codice che
l'ha chiamato. **Non è la frase che compare sotto un pulsante.** Quando lo
diventerà, sarà perché qualcuno l'avrà avvolto in un `PluginError`.

### `KernelError` resta fuori dal contratto, e la traduzione è una scelta scritta

`KernelError` è la lingua di *questo* host, e un host diverso ne avrà un'altra.
Ma proprio per questo `impl From<KernelError> for PluginError` è il punto in cui
si decide **cosa può fare chi riceve**, e va fatto una volta sola.

Prima era una funzione privata di `workspace.rs` che distingueva due casi su
dodici — `Stale` e `BadEdit` — e appiattiva gli altri dieci su `Internal`. Adesso
ogni variante ha la sua riga, e le quattro non ovvie sono motivate accanto al
codice:

- **`NoProvider` / `NoDefaultFormat` → `unserved`.** La forma è la stessa che la
  variante già descriveva per le query — *nessuno ha dichiarato di servire
  questo* — e la risposta da mostrare è «installa un plugin per questo formato»,
  non «qualcosa è andato storto». Che il non-servito sia una rotta d'indice o
  un'estensione di file è un dettaglio di quale registro si è guardato.
- **`OutsideVault` → `permission-denied`**, non `bad-args`: il path era ben
  formato, è il recinto ad aver detto di no. È la stessa risposta che
  `fenced_doc_id` dà a una risalita, e per chi la riceve i due recinti devono
  comportarsi uguale.
- **`NonUtf8Path` → `io`**, non `bad-args`: quel path non l'ha scritto chi
  chiama, l'ha trovato il kernel camminando sul disco.
- **`LinkRewrite` → `io`, con una perdita dichiarata.** È l'unico caso di
  *successo parziale* — il rename è avvenuto, sono i wikilink entranti di alcune
  sorgenti a non essere stati riscritti — e il contratto non ha una variante che
  dica «è andata a metà». `io` è la meno sbagliata perché ciò che è fallito è
  scrivere quei file; ma chi la riceve non lo sa dal `kind` e deve leggerne il
  messaggio, che nomina le sorgenti. **Non si è inventata una variante `partial`
  proprio per la regola di sopra**: nessuno la leggerebbe ancora.

### `BundleError` conserva l'errore di chi non si è attivato

La riga di cui vado più fiero, e dal diff non si vede. `BundleError` ha quattro
varianti, e la quarta — `Activation { id, error: PluginError }` — **porta già un
`PluginError`**, scritto da chi non si è attivato. Riavvolgerlo in un `Internal`
avrebbe cancellato una risposta giusta per rimpiazzarla con una generica, e con
essa il catalogo di chi l'aveva scritta. Quindi si preserva, premettendo al
messaggio l'id di chi ha detto di no.

Le altre tre si dividono per la stessa domanda di sempre: `Abi` → `unserved`
(questo host non parla quel contratto, non è colpa di nessuno), `Unknown` →
`not-found` («l'ho riacceso» e «ho scritto male l'id» *devono* essere due
risposte diverse — è la ragione per cui quella variante esiste, e sopravvive alla
traduzione solo restando distinta qui), `Declaration` → `internal`.

### `fubmd-host` parla `PluginError`, e la conversione **non** sta al confine Tauri

Questa era la scelta aperta, e la risposta è quella scomoda.

Convertire nell'app sarebbe stato meno lavoro, e avrebbe rimesso il difetto un
piano sotto: l'app non ha modo di sapere se un `String` che le arriva dall'host
significa «non c'è» o «disco pieno», quindi avrebbe mappato tutto su `internal` —
cioè la stessa identica appiattitura appena tolta dal kernel, riprodotta un
livello più in alto.

E l'host ha **cinque clienti previsti** — CLI (27.1), API locale (27.2), e2e
headless, mobile, PWA. È l'argomento della [0023](0023-chi-monta-il-kernel.md), che ha
spostato il montaggio qui apposta: lasciare `String` avrebbe voluto dire che
ognuno dei cinque si rideriva la discriminabilità dalla prosa, e quattro la
sbagliavano.

Due cuciture restano a `String` **deliberatamente**, e sono cuciture interne
dell'host che col contratto non parlano: `WatcherFactory` (chi la sostituisce
sostituisce un modo di guardare una cartella; il suo unico fallimento è il
sistema che non concede di guardare, e si nomina una volta al `?`) e
`write_atomic` con i suoi gemelli del sidecar, che hanno un fallimento solo —
scrivere un file — e vengono nominati `io` là dove attraversano.

### Anche gli errori si localizzano, e col catalogo di chi li ha prodotti

`Workspace::localized`, gemello di `Workspace::localize`. Le sei vie d'uscita
risolvevano ciò che *restituivano* e lasciavano non risolto ciò con cui
*fallivano*.

Si applica al solo `?` che può portare l'errore **di un provider**. Ciò che
fallisce prima che un provider sia stato chiamato — la view non esiste, i
parametri non reggono, il comando gira su sé stesso — è prosa del kernel, cioè un
`Text::Literal` che nessun catalogo tocca: farlo passare di lì non sarebbe
sbagliato, sarebbe rumore che suggerisce una traduzione che non avviene.

### La shell riconosce un errore dalla **forma**, non da una classe

`frontend/src/host/errors.ts`, tre funzioni e nessun `@tauri-apps` (§1.3): ciò
che attraversa l'IPC è JSON, e da questa parte non c'è nessuna classe da
riconoscere con un `instanceof`. `asPluginError` guarda la struttura e restituisce
`null` per tutto il resto — che è la risposta giusta: non tutto ciò che va storto
viene dal backend.

`errorText` merita una riga perché **non esisteva e adesso serve**: prima il
confine consegnava una stringa e ogni sito che notificava un guasto scriveva
`${e}`, che su una stringa è la stringa. Adesso consegna un oggetto, e `${e}`
sarebbe `[object Object]`. Venti siti sono passati da `${e}` a `${errorText(e)}`:
è la parte meno interessante di questo verbale e l'unica che, saltata, avrebbe
rotto ogni messaggio d'errore della shell.

## Cosa questo ha rotto, deliberatamente

`wit_additivity.rs` è diventato rosso e la linea di base è stata **ritagliata**
(`crates/fubmd-abi/wit/frozen/0.1.0.wit`, con la riga in tabella che dice perché). Pre-freeze è la
procedura prevista.

Ciò che ha rotto: **i nove payload di `plugin-error` passano da `string` a
`text`**. Non poteva essere additivo, per la stessa ragione della 0040 — una
seconda `string` accanto avrebbe raddoppiato la superficie e lasciato in piedi la
domanda «quale delle due vince».

Le tre varianti nuove sono invece **in coda**, cioè additive: non spostano il
discriminante di nessuna delle nove che c'erano.

Tre presidi asserivano il comportamento vecchio e adesso asseriscono quello
giusto — e sono il modo più corto di dire cosa è cambiato:

| dove | prima | adesso |
|---|---|---|
| `commands_e2e.rs` | ricreare sopra una nota → `Internal` | → `AlreadyExists` |
| `parsed_model_e2e.rs` | un documento che non c'è → `Internal` | → `NotFound` |
| `structural_host.rs` | `create_document` su path occupato → `Internal` | → `AlreadyExists` |

## Cosa si è scartato, e perché

- **Convertire al confine Tauri invece che nell'host.** Meno lavoro, e il difetto
  ricompare un piano sopra con cinque clienti a pagarlo. Vedi sopra.
- **Una variante `partial` per `LinkRewrite`.** Sarebbe l'unica del contratto che
  nessun cliente legge, cioè il contrario della regola con cui le altre tre sono
  nate.
- **Un «documento malformato» per `FormatError::Parse`.** Stessa ragione: il
  payload porta il `Display` del `FormatError`, che dice già quale delle tre cose
  è fallita, e nessuno rama su quella distinzione oggi.
- **Portare `KernelError` dentro il contratto.** È la lingua dell'host, e un
  host diverso ne avrà un'altra. Il posto giusto per la scelta è la conversione,
  non il tipo.
- **Convertire `Vec<String>` di `close_vault` e `set_plugin_enabled` in
  `Vec<PluginError>`.** Quelli sono **dati** — un rapporto di cosa non è
  diventato durevole, mostrato come un elenco di righe — non il canale d'errore.
  Chi disegna non ci rama sopra. Resta scritto qui sotto perché è comunque un
  posto in cui la prosa fa da tipo.
- **Un `instanceof` sulla shell.** Non c'è nessuna classe che attraversi un IPC.

## Cosa resta scoperto (e dove è scritto)

- **`close_vault` e `set_plugin_enabled` restituiscono ancora `Vec<String>`.**
  Sono dati e non il canale d'errore (vedi sopra), ma il giorno che la shell
  dovesse ramare su uno di quegli esiti, quella lista va tipizzata.
- **`FormatError` resta a `String`.** Deliberato, motivato nel doc del modulo, e
  vero finché nessuno lo mostra sotto un pulsante.
- **I messaggi del kernel e dell'host sono `Text::Literal` in italiano.** Il
  kernel non ha un catalogo: le sue frasi non sono tradotte e non lo saranno
  finché il §12.4 non gli darà il suo. È lo stesso degrado garbato della 0040 —
  ciò che si ottiene dimenticandosi non è più di ciò che si ottiene dichiarando —
  ma qui va detto che *nessuno* si è dichiarato, non che qualcuno ha dimenticato.
- **Il successo parziale non è esprimibile.** Vedi `LinkRewrite`.
- **Nessun presidio verifica che ogni `kind` abbia un ramo nella shell** oltre a
  `touchPluginErrorKind`, che è esaustivo per costruzione (`assertNever`) ma
  vive nel test del mirror: se qualcuno aggiungesse una variante e non toccasse
  il mirror, il rosso arriverebbe dalla fixture e non da lì.
