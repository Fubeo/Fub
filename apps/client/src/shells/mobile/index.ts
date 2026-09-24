import {
  MOBILE_CAPABILITIES,
  type ClientShell,
} from "../../platform/capabilities";

export const MOBILE_SHELL: ClientShell = Object.freeze({
  id: "mobile",
  capabilities: MOBILE_CAPABILITIES,
});
export type { MobileBridge, MobileCapturePayload, MobileCaptureTarget } from "./bridge";
export type { MobileStorageInfo, MobileStoragePreference, MobilePermissionState, MobileTreeGrant, MobileMountMode, MobileGrantPlatform } from "./bridge";
export type { MobileOpenedUrl, MobileWasmReport, MobileInvoker, MobileEventBus } from "./bridge";
export { createMobileBridge } from "./bridge";
export type { CaptureDraft, CaptureMode, CaptureValidation } from "./capture";
export {
  validateCaptureLocal,
  capturePayload,
  captureBody,
  suggestNotes,
  submitCaptureViaCommands,
  submitCaptureViaBridge,
} from "./capture";
export type {
  LifecyclePorts,
  LifecycleOutcome,
  MobileLifecycleState,
} from "./lifecycle";
export { createLifecycleFlush, defaultLifecyclePorts } from "./lifecycle";
export type { MobileStorageChoice, StorageDecision, GrantStore, SharedStoragePorts, MobileStorageHealth } from "./storage";
export {
  mobileGrantStore,
  decideStorage,
  storageConsequences,
  inspectSharedStorage,
  inspectStorageHealth,
  registerPersistedGrant,
  revokeTreeGrant,
  loadStorageChoice,
  saveStorageChoice,
  loadTreeGrant,
  saveTreeGrant,
} from "./storage";
export type { MobileShortcut, MobileShortcutKind, OsActionRegistration, WidgetPorts } from "./os-actions";
export { mobileShortcuts, handleWidgetAction, assistantSearchUrl, osActionPlan } from "./os-actions";
export type { MobilePermission, PermissionRequest, KeyboardKind, TouchEditing } from "./permissions";
export {
  needsExplicitAsk,
  isLostAccess,
  keyboardKind,
  touchEditing,
} from "./permissions";
export type { QuickAction, QuickActionPorts, TabEntry, ToolbarPorts, TreeAccessPorts } from "./touch";
export {
  MOBILE_TOUCH_TARGET_PX,
  defaultQuickActions,
  touchFirst,
  currentTabs,
  activateMobileTab,
  closeMobileTab,
  swipeTarget,
  openMobilePalette,
  runMobileCommand,
  openMobileSwitcher,
  openMobileSearch,
  focusMobileEditor,
  openMobileDoc,
  mobilePanes,
  mobileActiveTab,
  mountMobileChrome,
} from "./touch";
export { mountMobileViewport } from "./viewport";
export type { MobileExternalPorts } from "./opened";
export { mountMobileOpenedActions } from "./opened";
export type { MobileStorageMountPorts } from "./storage-ui";
export { mountMobileStorageStatus } from "./storage-ui";
export type { MobileBootstrapPorts, MobileShellOptions } from "./bootstrap";
export {
  defaultMobilePorts,
  mountMobileLifecycle,
  mobilePaletteHost,
  mobileQuickNote,
  mobileOpenPalette,
  mobileOpenSwitcher,
  mobileOpenSearch,
  mountMobileShell,
} from "./bootstrap";
