// Public surface of the permissions module (Phase 2d). The renderer imports the flow/bridge types
// and (in tests) the fake bridge from here; the Phase 2 gate's native adapter implements
// `PermissionBridge`.
export type { PermissionBridge, PermissionKind, PermissionStatus } from './bridge';
export {
  PermissionFlow,
  type PermissionFlowState,
  type PermissionFlowSnapshot,
  type RecoveryReason,
  type FlowListener,
} from './machine';
export {
  OnboardingPermissions,
  type OnboardingReadiness,
  type OnboardingListener,
} from './sequencing';
export { FakePermissionBridge, type FakeBridgeInit, type BridgeCall } from './fake-bridge';
