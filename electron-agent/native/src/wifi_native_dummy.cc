#include <napi.h>

Napi::Value GetSSID(const Napi::CallbackInfo& info) {
    return info.Env().Null();
}
