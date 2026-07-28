# 0040 — Chi localizza: il testo che porta la propria provenienza

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §12.1 (seduta 12) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/12-stringhe-errori-locale.md)

---

Il §12.1 poneva la domanda in una riga sola: *oggi un `ViewProvider` restituisce
`UiNode::Text { content: "Nessun backlink" }`, cioè prosa italiana cablata dentro
il provider — o i provider ricevono un `locale` e traducono, o restituiscono
chiavi che qualcun altro risolve.* La [0039](0039-il-locale-e-il-caso.md) aveva
appena messo il `locale` nel contratto, ma dichiarava anche di non aver mosso
nessuna di quelle frasi: il fatto c'era, la decisione no.

Ed era una voce **P0** perché non è una feature. È una scelta di **forma dei
tipi**: dopo il freeze di M4 un campo `title: string` che deve diventare
qualcos'altro non è una minor, è una rottura. Chiunque fra un anno guardi il
contratto congelato ci troverà questa scelta dentro, giusta o sbagliata che sia.

## La risposta, in una frase

**Il testo che una persona legge non è una `String` e non è una chiave: è un tipo
che porta la propria provenienza — `Text::Literal` per i dati, `Text::Message`
per ciò che si traduce — e a risolverlo è il kernel, sulla via d'uscita dal
contratto, col catalogo di chi l'ha scritto.**

## Perché le due risposte ovvie sono sbagliate, e in modo simmetrico

**«Il provider traduce.»** Vorrebbe dire che ogni componente si imbarca un
runtime i18n, il proprio catalogo e la propria scala di ripiego. Vorrebbe dire
che `render_view` — che la [0016](0016-cosa-e-una-view.md) ha reso *puro,
sincrono e senza stato* apposta — diventa dipendente da uno stato da invalidare a
ogni cambio di lingua. Vorrebbe dire che la qualità della traduzione di FubMD è
la peggiore fra quelle dei plugin installati. E soprattutto vorrebbe dire quello
che il §12.2 dice in una frase e che vale identico qui: **un messaggio già
composto non si traduce.** Chi lo riceve ha una stringa, e non sa più da cosa
venisse.

**«Tutto è una chiave.»** Vorrebbe dire che il nome di un tag, il titolo di una
nota, un path e un conteggio — cioè la maggioranza schiacciante di ciò che
attraversa il confine verso uno schermo — devono passare da un catalogo che non
li contiene. O da una convenzione di fuga (`!literal:a/Uno.md`) che è
esattamente la specie di convenzione privata che il §2.7 ha smontato quando i dati
finivano dentro l'id di un'azione. Un `DocId` non si traduce.

Le due risposte sbagliano dallo stesso punto: **assumono che il tipo sappia già
di che natura è il suo contenuto.** Non lo sa, e non lo può sapere — lo sa solo
chi scrive quella riga di codice, caso per caso.

## Le decisioni prese, da NON ridiscutere senza motivo

### `Text` è un enum `untagged`, con `Literal` per primo

```rust
#[serde(untagged)]
pub enum Text { Literal(String), Message(Message) }
```

L'ordine non è estetico. Con `untagged`, una stringa JSON resta una stringa JSON
e un messaggio è un oggetto: le due forme non possono collidere, e mettere
`Literal` per primo è ciò che rende **gratuita la forma comune**. È la stessa
proprietà che il `#[serde(flatten)]` della chiave di un `UiNode` compra nella
[0016](0016-cosa-e-una-view.md) — un nodo senza chiave serializza come prima.

Da lì scende la conseguenza pratica più importante di questo verbale:

> **`Text` è un tipo di contratto (provider ↔ kernel), non un tipo di IPC
> (kernel ↔ shell).**

Dopo la risoluzione ogni `Text` è un `Literal`, e un `Literal` sul filo **è una
stringa nuda**. Il mirror TypeScript non ha imparato niente: `frontend/` non ha
cambiato una riga per il §12.1, e i suoi 209 test sono passati senza toccarli. È
presidiato da `on_the_wire_a_resolved_text_is_a_bare_string`, che serializza un
albero reso e asserisce che al posto di un titolo ci sia una stringa e non un
oggetto con dentro una chiave.

### `Literal` è il default, e questo è il degrado garbato

`impl From<&str>` e `From<String>`: chi scrive `UiNode::text("Nessun backlink")`
continua a compilare e continua a vedersi l'italiano. Non è un residuo da
ripulire — è la regola di `Trust::default` applicata alle stringhe: **ciò che si
ottiene dimenticandosi non può essere più di ciò che si ottiene dichiarando.**
Sei delle otto feature ufficiali non dichiarano un catalogo, e si leggono
esattamente come prima.

Vale anche nel verso opposto: un componente che dichiara chiavi e non ha
catalogo non rompe niente, perché l'ultimo gradino della scala è la chiave nuda.

### La scala di ripiego, e il suo ultimo gradino

`it-IT` → `it` → la lingua di ripiego dichiarata dal componente → **la chiave
nuda**.

Il quarto gradino è deliberato: brutto, onesto e soprattutto *cercabile*. Un
ripiego che inventasse una prosa plausibile renderebbe una chiave mancante
indistinguibile da una traduzione fatta male — e la si scoprirebbe da una
segnalazione, non da un `grep`.

### Gli argomenti sono tipizzati, non stringhe già formattate

`ArgValue` è `Text | Int | Float | Timestamp`, e non una `String`. Due ragioni,
tutte e due strutturali:

- **Un provider che passasse `"28/07/2026"` avrebbe già deciso il calendario e il
  fuso** di un utente che non conosce, e nessuno a valle potrebbe più
  correggerlo. Formattare è lavoro di chi conosce il locale — che è precisamente
  ciò che la [0039](0039-il-locale-e-il-caso.md) ha messo nel kernel.
- **Un provider che passasse `"3"` avrebbe già buttato via** ciò con cui si
  sceglie una forma plurale.

`Timestamp` è l'argomento che rende l'argomento concreto invece che teorico:
`Locale::format_timestamp` applica offset e `hour_cycle`, e lo stesso messaggio
si legge `14:30` a Roma e `8:30 AM` a New York senza che il provider sappia dove
si trovi chi guarda.

Il rovescio va detto per intero, ed è la parte che non è ancora vera:
`Int` e `Float` sono resi nella forma **invariante** — separatore decimale `.`,
nessun raggruppamento delle migliaia. Serve una tabella CLDR che il contratto non
porta. Ma è esattamente il punto del tipo: **quando quella tabella arriverà si
cambierà un metodo, non N provider.** La forma è congelata, il formattatore no.

### Il template ha una sola costruzione, e crescerà da lì

A M2: `{nome}`, con `{{` e `}}` per le graffe letterali. Un nome sconosciuto
resta scritto com'è, graffe comprese — stessa scelta dell'ultimo gradino della
scala.

Niente plurali, niente genere. La cosa che conta è **dove** cresceranno: dentro
il linguaggio del template, che è *dato di catalogo*. Il giorno che un catalogo
scriverà `{n, plural, one{…} other{…}}`, il tipo congelato a M4 non avrà bisogno
di cambiare — gli argomenti tipizzati ci sono già.

### Il catalogo sta nel manifest, con chiavi **nude**

`PluginManifest.strings: Vec<StringCatalog>` e `default_locale`, in coda (quindi
additivi: vedi sotto). Sta lì per le due ragioni per cui ci sta lo schema delle
impostazioni della [0036](0036-le-impostazioni-e-i-tre-stati.md) — si legge
**prima** di montare, e una palette mostra i titoli di componenti che nessuno ha
ancora attivato — più una terza che è solo delle stringhe: **un catalogo è
dato**, e dato nel manifest vuol dire che un traduttore corregge una frase senza
ricompilare, e che a M5 un componente WASM di terzi non se lo scrive a build
time.

Le chiavi sono **nude**, e qui c'è una differenza deliberata dalle impostazioni.
Quelle vivono in un archivio solo e devono quindi qualificarsi col nome di chi le
dichiara (`versioning.enabled`, regola del §7.4). Un catalogo appartiene a un
componente e basta: la qualifica è **strutturale**, e un plugin non ha nemmeno il
modo di *nominare* la stringa di un altro. È più forte della regola dei nomi, non
più debole — e infatti `the_catalog_is_the_owners_one` prova che due view che
disegnano la stessa identica chiave si leggono diverse.

### A risolvere è il kernel, e non la shell

È la scelta meno ovvia delle sei, e la più difendibile. La shell è **uno** dei
tre host previsti: c'è la CLI (27.1) e c'è l'API locale (27.2), e tutti e tre
hanno lo stesso bisogno. Il kernel è l'unico posto che ognuno dei tre attraversa.
Risolvere nella shell avrebbe voluto dire riscrivere la scala di ripiego tre
volte, e sbagliarla in due.

I punti di uscita sono cinque, e sono tutti in `Workspace`: `render_view`,
`view_action`, `views`, `commands`, `invoke_command`, `settings_entries`. Il
metodo che li serve è uno solo (`Workspace::localize`).

### Il trait `Localize` sta nel contratto, il catalogo nel kernel

Il taglio è la parte di cui vado più fiero, e vale la pena scriverlo perché dal
diff non si vede: **`Localize` dice *dove sono* i testi, `Strings` dice *cosa
diventano*.**

`impl Localize for UiKind` è un `match` esaustivo che vive **accanto all'enum**,
esattamente come `UiNode::children` della [0016](0016-cosa-e-una-view.md) e per
la stessa lezione: una variante nuova con un'etichetta dentro deve **rompere la
compilazione lì**, non arrivare all'utente non tradotta perché nessuno si è
ricordato di elencarla. Se l'attraversamento l'avesse scritto il kernel, un buco
sarebbe stato silenzioso — e il kernel avrebbe dovuto conoscere la forma di ogni
albero del contratto.

## Cosa questo ha rotto, deliberatamente

Il presidio dell'additività (`wit_additivity.rs`) è diventato rosso, ed è stato
**ritagliato**: `crates/fubmd-abi/wit/frozen/0.1.0.wit` è stato riscritto, con la riga in tabella
che dice perché. Pre-freeze è la procedura prevista — una rottura si fa vedendola
in review, che è tutta la differenza con non vederla affatto.

Ciò che ha rotto: ventidue record di `ui`, più `command-spec`, `param-spec`,
`choice`, `command-plan`, `command-outcome`, `setting-spec`, `view-spec`. Ogni
campo che una persona legge è passato da `string` a `text`.

**Non poteva essere additivo**, e vale la pena dire perché l'alternativa è stata
scartata: una `string` *in più* accanto a ogni etichetta (`title` +
`title_key`) avrebbe raddoppiato la superficie del contratto e lasciato in piedi
la domanda a cui nessuno sa rispondere — *quale delle due vince quando ci sono
tutte e due?* Quella domanda si sarebbe risolta con una convenzione, cioè con la
specie di cosa che questa cartella esiste per non lasciar succedere.

`plugin-manifest` invece guadagna `strings` e `default-locale` **in coda**, e
quello sì è additivo: il catalogo è dato nuovo, non un ritipo.

## Cosa si è scartato, e perché

- **Un `Text` che è solo una chiave, con una convenzione di fuga per i dati.**
  Vedi sopra: il novanta per cento del traffico è dato, e la convenzione sarebbe
  diventata contratto de facto.
- **Un secondo campo accanto a ogni etichetta.** Vedi sopra: due verità, e una
  domanda senza risposta.
- **Risolvere nella shell.** Tre host, tre implementazioni, due sbagliate.
- **`ArgValue` come `String` già formattata.** Avrebbe reso il tipo inutile: il
  provider avrebbe deciso fuso e calendario di chi legge, e il plurale sarebbe
  stato inesprimibile per sempre.
- **Un tag interno per `ArgValue` (`#[serde(tag = "kind")]`).** Non è un gusto,
  non compila: serde non sa serializzare una variante taggata *internamente* il
  cui payload non è una mappa. È adiacente, come `UiValue`.
- **`Icon.name`, `Custom.ns`, `Html.html`, `WebView.url` e tutti i `value` come
  `Text`.** Non sono prosa. Un nome di icona è un id del repertorio della shell,
  un `ns` è un namespace, un `value` di `UiOption` è ciò che torna nei
  `FieldValue`: tradurli romperebbe l'identità che sono.
- **Una chiave di gruppo distinta dal titolo di gruppo in `SettingSpec`.** Ci ho
  pensato, e per oggi sono due campi per dire una cosa: chi disegna raggruppa per
  intestazione **risolta**, che è la stessa semantica di quando il campo era prosa
  libera. Diventerà la forma giusta il giorno che i gruppi saranno ordinabili o
  annidati.
- **Tradurre anche in *ingresso*.** Un `UiAction` che arrivasse dalla shell
  attraversa il kernel senza che nessuno guardi dentro: ciò che entra da un click
  è dato dell'utente, e chi lo risolvesse tradurrebbe quello che qualcuno ha
  digitato. Presidiato da `nothing_is_resolved_on_the_way_in`.

## Cosa resta scoperto (e dove è scritto)

- **Sei feature ufficiali su otto non hanno un catalogo.** Backlink e tag sono
  clienti veri — le due che la roadmap nomina, e le due con la prosa che si vede
  di più — e le altre continuano a restituire italiano cablato. È il degrado
  garbato in azione e non un bug, ma è anche lavoro che qualcuno dovrà fare: sta
  nel §12.4 insieme al catalogo della shell, che è l'altra metà.
- **La shell scrive ancora la propria prosa in italiano** (`main.ts`,
  `panels/*.ts`). Il §12.4 le dà il suo `t()`; dopo questa decisione riguarda
  **solo** le stringhe che la shell scrive di suo, perché quelle dei provider le
  risolve il kernel.
- **`Int` e `Float` non sono ancora localizzati.** Detto sopra: serve CLDR, e
  quando arriverà arriverà in `ArgValue::render`.
- **Il plurale e il genere non ci sono.** Cresceranno nel template, non nel tipo.
- **Il §12.2 è il gemello, ed è la voce successiva**: `PluginError` porta ancora
  `String` in ogni variante, quindi un errore è **l'unica cosa che attraversa il
  confine verso uno schermo e non si può ancora tradurre**. Questa decisione gli
  ha preparato il posto — il payload diventa un `Text` e `Display` resta la forma
  per il log — ma finché non è fatta, metà della superficie resta indietro.
- **Nessuno verifica che una chiave dichiarata esista in tutti i cataloghi di un
  componente.** Un `it` completo e un `en` a metà si scoprono a schermo, gradino
  per gradino. È un presidio da scrivere (§17), non una scelta.
