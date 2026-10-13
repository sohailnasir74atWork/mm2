package com.mm2tradesvalues

import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * Reloads the React host so a layout-direction change (I18nManager.forceRTL,
 * when the player switches to or from Arabic) applies at once instead of on
 * the next cold start. JS side: i18n.js → setAppLanguage.
 */
class AppReloadModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AppReload"

  @ReactMethod
  fun reload() {
    val app = reactApplicationContext.applicationContext as? ReactApplication ?: return
    UiThreadUtil.runOnUiThread { app.reactHost?.reload("layout direction changed") }
  }
}
