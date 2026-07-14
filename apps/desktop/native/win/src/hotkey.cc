// Global push-to-talk hotkey — CONTRACTS.md §2.3 `HotkeyManager` (win side).
//
// RegisterHotKey cannot report key-UP, but push-to-talk needs both transitions, so each
// registration owns a dedicated thread that installs a WH_KEYBOARD_LL hook and pumps its own
// message loop (a low-level keyboard hook only fires on a thread with a running message loop).
//
// The hook callback is trivial and NEVER blocks the hook chain (blocking it would freeze
// system-wide input): it de-duplicates OS auto-repeat, then hands the transition to N-API's
// thread-safe function via NonBlockingCall and immediately calls CallNextHookEx. The JS
// callback therefore runs on the main event-loop thread, not inside the hook.
#include "util.h"

#include <cstdint>
#include <map>

namespace undertone {
namespace {

struct HotkeyContext {
  DWORD vk = 0;
  Napi::ThreadSafeFunction tsfn;
  HANDLE thread = nullptr;
  DWORD threadId = 0;
  HANDLE readyEvent = nullptr;  // signaled once the hook is installed (or failed)
  HHOOK hook = nullptr;
  bool pressed = false;  // touched only by the hook thread — auto-repeat de-dup
};

// Registrations live only as long as JS holds their handle. Accessed exclusively from the JS
// main thread (register/unregister), so no lock is required. The hook thread only ever touches
// its own context via the thread_local pointer below.
std::map<int32_t, HotkeyContext*> g_hotkeys;
int32_t g_nextHandle = 1;

// Each hotkey thread has exactly one hook; thread_local lets the parameterless LL hook proc
// reach its own context without a global lookup.
thread_local HotkeyContext* t_ctx = nullptr;

// Marshals a single transition to JS. `data` is a heap bool owned by the callback. During
// tsfn teardown this may run with a null env (abort); guard and always free the payload.
void CallJs(Napi::Env env, Napi::Function cb, bool* data) {
  if (env != nullptr) {
    cb.Call({Napi::Boolean::New(env, *data)});
  }
  delete data;
}

void PostTransition(HotkeyContext* ctx, bool isDown) {
  bool* payload = new bool(isDown);
  // Non-blocking: if the queue is somehow full or the tsfn is closing, drop rather than stall
  // the system input hook. A dropped transition is far less harmful than a frozen keyboard.
  napi_status status = ctx->tsfn.NonBlockingCall(payload, CallJs);
  if (status != napi_ok) {
    delete payload;
  }
}

LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  HotkeyContext* ctx = t_ctx;
  if (nCode == HC_ACTION && ctx != nullptr) {
    const KBDLLHOOKSTRUCT* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    if (kb->vkCode == ctx->vk) {
      if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
        if (!ctx->pressed) {
          ctx->pressed = true;
          PostTransition(ctx, true);
        }
        // else: OS auto-repeat while held → swallow (transitions only).
      } else if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {
        if (ctx->pressed) {
          ctx->pressed = false;
          PostTransition(ctx, false);
        }
      }
    }
  }
  // ALWAYS pass the event on — we observe, never consume, the key.
  return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

DWORD WINAPI HotkeyThreadProc(LPVOID param) {
  HotkeyContext* ctx = reinterpret_cast<HotkeyContext*>(param);
  t_ctx = ctx;

  ctx->hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  // Ensure the thread has a message queue before the installer waits on us.
  MSG msg;
  PeekMessageW(&msg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  SetEvent(ctx->readyEvent);

  if (ctx->hook == nullptr) {
    t_ctx = nullptr;
    return 1;
  }

  // Message loop: required for WH_KEYBOARD_LL delivery. Exits when hotkeyUnregister posts WM_QUIT.
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  UnhookWindowsHookEx(ctx->hook);
  ctx->hook = nullptr;
  t_ctx = nullptr;
  return 0;
}

Napi::Value HotkeyRegister(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
    throw Napi::TypeError::New(env, "hotkeyRegister(vk: number, cb: (isDown: boolean) => void)");
  }

  HotkeyContext* ctx = new HotkeyContext();
  ctx->vk = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  ctx->tsfn = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "UndertoneHotkey",
                                            0 /* unlimited queue */, 1 /* one thread */);
  ctx->readyEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

  ctx->thread = CreateThread(nullptr, 0, HotkeyThreadProc, ctx, 0, &ctx->threadId);
  if (ctx->thread == nullptr) {
    ctx->tsfn.Release();
    CloseHandle(ctx->readyEvent);
    delete ctx;
    throw Napi::Error::New(env, "hotkeyRegister: failed to start hook thread");
  }

  // Wait until the hook is installed so a failure surfaces synchronously to the caller.
  WaitForSingleObject(ctx->readyEvent, 5000);
  if (ctx->hook == nullptr) {
    PostThreadMessageW(ctx->threadId, WM_QUIT, 0, 0);
    WaitForSingleObject(ctx->thread, 5000);
    ctx->tsfn.Release();
    CloseHandle(ctx->thread);
    CloseHandle(ctx->readyEvent);
    delete ctx;
    throw Napi::Error::New(env, "hotkeyRegister: SetWindowsHookExW(WH_KEYBOARD_LL) failed");
  }

  int32_t handle = g_nextHandle++;
  g_hotkeys[handle] = ctx;
  return Napi::Number::New(env, handle);
}

Napi::Value HotkeyUnregister(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    throw Napi::TypeError::New(env, "hotkeyUnregister(handle: number)");
  }
  int32_t handle = info[0].As<Napi::Number>().Int32Value();
  auto it = g_hotkeys.find(handle);
  if (it == g_hotkeys.end()) {
    return env.Undefined();  // already released — idempotent
  }
  HotkeyContext* ctx = it->second;
  g_hotkeys.erase(it);

  // Stop the thread FIRST so no further hook callbacks fire, then release the tsfn.
  PostThreadMessageW(ctx->threadId, WM_QUIT, 0, 0);
  WaitForSingleObject(ctx->thread, 5000);
  ctx->tsfn.Release();
  CloseHandle(ctx->thread);
  CloseHandle(ctx->readyEvent);
  delete ctx;
  return env.Undefined();
}

}  // namespace

void InitHotkey(Napi::Env env, Napi::Object exports) {
  exports.Set("hotkeyRegister", Napi::Function::New(env, HotkeyRegister));
  exports.Set("hotkeyUnregister", Napi::Function::New(env, HotkeyUnregister));
}

}  // namespace undertone
