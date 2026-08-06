# 24. Tre firme che il freeze rende definitive

Una **seduta chiusa** della [roadmap infrastrutturale](../todo.md): un punto del contratto che oggi costa un campo e dopo il freeze di M4 costa una migrazione di versione. **Tutte e tre le voci sono chiuse, e due delle tre non scadevano affatto**: la §24.1 con la [0130](../decisions/0130-ogni-tipo-del-contratto-si-vede-dalla-radice.md) — i tipi invisibili dalla radice erano sessantuno e non sette, e un `pub use` è additivo — e la §24.2 con la [0131](../decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md), perché `enabled` è un metodo Rust di comodo e al confine WIT non esiste: la `option-map` i tre stati li portava già tutti. La §24.3 sì, e a dirlo è stata la sola cosa che poteva dirlo: la [0132](../decisions/0132-un-rifiuto-non-e-una-frase.md) ha dovuto **ritagliare la linea di base congelata**, perché `format-error` è il tipo d'errore delle funzioni che un plugin di formato *esporta* e ritiparne un caso non è un'aggiunta in nessuna lettura.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta non l'ha trovata un giro, e nemmeno una verifica sui verbali:
l'ha trovata un consuntivo.** `docs/issues.md` era un contenitore di
osservazioni scritte in un audit del 2026-07-31 e mai lavorate: novantadue
righe, di cui settantuno rimandavano a voci che non sono mai state committate —
il rimando cieco che [`numerazione.md`](numerazione.md) esiste per impedire,
arrivato dal lato che quella disciplina non copre. Rilette contro i sorgenti di
oggi, sedici erano già chiuse, una era falsa il giorno stesso, cinque non erano
difetti. Settanta reggevano.

**Sessantasette di quelle settanta non sono voci**, e stanno nell'elenco dei
[difetti misurati](../todo.md#i-difetti-misurati): nessuna chiede una decisione,
nessuna è il residuo di un verbale. Sono lavoro già deciso che qualcuno deve
ancora fare, e aprirle come voci vorrebbe dire chiedere a `todo.md` di rispondere
a una domanda che non è la sua.

**Tre lo erano, e sono nate qui per un criterio solo**: toccano una **firma**.
È il criterio che questo piano usa per le P0 fin dalla prima riga — *la forma
scade col freeze: oggi costa un campo, dopo costa una migrazione di versione* —
e non la loro importanza, che è modesta. **Il criterio, su due delle tre, non
reggeva**, e a scoprirlo è stato ogni volta il giro che l'ha chiusa — non chi le
ha scritte: quello che scade non si deduce leggendo la voce, si misura andando a
vedere se la firma attraversa davvero il confine. Sulla §24.3 quella misura ha
dato **sì**, ed è l'unica delle tre.

---

**Perché stanno insieme.** Sono la stessa domanda a tre distanze dal confine:
*ciò che il contratto dice, arriva a chi deve leggerlo?* La §24.1 era ciò che il
contratto **espone** e che non si vedeva da dove tutti guardano; la §24.2 era ciò
che il contratto **sa** e che la firma con cui lo si chiedeva non riusciva a
dire; la §24.3 è ciò che il contratto **rifiuta**, senza dire a nessuno perché.
Decise separate darebbero tre rattoppi in tre file; decise insieme sono un
criterio — *una risposta a due valori per una domanda che ne ha tre non è una
semplificazione, è una perdita* — che la [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md)
ha già preso una volta, su `random-bytes`, e la
[0131](../decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md) una seconda,
scoprendo che il verso opposto vale insieme al primo: la firma a due valori
resta, perché sei chiamanti su sei fanno la stessa cosa nei due casi, e a
cambiare è che adesso è una **proiezione** di quella che risponde per intero.

---

## Com'è finita, e cosa lascia

**Due P0 su tre erano P0 per la ragione sbagliata**, ed è il consuntivo che
questa seduta lascia al piano. Non è un caso di tre: è un caso di **come sono
state aperte**. Le tre voci sono nate da un criterio dichiarato — *tocca una
firma, quindi scade col freeze* — applicato **leggendo**, e leggendo si vede che
un simbolo esiste, non dove arriva. La §24.1 nominava una firma che si ripara
per aggiunta; la §24.2 nominava una firma che al confine **non c'è**; solo la
§24.3 nominava un caso di variant pubblicato, ed è l'unica che ha acceso il
presidio che quella promessa la sorveglia (`wit_additivity`).

La regola che ne esce, e che vale per la prossima P0 di firma di questo piano:
**«scade col freeze» non è una lettura, è una misura**, e la misura è una sola —
il simbolo attraversa `crates/fub-abi/wit/`, e la riparazione tocca
`wit/frozen/`? Finché quella misura non è fatta, la sigla «P0» dice quanto si è
preoccupato chi scriveva la voce, non quanto costa aspettare. Le tre volte in cui
è stata fatta, ha cambiato la conclusione due volte su tre.

Il consuntivo ha però un verso opposto, e va scritto insieme all'altro: **tutte
e tre sono valse il giro lo stesso**, e per una ragione che non era nella loro
urgenza. Ognuna delle tre ha trovato la cosa vera un centimetro più in là di
dove la voce guardava — sessantuno tipi invece di sette, due funzioni che
leggevano la stessa mappa in due modi, un banco della
[0054](../decisions/0054-il-banco-del-lato-provider.md) che citava una regola nel
commento e ne provava metà nel corpo. Una voce sbagliata sulla scadenza può
essere giusta sul posto dove guardare.
