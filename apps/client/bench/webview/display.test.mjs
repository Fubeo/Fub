import { describe, expect, it } from "vitest";

import { cookieFor, displayNumber, holdDisplay, parseXauthority, setupRequest } from "./display.mjs";

/// Una voce di `Xauthority` nel formato di `xauth`: campi big endian lunghi
/// due byte, poi i byte.
function entry(family, address, number, name, data) {
  const field = (bytes) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const head = Buffer.alloc(2);
  head.writeUInt16BE(family);
  return Buffer.concat([head, field(Buffer.from(address)), field(Buffer.from(number)), field(Buffer.from(name)), field(data)]);
}

const COOKIE = Buffer.from("0123456789abcdef0123456789abcdef", "hex");

describe("il display tenuto aperto del banco WebView (#287)", () => {
  it("legge il numero del display solo da un socket locale", () => {
    expect(displayNumber(":99")).toBe("99");
    expect(displayNumber(":0.0")).toBe("0");
    expect(displayNumber("unix:7")).toBe("7");
    expect(displayNumber("localhost:10.0")).toBeNull();
    expect(displayNumber("")).toBeNull();
    expect(displayNumber(undefined)).toBeNull();
  });

  it("trova il cookie del display giusto in Xauthority, come lo scrive xvfb-run", () => {
    const file = Buffer.concat([
      entry(256, "altra-macchina", "99", "MIT-MAGIC-COOKIE-1", Buffer.from("aa", "hex")),
      entry(256, "banco", "98", "MIT-MAGIC-COOKIE-1", Buffer.from("bb", "hex")),
      entry(256, "banco", "99", "MIT-MAGIC-COOKIE-1", COOKIE),
    ]);
    const entries = parseXauthority(file);
    expect(entries).toHaveLength(3);
    expect(cookieFor(entries, "99", "banco")).toEqual(COOKIE);
    expect(cookieFor(entries, "97", "banco")).toBeNull();
    // Una voce jolly vale per ogni macchina.
    expect(cookieFor(parseXauthority(entry(65535, "", "97", "MIT-MAGIC-COOKIE-1", COOKIE)), "97", "banco")).toEqual(COOKIE);
  });

  it("tiene le voci lette prima di una coda rovinata", () => {
    const good = entry(256, "banco", "99", "MIT-MAGIC-COOKIE-1", COOKIE);
    expect(parseXauthority(Buffer.concat([good, good.subarray(0, 7)]))).toHaveLength(1);
  });

  it("scrive la richiesta di connessione X11 con il cookie, allineata a quattro byte", () => {
    const request = setupRequest(COOKIE);
    expect(request.toString("latin1", 0, 1)).toBe("l");
    expect(request.readUInt16LE(2)).toBe(11);
    expect(request.readUInt16LE(6)).toBe(18);
    expect(request.readUInt16LE(8)).toBe(16);
    expect(request.length).toBe(12 + 20 + 16);
    expect(request.toString("latin1", 12, 30)).toBe("MIT-MAGIC-COOKIE-1");
    expect(request.subarray(32, 48)).toEqual(COOKIE);
    expect(setupRequest(null)).toHaveLength(12);
  });

  it("senza un display X locale lo dice e non tiene niente", async () => {
    const held = await holdDisplay({ DISPLAY: "" });
    expect(held.skipped).toBeTruthy();
    held.close();
  });
});
