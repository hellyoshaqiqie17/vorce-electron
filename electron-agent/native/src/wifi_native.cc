#include <napi.h>

// Forward declaration of GetSSID implemented in platform-specific files
Napi::Value GetSSID(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "getSSID"), Napi::Function::New(env, GetSSID));
    return exports;
}

NODE_API_MODULE(wifi_native, Init)
