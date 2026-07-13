// Public surface of the desktop WebSocket client (CONTRACTS.md §4).
export { WsClient, type WsClientOptions } from './ws-client';
export { createWebSocketTransport } from './websocket-transport';
export { TypedEmitter, type Listener } from './emitter';
export type {
  ConnectionState,
  SessionInvalidEvent,
  TokenProvider,
  Transport,
  TransportCloseInfo,
  TransportConnection,
  WsClientEventMap,
} from './types';
