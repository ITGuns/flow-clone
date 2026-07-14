// Text injection primitives — CONTRACTS.md §2.3 `TextInjector`, guide §4.1 (win row).
//
// The addon exposes primitives; the fallback orchestration and §8 error-code mapping live in
// testable TS (`text-injector.ts`). Here:
//   getForegroundWindow() → foreground facts incl. whether it is our own process (HUD guard).
//   sendUnicode(text)      → SendInput with KEYEVENTF_UNICODE (layout-independent; handles the
//                            full BMP and surrogate pairs), reporting accepted vs. sent + error.
//   clipboardPaste(text)   → save clipboard (CF_UNICODETEXT) → set text → synth Ctrl+V → restore.
#include "util.h"

#include <string>
#include <vector>

namespace undertone {
namespace {

Napi::Value GetForegroundWindowInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND hwnd = GetForegroundWindow();
  if (hwnd == nullptr) {
    return env.Null();
  }

  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);

  wchar_t cls[256] = L"";
  GetClassNameW(hwnd, cls, 256);

  std::wstring title;
  int len = GetWindowTextLengthW(hwnd);
  if (len > 0) {
    title.resize(static_cast<size_t>(len) + 1);
    int got = GetWindowTextW(hwnd, title.data(), len + 1);
    title.resize(static_cast<size_t>(got));
  }
  if (title.size() > 256) {
    title.resize(256);
  }

  Napi::Object out = Napi::Object::New(env);
  out.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
  out.Set("isOwnProcess", Napi::Boolean::New(env, pid == GetCurrentProcessId()));
  out.Set("className", Utf16(env, cls));
  out.Set("title", Utf16(env, title));
  return out;
}

Napi::Value SendUnicode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(env, "sendUnicode(text: string)");
  }
  std::u16string text = info[0].As<Napi::String>().Utf16Value();

  // Two events (down + up) per UTF-16 code unit. Surrogate pairs are sent as their two halves,
  // which Windows reassembles for KEYEVENTF_UNICODE.
  std::vector<INPUT> inputs;
  inputs.reserve(text.size() * 2);
  for (char16_t cu : text) {
    INPUT down = {};
    down.type = INPUT_KEYBOARD;
    down.ki.wScan = static_cast<WORD>(cu);
    down.ki.dwFlags = KEYEVENTF_UNICODE;
    inputs.push_back(down);

    INPUT up = down;
    up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    inputs.push_back(up);
  }

  UINT sent = static_cast<UINT>(inputs.size());
  UINT accepted = 0;
  DWORD lastError = 0;
  if (sent > 0) {
    SetLastError(0);
    accepted = SendInput(sent, inputs.data(), sizeof(INPUT));
    if (accepted < sent) {
      lastError = GetLastError();
    }
  }

  Napi::Object out = Napi::Object::New(env);
  out.Set("sent", Napi::Number::New(env, sent));
  out.Set("accepted", Napi::Number::New(env, accepted));
  out.Set("lastError", Napi::Number::New(env, static_cast<double>(lastError)));
  return out;
}

// Reads the current CF_UNICODETEXT clipboard content. Requires an already-open clipboard.
bool ReadClipboardText(std::u16string& out) {
  HANDLE h = GetClipboardData(CF_UNICODETEXT);
  if (h == nullptr) return false;
  const wchar_t* p = reinterpret_cast<const wchar_t*>(GlobalLock(h));
  if (p == nullptr) return false;
  out.assign(reinterpret_cast<const char16_t*>(p));
  GlobalUnlock(h);
  return true;
}

// Writes text as CF_UNICODETEXT. Requires an already-open, already-emptied clipboard.
bool WriteClipboardText(const std::u16string& text) {
  size_t bytes = (text.size() + 1) * sizeof(char16_t);
  HGLOBAL g = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (g == nullptr) return false;
  void* dst = GlobalLock(g);
  if (dst == nullptr) {
    GlobalFree(g);
    return false;
  }
  memcpy(dst, text.data(), text.size() * sizeof(char16_t));
  reinterpret_cast<char16_t*>(dst)[text.size()] = 0;  // NUL terminate
  GlobalUnlock(g);
  if (SetClipboardData(CF_UNICODETEXT, g) == nullptr) {
    GlobalFree(g);
    return false;
  }
  return true;  // ownership transferred to the clipboard on success
}

// Synthesizes Ctrl+V. Returns SendInput's accepted count via out-params.
void SendCtrlV(UINT& sent, UINT& accepted, DWORD& lastError) {
  INPUT seq[4] = {};
  auto key = [](INPUT& in, WORD vk, bool up) {
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
  };
  key(seq[0], VK_CONTROL, false);
  key(seq[1], 'V', false);
  key(seq[2], 'V', true);
  key(seq[3], VK_CONTROL, true);

  sent = 4;
  SetLastError(0);
  accepted = SendInput(sent, seq, sizeof(INPUT));
  lastError = (accepted < sent) ? GetLastError() : 0;
}

Napi::Value ClipboardPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(env, "clipboardPaste(text: string)");
  }
  std::u16string text = info[0].As<Napi::String>().Utf16Value();

  auto fail = [&](DWORD code) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("ok", Napi::Boolean::New(env, false));
    out.Set("lastError", Napi::Number::New(env, static_cast<double>(code)));
    return out;
  };

  if (!OpenClipboard(nullptr)) {
    return fail(GetLastError());
  }
  std::u16string saved;
  bool hadText = ReadClipboardText(saved);
  EmptyClipboard();
  bool wrote = WriteClipboardText(text);
  CloseClipboard();
  if (!wrote) {
    return fail(GetLastError());
  }

  // Synthesize the paste.
  UINT sent = 0, accepted = 0;
  DWORD sendErr = 0;
  SendCtrlV(sent, accepted, sendErr);

  // Give the foreground app a moment to service WM_PASTE before we put the old clipboard back,
  // otherwise the restore can race ahead of the paste and the app pastes the wrong content.
  Sleep(60);

  // Restore the previous clipboard text (or clear it if there was none).
  if (OpenClipboard(nullptr)) {
    EmptyClipboard();
    if (hadText) {
      WriteClipboardText(saved);
    }
    CloseClipboard();
  }

  bool ok = (accepted == sent);
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, ok));
  out.Set("lastError", Napi::Number::New(env, static_cast<double>(ok ? 0u : sendErr)));
  return out;
}

}  // namespace

void InitInject(Napi::Env env, Napi::Object exports) {
  exports.Set("getForegroundWindow", Napi::Function::New(env, GetForegroundWindowInfo));
  exports.Set("sendUnicode", Napi::Function::New(env, SendUnicode));
  exports.Set("clipboardPaste", Napi::Function::New(env, ClipboardPaste));
}

}  // namespace undertone
