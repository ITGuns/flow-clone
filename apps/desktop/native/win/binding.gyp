{
  "targets": [
    {
      "target_name": "undertone_win",
      # Guard: on non-Windows this becomes a no-op target so `node-gyp` / install never fails on
      # mac/linux (CONTRACTS.md §2.3, guide §4.5 — the OS-matrix CI is the authority for native).
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/addon.cc",
            "src/hotkey.cc",
            "src/inject.cc",
            "src/activeapp.cc"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include_dir\")"
          ],
          "defines": [
            "NAPI_VERSION=8",
            "NAPI_CPP_EXCEPTIONS",
            "UNICODE",
            "_UNICODE"
          ],
          "libraries": [
            "user32.lib",
            "version.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17" ]
            }
          }
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
