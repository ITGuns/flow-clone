// Undertone win32 native addon entry point — CONTRACTS.md §2.3.
//
// N-API (node-addon-api) module. ABI-stable, no electron-rebuild required. Exposes the
// primitive surface consumed by `apps/desktop/src/native/win32/binding.ts`. The whole target
// is guarded by `OS=='win'` in binding.gyp, so this only ever compiles on Windows.
#include "util.h"

namespace undertone {
void InitHotkey(Napi::Env env, Napi::Object exports);
void InitInject(Napi::Env env, Napi::Object exports);
void InitActiveApp(Napi::Env env, Napi::Object exports);
}  // namespace undertone

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  undertone::InitHotkey(env, exports);
  undertone::InitInject(env, exports);
  undertone::InitActiveApp(env, exports);
  return exports;
}

NODE_API_MODULE(undertone_win, Init)
