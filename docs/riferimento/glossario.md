# Glossario

**ABI**  
Il contratto condiviso da host e provider. In Rust vive in `fub-abi`; per i componenti WASM è rispecchiato dal WIT.

**Bundle**  
Un insieme coerente di provider, viste, comandi e impostazioni che può essere montato dall'host.

**Capacità**  
Permesso esplicito con cui l'host rende disponibile un servizio a un provider o a un guest WASM.

**Documento**  
File riconosciuto da un provider di formato e rappresentato attraverso il modello comune.

**Host**  
Il livello che assembla kernel, provider, sessioni, watcher e servizi. In Fub è soprattutto `fub-host`.

**Kernel**  
Il core agnostico rispetto a formato e UI che applica le regole del vault.

**Provider**  
Implementazione di una parte del contratto: formato, indice, comando, vista o altro servizio estensibile.

**Shell**  
L'interfaccia desktop TypeScript eseguita nella webview Tauri.

**Vault**  
La cartella locale aperta da Fub, contenente documenti, allegati e la cartella di servizio `.fub/`.

**View / vista**  
Superficie dichiarativa fornita da un provider e resa dalla shell attraverso `UiNode`.

**WIT**  
WebAssembly Interface Types: il linguaggio con cui il contratto è espresso per i componenti WASM.

**World**  
L'insieme delle interfacce importate ed esportate da un componente WIT.