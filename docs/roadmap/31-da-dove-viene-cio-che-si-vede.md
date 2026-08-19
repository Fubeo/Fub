# 31. Da dove viene ciò che si vede

Una **seduta** della [roadmap infrastrutturale](../todo.md). La [seduta
29](29-chi-possiede-la-pelle.md) ha fatto della pelle un fascio sostituibile, la
[30](30-il-moto-e-del-tema.md) le ha dato il ritmo: l'architettura che porta un
tema è in piedi, e regge. Questa seduta guarda **ciò che ci sta dentro** — il
tema di serie, primo e unico esemplare — e pone una domanda sola: *da dove
viene, ciascuna delle cose che si vedono?* Nove voci, tre chiuse. La prima non
decideva nessuna delle altre otto: ha costruito l'occhio con cui si guardano, e
la seconda è la prima cosa che quell'occhio ha visto.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: da una decisione di prodotto, presa il
2026-08-19.** I due temi di serie — e la GUI che vestono — devono salire di
qualità, e non di un gradino. Le caselle che questa seduta consuma sono già
scritte: temi, anteprima, densità, font, corpo, interlinea, larghezza del
contenuto in [FEATURES.md §6.2](../features/06-rendering-preview-temi.md); alto
contrasto, riduzione del movimento, spaziatura regolabile in
[§25.1](../features/25-accessibilita-localizzazione.md).

**Ciò che non è in discussione.** I tre strati e i loro padri, il caricatore che
sostituisce invece di impilare, il risolutore che sceglie la luce in TypeScript
e non in CSS: sono la 29, hanno un anno di ragioni scritte accanto, e questa
seduta non ne muove una riga. Nemmeno la scelta di prodotto del nero OLED e
dell'accento lime (`bdc3203`) è in discussione: si tiene, e si porta più in
alto.

**Il difetto sta dove la 29 non guardava.** La 29 ha chiesto *chi possiede* la
pelle, e ha risposto bene. Non ha chiesto *da dove venga* ciò che quella pelle
contiene — e la risposta, misurata, è: da nessuna parte. Ogni colore è stato
scelto una volta, da solo, e poi difeso da un presidio; ogni pannello nuovo ha
rifatto i propri bottoni; la tavolozza del documento è quella che l'editor
montava come pacchetto, rimasta quando il fondo è diventato nero. Un presidio
ferma il rosso: non produce il bello. **La differenza fra un valore difeso e un
valore derivato è tutta questa seduta.**

**Il conto, prima delle decisioni** — e i numeri portano accanto il comando che
li rimisura, come la [seduta
26](26-otto-gesti-che-nessuno-puo-dichiarare.md) insegna. Sono dell'albero del
2026-08-19, su `main` a `5950fc9` più il lavoro del moto non ancora committato:

- i due fogli dichiarano **83** token ciascuno
  (`grep -c '^  --' frontend/src/theme/serie/foglio-chiaro.css`), la struttura
  **8**, e la pelle **300** regole su **2117** righe
  (`grep -c '{' frontend/src/theme/serie/pelle.css`);
- la pelle non contiene **nessun** colore
  (`grep -cE '#[0-9a-fA-F]{3,8}\b' frontend/src/theme/serie/pelle.css` → 0, ed è
  la ragione per cui il conto seguente si può fare con lo stesso carattere):
  nomina **43** id distinti
  (`grep -oE '#[a-z][a-z0-9-]*' … | sort -u | wc -l`) su **94** righe di
  selettore (`grep -E '\{$|,$' … | grep -c '#'`). Un tema di terzi, oggi, non
  eredita un vocabolario: eredita una mappa del DOM;
- **66** regole vestono un bottone
  (`grep -cE '^[^{]*(button|\.[a-z-]*btn|\.win-ctrl|\.tab|\.space-chip)[^{]*\{' …`)
  e **17** un campo (`… (input|select|textarea) …`). Lo stesso idioma
  dell'attivo — `box-shadow: inset 0 -2px 0 var(--accent)` — compare **quattro**
  volte, per tre controlli segmentati e per le tab di un riquadro;
- il vocabolario è chiuso in un verso solo: **tre** `var()` hanno un ripiego su
  token che nessuno dichiara (`--bg-soft`, `--font-sm`, `--text-muted`,
  `grep -oE 'var\(--[a-z0-9-]+, ' … | wc -l`), e **sei** token dichiarati la
  pelle non li spende mai (`--shadow-lg`, `--space-8/9/10`, `--text-md`,
  `--tracking-caps`);
- al buio le superfici stanno a **1,06:1**, **1,14:1** e **1,21:1** dal fondo, e
  la scala **non è monotona**: `--bg-elev` (L OKLCH 0,145) sta *sotto*
  `--bg-input` (0,191) e `--bg-hover` (0,218) — un popover è più scuro del campo
  che contiene. `--bg-chrome` è `#000000` come `--bg`: titlebar, rail e
  statusbar si staccano dal documento per un filetto e nient'altro;
- **sette** dei dieci colori di sintassi in luce stanno sotto la soglia del
  testo, ed è un debito dichiarato per nome dal 2026-07-28, cioè dal giorno in
  cui è nato il tema chiaro (`087a40f`, `SOTTO_AA` in
  `frontend/src/theme/contrast.test.ts`);
- **49** suggerimenti sono `title` nativi
  (`grep -rhoE 'title="|\.title = |setAttribute\("title"' frontend/index.html frontend/src/panels frontend/src/ui | wc -l`):
  lenti, non tematizzati, e senza il tasto accanto;
- **37** superfici si aprono e si chiudono con `hidden` o staccandosi dal DOM
  (`grep -rhoE '\.hidden = |\.remove\(\)' frontend/src/panels frontend/src/ui | wc -l`),
  ed è il censimento vivo che la [§30.4](30-il-moto-e-del-tema.md) chiedeva;
- **21** icone disegnate a mano (`grep -cE '^  [a-z]+: .<' frontend/src/ui/icons.ts`);
- **zero** banchi che rendano la shell: `frontend/banco/` non esiste, e
  `happy-dom` non ha né CSS né misure — `shell.e2e.test.ts` lo dichiara da sé
  (*«non è un presidio di layout: si asserisce su cosa c'è e mai su dove»*).

**Perché adesso, e non dopo M3.** Tre ragioni, e la prima ha una data. Il
vocabolario degli hook si congela **a fine M3**
([§29.2](29-chi-possiede-la-pelle.md)), e oggi quel vocabolario non esiste: ci
sono quarantatré id. Congelare a fine M3 ciò che non è ancora nato vuol dire
congelare gli id, cioè promettere a chi scriverà un tema il markup di oggi. La
seconda: il banco che vede è la precondizione di tutto il resto, e più tardi
arriva più baseline mancano alle tappe già fatte. La terza è di costo: la §29.3
vuole una tabella di coppie letta dal caricatore, la §29.5 vuole un'anteprima,
la §29.4 un inventario — e tutte e tre diventano lavoro meccanico se il tema di
serie ci arriva già derivato da una regola invece che scelto a mano.

**Nessuna di queste nove scade col freeze.** Non stanno nel WIT: nessun tipo del
contratto cambia, e la sola voce che tocchi Rust è la §31.6, che aggiunge chiavi
di impostazione — additive per costruzione, come la
[0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha già stabilito.
Scadono tutte con M3, per la stessa ragione della §29.2.

---

## Perché stanno insieme

In tutte e nove la domanda è una sola — **da dove viene ciò che si vede** — e
oggi la risposta è nove volte la stessa: *da una scelta fatta una volta e mai
più derivabile*. Un colore, una voce di carattere, un bottone, una distanza, una
preferenza, una soglia, una superficie di scrittura, un nome di classe: ognuna
di queste cose, adesso, sta scritta dove capita che qualcuno l'abbia scritta.

Decise una per volta producono nove volte lo stesso difetto in nove posti
diversi — e non è un'ipotesi: è come è nata la pelle di oggi. La prova sta in
`--bg-hover`, che è stato per undici regole `--bg-input` usato per un'altra
cosa, finché il tema chiaro non ha chiesto di cambiarne uno solo dei due. È
l'argomento con cui la [0015](../decisions/0015-la-forma-della-shell.md) ha
spezzato `main.ts` e con cui la 29 ha tenuto insieme le sue sei.

Il punto di applicazione è di nuovo il dogfooding, e stavolta con un cancello in
più. **Il tema di serie passa per la stessa porta dei terzi** (29), *e per lo
stesso banco*: le scene che fotografano la serie fotograferanno un tema di terzi
con lo stesso comando. Ciò che la pelle di serie fa con un id, un tema di terzi
non potrà mai farlo — quindi non lo fa nemmeno la serie.

| Voce | Da dove viene, oggi | Da dove verrà |
| --- | --- | --- |
| **31.1** | da nessuna parte: nessuno guarda | da una foto, in due luci, contro una baseline |
| **31.2** | da un hex scelto una volta | da una ricetta in OKLCH, con la soglia già dentro |
| **31.3** | da `system-ui`, cioè da tre piattaforme diverse | da tre voci scelte e portate in bundle |
| **31.4** | da sessantasei regole che si somigliano | da un'anatomia sola per componente |
| **31.5** | da un'ombra nera su fondo nero | da una scala di elevazione dichiarata |
| **31.6** | da nessuna parte: la persona non ha voce | da uno strato sopra il tema, a lista chiusa |
| **31.7** | da una soglia sola | da due tabelle di soglie e un risolutore che le sceglie |
| **31.8** | da un pacchetto che l'editor montava | dalla stessa sorgente delle altre |
| **31.9** | da chi legge il CSS della serie | da un file che si genera da `hooks.ts` |

---

### 31.1 Il banco che vede

*presidi · **P1** — **chiusa** dalla
[0166](../decisions/0166-il-banco-che-vede.md); resta una casella: il confronto a
pixel in CI aspettava i caratteri in bundle, e la
[0168](../decisions/0168-tre-voci-in-bundle-un-canale-in-piu.md) (§31.3) l'ha
portata — ma non basta da sola: le baseline restano scattate su una macchina
che Playwright non riconosce come Ubuntu, non su `ubuntu-latest`*

Non si migliora ciò che non si guarda, e i quattro presidi del tema — il
contrasto, la struttura, il moto, il caricatore — non guardano: i primi tre
leggono i CSS **come testo**, il quarto conta gli elementi montati in un DOM
finto. È la scelta giusta per ciò che provano (il conto è aritmetica, non
rendering), e lascia scoperta esattamente la specie di difetto che questa seduta
va a cercare: un gradino che non si vede, un allineamento che salta, un'ombra
che non stacca. Oggi l'unico oracolo visivo è aprire l'app.

Il banco è un **secondo ingresso** della shell, non una seconda shell: monta
`main.ts` vero contro `host/finto.ts`, che il §1.3 ha già ridotto a un file
solo, e fotografa. Nessuna riga di produzione cambia — è la stessa mossa con cui
`shell.e2e.test.ts` prova il cablaggio, portata dove serve un motore vero.

- [x] **Le scene sono un elenco chiuso**, non uno screenshot che qualcuno
      ricorda di fare: ogni scena dichiara come si prepara (vault, azioni, fuoco
      da tastiera, hover) e un presidio verifica che ognuna abbia la sua
      baseline in **entrambe** le luci. Un elenco che si svuota in silenzio è
      indistinguibile da un elenco verde
      ([0109](../decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md)).
- [x] **Tre scene non sono schermate ma cataloghi**: ogni componente in ogni
      stato, ogni token col suo nome e il suo contrasto, la scala tipografica
      per intero. Sono la superficie di revisione delle tappe successive, e
      diventeranno la pagina di prova di un tema di terzi.
- [x] **La stabilità è una decisione, non un'impostazione**: caratteri attesi,
      ora congelata, moto ridotto acceso, corpus fisso, soglia del diff
      dichiarata, baseline solo Linux. Un banco visivo che sfarfalla si spegne
      da solo entro tre settimane.
- [x] **Il contrasto *reso* accanto a quello dei token**: `axe-core` sulla
      pagina vera vede ciò che la tabella delle coppie non può vedere — un
      inchiostro sopra un velo, un testo dentro un fondo che una regola ha
      cambiato.
- [x] **Il cancello umano è il foglio di contatto**: le due luci affiancate,
      generate a ogni corsa. Ogni tappa di questa seduta si chiude guardandolo,
      e questo è scritto qui perché non diventi un'abitudine di una persona
      sola.

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) revisione a occhio, aprendo l'app | zero infrastruttura | non lascia un «prima», quindi non prova nessun miglioramento e non vede nessuna regressione |
| (b) presidi di layout in `happy-dom` | niente motore da installare | non c'è CSS e non ci sono misure: il presidio passerebbe **a vuoto**, che è peggio di non averlo |
| (c) foto senza baseline in repo | niente PNG versionati | un diff che non ha un termine di paragone non è un diff: è una foto |

**Cosa ha visto, prima ancora di scattare.** Le scene del banco sono
**venti** [conta: scene-del-banco], e in due luci fanno quaranta baseline; tre
di quelle scene non stavano ferme. Due delle tre erano difetti veri: la `<progress>` era
rimasta un widget del **sistema operativo** — non segue `--accent`, si dipinge
diverso su ogni macchina, e da indeterminata si anima anche con
`prefers-reduced-motion` perché l'animazione non è CSS ma il motore nativo — e il
grafo ha un secondo inquadra che riparte proprio alla prima quiete. Poi
`axe-core` sulla pagina vera ha trovato cinque coppie sotto la soglia, **tutte e
cinque in luce chiara**, e tre di quelle cinque la tabella dei token non poteva
vederle: un colore di sintassi sulla riga attiva invece che sul fondo, un titolo
dal terzo livello in giù a cui la tabella chiede la soglia del testo grande, e un
link sopra un **velo** con alpha, che la formula dei token si rifiuta di misurare
— giustamente, perché non sa cosa c'è sotto. Sono finite nel debito dichiarato
di `banco/a11y.mjs`, due a carico della 25.1 e tre della §31.7.

**E cosa non ha visto.** Le ha pagate tutte e cinque la §31.2, che con la ricetta
ha reso «sopra cosa sta» una cosa che si **dichiara**: `sopra: CARTA` sono tutti e
tre i fondi del documento e non solo la pagina, la mira di `--doc-heading` è
quella del testo, e un velo si **compone** sul fondo prima di misurarlo. Il
debito dichiarato è vuoto, ed è stato lui a dirlo — è diventato rosso sulle
cinque voci riparate, che è il verso del lucchetto che di solito non serve.

Il confronto a pixel invece non ha visto niente, e la sua soglia era il difetto.
Alla tavolozza nuova diceva **verde su venti scene su quaranta**, `catalogo-tavolozza`
compresa. `SOGLIA_COLORE` era 0,1 — il default di `pixelmatch`, che internamente
confronta `delta > 35215 · soglia²` su una distanza YIQ al quadrato: una
tolleranza di 26 livelli di luminanza su 255, cioè più larga di un intero cambio
di tavolozza. Misurato: due corse della stessa tavolozza differiscono per lo
0,008% dei pixel, due tavolozze diverse per il 99,3% — e a 0,1 quel 99,3% diventa
0,4%, sotto il cancello. La soglia adesso è 0,01, che sta trenta volte sopra il
rumore misurato, e i due numeri stanno scritti in `banco/foto.mjs` con accanto la
misura invece del ragionamento.


### 31.2 Un colore ha una ricetta

*foglio · **P1** — **chiusa** dalla
[0167](../decisions/0167-un-colore-ha-una-ricetta.md); resta una casella: i due
gradini nuovi (`--bg-panel`, `--bg-active`) sono dichiarati e nessuna regola
della pelle li consuma ancora — li consuma la §31.4*

Novanta valori di colore nei due fogli — quarantacinque per luce
(`grep -E '^  --' frontend/src/theme/serie/foglio-scuro.css | grep -cE ':\s*(#[0-9a-fA-F]|rgb\()')`)
— e nessuno di essi è derivabile: sono stati scelti, poi verificati, e quando la
verifica diceva no sono stati spostati a mano finché diceva sì. Si vede in tre
punti misurati — la scala non monotona delle superfici, il chrome che coincide
col fondo, i sette colori di sintassi che stanno sotto la soglia da quando
esiste il tema chiaro — e si vedrà di nuovo, identico, ogni volta che servirà
una tavolozza in più: l'alto contrasto della §31.7 e l'accento della persona
della §31.6 sono due tavolozze in più.

La forma è quella della
[0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md), presa
alla lettera: **il numero si scrive accanto a come si ricava**, e qui il «come»
è una funzione. La sorgente dichiara luminosità, croma e tinta; la generazione
produce i due fogli in esadecimale, che restano ciò che sono oggi — testo che
tre presidi sanno leggere.

- [x] **La sorgente è OKLCH, il foglio resta hex**: si tocca la ricetta e si
      rigenera, e un presidio verifica che rigenerare dia byte identici. È lo
      stesso schema di `*.generated.ts` e della
      [0020](../decisions/0020-le-regole-in-un-posto-solo.md): un posto in cui
      scriverlo, due da cui leggerlo. La bisezione che cerca la chiarezza fa un
      numero **fisso** di giri, non «finché converge»: un derivato che cambia da
      solo non è un derivato.
- [x] **La scala delle superfici è monotona per costruzione**, con una distanza
      minima dichiarata fra due gradini adiacenti — e i gradini sono **sette**
      più la carta, non sei: contandoli sulla ricetta invece che sul foglio è
      saltato fuori che `--bg` e la carta sono due cose diverse. Il nero resta ed
      è la carta; il chrome sale. La distanza si misura in chiarezza percettiva e
      non in rapporto di contrasto — con quel righello due superfici scure ben
      distinte danno 1,03:1, che è vero e inutile.
- [x] **Gli intenti sono quattro** — guasto, avviso, riuscito, informazione —
      ciascuno col proprio velo e col proprio **controcolore**, che non si sceglie:
      è il nero o il bianco, quello dei due che regge di più.
- [x] **La sintassi diventa propria**: dieci specie in una **famiglia**, che è
      la forma che mancava — la chiarezza è di tutte, presa da quella che serve
      alla specie più difficile, e costa qualche punto a chi ne avrebbe avuto
      bisogno di meno. `SOTTO_AA` non è andato a zero: è **sparito**, perché una
      lista di esenzioni vuota non è un presidio, e al suo posto c'è la soglia
      chiesta a tutte e dieci su tutti e tre i fondi della carta.
- [x] **I neutri sono tinti**, di poco e nella stessa direzione nelle due luci —
      285°, che non è inventato: è dove stavano già i neutri scelti a mano, tutti
      e sei, fra 285,4° e 286,4°. Chi li ha scelti uno per uno ha scelto ogni
      volta la stessa direzione senza avere un posto in cui dirlo.
- [x] **Il vocabolario cresce solo in modo additivo**: nessun ruolo esistente
      cambia nome, o l'additività che la
      [0002](../decisions/0002-additivita-del-contratto.md) impone al contratto
      varrebbe meno di quella che ci si impone da soli. Il presidio è un
      **lucchetto su un verso solo**: un ruolo nuovo passa, un ruolo sparito o
      rinominato è rosso.

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) hex a mano, difesi dal presidio | è oggi | il presidio ferma il rosso e non produce il bello; e ogni tavolozza nuova ripaga lo stesso prezzo |
| (b) `oklch()` vivo nel CSS | nessuna generazione | i tre presidi parsano esadecimali, e il valore reso dipenderebbe dal motore: si perde il conto del contrasto proprio dove serve |

### 31.3 La voce del tema: i caratteri

*foglio · **P1** — **chiusa** dalla
[0168](../decisions/0168-tre-voci-in-bundle-un-canale-in-piu.md); resta una
casella: `--font-reading`, `--text-2xl`, `--text-3xl`, `--text-reading`,
`--leading-normal`, `--leading-relaxed` e `--content-width` sono dichiarati e
visibili nel campionario del banco, ma nessuna regola vera li consuma
ancora — li consuma la §31.8*

`--font-ui` è `system-ui` con quattro ripieghi, e vuol dire tre prodotti
diversi su tre piattaforme: metriche verticali che non coincidono, allineamenti
che si spostano, foto del banco non confrontabili. Non c'è nessuna voce per la
**lettura** — che è l'attività per cui esiste l'app — e la scala dei corpi ha
sei gradini a un pixel di distanza l'uno dall'altro, che non è una scala ma un
elenco.

Il vincolo è già scritto e non è negoziabile: la CSP dell'app ammette
`font-src 'self' asset:`, quindi un carattere o è in bundle o non esiste. Ed è
la regola giusta anche senza CSP — una risorsa remota parte da sola e dice a chi
la serve che quella GUI è aperta
([0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md), e la
§29.3 la riscrive per i fogli).

- [x] **Tre voci, in bundle, con licenza compatibile**: Inter per
      l'interfaccia, Literata per la lettura, JetBrains Mono per il codice —
      OFL-1.1, variabili (un file copre l'intero asse `wght`), sottoinsieme
      `latin`. Entrano nell'SBOM come qualunque altra dipendenza — sono file che
      l'app distribuisce.
- [x] **La scala si allarga e prende un passo**, con più di una interlinea e
      con la misura di lettura come token: sono le caselle di
      [6.2](../features/06-rendering-preview-temi.md) (corpo, interlinea,
      larghezza del contenuto) e senza di esse la §31.8 non ha niente su cui
      appoggiarsi.
- [x] **Il caricatore impara l'ordine dei canali**: oggi `monta()` appendeva in
      coda, e appendere bastava finché i canali erano due. Con i caratteri e con
      lo strato delle preferenze (§31.6) diventano quattro, e l'ordine smette di
      essere una conseguenza dell'ordine in cui si è montato: `loader.ts`
      dichiara `ORDINE` e inserisce ogni canale al proprio posto nel DOM.
- [x] **Il sistema resta raggiungibile**, come preferenza e non come difetto:
      ogni pila porta il ripiego di piattaforma in coda; chi vuole le metriche
      della propria piattaforma le sceglierà (§31.6).

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) solo caratteri di sistema | zero byte da distribuire | tre rese diverse, nessuna voce per la lettura, e un banco visivo che non può avere una baseline |
| (b) caratteri da un CDN | zero byte nel repo | la CSP li rifiuta, e se non lo facesse sarebbe la richiesta di rete che la 0017 vieta per l'anteprima |

### 31.4 Un componente, un'anatomia — e il vocabolario degli hook

*pelle · shell · **P1***

Sessantasei regole vestono un bottone, diciassette un campo, quattro scrivono lo
stesso attivo. Non è ridondanza: è **assenza di anatomia**. Ogni superficie
nuova ha rifatto i propri controlli guardando quelli accanto, e il risultato è
che altezze, raggi e passi non coincidono — la differenza si vede tutta insieme,
ed è la ragione principale per cui la GUI non sembra una.

L'altra metà della voce è il conto che la [§29.2](29-chi-possiede-la-pelle.md)
aspetta: *quante classi è servito toccare per rimettere in piedi la pelle di
serie da zero*. Oggi la risposta non è un numero di classi ma quarantatré id, e
un id non è un contratto: è il nome che un pannello si è dato. Le classi che
escono da questa voce **sono** il vocabolario degli hook, e nascono qui perché a
fine M3 si congelano.

- [ ] **L'inventario si chiude prima di cominciare**: l'elenco dei componenti si
      scrive all'apertura della voce e non cresce durante. Un componente
      scoperto dopo è una voce nuova, non una riga in più — è la disciplina con
      cui la [seduta 28](28-centoventuno-eseguibili-per-provare-una-riga.md) ha
      evitato che una misura diventasse un cantiere.
- [ ] **Ogni componente dichiara i suoi stati** — riposo, hover, premuto,
      selezionato, a fuoco, disabilitato, e il trascinamento dove esiste — in
      una tabella che è **sorgente**: la guida della §31.9 e la scena del
      catalogo la leggono, non la ricopiano
      ([0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)).
- [ ] **Gli id escono dai selettori** e restano nel markup per chi li usa come
      manico (i comandi, gli e2e, `ui/a11y.ts`). Lo stato si legge
      dall'attributo ARIA dove esiste — `aria-pressed`, `aria-selected`,
      `aria-current`, `aria-expanded` — così una classe non può dire il
      contrario di ciò che un lettore di schermo annuncia.
- [ ] **La pelle si scrive a pezzi e si monta in un file**: il caricatore vuole
      una stringa e i presidi leggono un file, e tutti e due restano come sono;
      chi scrive lavora su un componente per volta invece che in duemilacento
      righe.
- [ ] **Le icone hanno un tratto solo**: ventuno disegnate a mano sono coerenti
      nel metodo e non nella mano. Restano SVG inline con `currentColor` — la
      forma è giusta — e diventano un insieme con una griglia e uno spessore
      dichiarati.
- [ ] **Il suggerimento è un componente della shell**, non un attributo del
      browser: quarantanove `title` nativi sono lenti, non tematizzabili, e non
      possono portare accanto il tasto che fa la stessa cosa. È logica di shell
      come `intrappolaFuoco`, e la sua pelle è del tema.

### 31.5 Quanto è lontana una superficie

*pelle · **P1***

Al buio l'elevazione è fatta con l'ombra, e un'ombra nera al 55% sopra un fondo
nero non solleva niente: sposta un po' di grigio. La distanza fra una superficie
e quella sotto si fa con la **luce** quando il fondo è scuro, e con l'ombra
quando è chiaro — e oggi i due fogli dichiarano tre ombre uguali per struttura e
diverse solo per opacità, che è la stessa scelta fatta due volte invece di due
scelte.

La stessa voce copre ciò che si vede **prima di tutto il resto**: la titlebar,
la rail, la statusbar, e le quattro schermate in cui l'app non ha ancora niente
da mostrare. Uno stato vuoto disegnato è la differenza fra un'app che aspetta e
un'app che sa cosa vuoi fare; oggi sono testo grigio in un angolo.

- [ ] **La scala di elevazione è una tabella**, non un'abitudine: per ogni
      livello e per ogni luce, la superficie, il filetto e l'ombra. Cinque
      livelli, dalla carta al dialogo, e la regola che li lega — al buio sale la
      luce, in luce scende l'ombra.
- [ ] **La scocca è un telaio**: chrome, pannelli e carta sono tre superfici
      distinte e riconoscibili, non tre modi di dire nero. I piani `--z-*`
      restano della struttura e non si toccano: qui si decide *cosa si vede*,
      non *chi sta sopra*.
- [ ] **Il riquadro a fuoco si vede senza contarne le tab**: la forma attuale —
      il filetto sotto le tab che cambia colore — si mette a confronto al banco
      con almeno un'alternativa, perché a due riquadri è ciò che si guarda per
      sapere dove finirà la prossima nota che si apre.
- [ ] **I quattro stati vuoti sono disegnati**: senza vault (con le recenti, che
      `state/recenti.ts` già tiene), riquadro senza documento, ricerca senza
      risultati, cestino vuoto.
- [ ] **I controlli finestra sono per piattaforma**, e la prova sta al banco:
      la classe `titlebar--darwin` esiste già, e nessuno l'ha mai vista in una
      foto.

### 31.6 Cosa è del tema e cosa della persona

*shell · kernel · **P1***

Densità, corpo del testo, interlinea, larghezza della colonna, carattere,
accento, zoom: sono sette caselle di
[6.2](../features/06-rendering-preview-temi.md) e
[25.1](../features/25-accessibilita-localizzazione.md), e nessuna di esse è un
tema. Un tema è *come appare l'applicazione*; queste sono *come la persona vuole
leggere* — e la prova che sono due specie diverse è che devono restare vere
**quando il tema cambia**. Metterle dentro il foglio le farebbe sparire al primo
tema di terzi installato.

La 29 le ha già nominate come l'altra specie
([§29.6](29-chi-possiede-la-pelle.md): *«l'overlay dichiarato, che sta sopra
qualunque tema e non lo sostituisce»*). Questa voce le realizza per la parte
che riguarda la GUI, e lascia il CSS per nota e per cartella dov'è.

- [ ] **Uno strato sopra, con una lista chiusa**: le preferenze si montano in un
      canale proprio, dopo la pelle, e possono toccare **solo** i token di un
      elenco dichiarato. Senza la lista, «una preferenza» diventa il modo di
      scrivere CSS arbitrario da un pannello.
- [ ] **Le chiavi sono di macchina**, coi tre stati della
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md): lo scope segue
      la vita di chi le dichiara
      ([0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)),
      e la GUI è della macchina come `keys.shell.*` e come il tema.
- [ ] **L'accento della persona passa dalla ricetta**: si dichiara una tinta, e
      luminosità e croma le deriva la §31.2 fino a far passare i cancelli. Un
      accento scelto in esadecimale da un selettore di colori è il modo più
      rapido di rendere illeggibile un bottone — ed è il caso in cui la ricetta
      smette di essere un'eleganza e diventa l'unica strada.
- [ ] **La densità muove la scala, non la scocca**: `--titlebar-h` e `--rail-w`
      restano della struttura. È il pavimento che la 29 ha messo apposta, e
      questa è la prima voce che lo mette alla prova.
- [ ] **Lo zoom è dell'host**: la webview lo sa fare su tutte e tre le
      piattaforme, e farlo in CSS vorrebbe dire riscrivere ogni misura in unità
      relative — cioè spostare la scocca, che non si muove.

### 31.7 Il contrasto ha più di una soglia

*foglio · struttura · **P1***

L'alto contrasto è una casella di
[25.1](../features/25-accessibilita-localizzazione.md) e oggi non esiste in
nessuna forma: né come scelta, né come risposta al sistema, né come pavimento
per chi usa i colori forzati di Windows. Con la ricetta della §31.2 in piedi non
è un tema in più da scrivere a mano: è la **stessa** ricetta con altre soglie.

E c'è un secondo prodotto, che vale più del primo: la tabella delle coppie —
trentaquattro oggi, ciascuna con scritto accanto quale regola della pelle le
mette davvero insieme — esce dal banco e diventa una **fixture**. Da lì la leggono il
presidio e la ricetta, e domani il caricatore dei temi di terzi: è
letteralmente ciò che la [§29.3](29-chi-possiede-la-pelle.md) chiede — *«una
tabella, due lettori»* — consegnato prima che il caricatore esista.

- [ ] **Il risolutore risolve anche il contrasto**, con la stessa forma con cui
      risolve la luce: una scelta a tre stati più ciò che dice il sistema, e un
      foglio solo montato. Luce × contrasto danno quattro fogli, tutti generati.
- [ ] **I colori forzati sono un pavimento della struttura**, come il moto
      ridotto e l'anello del fuoco: li fa rispettare la shell, non la cortesia
      dell'autore del tema.
- [ ] **Le coppie diventano una fixture**, e la §29.3 la trova già scritta.
- [ ] **Le soglie alte si dichiarano come numeri**, non come «più contrasto»: un
      tema ad alto contrasto che non dice quanto vale non si può presidiare.

### 31.8 La stessa nota in tre modi

*pelle · editor · **P1***

È la superficie che si guarda per ore, ed è la meno disegnata: la Lettura non ha
misura né passo verticale, la Sorgente porta una tavolozza nata per il fondo
`#282c34` e montata su nero, la Live sta nel mezzo. La promessa del §4.1 — «le
tre modalità sono la stessa nota vista in tre modi» — oggi è vera **sui
colori**, perché `editor/theme.ts` legge i token, e falsa su tutto il resto:
corpo, interlinea, misura e passo non coincidono, e passando da una modalità
all'altra il testo si sposta.

- [ ] **La misura, il corpo e il passo vengono da un posto solo**, e li usano
      tutte e tre le superfici: è la stessa mossa già fatta per i colori quando
      `oneDark` è uscito da `editor/theme.ts`, applicata al ritmo verticale.
- [ ] **Il documento prende ciò che gli manca**: callout per specie, note a piè
      di pagina, blocco delle proprietà, immagini, tabelle, sillabazione nella
      lingua della nota. Sono superfici che il modello sa già dire e che la
      pelle veste a metà.
- [ ] **La prova è una foto sola**: la stessa nota nelle tre modalità,
      affiancate, in due luci. Una modalità che ha perso un colore o un passo si
      vede lì, e non altrove.
- [ ] **Il pavimento resta la scrittura**: sessanta fotogrammi al secondo su una
      nota da diecimila parole ([interview_2](../personas/interview_2.md)), e il
      moto che si ferma alla soglia dell'editor — che la
      [seduta 30](30-il-moto-e-del-tema.md) ha già deciso e che qui si misura,
      perché è questa la voce che tocca la superficie di scrittura.

### 31.9 Cosa si consegna a chi scriverà un tema

*presidi · docs · **P1***

Le otto voci sopra producono, come effetto, tutto ciò che serve a un terzo per
scrivere un tema: un elenco di ruoli con un significato, un elenco di classi con
i loro stati, un banco che li prova. Questa voce fa in modo che quel materiale
**esista come consegna** e non come conseguenza, e che nessuno debba ricavarlo
leggendo il CSS della serie.

Non chiude la §29.2 e non chiude la §29.5: le rifornisce. Il congelamento del
vocabolario resta a fine M3, l'inventario dei bundle e il disco restano kernel.

- [ ] **La guida si genera dalle sorgenti** — i ruoli dalla ricetta, gli hook
      dalla tabella degli stati — perché una guida scritta a mano accanto a un
      codice che cambia è la duplicazione che diverge, e questa cartella ne ha
      già misurate abbastanza.
- [ ] **Il banco prova anche un tema che non è la serie**: un comando che
      fotografa un fascio qualunque con le stesse scene e gli stessi cancelli.
      La porta dei terzi va provata prima che esista un terzo — è il dogfooding
      della [0031](../decisions/0031-chi-possiede-i-bundle.md) portato al banco.
- [ ] **La scheda Temi, nella sua forma minima**
      ([§29.5](29-chi-possiede-la-pelle.md)): l'elenco, la luce e il contrasto
      offerti, l'anteprima in un contenitore, e il ritorno alla serie
      raggiungibile anche a tema rotto.
- [ ] **Il conto che la §29.2 aspetta**, scritto: quanti ruoli obbligatori,
      quanti hook, quanti stati. Non un'immaginazione — un numero col comando
      accanto.

---

## Le tappe, e l'ordine che non si scambia

1. ~~**La §31.1 da sola.**~~ Fatta: il banco, le scene, e le quaranta baseline
   di **prima** della ricetta. Sono servite subito — la §31.2 le ha usate per
   dimostrare che la tavolozza nuova è la stessa vista meglio, e per scoprire che
   la soglia del confronto non la vedeva affatto.
2. **La §31.2** ~~**, poi la §31.3.**~~ La prima è fatta; per la seconda vale
   ancora l'ordine, e non insieme: i caratteri
   cambiano le misure verticali di ogni superficie, e cambiarle mentre si
   guarda una tavolozza nuova vuol dire non sapere quale delle due si sta
   giudicando. Le uniche due tappe che si chiudono guardando, e basta.
3. **La §31.4.** È la più lunga e la sola che tocchi il markup della shell. Ha
   bisogno di colore e caratteri già fermi, o il catalogo mostra tre variabili
   insieme.
4. **La §31.5 e la [seduta 30](30-il-moto-e-del-tema.md), in parallelo alla
   §31.8.** Profondità e moto lavorano sulla scocca e hanno bisogno dei
   componenti; il documento non li tocca e può correre accanto. È qui che la 30
   si realizza: le classi di coreografia che la sua §30.2 ha deciso nascono col
   nome del vocabolario della §31.4, e non due volte.
5. **La §31.6 e la §31.7.** Le due che aggiungono una tavolozza o uno strato: si
   fanno per ultime perché sono la prova che la ricetta della §31.2 vale anche
   per chi non l'ha scritta.
6. **La §31.9.** Il conto si fa quando c'è qualcosa da contare.

L'ordine ha due giunti rigidi e il resto è negoziabile: **la §31.1 prima di
tutto** (senza, si lavora al buio) e **la §31.2 prima di ogni voce che produca
un colore** (senza, ogni tappa ripaga il prezzo di sceglierlo a mano). La §31.6
e la §31.7 sono le più separabili: valgono identiche anche fatte dopo M3.

## Cosa non è questa seduta

- **Non è l'architettura dei temi** (29): non tocca i tre strati, il caricatore,
  la sostituzione, il risolutore. Li usa, ed è la prima cosa che li usa davvero.
- **Non è il moto** (30): quella seduta ha già deciso, e qui si realizza. Le sue
  due voci aperte — [§30.8](30-il-moto-e-del-tema.md) e §30.9 — restano sue.
- **Non è il montaggio dei temi di terzi**
  ([§29.4](29-chi-possiede-la-pelle.md)) né il disco
  ([§29.6](29-chi-possiede-la-pelle.md)): sono kernel, e questa seduta consegna
  loro il conto, la fixture e la scheda.
- **Non è il motore di resa del documento** (6.1): la §31.8 veste ciò che il
  renderer produce, non lo produce.
- **Non è un secondo tema.** Una serie sola, due luci più due ad alto contrasto,
  tutte dalla stessa ricetta. Un tema in più — un grigio scuro, un seppia — dopo
  questa seduta costa un file di sorgente, ed è precisamente il punto.
- **Non è un redesign**: le regioni, i pannelli, i gesti e le scorciatoie
  restano quelli. Cambia da dove viene ciò che si vede.
