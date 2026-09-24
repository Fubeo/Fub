// Il confine del pacchetto media: nomi stabili per CanvasOwner e Main.
//
// CanvasOwner riusa `ResourceTransport`/`ResourcePort` con porte opzionali
// iniettate (mai import diretti verso l'IPC). `transport.ts` NON importa
// `@tauri-apps`: la `invoke` arriva iniettata da `host/ipc.ts` (§1.3).
export type { MediaKind, ResourceDescriptor, ResourceHandle } from "./media-types";
export {
  MEDIA_IPC_CHUNK,
  MEDIA_MAX_INLINE_BYTES,
  assetUrl,
  mediaKindOfId,
  mediaKindOfMime,
  mimeOfId,
  mimeOrOctet,
} from "./media-types";
export type { ResourcePort, ResourceTransport } from "./resource-port";
export { openResourcePort, readAllResource } from "./resource-port";
export {
  DEFAULT_ATTACHMENT_FOLDER,
  MAX_FILE_NAME_BYTES,
  attachmentCandidate,
  attachmentTarget,
  depositAttachment,
  depositFiles,
  mountAttachmentDropPaste,
  saveRemoteAttachment,
  type AttachmentDeposit,
  type AttachmentReceipt,
  relativeUrl,
  sanitizeFileName,
  splitFileName,
} from "./attachment-target";
export { decodeImage, mountImageView, type DecodedImage, type ImageView } from "./image-view";
export { mountAudioView, mountVideoView, type MediaError, type PlayerView } from "./player-view";
export {
  PDFJS_VERSION,
  makePdfJsLoader,
  type PdfJsModule,
  mountPdfView,
  pdfIdWithoutFragment,
  pdfPageFromFragment,
  type PdfEngine,
  type PdfEngineLoader,
  type PdfSearchHit,
  type PdfView,
} from "./pdf-view";
export {
  createAudioRecorder,
  finalizeRecording,
  preferredMimeTypes,
  commitRecording,
  recoverableRecordings,
  type AudioRecorder,
  type CrashDeposit,
  type RecorderEvents,
  type RecorderState,
  type RecordingMeta,
} from "./recorder";
export { createViewStateCrashDeposit, type RecordingStatePort } from "./recorder-store";
export { mountRecorderSurface, type RecorderSurfaceDeps } from "./recorder-surface";
export { mountMediaSurface, profileForKind, type MediaSurfaceDeps } from "./media-surface";
export { buildPrintDocument, copyRenderedText, printDocument, printRendered, type PrintOptions, type PrintRenderer } from "./print-view";
export { makeAttachmentDeposit, makeResourceTransport, openViewer, saveViewer, writeResource, PDF_LOADER_REF, RESOURCE_WRITE_HEADER, type TauriInvoke, type ResourceWriteReceipt } from "./transport";
