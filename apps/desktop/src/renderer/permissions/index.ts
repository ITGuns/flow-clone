// Public surface of the renderer permission components (Phase 2d). The onboarding flow (task 4d)
// imports PermissionFlowView (or the individual surfaces) from here.
export { PermissionPrePrompt, type PermissionPrePromptProps } from './PermissionPrePrompt';
export {
  PermissionDeniedRecovery,
  type PermissionDeniedRecoveryProps,
} from './PermissionDeniedRecovery';
export { PermissionFlowView, type PermissionFlowViewProps } from './PermissionFlowView';
export {
  prePromptCopy,
  recoveryCopy,
  type Platform,
  type PrePromptCopy,
  type RecoveryCopy,
} from './permission-copy';
export { PERMISSION_CSS, PERMISSION_STYLE_ID } from './permission-styles';
