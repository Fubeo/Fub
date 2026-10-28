# 0222 — Tre strati in ogni superficie, e l'aspetto del contenuto lo dichiara la modalità

- **Stato:** proposta
- **Data:** 2026-10-25
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fin dove arriva il tema dentro un editor? Ogni superficie rispondeva a modo
suo. Il Markdown prende tutto dal tema; il disegno tiene la carta bianca del
file e dipinge i segni di Fub con i colori del tema; il documento scrive in
linea caratteri e colori del file, che sono pensati per il bianco e finiscono
su una carta scura di notte, mentre le sue revisioni scrivono sull'elemento
`var(--accent)` e `var(--danger)`. Nel foglio di calcolo il testo automatico
prende `--doc-fg`: di notte `#dbdee3` su un riempimento `#fff2cc` del file,
cioè 1,2:1.

Il tema arriva a due profondità. I suoi token arrivano ovunque; le sue regole
arrivano soltanto dove l'elemento ha una classe dell'anatomia e lo stile non è
scritto sull'elemento. Senza una regola comune ogni editor rifà luce scura,
contrasto alto, colori forzati e moto ridotto, e un tema di terzi non sa che
cosa può vestire.

La regola tocca soltanto le superfici della shell (`apps/client/src/editors/`
e i renderer fidati). Le view dichiarative dei plugin scelgono già intenti e non
colori (`crates/fub-abi/src/ui.rs`), e un provider di formato porta l'aspetto
del file come dati, non come CSS: per loro non cambia niente.

## Decisione

Ogni superficie ha tre strati, ciascuno con un padrone fisso:

1. **cornice**: barre, pannelli, menu, righelli, scrivania. È sempre del tema;
2. **segno**: ciò che Fub disegna sul contenuto (selezione, cursore, fuoco,
   ricerca, revisioni, correttore, commenti, maniglie). È sempre del tema, con
   i colori della carta su cui sta;
3. **contenuto**: ciò che il file dice. Chi ne ha l'autorità lo dichiara la
   modalità della superficie, con uno di tre aspetti.

Gli aspetti sono questi:

- `tema`: il tema veste il contenuto, e del file restano struttura ed enfasi;
- `file`: vince ogni valore del file, sulla sua carta; i segni prendono i
  colori del tema per la carta chiara;
- `adattato`: le tinte del file sulla carta del tema, con la sola chiarezza
  corretta da una funzione della shell. Il colore tiene il contrasto che aveva
  sulla carta del file, non scende sotto la soglia di legge e non sale oltre
  l'inchiostro della carta nuova.

Chi sceglie e dove:

- la modalità dichiara gli aspetti che offre, il predefinito per primo
  (`SurfaceMode.looks`). È l'unico punto in cui un editor sceglie;
- la persona sceglie per riquadro e per famiglia, come sceglie la modalità; la
  scelta resta anche quando la modalità non la offre, e si torna al predefinito;
- l'impostazione `appearance.content-look` dà il predefinito: `auto` è il
  predefinito della modalità, oppure `adattato` con il contrasto alto;
- la radice del contenuto riceve la classe `look-tema`, `look-file` o
  `look-adattato`. Una classe e non un attributo, perché i frammenti CSS
  accettano soltanto selettori di classe.

Come si fa rispettare:

- ogni hook dell'anatomia dichiara il suo strato, e il contratto del tema lo
  esporta;
- la meccanica degli aspetti sta in `structure.css`, che non passa dal
  sanificatore: una pelle non la può revocare;
- i segni sulle due carte sono ruoli facoltativi del tema (`--doc-ins`,
  `--doc-find`, `--paper-*`, …), con le loro coppie di contrasto contate solo
  quando il tema li dichiara: un ruolo obbligatorio nuovo farebbe rifiutare ogni
  tema `theme-2` già scritto;
- un editor non scrive un ruolo del tema sull'elemento; sull'elemento vanno i
  valori del file, come variabili di dato;
- i colori forzati vincono in ogni aspetto.

È obbligatorio che una modalità nuova dichiari i suoi aspetti. Una conseguenza
possibile, non ancora presente, è il gate delle classi di contenuto: per una
famiglia che offre `file` o `adattato`, una regola della pelle, di un tema o di
un frammento vale solo sotto `.look-tema`. Si accende un pezzo alla volta,
quando la superficie del pezzo dipinge la carta del file.

## Conseguenze

### Positive

- la cornice resta coerente in ogni superficie, e un tema di terzi sa che cosa
  veste;
- il file resta fedele dove l'aspetto conta, come un documento da spedire;
- luce scura, contrasto alto e colori forzati si risolvono una volta, nella
  shell, e non in ogni editor;
- l'adattamento dà lo stesso colore allo stesso valore in ogni editor.

### Negative

- un campo nuovo nelle modalità, una guardia in più e, con il gate, un
  contratto più stretto per i temi `theme-2`;
- le righe che scrivono ancora un ruolo in linea restano in un elenco di
  eccezioni, e il tema di CodeMirror è un caso a parte (issue #242);
- la carta di un file è chiara anche di notte, e il passaggio dalla scrivania
  scura alla pagina bianca è voluto.

## Alternative scartate

### A. Il tema vince sempre

Coerente, con il contrasto garantito dalla ricetta e la luce scura gratis. Ma
tradisce i formati che hanno un aspetto loro: un docx non sarebbe più quello
che vede chi lo riceve.

### B. Il file vince sempre, il tema solo nella cornice

Fedele e semplice. Ma niente lettura di notte e nessun aiuto con il contrasto
alto; il Markdown, che non ha un aspetto suo, ricadrebbe nel tema, e la regola
nascerebbe con un'eccezione.

### C. Decide il plugin, liberamente

Non chiede un contratto. Ma ogni editor rifà luce scura, contrasto e colori
forzati, i temi di terzi non arrivano, e vale solo per il codice fidato, perché
un plugin WASM non ha CSS.

### D. Isolamento con shadow DOM o iframe

Un confine netto, senza selettori che si scontrano. Ma costa su fuoco,
selezione, accessibilità e WebKitGTK, e i segni di Fub servono anche dentro:
i token andrebbero passati lo stesso, e il problema si sposterebbe.

## Verifica

- `apps/client/src/theme/content-look.test.ts`: la scelta dell'aspetto, il
  ritorno al predefinito, `auto` con il contrasto alto;
- `apps/client/src/editors/core/surface-looks.test.ts`: ogni modalità dichiara i
  suoi aspetti, con un elenco delle mancanti che può solo accorciarsi;
- `apps/client/src/theme/adapt.test.ts`: i numeri dell'adattamento;
- `apps/client/src/theme/scrittoio/anatomia.test.ts` e `npm run theme:verify`:
  lo strato di ogni hook, nel contratto del tema;
- `apps/client/src/theme/recipe.test.ts`, `structure.test.ts` e
  `scrittoio/gate.test.ts`: i ruoli facoltativi, le loro coppie, la meccanica
  di `look-file` e un tema senza i ruoli nuovi che resta valido;
- `.github/scripts/check-inline-theme.mjs`: nessun ruolo del tema scritto
  sull'elemento negli editor oltre l'elenco delle eccezioni;
- `crates/fub-host/src/legacy_tests/switches.rs`: i valori di
  `appearance.content-look` sono gli stessi nell'host e nella shell.
