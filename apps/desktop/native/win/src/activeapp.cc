// Active-app detection — CONTRACTS.md §2.3 `ActiveAppDetector`, §1 `AppContext`.
//
// Returns the foreground window's owning executable basename (→ `bundleId`, e.g. "slack.exe"),
// a human-readable name (FileDescription from version info, else the basename → `appName`), and
// the window title (→ `windowTitle`). `register` is derived client-side and not produced here.
#include "util.h"

#include <cstdio>
#include <cwchar>
#include <string>

#pragma comment(lib, "version.lib")

namespace undertone {
namespace {

// Best human-readable name for an executable: its version-info FileDescription, or "" if absent.
std::wstring FileDescriptionOf(const std::wstring& path) {
  DWORD dummy = 0;
  DWORD size = GetFileVersionInfoSizeW(path.c_str(), &dummy);
  if (size == 0) return L"";

  std::wstring block(size, L'\0');
  if (!GetFileVersionInfoW(path.c_str(), 0, size, block.data())) return L"";

  // Resolve the file's translation (language + codepage) so we query the right string table.
  struct LangCodepage {
    WORD language;
    WORD codepage;
  };
  LangCodepage* langs = nullptr;
  UINT langBytes = 0;
  if (!VerQueryValueW(block.data(), L"\\VarFileInfo\\Translation",
                      reinterpret_cast<void**>(&langs), &langBytes) ||
      langBytes < sizeof(LangCodepage)) {
    return L"";
  }

  wchar_t subBlock[64];
  swprintf(subBlock, 64, L"\\StringFileInfo\\%04x%04x\\FileDescription", langs[0].language,
           langs[0].codepage);

  wchar_t* value = nullptr;
  UINT valueLen = 0;
  if (!VerQueryValueW(block.data(), subBlock, reinterpret_cast<void**>(&value), &valueLen) ||
      valueLen == 0) {
    return L"";
  }
  return std::wstring(value, valueLen > 0 ? valueLen - 1 : 0);  // drop trailing NUL
}

Napi::Value GetActiveApp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  HWND hwnd = GetForegroundWindow();
  DWORD pid = 0;
  std::wstring exeName;
  std::wstring appName;
  std::wstring title;

  if (hwnd != nullptr) {
    GetWindowThreadProcessId(hwnd, &pid);

    int len = GetWindowTextLengthW(hwnd);
    if (len > 0) {
      title.resize(static_cast<size_t>(len) + 1);
      int got = GetWindowTextW(hwnd, title.data(), len + 1);
      title.resize(static_cast<size_t>(got));
    }
    if (title.size() > 256) {
      title.resize(256);
    }

    HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (proc != nullptr) {
      wchar_t path[MAX_PATH] = L"";
      DWORD cch = MAX_PATH;
      if (QueryFullProcessImageNameW(proc, 0, path, &cch)) {
        std::wstring full(path, cch);
        exeName = BaseName(full);
        appName = FileDescriptionOf(full);
      }
      CloseHandle(proc);
    }
  }

  Napi::Object out = Napi::Object::New(env);
  out.Set("exeName", Utf16(env, exeName));
  out.Set("appName", Utf16(env, appName));
  out.Set("title", Utf16(env, title));
  out.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
  return out;
}

}  // namespace

void InitActiveApp(Napi::Env env, Napi::Object exports) {
  exports.Set("getActiveApp", Napi::Function::New(env, GetActiveApp));
}

}  // namespace undertone
