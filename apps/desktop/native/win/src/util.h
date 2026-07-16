// Shared helpers for the Undertone win32 addon. Windows-only; the whole target is guarded by
// `OS=='win'` in binding.gyp so these files never compile off-Windows.
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <napi.h>

#include <string>

namespace undertone {

// wchar_t is UTF-16 on Windows, so it aliases char16_t for N-API string construction.
inline Napi::String Utf16(Napi::Env env, const wchar_t* s) {
  return Napi::String::New(env, reinterpret_cast<const char16_t*>(s));
}

inline Napi::String Utf16(Napi::Env env, const std::wstring& s) {
  return Napi::String::New(env, reinterpret_cast<const char16_t*>(s.c_str()), s.size());
}

// Basename of a full path (portion after the last path separator).
inline std::wstring BaseName(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

}  // namespace undertone
