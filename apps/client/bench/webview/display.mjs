// Il display X del banco tenuto aperto per tutta la corsa (#287).
//
// Xvfb, come ogni server X avviato senza `-noreset`, si azzera quando si
// stacca il suo ultimo client: chiude le risorse, rilegge l'autorizzazione e
// riparte. Nel banco l'ultimo client è l'app dello scenario appena chiuso, e
// l'app dello scenario dopo parte meno di 100 ms più tardi: se si collega
// mentre il server si sta azzerando, GTK non si inizializza («Failed to
// initialize GTK») e lo scenario è rosso senza aver misurato niente.
//
// Un client che resta collegato dall'inizio alla fine toglie l'azzeramento
// alla radice, comunque `xvfb-run` sia stato chiamato (la CI, `misura.sh`, chi
// misura a mano). Il client è il minimo che il protocollo chiede: la richiesta
// di connessione, con il cookie MIT-MAGIC-COOKIE-1 di `$XAUTHORITY` se c'è, e
// poi niente; non apre finestre e non legge eventi.
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const COOKIE = "MIT-MAGIC-COOKIE-1";
const FAMILY_LOCAL = 256;
const FAMILY_WILD = 65535;

/// Il numero del display da `DISPLAY` (`:99`, `:99.0`, `unix:99`); `null` per
/// un display che non è un socket locale (TCP, Wayland, nessun display).
export function displayNumber(display) {
  const match = /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(display ?? "");
  return match ? match[1] : null;
}

/// Le voci di un file `Xauthority`: famiglia, indirizzo, numero del display,
/// nome e dati del cookie. Il formato è fisso: campi lunghi due byte (big
/// endian) seguiti dai byte del campo.
export function parseXauthority(bytes) {
  const entries = [];
  let at = 0;
  const field = () => {
    if (at + 2 > bytes.length) throw new RangeError("Xauthority troncato");
    const length = bytes.readUInt16BE(at);
    at += 2;
    if (at + length > bytes.length) throw new RangeError("Xauthority troncato");
    const value = bytes.subarray(at, at + length);
    at += length;
    return value;
  };
  try {
    while (at < bytes.length) {
      if (at + 2 > bytes.length) break;
      const family = bytes.readUInt16BE(at);
      at += 2;
      const address = field().toString("latin1");
      const number = field().toString("latin1");
      const name = field().toString("latin1");
      const data = Buffer.from(field());
      entries.push({ family, address, number, name, data });
    }
  } catch {
    // Una coda rovinata non toglie le voci lette prima.
  }
  return entries;
}

/// Il cookie per il display `number` di questa macchina, o `null` se il file
/// non lo ha (il server senza autorizzazione accetta la richiesta vuota).
export function cookieFor(entries, number, host = hostname()) {
  const match = entries.find((entry) =>
    entry.name === COOKIE &&
    (entry.number === number || entry.number === "") &&
    (entry.family === FAMILY_WILD || (entry.family === FAMILY_LOCAL && entry.address === host)));
  return match?.data ?? null;
}

/// La richiesta di connessione X11, little endian, con l'autorizzazione data.
export function setupRequest(cookie) {
  const pad = (n) => (4 - (n % 4)) % 4;
  const name = cookie ? Buffer.from(COOKIE, "latin1") : Buffer.alloc(0);
  const data = cookie ?? Buffer.alloc(0);
  const head = Buffer.alloc(12);
  head.write("l", 0, "latin1");
  head.writeUInt16LE(11, 2);
  head.writeUInt16LE(0, 4);
  head.writeUInt16LE(name.length, 6);
  head.writeUInt16LE(data.length, 8);
  return Buffer.concat([head, name, Buffer.alloc(pad(name.length)), data, Buffer.alloc(pad(data.length))]);
}

/// Si collega al display di `env.DISPLAY` e resta collegato. Torna
/// `{ close() }` se il server ha accettato la connessione, oppure
/// `{ close(), skipped }` con il motivo: senza un display X locale il banco va
/// avanti come prima, e il referto lo dice.
export async function holdDisplay(env = process.env, { timeoutMs = 5_000 } = {}) {
  const none = (skipped) => ({ skipped, close() {} });
  if (process.platform !== "linux") return none("non Linux");
  const number = displayNumber(env.DISPLAY);
  if (number === null) return none(`DISPLAY «${env.DISPLAY ?? ""}» non è un display X locale`);
  let cookie = null;
  try {
    cookie = cookieFor(parseXauthority(readFileSync(env.XAUTHORITY || join(homedir(), ".Xauthority"))), number);
  } catch {
    // Nessun file: il server forse non chiede autorizzazione.
  }
  const socket = connect(`/tmp/.X11-unix/X${number}`);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("nessuna risposta dal server X")), timeoutMs);
      let reply = Buffer.alloc(0);
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      socket.once("connect", () => socket.write(setupRequest(cookie)));
      socket.on("data", function first(chunk) {
        reply = Buffer.concat([reply, chunk]);
        if (reply.length < 8) return;
        clearTimeout(timer);
        socket.off("data", first);
        // 1 è «Success»; 0 «Failed» e 2 «Authenticate» portano il motivo.
        if (reply[0] === 1) resolve();
        else reject(new Error(`il server X rifiuta la connessione: ${reply.subarray(8, 8 + reply[1]).toString("latin1") || `stato ${reply[0]}`}`));
      });
    });
  } catch (error) {
    socket.destroy();
    return none(String(error?.message ?? error));
  }
  // Il server non manda eventi a chi non ne chiede, ma un byte che arriva si
  // legge e si butta: il buffer del socket non si riempie mai.
  socket.on("data", () => {});
  socket.on("error", () => {});
  socket.unref();
  return { close: () => socket.destroy() };
}
