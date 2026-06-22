#import <Foundation/Foundation.h>
#import <CoreWLAN/CoreWLAN.h>
#include <napi.h>

Napi::Value GetSSID(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    @autoreleasepool {
        CWWiFiClient *client = [CWWiFiClient sharedWiFiClient];
        if (client == nil) {
            return env.Null();
        }
        
        CWInterface *interface = [client interface];
        if (interface == nil) {
            return env.Null();
        }
        
        NSString *ssid = [interface ssid];
        if (ssid == nil) {
            return Napi::String::New(env, "");
        }
        
        return Napi::String::New(env, [ssid UTF8String]);
    }
}
