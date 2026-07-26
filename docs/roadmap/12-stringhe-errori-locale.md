# 12. Le stringhe, gli errori, il locale

Una **seduta** della [roadmap infrastrutturale](../todo.md): chi localizza le stringhe localizza anche gli errori, e comunque serve il locale.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Una decisione sola con tre facce: se un provider riceve un `locale` e traduce,
o restituisce **chiavi** che la shell risolve. Il §12.2 è il gemello dichiarato
del §12.1 — «chi localizza le stringhe localizza anche gli errori, e un messaggio
già composto non si traduce» — e il §12.3 chiude il cerchio dal lato del dato: il
locale serve comunque per l'ordinamento e per formattare numeri, date e valute,
qualunque risposta si dia sulle stringhe di UI.

Il catalogo della shell (12.4) non ha una cartella perché non ha ancora una
decisione: è la prova che le quattro sono una.

### 12.1 Stringhe e localizzazione al confine — decisione, non implementazione

*ex §1.8 · contratto · **P0** — è una scelta di forma dei tipi: dopo il freeze si cambia con una minor*

- [ ] **Decidere ora chi localizza**: oggi un `ViewProvider` restituisce
      `UiNode::Text { content: "Nessun backlink" }` — testo italiano cablato
      dentro il provider. Con la localizzazione (25.2) o i provider ricevono un
      `locale` e traducono, o restituiscono **chiavi** che la shell risolve. È
      una scelta di forma dei tipi: dopo il freeze si cambia solo con una minor.

### 12.2 Errori tipizzati al confine, non `String`

*ex §1.11 · contratto · **P0** — il gemello dichiarato della 12.1*

- [ ] **Un errore con codice e parametri**: i comandi Tauri restituiscono
      `Result<_, String>` con la prosa italiana del kernel. Il costo è già
      visibile: `restoreFromTrash` (`main.ts:951`) ha un `catch` nudo che
      intercetta **qualunque** errore e assume "path di nuovo occupato", quindi
      un errore di I/O o di permessi produce all'utente la domanda sbagliata — e
      la risposta «Ripristina» a quella domanda ritenta con un nome libero, che
      per un disco pieno fallirà di nuovo.
- [ ] **`PluginError`/`KernelError` sono nel contratto**, quindi la forma scade
      col freeze; ed è il gemello della decisione del §12.1 — chi localizza le
      stringhe localizza anche gli errori, e un messaggio già composto non si
      traduce.

*Sblocca:* 24.2 (error reporting chiaro, repair), 10.5 (alert e notifiche),
16.3 (automation error handling, retry), 25.2.

### 12.3 Caso, tempo civile e locale — le capacità che il dogfooding non ha ancora toccato

*ex §1.25 · contratto · **P0** — caso e UUID sono «lo stesso buco dell'orologio, un metodo più in là»*

Il versioning ha trovato `now_unix_millis` con l'argomento giusto: sotto sandbox
un componente non ha orologio, e uno che chiamasse `SystemTime::now` sarebbe non
testabile e non funzionante (`abi/traits.rs:296`). Lo stesso argomento, non
applicato, lascia fuori tre cose:

- [ ] **Il caso e gli UUID**: «UUID opzionale per nota» (2.2), Zettelkasten ID e
      «ID univoco nota» (8.3), id di blocco (5.2, e la [decisione 0003](../decisions/0003-modello-del-documento.md)), «ID univoco
      annotazione» (13.3). Sotto WASI il caso non c'è di default: è
      letteralmente lo stesso buco dell'orologio, un metodo più in là.
- [ ] **Il tempo civile e il fuso**: `now_unix_millis` dà millisecondi UTC. Note
      periodiche e naming automatico (8.3), calendario con «first day of week»,
      «regional holidays» e «workweek localization» (10.4), promemoria relativi
      e ricorrenze (10.5, 10.1), «ricerca per date assolute e relative» (9.1)
      hanno bisogno del fuso e del calendario **dell'utente**, che un
      componente non può dedurre e che un plugin non deve indovinare.
- [ ] **Il locale**: è il gemello della decisione del §12.1. Qualunque risposta
      si dia sulle stringhe di UI, un provider ne ha comunque bisogno per
      l'ordinamento e la collazione («locale-aware sorting/collation», 25.2) e
      per formattare numeri, date, valute e unità.

### 12.4 Tema, token, accessibilità

*ex §3.3 · shell · **P2** — il catalogo dipende dalla 12.1*

- [ ] **Token CSS** (colore, spaziatura, tipografia) e temi chiaro/scuro/sistema
      al posto degli stili sparsi; è il prerequisito di 6.2 (temi, snippet CSS,
      CSS per nota/cartella) e di 25.1 (alto contrasto, reduced motion,
      dimensioni testo, font per dislessia).
- [ ] **Passata di accessibilità strutturale**: ruoli ARIA, focus visibile,
      focus trap nei modali, navigazione da tastiera nei pannelli, skip link.
      Farla ora costa poco; rifarla su 30 pannelli costa trenta volte.
- [ ] **E il suo presidio, che arriva con lei** (veniva dal §17.2, dove era
      un'altra voce): un **check di accessibilità automatico** sui pannelli, in
      CI. Sta qui e non fra i presidi perché una passata senza presidio decade
      alla prima view nuova — è la regola della
      [decisione 0014](../decisions/0014-i-verbali-fuori-da-todo.md), *«una
      promessa senza presidio meccanico decade»* — e un presidio senza la passata
      non ha niente da tenere fermo. **Vanno prese nella stessa seduta, in
      quest'ordine**. Di che forma siano i pannelli è ormai fissato — la
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ha chiuso nodi,
      superfici e metadati —, quindi il vincolo che teneva ferma questa voce non
      c'è più: prima, un check scritto avrebbe presidiato una resa che stava per
      essere sostituita.
- [ ] **Catalogo stringhe** e `t()` (dipende dalla decisione del §12.1).
