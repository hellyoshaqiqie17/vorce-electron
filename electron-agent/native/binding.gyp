{
  "targets": [
    {
      "target_name": "wifi_native",
      "sources": [ "src/wifi_native.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "src/wifi_native_mac.mm" ],
          "link_settings": {
            "libraries": [
              "-framework CoreWLAN",
              "-framework Foundation"
            ]
          },
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS!='mac'", {
          "sources": [ "src/wifi_native_dummy.cc" ]
        }]
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}
