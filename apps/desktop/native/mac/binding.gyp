{
  "targets": [
    {
      "target_name": "undertone_mac",
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": ["src/addon.mm"],
            "defines": ["NAPI_VERSION=8"],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc"]
            },
            "link_settings": {
              "libraries": [
                "-framework AppKit",
                "-framework ApplicationServices",
                "-framework CoreGraphics",
                "-framework CoreFoundation"
              ]
            }
          },
          {
            # Non-mac: no sources. The build script (build-if-darwin.mjs) skips node-gyp entirely
            # off darwin, so this target is never actually configured on Windows/Linux; the empty
            # branch keeps `gyp` well-formed if it is ever evaluated.
            "type": "none"
          }
        ]
      ]
    }
  ]
}
