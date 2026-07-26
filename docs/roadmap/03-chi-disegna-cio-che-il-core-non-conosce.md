# 3. Chi disegna ciò che il core non conosce

Una **seduta** della [roadmap infrastrutturale](../todo.md): una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quarto giro lo dice alla lettera: **§3.1, §3.2 e §3.3 sono una decisione
sola vista da tre lati**, e vanno prese nella stessa seduta o due terzi della
risposta saranno inutilizzabili. I tre lati sono: chi aggiunge la *sintassi*
(3.1), chi disegna il *blocco* che ne esce (3.2), chi fa entrare un renderer di
terzi nella *shell* (3.3). Un plugin che può aggiungere la sintassi ma non il
renderer, o il renderer Rust ma non quello della shell, è mezzo plugin.

Con loro le due voci che aprono le stesse porte dal lato delle opzioni (3.4) e
dei tipi chiusi troppo presto (3.5) — e dentro la 3.5 **non c'è una precedenza
interna**: i quattro tipi hanno la stessa forma (uno o tre booleani dove serve
una mappa con namespace) e la stessa risposta, e nessuno dei quattro si sistema
appendendo un campo. Vanno in blocco, con la 3.4 che chiede la stessa cosa al
`ParseContext`. E la
sanitizzazione (3.6), che è la domanda «e se il blocco custom resta una stringa
HTML, chi la ripulisce?»: la risposta cambia a seconda di come si chiude il
capitolo 4, quindi va decisa qui e non altrove.

### 3.1 Il parser è sostituibile, non estendibile

*ex §1.22 · contratto · **P0** — leva alta: è l'unico punto in cui «una feature ufficiale è ciò che scriverà un plugin» è **già falsa oggi***

- [ ] **`FormatRegistry::by_ext` è una mappa estensione → *un* indice**
      (`kernel/registry.rs:13`) e `register` fa `insert`: chi registra dopo
      **vince in silenzio** (`:22-28`). Non esiste alcun modo di innestare una
      regola sintattica su un provider esistente — si può solo rimpiazzarlo.
- [ ] **Quindi un'estensione di sintassi non può essere un plugin**, ed è
      l'unico punto in cui l'invariante del progetto — «una feature ufficiale è
      ciò che scriverà un plugin di terzi» — è **già falsa oggi**. Le ~50
      estensioni del 5.2 (callout, footnote, definition list, math, mermaid,
      apici/pedici, tabs, timeline, stepper…), «Plugin markdown extensions»
      (20.1) e «Custom markdown blocks» (27.3) richiedono un fork di
      `fubmd-format-markdown`.
- [ ] **Serve una firma per l'innesto** (`SyntaxExtension`/`BlockRule`
      registrata contro un `FormatDescriptor`, con l'ordine di applicazione
      dichiarato) e la regola dei conflitti: due estensioni che rivendicano la
      stessa sintassi oggi non hanno nemmeno un posto dove collidere.
- [ ] **È l'altra metà del §3.4**: quello apre le *opzioni* di parse
      (`ParseContext` chiuso), questo dice **chi aggiunge la sintassi**. Vanno
      decise insieme, o si ottiene un `ParseContext` aperto che nessun terzo
      può popolare.

### 3.2 `Block::Custom` non ha un renderer

*ex §1.23 · contratto · **P0** — va deciso insieme alla 4.1*

- [ ] **L'escape hatch del modello esiste, il suo disegno no.** Il rendering di
      un blocco custom è `if custom_kind == CALLOUT` dentro il provider markdown
      (`format-markdown/src/render.rs:103-143`); ogni altro kind cade in un ramo
      generico che produce `<div class="block-{kind}">` col contenuto dentro
      (`:125-142`). Il primo giro su questa voce diceva «non produce nulla, in
      silenzio»: **era sbagliato già allora** — quel ramo c'è da prima
      (`0a4ee40~1`, `render.rs:84-91`), e la [decisione 0003](../decisions/0003-modello-del-documento.md) gli ha solo aggiunto
      l'ancora e la `label`. Il difetto vero è un altro, e non si vede leggendo
      l'esito: il degrado **non è un renderer**. Mermaid, math e un chart resi
      come `<div class="block-mermaid">` col sorgente dentro sono un blocco che
      l'utente legge crudo — e non c'è modo di dire chi lo disegnerebbe.
- [ ] **La famiglia è grande e ha tutta la stessa forma** — un blocco che il
      core sa delimitare e non sa disegnare: mermaid, PlantUML, Graphviz, D2,
      math, chart, embed di database e di query, tabs, accordion, timeline,
      stepper, file tree (6.1 e 5.2), più «Plugin custom renderers» (20.1).
- [ ] **Serve un punto d'innesto per `custom_kind`**, registrato come gli altri
      provider, e va deciso **insieme al §4.1**: se il modello arriva alla
      shell, una parte di questi si disegna di là (con gli `Span`, quindi
      interattiva); se resta la stringa HTML, si disegnano tutti di qua, e
      allora il §3.6 (sanitizzazione) deve coprire anche loro.

### 3.3 La UI di un plugin non ha modo di entrare nella shell

*ex §3.12 · shell · **P1** — decisione P0, implementazione P1*

- [ ] **`renderUiNode` è uno `switch` esaustivo su un union chiuso**
      (`ui/node.ts`), compilato dentro il bundle. `UiKind::Custom { ns, payload,
      fallback }` **ora esiste** ([decisione 0016](../decisions/0016-cosa-e-una-view.md)),
      e con esso la metà che si poteva fare senza rispondere a questa voce: chi
      non conosce `ns` disegna il `fallback` dichiarativo, ed è ciò che il
      contratto chiede. Quello che manca è **come un `ns` di terzi arriva alla
      shell**: finché non c'è una risposta, `Custom` significa "riservato a chi è
      già nel bundle" — cioè la superficie privilegiata di prima con un altro
      nome. La differenza rispetto a ieri è che ora il varco è nel contratto e
      il debito è tutto di qua.
- [ ] **Il conto è dirimente**: il 21.1 promette che ogni modulo Suite è
      «installabile separatamente» e «disattivabile», e i moduli che hanno
      bisogno di un renderer proprio sono FubCanvas, FubDB, FubCharts, FubMaps,
      FubForms (21.2). Se i loro renderer stanno nel bundle della shell, quella
      promessa è falsa — e lo è **già** per il grafo (`panels/graph.ts`), che
      resta un pannello nativo anche ora che il contratto avrebbe dove metterlo
      (l'area principale) e come disegnarlo (`Custom`).
- [ ] **Le tre opzioni non sono equivalenti**, e vanno scelte prima che venti
      moduli si scrivano contro l'ipotesi implicita:
      - un registro di web component caricati da un bundle di plugin — è la più
        potente e sbatte contro «no eval policy» (20.3) e la CSP del §3.6;
      - un iframe sandboxato con un protocollo di messaggi — regge 20.3 e §3.6,
        costa un confine in più e una storia di temi/asset per i plugin;
      - solo prima parte, e tutto il resto dichiarativo — allora il protocollo
        deve arrivare fino a canvas e chart (tabella e albero ci sono arrivati
        con la [decisione 0016](../decisions/0016-cosa-e-una-view.md)), e
        `Custom` serve al solo core.
- [ ] È il terzo lato della stessa domanda dei §3.1 e §3.2 — **chi disegna
      ciò che il core non conosce** — e le tre risposte devono essere coerenti:
      un plugin che può aggiungere la sintassi ma non il renderer, o il
      renderer Rust ma non quello della shell, è mezzo plugin.

### 3.4 `ParseContext` è chiuso, e `parse` vuole per forza del testo

*ex §1.20 · contratto · **P0** — l'altra metà della 3.1: quella dice chi aggiunge, questa cosa si accende*

- [ ] **Due booleani** (`parse_tags`, `parse_wikilinks`, `format.rs:42-47`) contro
      le ~50 estensioni sintattiche del capitolo 5.2 — callout, footnote,
      definition list, math, mermaid, apici/pedici, tabs, timeline — ognuna
      accendibile per vault (28) o per nota (6.2, classi da frontmatter). Con
      questa forma ogni estensione è un campo nuovo nel contratto: una minor a
      testa. Da decidere ora se porta una mappa di opzioni con namespace, come
      `IndexQuery::Custom`.
- [ ] **`parse(source: &str)` e `Vault::read -> String` escludono i documenti
      non-testo**: un `.canvas`, un CSV grande, un PDF trattato come documento
      (12, 11.4, 13.2) o un file con encoding da rilevare (2.3) non entrano. Il
      §14.1 dà `VaultEntry`/asset lato kernel; questo è il varco nel
      **contratto**, e `FormatProvider` è una firma che M4 congela.

### 3.5 Gli altri tipi chiusi troppo presto

*ex §1.26 · contratto · **P0** — i quattro in blocco: stessa forma, stessa risposta, nessuna precedenza interna*

La [decisione 0016](../decisions/0016-cosa-e-una-view.md) ha visto il caso più
grosso (`ViewPlacement`, ora `ViewSurface` con dieci casi). La stessa forma si
ripete su quattro tipi del contratto — un booleano, o tre, o cinque, dove la
domanda che arriva ha una coda aperta:

- [ ] **`RenderOptions` è un booleano** (`abi/format.rs:62-64`) ed è argomento di
      `FormatProvider::render_html`. Il rendering ha almeno tre bersagli distinti
      — schermo/lettura, stampa e PDF (6.3), pubblicazione statica (19.4) — più
      tema, livello di sanitizzazione (5.3), risoluzione degli asset (13.1) e CSS
      per nota/cartella/tipo (6.2).
- [ ] **`FormatCapabilities` sono 5 booleani** (`abi/format.rs:31-37`) contro le
      ~50 sintassi del 5.2: stessa forma del `ParseContext` del §3.4 e stessa
      risposta (una mappa di capacità con namespace), da decidere con lui e con
      il §3.1.
- [ ] **`Trust` ha due varianti** (`kernel/workspace.rs:116-123`) mentre 20.2 e
      20.3 chiedono verificato, community, locale in sviluppo, revocato — e il
      §7.3 nota già che si applica alle sole view. È l'unico dei quattro che vive
      nel **kernel** e non nell'abi: la sua forma non scade col freeze, ci sta
      qui perché la domanda è la stessa.
- [ ] **`PluginPermissions` sono tre booleani** (`abi/traits.rs:997-1001`) contro
      clipboard, camera/microfono, filesystem esterno e rete con allowlist
      (20.1, 23.1, 20.3 «network allowlist», «file allowlist»).
- [ ] **Il primo giro dava una precedenza a `RenderOptions` con una ragione che
      non regge**, e va detto perché non torni: *allargarlo dopo il freeze rompe
      la firma di ogni provider*. No. Un campo appeso in fondo a un `record` è fra
      le aggiunte che il presidio della [decisione 0002](../decisions/0002-additivita-del-contratto.md) deve far **passare**, e
      `render-html: func(model, opts: render-options)` (`wit/fubmd/abi.wit:342`)
      non cambia di una virgola; in Rust, chi *implementa* `FormatProvider` legge
      i campi e non si accorge di niente — a rompersi sarebbero i siti di
      costruzione, che sono tutti in questo repo e hanno `derive(Default)`. E il
      `ParseContext` del §3.4 è lo stesso caso al millimetro (`record` in WIT,
      `derive(Default)`, parametro di `parse` nella stessa interfaccia), quindi
      una precedenza fra i due non ha su cosa poggiare. **Ciò che davvero non si
      fa più dopo il freeze è sostituire il tipo** — passare da N booleani a una
      mappa con namespace — ed è esattamente la risposta che tutti e quattro
      vogliono. Per questo vanno in blocco: la scadenza è comune, e non è la
      larghezza, è la forma.

### 3.6 Sanitizzazione e CSP in un punto solo

*ex §3.4 · shell · **P2** — P2 come lavoro, ma la regola la fissa questa seduta*

- [ ] **Sanitizer per l'HTML che entra nella webview**: `ui.ts:63-67` fa
      `innerHTML` diretto su `UiNode::Html`, e l'anteprima innesta l'HTML del
      provider. Il rendering è già escapato lato Rust, ma la regola deve valere
      per *chiunque* produca HTML (embed, plugin fidati, temi).
- [ ] **CSP stretta** in `tauri.conf.json` + `rel="noopener"` sui link esterni +
      blocco di default delle immagini/font remoti con consenso esplicito
      (5.3, 23.2).
- [ ] **Sandbox degli embed** (iframe, SVG, PDF) con la stessa policy.
