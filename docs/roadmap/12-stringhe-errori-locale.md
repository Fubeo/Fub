# 12. Le stringhe, gli errori, il locale

Una **seduta** della [roadmap infrastrutturale](../todo.md): chi localizza le stringhe localizza anche gli errori, e comunque serve il locale.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Una decisione sola con tre facce: se un provider riceve un `locale` e traduce,
o restituisce **chiavi** che qualcun altro risolve. Il §12.2 è il gemello
dichiarato del ~~§12.1~~ — «chi localizza le stringhe localizza anche gli errori,
e un messaggio già composto non si traduce» — e il ~~§12.3~~ chiudeva il cerchio
dal lato del dato.

Ed è quello che si è preso per primo, con la
[decisione 0039](../decisions/0039-il-locale-e-il-caso.md), proprio perché era
l'unico che **non aspettava** la risposta sulle stringhe: qualunque cosa si
decida sulla UI, un provider ha comunque bisogno del locale per ordinare e per
formattare. Adesso ce l'ha — `HostEnv::user_locale`, pubblicato dalla shell e
composto dal kernel con le chiavi `locale.*` — e con lui il **caso**
(`random_bytes`), che era lo stesso buco dell'orologio un metodo più in là.

Poi è arrivata la risposta vera, con la
[decisione 0040](../decisions/0040-chi-localizza.md): **né una `String` né una
chiave — un tipo che porta la propria provenienza**, `Text::Literal` per i dati e
`Text::Message` per ciò che si traduce, risolto dal *kernel* sulla via d'uscita
dal contratto col catalogo di chi l'ha scritto. È il ritaglio più largo fatto
alla linea di base dopo quello della [0021](../decisions/0021-il-confine.md), e
per la stessa ragione: ciò che scade col freeze è la **forma**, non la larghezza.

Il gemello l'ha chiuso la
[decisione 0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md), che
ha portato la stessa forma dove serviva di più: **anche un errore è testo che
qualcuno legge** — e, in più, è una domanda su cui qualcuno rama. Il payload di
ogni variante è un `Text`, la forma sul filo è discriminabile
(`{kind, message}`), e tre varianti nuove — `not-found`, `already-exists`, `io`
— distinguono ciò che prima passava tutto come `internal`. Il confine Tauri non
stringa più niente.

Resta **una** faccia, ed è il §12.4: il catalogo della shell non ha una cartella
perché non ha ancora una decisione — ed è la prova che le tre erano una.

### ~~12.2 Errori tipizzati al confine, non `String`~~

*ex §1.11 · contratto · **P0** — il gemello dichiarato della 12.1* ·
**chiusa** dalla [decisione 0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)

- [x] **Un errore con codice e parametri.** Il payload di ogni variante di
      `PluginError` è un `Text` — quindi traducibile, con la stessa scala di
      ripiego della 0040 — e la forma sul filo è **adiacente e discriminabile**:
      `{"kind": "already_exists", "message": …}`. `Display` resta la forma per
      il log.
- [x] **Le varianti che mancavano**, nate da un cliente vero e non da una
      tassonomia: `not-found`, `already-exists` e `io` in coda alle nove. Il
      `catch` nudo di `panels/trash.ts` è adesso un ramo su
      `already_exists`, e ogni altro fallimento si notifica invece di produrre
      la domanda sbagliata.
- [x] **Il confine non stringa più.** Trentacinque firme `#[tauri::command]`
      passano da `Result<_, String>` a `Result<_, PluginError>`, e `fubmd-host`
      parla `PluginError` fino in fondo — non converte l'app, o i cinque clienti
      previsti dell'host si ridurrebbero la discriminabilità dalla prosa.
      `KernelError` resta **fuori** dal contratto (è la lingua dell'host): la
      traduzione è un `From` scritto una volta sola, con le quattro scelte non
      ovvie motivate accanto al codice.

*Sblocca:* 24.2 (error reporting chiaro, repair), 10.5 (alert e notifiche),
16.3 (automation error handling, retry), 25.2.

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
- [ ] **Catalogo stringhe** e `t()` — e dopo la
      [0040](../decisions/0040-chi-localizza.md) questa voce si è **ristretta**,
      il che è il modo giusto in cui una dipendenza si risolve: le stringhe dei
      provider le risolve il kernel, quindi qui resta solo ciò che la shell
      scrive di suo (`main.ts`, `panels/*.ts`). Ci si aggiunge però una coda che
      prima non c'era: **sei feature ufficiali su otto non hanno ancora un
      catalogo** — backlink e tag sì — e continuano a restituire italiano
      cablato. È il degrado garbato della 0040 in azione, non un difetto, ma è
      lavoro che sta qui.
