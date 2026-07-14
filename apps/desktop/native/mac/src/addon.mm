// Undertone macOS native addon (task 2a).
//
// N-API (C ABI, NAPI_VERSION 8 — ABI-stable across Node/Electron, no electron-rebuild). This is
// the "dumb" binding surface behind apps/desktop/src/native/darwin: it performs OS calls and
// returns primitives / flat status strings. ALL policy (accelerator parsing, transition
// de-bounce, error mapping, truncation) lives in the JS wrappers and is unit-tested there.
//
// UNVERIFIED until the macos-latest CI job compiles it and a human runs the manual script — this
// file cannot be built or executed on the Windows orchestration host.
//
// Exposes: hotkeyRegister, hotkeyUnregister, inject, getActiveApp, checkPermission.

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>

#include <node_api.h>

#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>

// Modifier bitmask — MUST match MOD_* in apps/desktop/src/native/darwin/binding.ts.
static const uint32_t kModCmd = 1u << 0;
static const uint32_t kModCtrl = 1u << 1;
static const uint32_t kModAlt = 1u << 2;
static const uint32_t kModShift = 1u << 3;

namespace {

// ---- small N-API helpers -------------------------------------------------------------------

napi_value MakeString(napi_env env, const char* s) {
  napi_value v = nullptr;
  napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v);
  return v;
}

std::string GetStringArg(napi_env env, napi_value v) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) return std::string();
  std::string out;
  out.resize(len);
  size_t written = 0;
  napi_get_value_string_utf8(env, v, &out[0], len + 1, &written);
  out.resize(written);
  return out;
}

uint32_t GetUint32Arg(napi_env env, napi_value v) {
  uint32_t out = 0;
  napi_get_value_uint32(env, v, &out);
  return out;
}

// ---- hotkey event tap ----------------------------------------------------------------------

struct HotkeyReg {
  uint16_t keyCode;
  uint32_t modifiers;  // kMod* bitmask
  napi_threadsafe_function tsfn;
};

std::mutex g_mutex;
std::unordered_map<int, HotkeyReg*> g_regs;
int g_nextHandle = 1;
CFMachPortRef g_tap = nullptr;
CFRunLoopSourceRef g_source = nullptr;

bool ModsSatisfied(uint32_t mods, CGEventFlags flags) {
  if ((mods & kModCmd) && !(flags & kCGEventFlagMaskCommand)) return false;
  if ((mods & kModCtrl) && !(flags & kCGEventFlagMaskControl)) return false;
  if ((mods & kModAlt) && !(flags & kCGEventFlagMaskAlternate)) return false;
  if ((mods & kModShift) && !(flags & kCGEventFlagMaskShift)) return false;
  return true;
}

// Runs on the JS thread (via the threadsafe function). `data` is a heap "down"/"up" string.
void CallJs(napi_env env, napi_value js_cb, void* /*context*/, void* data) {
  char* phase = static_cast<char*>(data);
  if (env != nullptr && js_cb != nullptr) {
    napi_value undefined = nullptr;
    napi_value arg = nullptr;
    napi_get_undefined(env, &undefined);
    napi_create_string_utf8(env, phase, NAPI_AUTO_LENGTH, &arg);
    napi_call_function(env, undefined, js_cb, 1, &arg, nullptr);
  }
  std::free(phase);
}

void FirePhase(HotkeyReg* reg, const char* phase) {
  char* copy = strdup(phase);
  if (copy == nullptr) return;
  if (napi_call_threadsafe_function(reg->tsfn, copy, napi_tsfn_nonblocking) != napi_ok) {
    std::free(copy);
  }
}

CGEventRef TapCallback(CGEventTapProxy /*proxy*/, CGEventType type, CGEventRef event,
                       void* /*userInfo*/) {
  // Re-arm if macOS disabled the tap (timeout / user input).
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (g_tap != nullptr) CGEventTapEnable(g_tap, true);
    return event;
  }
  if (type != kCGEventKeyDown && type != kCGEventKeyUp) return event;

  const uint16_t keyCode = static_cast<uint16_t>(
      CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
  const CGEventFlags flags = CGEventGetFlags(event);
  const bool isDown = (type == kCGEventKeyDown);

  std::lock_guard<std::mutex> lock(g_mutex);
  for (auto& entry : g_regs) {
    HotkeyReg* reg = entry.second;
    if (reg->keyCode != keyCode) continue;
    if (isDown) {
      // Down requires the configured modifiers; up ignores them so a held-then-release always
      // reports up even if the user let go of a modifier first. The JS wrapper de-bounces.
      if (ModsSatisfied(reg->modifiers, flags)) FirePhase(reg, "down");
    } else {
      FirePhase(reg, "up");
    }
  }
  return event;
}

bool EnsureTap() {
  if (g_tap != nullptr) return true;
  const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp);
  g_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                           kCGEventTapOptionListenOnly, mask, TapCallback, nullptr);
  if (g_tap == nullptr) return false;  // typically: Accessibility permission not granted
  g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
  CFRunLoopAddSource(CFRunLoopGetMain(), g_source, kCFRunLoopCommonModes);
  CGEventTapEnable(g_tap, true);
  return true;
}

void TeardownTapIfIdle() {
  if (!g_regs.empty() || g_tap == nullptr) return;
  if (g_source != nullptr) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), g_source, kCFRunLoopCommonModes);
    CFRelease(g_source);
    g_source = nullptr;
  }
  CFMachPortInvalidate(g_tap);
  CFRelease(g_tap);
  g_tap = nullptr;
}

napi_value HotkeyRegister(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    napi_throw_error(env, nullptr, "hotkeyRegister(keyCode, modifiers, cb) requires 3 arguments");
    return nullptr;
  }

  const uint16_t keyCode = static_cast<uint16_t>(GetUint32Arg(env, argv[0]));
  const uint32_t modifiers = GetUint32Arg(env, argv[1]);

  napi_value asyncName = MakeString(env, "undertone_hotkey");
  napi_threadsafe_function tsfn = nullptr;
  if (napi_create_threadsafe_function(env, argv[2], nullptr, asyncName, 0, 1, nullptr, nullptr,
                                      nullptr, CallJs, &tsfn) != napi_ok) {
    napi_throw_error(env, nullptr, "failed to create hotkey callback");
    return nullptr;
  }
  // Don't keep the event loop alive purely for the tap.
  napi_unref_threadsafe_function(env, tsfn);

  std::lock_guard<std::mutex> lock(g_mutex);
  if (!EnsureTap()) {
    napi_release_threadsafe_function(tsfn, napi_tsfn_release);
    napi_throw_error(env, nullptr,
                     "failed to create event tap (Accessibility permission not granted?)");
    return nullptr;
  }

  HotkeyReg* reg = new HotkeyReg{keyCode, modifiers, tsfn};
  const int handle = g_nextHandle++;
  g_regs[handle] = reg;

  napi_value result = nullptr;
  napi_create_int32(env, handle, &result);
  return result;
}

napi_value HotkeyUnregister(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t handle = 0;
  if (argc >= 1) napi_get_value_int32(env, argv[0], &handle);

  std::lock_guard<std::mutex> lock(g_mutex);
  auto it = g_regs.find(handle);
  if (it != g_regs.end()) {
    HotkeyReg* reg = it->second;
    napi_release_threadsafe_function(reg->tsfn, napi_tsfn_release);
    delete reg;
    g_regs.erase(it);
    TeardownTapIfIdle();
  }
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

// ---- text injection ------------------------------------------------------------------------

// Clipboard fallback: save clipboard → set text → synth Cmd+V → restore after a short delay.
// Returns false if the clipboard could not be set or the paste could not be synthesized.
bool ClipboardFallback(const std::string& text) {
  @autoreleasepool {
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    NSString* saved = [pb stringForType:NSPasteboardTypeString];  // may be nil
    NSString* newText = [NSString stringWithUTF8String:text.c_str()];
    if (newText == nil) return false;

    [pb clearContents];
    if (![pb setString:newText forType:NSPasteboardTypeString]) return false;

    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    CGEventRef down = CGEventCreateKeyboardEvent(src, static_cast<CGKeyCode>(0x09), true);
    CGEventRef up = CGEventCreateKeyboardEvent(src, static_cast<CGKeyCode>(0x09), false);
    if (down == nullptr || up == nullptr) {
      if (down != nullptr) CFRelease(down);
      if (up != nullptr) CFRelease(up);
      if (src != nullptr) CFRelease(src);
      return false;
    }
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
    if (src != nullptr) CFRelease(src);

    NSString* savedCopy = (saved != nil) ? [saved copy] : nil;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(0.15 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     NSPasteboard* pb2 = [NSPasteboard generalPasteboard];
                     [pb2 clearContents];
                     if (savedCopy != nil) [pb2 setString:savedCopy forType:NSPasteboardTypeString];
                   });
    return true;
  }
}

napi_value Inject(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return MakeString(env, "inject-failed");

  const std::string text = GetStringArg(env, argv[0]);

  if (!AXIsProcessTrusted()) return MakeString(env, "no-permission");

  AXUIElementRef sys = AXUIElementCreateSystemWide();
  CFTypeRef focused = nullptr;
  AXError err = AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute, &focused);
  if (err != kAXErrorSuccess || focused == nullptr) {
    if (focused != nullptr) CFRelease(focused);
    CFRelease(sys);
    return MakeString(env, "no-target");
  }

  AXUIElementRef element = static_cast<AXUIElementRef>(focused);
  CFStringRef cfText =
      CFStringCreateWithCString(kCFAllocatorDefault, text.c_str(), kCFStringEncodingUTF8);
  AXError setErr = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute, cfText);

  const char* result;
  if (setErr == kAXErrorSuccess) {
    result = "ax";  // AX write landed at the focused element's selection
  } else {
    result = ClipboardFallback(text) ? "clipboard-fallback" : "inject-failed";
  }

  if (cfText != nullptr) CFRelease(cfText);
  CFRelease(element);
  CFRelease(sys);
  return MakeString(env, result);
}

// ---- active app ----------------------------------------------------------------------------

std::string CopyFocusedWindowTitle(pid_t pid) {
  std::string title;
  AXUIElementRef appEl = AXUIElementCreateApplication(pid);
  if (appEl == nullptr) return title;

  CFTypeRef window = nullptr;
  if (AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute, &window) == kAXErrorSuccess &&
      window != nullptr) {
    CFTypeRef titleRef = nullptr;
    if (AXUIElementCopyAttributeValue(static_cast<AXUIElementRef>(window), kAXTitleAttribute,
                                      &titleRef) == kAXErrorSuccess &&
        titleRef != nullptr) {
      if (CFGetTypeID(titleRef) == CFStringGetTypeID()) {
        char buffer[1024];
        if (CFStringGetCString(static_cast<CFStringRef>(titleRef), buffer, sizeof(buffer),
                               kCFStringEncodingUTF8)) {
          title = buffer;
        }
      }
      CFRelease(titleRef);
    }
    CFRelease(window);
  }
  CFRelease(appEl);
  return title;
}

napi_value GetActiveApp(napi_env env, napi_callback_info /*info*/) {
  std::string bundleId;
  std::string appName;
  std::string windowTitle;

  @autoreleasepool {
    NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (app != nil) {
      if (app.bundleIdentifier != nil) bundleId = app.bundleIdentifier.UTF8String;
      if (app.localizedName != nil) appName = app.localizedName.UTF8String;
      if (AXIsProcessTrusted()) {
        windowTitle = CopyFocusedWindowTitle(app.processIdentifier);
      }
    }
  }

  napi_value obj = nullptr;
  napi_create_object(env, &obj);
  napi_set_named_property(env, obj, "bundleId", MakeString(env, bundleId.c_str()));
  napi_set_named_property(env, obj, "appName", MakeString(env, appName.c_str()));
  napi_set_named_property(env, obj, "windowTitle", MakeString(env, windowTitle.c_str()));
  return obj;
}

// ---- permission ----------------------------------------------------------------------------

// AXIsProcessTrusted() — read-only, never triggers the OS prompt (task 2d owns the pre-prompt UX).
napi_value CheckPermission(napi_env env, napi_callback_info /*info*/) {
  return MakeString(env, AXIsProcessTrusted() ? "granted" : "denied");
}

// ---- module init ---------------------------------------------------------------------------

napi_value Init(napi_env env, napi_value exports) {
  const struct {
    const char* name;
    napi_callback fn;
  } entries[] = {
      {"hotkeyRegister", HotkeyRegister}, {"hotkeyUnregister", HotkeyUnregister},
      {"inject", Inject},                 {"getActiveApp", GetActiveApp},
      {"checkPermission", CheckPermission},
  };
  for (const auto& e : entries) {
    napi_value fn = nullptr;
    napi_create_function(env, e.name, NAPI_AUTO_LENGTH, e.fn, nullptr, &fn);
    napi_set_named_property(env, exports, e.name, fn);
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
