import { STATI } from "./stati-sim.mjs";
import fs from "node:fs";
const cart = ["nuove2","nuove4","nuove3","nuove","s2","avvio"];
const have = new Map();
for (const c of cart) for (const f of fs.readdirSync(`catture/${c}`)) { const m = f.match(/^(.*)-(light|dark)\.json$/); if (m && !have.has(m[1]+"|"+m[2])) have.set(m[1]+"|"+m[2], c); }
const ids = new Set(); for (const s of STATI) { ids.add(s.id); if (s.w700) ids.add(s.w700); if (s.tel) ids.add(s.tel); }
const miss = [...ids].filter(i => !have.has(i+"|light") || !have.has(i+"|dark"));
console.log("mancano:", miss.join(" "));
const all = new Set([...have.keys()].map(k=>k.split("|")[0]));
console.log("catturati ma non usati:", [...all].filter(i=>!ids.has(i)).join(" "));
