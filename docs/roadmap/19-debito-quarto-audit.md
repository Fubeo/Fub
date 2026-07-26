# 19. Debito riportato dal quarto audit

Una **seduta** della [roadmap infrastrutturale](../todo.md): le voci ancora aperte dei quattro giri di audit, col loro milestone.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Voci ancora aperte, con il loro milestone.

- [ ] **Mutex unico sul `Workspace`** → assorbito dal §8.3 (misurare prima).
- [ ] **UI di produzione = IPC bespoke** → assorbito da [decisione 0009](../decisions/0009-registro-dei-comandi.md), §2.1, §1.2, §16.6;
      il caso concreto resta la UI del versioning.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3): rivalutare alla
      superficie plugin di M5 — con i nodi `Tree`/`Custom` del §2.1 la scelta
      cambia natura.
- [ ] **"Tre copie" custodite da un flag TS**: merge esplicito a M3 (§18.1).
- [~] **Ponte byte↔UTF-16**: direzione byte→code unit fatta e testata; l'inversa
      resta (§18.1).
- [ ] Cosmetico: `.fubmd-data/index/` orfana per chi ha aperto il vault con
      versioni precedenti; si cancella a mano.
