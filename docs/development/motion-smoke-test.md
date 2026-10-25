# Prova manuale del moto

Questa guida dice come provare a mano il moto dello Scrittoio nella finestra
vera, con la webview del sistema.

> **Per chi:** chi cambia `apps/client/src/moto/`, le superfici che entrano ed
> escono (menu, palette, dialoghi, avvisi, cassetti, fogli) o il livello del
> moto, e chi prepara una versione.
> **Risultato:** una tabella di esiti per webview, con ciò che è passato, ciò
> che non è passato e ciò che non si è potuto provare.

Il [banco del moto](../../apps/client/bench/motion.mjs) misura le regole del
moto in Chromium: stato finale, residui, proprietà ammesse, interruzioni. Il
[budget d'interazione](../product/performance-budget.md#il-budget-dinterazione)
misura i tempi, sempre in Chromium. Nessuno dei due vede WebKitGTK, che su
Linux compone in un altro modo, né il carico del thread principale di una
macchina vera. Questa prova copre ciò che resta, e non sostituisce [la
verifica automatica](testing-and-quality.md).

## Quando farla

A ogni cambiamento che tocca il moto, prima di fonderlo. Prima di una versione
la si rifà su ogni webview a portata di mano: WebKitGTK su Linux, WebKit su
macOS, WebView2 su Windows. Una webview che manca si scrive come **non
provata**, non come passata.

## Preparazione

1. Parti dal commit che vuoi provare e annotalo: `git rev-parse --short HEAD`.
2. Avvia l'app: `cargo tauri dev --config crates/fub-app/tauri.conf.json`.
3. Apri un vault con qualche nota e una cartella con delle sottocartelle.
4. Scrivi in testa alla tabella degli esiti: commit, sistema operativo,
   webview e versione, schermo, fattore di scala e frequenza di aggiornamento.
5. Fai il giro due volte: con **Moto** di serie e con **Moto: calmo**. Il
   livello **ridotto** non si muove, e basta guardare che arrivi allo stesso
   stato.

## Il giro

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Tasto destro vicino al bordo basso della nota | il menu nasce dal puntatore, anche quando si apre verso l'alto; nessun salto al primo fotogramma |
| 2 | Apri e chiudi la palette quattro volte di fila, veloce | ogni apertura parte da dove era la chiusura; niente lampi, niente fantasmi rimasti sullo schermo |
| 3 | Apri un dialogo (per esempio rinomina) e premi `Esc` subito | l'uscita dura meno di un battito; il fuoco torna dove era |
| 4 | Scrivi nella nota mentre un avviso entra o esce | ogni tasto arriva, nell'ordine; il testo non trema |
| 5 | Dividi un foglio, poi chiudine uno | la carta scorre da un posto all'altro; il testo è già al suo posto e non si deforma |
| 6 | Apri e chiudi il cassetto durante un trascinamento della finestra | il cassetto arriva e il ridimensionamento non diventa un'animazione |
| 7 | Cambia luce | il passaggio è uno solo, senza una cornice disegnata due volte |
| 8 | Apri una cartella con molte voci nell'albero, poi richiudila | le voci entrano una dopo l'altra e le righe sotto scivolano; alla chiusura i figli sbiadiscono al loro rientro e non resta niente; lo scorrimento resta fluido |
| 9 | Trascina una nota fra due sorelle e rilasciala | la riga d'origine si solleva di poco, il fantasma sotto il puntatore è quello del sistema e senza ombra tagliata; al rilascio le righe scivolano nel nuovo ordine |
| 10 | Trascina una linguetta fuori dalla finestra | la linguetta si solleva e torna giù; si apre una finestra nuova |
| 11 | Su un vault grande, cerca una parola comune e apri il lanciatore | se la risposta tarda, compaiono righe grigie ferme al posto dei risultati, e spariscono quando arrivano; una risposta rapida non le mostra |
| 12 | Ripeti 1, 2 e 5 con la finestra a tutto schermo su uno schermo grande | nessun fotogramma lungo che si veda a occhio |

Per ogni riga annota **passato**, **non passato** (con che cosa si è visto) o
**non provato**. Uno scatto che si vede una volta su dieci è un non passato:
scrivi quante volte su quante.

## Che cosa fare di un esito rosso

- Se la stessa riga è rossa anche nel banco del moto in Chromium, la causa è
  del prodotto: apri una issue con la riga e il commit.
- Se è rossa solo nella webview, scrivi webview e versione nella issue, e se
  puoi un video. Una correzione che spegne il moto per una sola webview si
  discute prima nella issue.

L'esito sta nella descrizione della PR, come tabella.
