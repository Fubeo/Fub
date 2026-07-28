# 12. Le stringhe, gli errori, il locale

Una **seduta chiusa** della [roadmap infrastrutturale](../todo.md): chi localizza le stringhe localizza anche gli errori, e comunque serve il locale.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa.** Una decisione sola con quattro facce, e la domanda era una:
*chi trasforma un dato in una frase che una persona legge, e in che momento?*

- il **locale** ([0039](../decisions/0039-il-locale-e-il-caso.md)): ciò che
  serve per rispondere, prima ancora di sapere cosa si risponde;
- **chi localizza** ([0040](../decisions/0040-chi-localizza.md)): la risposta
  vera — né una `String` né una chiave, ma un tipo che porta la propria
  provenienza;
- **l'errore** ([0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)):
  la stessa forma dove serve di più, cioè quando le cose vanno male;
- **il catalogo della shell** ([0042](../decisions/0042-il-catalogo-della-shell.md)):
  ciò che restava dopo che le tre di sopra lo avevano ristretto.

Il §12.3 si è preso **per primo**, e non per comodità: era l'unico che non
aspettava la risposta sulle stringhe. Qualunque cosa si fosse decisa sulla UI,
un provider ha comunque bisogno del locale per ordinare e per formattare. Adesso
ce l'ha — `HostEnv::user_locale`, pubblicato dalla shell e composto dal kernel
con le chiavi `locale.*` — e con lui il **caso** (`random_bytes`), che era lo
stesso buco dell'orologio un metodo più in là.

Poi la risposta vera: `Text::Literal` per i dati, `Text::Message` per ciò che si
traduce, risolto dal *kernel* sulla via d'uscita dal contratto col catalogo di
chi l'ha scritto. È il ritaglio più largo fatto alla linea di base dopo quello
della [0021](../decisions/0021-il-confine.md), e per la stessa ragione: ciò che
scade col freeze è la **forma**, non la larghezza.

Il gemello dichiarato — l'errore — ha portato quella forma dove pesa di più, e
ha aggiunto la metà che non è traduzione: **un errore non serve solo a essere
letto, serve a essere distinto**. Il payload di ogni variante è un `Text`, la
forma sul filo è discriminabile (`{kind, message}`), e tre varianti nuove
(`not-found`, `already-exists`, `io`) separano ciò che prima passava tutto come
`internal`. Il `catch` nudo del cestino, che leggeva ogni fallimento come «il
path è di nuovo occupato» e poneva la domanda sbagliata, è adesso un ramo.

L'ultima faccia è la prova che le quattro erano una: il §12.4 non è stato
*eseguito* com'era scritto, è stato **ristretto** dalle tre prima di lui — le
stringhe dei provider le risolve il kernel, quindi alla shell restava solo ciò
che scrive di suo. E ciò che restava si è rivelato la stessa domanda dei token e
dell'accessibilità, che stavano nella stessa voce senza che fosse ovvio perché:
*questo valore è dichiarato in un posto solo, o è ricopiato in due che devono
restare d'accordo?* Il colore che sta nei token **e** dentro `oneDark`. Il nome
accessibile che sta nell'`aria-label` **e** nel titolo della view. La parola che
sta nel catalogo **e** nell'HTML. Ogni punto della voce è una di quelle coppie
sciolta.

Il caso più istruttivo è il contrasto: `--accent-soft` faceva da **sfondo** alle
righe in hover e a quelle selezionate, cioè il rapporto peggiore dell'app stava
proprio sotto il puntatore del mouse. Adesso quelle righe prendono `--bg-hover`,
e `--accent-soft` torna a essere inchiostro — che è il ruolo per cui è
dichiarato, e che il presidio verifica.

Due cose vale la pena ricordarsele fuori dai verbali, perché torneranno:

- **Il plurale non esiste.** Il motore dei template — questo e quello del
  contratto — non sa scegliere una forma plurale, quindi le frasi coi conteggi
  sono riscritte in forma che non lo chiede («Parole: 3», non «3 parole»). Una
  frase con un ternario dentro non è traducibile e non lo dice: passa i tipi,
  passa i test, e sbaglia in ogni lingua che non declina come l'italiano.
- **Un presidio che guarda del testo deve dichiarare in che lingua guarda.**
  Senza, `t()` risolve su `navigator.language` e la suite passa o fallisce
  secondo chi la lancia. È fissata una volta in `frontend/src/test-setup.ts`.

Resta fuori, e sono di altre sedute:

- **`SettingKind::rejects()` porta italiano cablato dentro l'ABI.** Non è un fix
  meccanico rimasto indietro: nessun catalogo appartiene all'ABI, quindi darne
  uno al contratto è una decisione di forma. Si vede in `settings.import`, dove
  le ragioni dei rifiuti attraversano come dato e restano italiane.
- Che ciò che va storto **nel backend** abbia una variante di evento con dentro
  un errore tipizzato è il [§20.2](20-quando-qualcosa-va-storto.md) — il tipo
  adesso c'è —, e che gli avvisi oggi scritti in `console` arrivino a una
  superficie è il [§20.4](20-quando-qualcosa-va-storto.md). Il posto dove
  atterreranno c'è già: il centro notifiche della
  [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md).
- L'alto contrasto, il reduced motion, le dimensioni del testo e il font per
  dislessia sono la **§25.1**, e adesso hanno su cosa poggiare: i token. È anche
  la via d'uscita dell'unico debito di contrasto lasciato dichiarato (il dark
  `--accent-contrast` su `--accent`, AA senza margine).
- I temi di terze parti, gli snippet CSS e il CSS per nota o cartella sono la
  **6.2**, di cui i token erano il prerequisito.
