// AppReload: reloads the React host so a layout-direction change
// (I18nManager.forceRTL, when the player switches to or from Arabic) applies
// at once instead of on the next cold start. JS side: i18n.js
// reloadForDirection. Android twin: android/.../AppReloadModule.kt.
//
// RCTTriggerReloadCommandListeners is the same call React Native's own
// release-mode "JS Crash Reload" uses (RCTExceptionsManager). In bridgeless
// mode RCTHost registers itself as a reload listener at init in every build
// configuration, and reloads its instance and surfaces when it fires.
// DevSettings.reload() would not do: it is a no-op outside __DEV__.
//
// A legacy (RCT_EXPORT_MODULE) module, served in bridgeless mode by the
// TurboModule interop layer, as React Native Firebase's modules are.

#import <React/RCTBridgeModule.h>
#import <React/RCTReloadCommand.h>

@interface AppReload : NSObject <RCTBridgeModule>
@end

@implementation AppReload

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(reload)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    RCTTriggerReloadCommandListeners(@"layout direction changed");
  });
}

@end
