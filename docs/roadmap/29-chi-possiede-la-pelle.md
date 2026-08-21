# 29. Chi possiede la pelle della shell

Una **seduta** della [roadmap infrastrutturale](../todo.md). La pelle della
shell — i token, il chrome dei componenti, le animazioni — smette di essere
della shell e diventa un **fascio sostituibile**, di cui il tema di serie è il
primo esemplare: un tema di terzi non si sovrappone, **prende il posto**. Sei
voci, tutte aperte, e la prima si può fare domani senza decidere nessuna delle
altre cinque.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: da una decisione di prodotto, presa il
2026-08-17.** La community deve poter fare temi — colori propri, animazioni
proprie — e il risultato non deve essere «qualcosa che si sovrappone alla GUI»,
ma una sostituzione, con un minimo di coerenza con l'applicazione base. Le
caselle che questa seduta sblocca esistono da un pezzo: temi e anteprima in
[FEATURES.md §6.2](../FEATURES.md), *Plugin themes* in §20.1, alto contrasto e
movimento ridotto in §25.1. E la promessa è già scritta nel codice:
`frontend/src/theme/tokens.css` chiude il proprio commento con la riga che
aspetta questa seduta — *«un tema di terze parti ridichiara venticinque ruoli,
non milleduecento regole»*.

**La via dell'overlay è scartata, non rimandata.** È la strada che altri editor
usano: il CSS di terzi caricato dopo quello di serie, che vince dove la
specificità lo consente. Scartata per tre ragioni, e la prima è
l'anti-requisito: la decisione di prodotto chiede una *sostituzione*. La
seconda: un overlay incompleto mostra il mix involontario di due estetiche — i
pezzi non sovrascritti restano della serie, e nessuno li ha scelti. La terza:
nessun cancello tiene — né sul contrasto, né sul moto, né su ciò che quel CSS
può caricare. Il lato sociale di quella strada — la cartella, il file, il
riavvia — resta tutto: è il *come* interno che cambia.

**Il conto, prima delle decisioni** — e i numeri portano accanto il comando che
li rimisura, come la [seduta 26](26-otto-gesti-che-nessuno-puo-dichiarare.md)
insegna:

- `theme/tokens.css` dichiara oggi **132** valori
  (`grep -c '^  --' frontend/src/theme/tokens.css`);
- il blocco chiaro del file ridichiara **44** di quei ruoli — ed è il primo
  tema completo mai scritto per questa shell: il prototipo gratuito di ciò che
  un tema di terzi dovrà portare;
- `theme/contrast.test.ts` già ricalcola le coppie che quei valori dichiarano di
  formare: il cancello del contrasto non si inventa, si sposta dal banco al
  caricatore.

E il tema non è solo la cornice: il tema dell'editor e quello dell'anteprima
derivano dagli stessi token — «la stessa nota vista in tre modi» — e il grafo
su canvas li legge con `getComputedStyle` (`panels/graph.ts`). Un tema che
ridichiara i ruoli ricolora tutto, gratis.

**Perché adesso, e perché non è una voce del freeze.** L'invariante che la
[0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) ha già
difeso una volta — *«una feature ufficiale è ciò che scriverà un plugin di
terzi»* — su un punto è ancora falsa: la pelle. La sintassi di terzi l'ha
raccolta il `custom_kind`; la pelle di terzi non ha nessuna strada. Ma il
contratto che questa seduta apre è **di una specie nuova**: non sta nel WIT, e
la [seduta 27](27-tre-scommesse-che-nessuno-ha-provato.md) ha già misurato che
cosa significa — ciò che il freeze incassa è quel che il contratto *dichiara*,
e nel WIT non c'è nessun vocabolario di classi da congelare. La scadenza vera è
un'altra, ed è più vicina del freeze: il vocabolario degli hook (§29.2) si
congela **dopo** che M3 ha assestato la GUI, perché congelare prima vuol dire
rompere i temi a ogni seduta.

---

## Perché stanno insieme

In tutte e sei la domanda è una sola — **chi possiede la pelle** — vista da sei
lati: che cosa si sostituisce (§29.1), con quale contratto (§29.2), attraverso
quali cancelli (§29.3), su quale strada di montaggio (§29.4), con quale gesto
dell'utente (§29.5), e dove il tutto vive (§29.6). Decise una per volta
producono due modi di fare la stessa cosa — un loader della shell accanto a un
loader dei bundle, un validatore nel banco accanto a uno nel caricatore — che
non si accorgono mai di essere diversi. È l'argomento con cui la
[0015](../decisions/0015-la-forma-della-shell.md) ha spezzato `main.ts`, un
piano più su.

Il punto di applicazione è lo stesso della 0015 e della
[0031](../decisions/0031-chi-possiede-i-bundle.md): il dogfooding. **Il tema di
serie passa per la stessa porta dei temi di terzi** — stesso caricatore, stesso
manifest, stessi cancelli — perché se la feature ufficiale ha una strada sua,
la porta dei terzi non è mai stata provata. È la mossa che ha reso vere le
sette view ufficiali e il renderer dei diagrammi.

## I tre strati, e i loro padri

La sostituzione è vera per costruzione se ciò che un tema porta ha un posto
suo, e il posto non è «sopra»:

| Strato | Contenuto | Padre |
| --- | --- | --- |
| **struttura** | le metriche della scocca (`--titlebar-h`, `--rail-w`), la scala dei piani, la geometria dei riquadri: *dove* sta cosa | la shell, **non tematizzabile** |
| **foglio** | i ruoli semantici — colori shell, documento, sintassi — più tipografia e moto: *com'è fatto* | **il tema** |
| **pelle** | il chrome dei componenti: bordi, hover, effetti, keyframes — e le animazioni: *come si muove* | **il tema**, facoltativa |

La regola che tiene insieme i tre: **il caricatore sostituisce, non impila**.
Un solo foglio attivo, una sola pelle attiva. Quando un tema porta la propria
pelle, quella di serie non si carica affatto: niente cascade, niente gara di
specificità. Senza pelle, il tema ride il chrome di serie sui propri ruoli — ed
è un tema completo lo stesso, come il blocco chiaro di `tokens.css` dimostra da
solo.

---

### 29.1 I tre strati, e il caricatore che sostituisce

*shell · **P1***

Lo split vero del foglio visivo, con il caricatore che lo monta. È l'unica
voce che si può decidere da sola, ed è la precondizione di tutte le altre: fin
ché il foglio di serie è un file cablato, non c'è niente da sostituire.

- [ ] **Spezzare `tokens.css` e `style.css` nei tre strati**: struttura alla
      shell; foglio (ruoli, tipografia, moto) e pelle (chrome) nel fascio del
      tema di serie. La domanda aperta, decisa qui: dove sta il confine fra
      foglio e struttura — la proposta è che scala di spazi e raggi vadano al
      foglio **con pavimento** (la densità compatta/rilassata è già una casella
      di 6.2), le metriche della scocca no.
- [ ] **Dark e light di serie come primi due temi dello stesso caricatore**:
      `theme/theme.ts` resta il risolutore — scrive sempre un tema concreto,
      niente `prefers-color-scheme` nel CSS, come il commento di `tokens.css`
      già impone — ma smette di essere il proprietario dei valori.
- [ ] **Il caricatore a sostituzione**: monta un foglio togliendo l'altro,
      stessa cosa per la pelle. Nessuna API pubblica: a questa altezza il
      caricatore serve solo alla shell e al tema di serie.
- [ ] **Il banco**: montare due temi di fila e contare i fogli attivi — deve
      uscire **uno**. È il presidio della sostituzione, ed è anche il conto
      che la §29.2 aspetta: quante classi è servito toccare per rimettere in
      piedi la pelle di serie da zero.

### 29.2 Il contratto del tema: ruoli obbligatori e vocabolario degli hook

*contratto · **P1** — di una specie nuova: non sta nel WIT, e la sua scadenza è
la fine di M3, non il freeze*

Ciò che un tema porta ha bisogno di due elenchi congelati, e tutti e due
nascono da un conto, non da un'immaginazione: il primo dal blocco chiaro di
`tokens.css` (44 ridichiarazioni), il secondo dal banco della §29.1.

- [ ] **L'elenco dei ruoli obbligatori**: manca un ruolo → il tema non si
      monta, e il rifiuto **nomina i mancanti** — la regola della
      [0132](../decisions/0132-un-rifiuto-non-e-una-frase.md) applicata a un
      nuovo confine. Il tema parziale non è un tema: è una preferenza (i tre
      stati della [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)) o
      uno snippet, che stanno sopra e sono un'altra specie.
- [ ] **Il vocabolario degli hook**: le classi che una pelle può toccare sono
      API pubblica, versionata a parte (`theme-1`), con la stessa disciplina
      del WIT congelato e una vita sua: l'additività della
      [0002](../decisions/0002-additivita-del-contratto.md) vale anche qui —
      un ruolo nuovo si accoda, toglierne uno costa una major del contratto
      temi.
- [ ] **Il manifest**: `fub-abi`/`fub-host`, mirror in `host/contract.ts` come
      la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) insegna.
      Campi: id, nome, versione, `engine` (`theme-1`), **le luci offerte**
      (scuro, chiaro o coppia — un tema che porta una luce sola dichiara
      quale), il namespace degli asset.
- [ ] **La data del congelamento**: dopo l'assestamento della GUI in M3. Il
      vocabolario congelato troppo presto è un impegno verso terzi che ogni
      seduta rompe; troppo tardi è un ritardo solo. L'innesco è scritto: la
      fine di M3.

### 29.3 I cancelli al montaggio: contrasto, moto, sanificazione

*shell · **P1***

La coerenza minima non è un augurio e non è una revisione a occhio: sono
quattro cancelli che girano al montaggio, prima che l'utente veda qualunque
cosa. Il primo — la completezza — sta nella §29.2; qui gli altri tre.

- [ ] **Contrasto**: le coppie di `theme/contrast.test.ts` diventano la
      tabella che il caricatore ricalcola sui valori del tema. AA sui ruoli
      testo → rifiuto che nomina la coppia caduta. La tabella esce dal banco e
      diventa una fixture letta dai due lati — una tabella, due lettori, come
      `rules-samples.json` per le gemelle.
- [ ] **Moto**: `prefers-reduced-motion` lo fa rispettare **la shell**, non la
      cortesia dell'autore: una regola di struttura che sotto moto ridotto
      spegne il moto del foglio attivo, comunque il tema lo scriva. È il
      pavimento del §25.1. Indicazione di contratto nel manifest del tema:
      animare `transform` e `opacity`, non la geometria.
- [ ] **Sanificazione CSS in un punto solo**: il gemello di `ui/sanitize.ts`
      per i fogli — niente `url()` remoti (una risorsa remota parte da sola e
      dice a chi la serve che quella GUI è aperta: stessa regola di
      `<img src="https://…">` nella 0017), niente `@import`, asset solo dal
      namespace del bundle, selettori solo sul vocabolario degli hook,
      proprietà strutturali (`position`, `z-index`, `display` e le metriche
      della scocca) vietate. La casa è `ui/`, per la tabella di «dove va una
      regola scritta due volte» in [todo.md](../todo.md).
- [ ] **Il rifiuto entra nel canale trouble**: un tema che non passa non è un
      `console.warn` — è un evento, con il nome del tema e la ragione
      ([0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md)).

### 29.4 Un tema è un bundle senza provider

*kernel · **P1***

Il montaggio non è una strada nuova: è quella della 0031, con la riga dei
provider vuota. Un tema non legge niente, non scrive niente, non chiede
permessi — e questo lo rende il bundle più povero che esista, cioè il banco di
prova più onesto della strada di montaggio.

- [ ] **Gli stessi quattro passi del `BundleRegistry`** (versione,
      dichiarazione, `activate`, provider): il primo cancella legge `engine`
      dal manifest — un tema che dichiara `theme-2` su un host `theme-1` non
      si monta, per la stessa ragione di `abi_compatible`: prima
      dell'inventario, non dopo.
- [ ] **`Trust::Community` di default, zero permessi**: il grado lo dice chi
      monta, non il manifest. Un tema con un permesso in manifesto è un
      manifesto sbagliato, e il caricatore lo dice.
- [ ] **L'inventario**: accanto ai componenti nelle impostazioni, con
      `BundleInfo` e un kind suo — «spento» e «non c'è» restano due stati, per
      la stessa ragione per cui `BundleInfo` non è `PluginInfo`.
- [ ] **La scelta è dell'utente, dalla shell**: una chiave di impostazione coi
      tre stati della 0036. Lo scope segue la vita di chi la dichiara
      ([0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)):
      la GUI è della macchina, come `keys.shell.*` — la chiave del tema non sta
      nel vault.

### 29.5 La scheda, l'anteprima, e la via di fuga

*shell · **P1***

Il gesto dell'utente. Una cosa è scegliere un tema, un'altra è provarlo, e la
terza — quella che si scopre quando il supporto arriva — è tornare indietro da
un tema che non parte.

- [ ] **La scheda Temi** in `panels/settings.ts`: elenco, attivazione, e la
      luce offerta da ciascuno. Se il tema porta una luce sola e il sistema
      chiede l'altra, vince il tema di serie **e si dice** — niente cadute
      silenziose.
- [ ] **L'anteprima prima di applicare** (la casella di 6.2): i token CSS
      ereditano per scoping, quindi l'anteprima monta il foglio in un
      contenitore — un tema si prova senza indossarlo.
- [ ] **La via di fuga**: un avvio che salta i temi di terzi, e il gesto
      «torna al tema di serie» raggiungibile senza passare dalla scheda. Un
      tema rotto deve poter somigliare a tutto tranne che a un bug dell'app.
      È la domanda del safe mode della
      [0032](../decisions/0032-il-runner-dei-job.md), un piano sotto: lì un
      plugin, qui un foglio — e il foglio non ha codice da isolare, solo stile
      da non caricare.

### 29.6 Dove vive un tema, e come entra

*kernel · **P2***

L'ultimo lato: il disco. Un tema non è un dato del vault — non deriva da
nessun vault — e la regola del confine è già scritta: i dati derivati da un
vault stanno nel vault, e ciò che non deriva da lì non ci sta.

- [ ] **La cartella dei temi a livello di macchina** (la configurazione
      dell'app, non `.fub/` nel vault): `manifest` + foglio + pelle + asset
      sotto una cartella per tema.
- [ ] **L'installazione da cartella e da archivio locale**, con i cancelli
      della §29.3 che girano **all'installazione**, non solo al caricamento:
      il report dice i ruoli mancanti e le coppie cadute prima che il tema
      companga nella scheda.
- [ ] **Il marketplace resta di 20.2** — questa voce dichiara solo che il
      formato non lo preclude: hash, firma e canali sono l'elenco di 20.3, e
      un tema è il caso più semplice che quell'elenco abbia, perché non c'è
      codice da firmare.
- [ ] **Ciò che un tema non è, scritto nel manifest o vicino**: il CSS per
      nota, per cartella e da frontmatter (6.2) è l'**altra specie** —
      l'overlay dichiarato, che sta sopra qualunque tema e non lo sostituisce;
      e il codice in un tema non entra mai: chi vuole animare con la logica
      sta scrivendo un plugin con la sua `WebView`, non un tema.

---

## Le tappe, e l'ordine che non si scambia

1. **La §29.1 da sola**: split, caricatore, banco. Nessun contratto congelato,
   nessun terzo coinvolto — e in cambio il conto delle classi.
2. **La §29.2 con la §29.3**: il contratto v1 nasce dal conto del passo 1 — il
   vocabolario è ciò che è servito per rifare la pelle di serie da zero — e le
   coppie del contrasto escono dal banco e diventano la fixture del
   caricatore. Deciderle prima del conto è deciderle su un elenco immaginato.
3. **La §29.4 con la §29.5**: bundle e scheda, insieme, perché l'inventario
   senza il gesto è una lista muta e il gesto senza l'inventario è un file
   cablato.
4. **La §29.6**: il disco, e con lui la prima installazione vera.

## Cosa non è questa seduta

- **Non è il rendering del documento** (6.1): il tema porta i ruoli della
  superficie documento, non i renderer che la disegnano.
- **Non è il marketplace** (20.2): la §29.6 ne dichiara solo la
  compatibilità.
- **Non è l'overlay**: snippet, CSS per nota e preferenze restano ciò che sono
  — cose che stanno **sopra** — e la §29.2 le tiene fuori dal contratto del
  tema perché nessuno le confonda con lui.
