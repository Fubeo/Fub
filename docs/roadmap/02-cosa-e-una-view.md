# 2. Cosa è una view

Una **seduta** della [roadmap infrastrutturale](../todo.md): le firme dicono insieme che una view è una funzione pura, sincrona, senza stato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Era la seduta più grande del piano e la più urgente: sette voci su nove erano
firme del contratto, e dicevano insieme una cosa che nessuno aveva mai deciso —
*una view è una funzione pura, sincrona, senza stato, che disegna in sola
lettura su una delle tre superfici che esistono*. Su quella forma non reggeva
niente di interattivo né di asincrono, cioè i capitoli 11, 12, 11.5 e 22.

**Otto voci su nove sono chiuse** con la
[decisione 0016](../decisions/0016-cosa-e-una-view.md): i nodi (§2.1), le
superfici (§2.2), le istanze (§2.3), lo stato (§2.4), l'invito a ridisegnare e
il «non ancora» (§2.5), i metadati della `ViewSpec` (§2.6), il payload delle
azioni (§2.7) e la chiave col riconciliatore (§2.8). Cosa è una view **adesso**
sta scritto nel verbale, e la forma del protocollo in
[architecture/ui-protocol.md](../architecture/ui-protocol.md).

Resta la nona, e resta per la ragione per cui era già P2: non scade col freeze,
non è precondizione di niente, e si paga quando le liste diventano lunghe — cioè
quando ci sarà un vault che le rende lunghe.

### 2.9 Prestazioni della UI

*ex §3.6 · shell · **P2** — la stessa superficie, quando le liste diventano lunghe*

- [ ] **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
      tabelle: senza, "vault enormi" (24.1) è una promessa che la UI rompe prima
      del kernel. Il nodo `Table` della
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ha reso il caso più
      concreto, non più urgente: una tabella dichiarata con diecimila righe le
      manda tutte attraverso l'IPC prima ancora che qualcuno provi a
      disegnarle, e la finestra che serve è quella che `Page` già esprime nelle
      query — il pezzo che manca è chi la chiede.
- [ ] **Rendering incrementale dell'anteprima** e lazy loading di immagini/embed.
