// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { commitRecording, createAudioRecorder, recoverableRecordings } from "./recorder";
import { createViewStateCrashDeposit } from "./recorder-store";

afterEach(() => vi.unstubAllGlobals());

it("keeps staged chunks after revocation and a failed vault deposit, then commits once", async () => {
  const values = new Map<string, unknown>();
  let savedChunk!: () => void;
  const chunkPersisted = new Promise<void>((resolve) => { savedChunk = resolve; });
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: unknown) {
      values.set(key, value);
      if (key.startsWith("media.recordings.") && key !== "media.recordings.index" && value !== null) savedChunk();
    },
  };
  const track = { onended: null as ((event: Event) => void) | null, stop: vi.fn() };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  class Recorder {
    static isTypeSupported(mime: string) { return mime === "audio/webm"; }
    state: "recording" | "inactive" = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, _options: MediaRecorderOptions) {}
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") throw new Error("already stopped");
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])]) });
      queueMicrotask(() => this.onstop?.());
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const staging = createViewStateCrashDeposit(store);
  const states: string[] = [];
  const recorder = createAudioRecorder(staging, { onState(state) { states.push(state); } });
  await recorder.start();
  (track.onended as ((event: Event) => void) | null)?.(new Event("ended"));
  await chunkPersisted;
  const recovered = createViewStateCrashDeposit(store);
  const records = await recoverableRecordings(recovered);
  expect(records).toHaveLength(1);
  expect(records[0]?.id).toBe(recorder.id);
  expect(states).toContain("failed");

  const attachment = {
    folder: "attachments",
    fromDocument: "note.md",
    write: vi.fn(async (id: string) => ({ id, revision: "r" })),
  };
  attachment.write.mockRejectedValueOnce(new Error("disk full"));
  await expect(commitRecording(recovered, recorder.id, attachment)).rejects.toThrow("disk full");
  expect(await recoverableRecordings(recovered)).toHaveLength(1);
  const saved = await commitRecording(recovered, recorder.id, attachment);
  expect(saved.link).toBe(`attachments/recording-${recorder.id}.webm`);
  expect(await recoverableRecordings(recovered)).toEqual([]);
  recorder.destroy();
});
