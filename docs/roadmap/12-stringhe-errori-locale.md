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

Restano due facce. Il §12.2 è il gemello, ed è la prossima: un errore è oggi
l'unica cosa che attraversa il confine verso uno schermo e **non si può ancora
tradurre**, perché ogni variante di `PluginError` porta una `String`. Il catalogo
della shell (12.4) non ha una cartella perché non ha ancora una decisione — ed è
la prova che le tre erano una.

### 12.2 Errori tipizzati al confine, non `String`

*ex §1.11 · contratto · **P0** — il gemello dichiarato della 12.1*

- [ ] **Un errore con codice e parametri**: i comandi Tauri restituiscono
      `Result<_, String>` con la prosa italiana del kernel. Il costo è già
      visibile: il ripristino dal cestino (`panels/trash.ts`) ha un `catch` nudo che
      intercetta **qualunque** errore e assume "path di nuovo occupato", quindi
      un errore di I/O o di permessi produce all'utente la domanda sbagliata — e
      la risposta «Ripristina» a quella domanda ritenta con un nome libero, che
      per un disco pieno fallirà di nuovo.
- [ ] **`PluginError`/`KernelError` sono nel contratto**, quindi la forma scade
      col freeze; ed è il gemello della decisione del ~~§12.1~~ — chi localizza
      le stringhe localizza anche gli errori, e un messaggio già composto non si
      traduce. Adesso che la [0040](../decisions/0040-chi-localizza.md) ha deciso
      *come* si localizza, questa voce sa già che forma prendere: il payload
      diventa un `Text`, `Display` resta la forma per il log, e il confine Tauri
      smette di restituire `Result<_, String>`. Restano da decidere le **varianti
      che mancano** — `KernelError` non è nel contratto, quindi `NotFound`,
      `AlreadyExists` e `Io` oggi arrivano tutte come prosa dentro un `internal`.

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
