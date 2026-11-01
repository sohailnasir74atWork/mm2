# ═══════════════════════════════════════════════════════════════════════════
# R8 rules for com.mm2tradesvalues
#
# Ported from adoptme-jan7 (same libraries) on 2026-10-29. Until then this
# file carried `-dontoptimize`, and Play graded releases 44 and 50
# "Memory: Bad behavior — DEX code optimization 0%" (fix by Feb 2027).
# Do NOT put -dontoptimize back: it is what that grade measures.
#
# READ THIS BEFORE ADDING A `-keep`.
#
# Every `-keep class some.package.** { *; }` is a promise to R8 that it may not
# rename, inline or remove any of those classes. Play Console grades the DEX of
# each uploaded bundle and warns when optimization or obfuscation drops under
# 25%. Blanket keeps for com.google.android.gms / firebase / react / okhttp
# are never needed: every one of those libraries ships its own consumer
# ProGuard rules inside its AAR; AGP merges them automatically and writes the
# merged result to build/outputs/mapping/release/configuration.txt.
#
# So: only rules the AARs do NOT cover belong below, and each one says why.
#
# Measure the obfuscation rate of a build before/after any change here:
#   awk '/^[^ \t].* -> .*:$/ { l=$0; sub(/:$/,"",l); split(l,a," -> ");
#     n=split(a[1],p,"."); m=split(a[2],q,".");
#     t++; if (p[n]!=q[m]) o++ }
#     END { printf "%d/%d obfuscated (%.1f%%)\n", o, t, 100*o/t }' \
#     app/build/outputs/mapping/release/mapping.txt
#
# And ALWAYS install + launch a release build before uploading. Removing keeps
# or turning optimization on is the change most likely to surface a missing
# rule, and R8 failures show up at runtime, never at build time.
# ═══════════════════════════════════════════════════════════════════════════

# ── Attributes ──────────────────────────────────────────────────────────────
# Without these every Crashlytics stack frame loses its file and line number.
# The Crashlytics gradle plugin uploads mapping.txt, so traces still
# deobfuscate.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── React Native / Hermes ───────────────────────────────────────────────────
# react-android's consumer rules already keep @DoNotStrip, NativeModule and
# JavaScriptModule implementors, native <methods>, @ReactProp methods and the
# bridge + turbomodule packages. Hermes' unicode helpers are reached from C++
# via FindClass on a literal descriptor, which a rename would break.
-keep class com.facebook.hermes.unicode.** { *; }

-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-dontwarn com.facebook.jni.**

# ── Room / WorkManager / androidx.startup ───────────────────────────────────
# Launch crash in 1.4.7 (39), 2026-09-27: "Unable to get provider
# androidx.startup.InitializationProvider: Failed to create an instance of
# class androidx.work.impl.WorkDatabase.canonicalName". WorkManager (pulled in
# by notifee) starts from an androidx.startup provider and builds its Room
# database by reflectively loading WorkDatabase_Impl; Room's own consumer rule
# keeps the class but not its constructor under AGP 9's R8. Targeted keeps
# only — blanket `-keep class androidx.** { *; }` trips Play's obfuscation
# warning.
-keepattributes InnerClasses,EnclosingMethod,Signature,*Annotation*
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keepnames class * extends androidx.room.RoomDatabase
-keep class * implements androidx.startup.Initializer { <init>(); }

# ── Nitro modules / MMKV ────────────────────────────────────────────────────
# The C++ side resolves every hybrid by literal class descriptor
# (findClassStatic("com/margelo/nitro/...")); a single missed @Keep on a
# generated file is a hard crash on first storage access. ~60 classes.
-keep class com.margelo.nitro.** { *; }
-keep class com.mrousavy.** { *; }

# ── AdMob mediation adapters ────────────────────────────────────────────────
# Adapters are instantiated reflectively by class name from the AdMob server
# config, so R8 cannot see the reference.
-keep class com.google.ads.mediation.** { *; }
-dontwarn com.google.ads.mediation.**

# ── Install Referrer (react-native-device-info) ─────────────────────────────
# RNInstallReferrerClient looks up InstallReferrerClient.newBuilder by
# reflection. Rule from the library README.
-keep class com.android.installreferrer.api.** { *; }

# ── Warning suppression only — NO keeps ─────────────────────────────────────
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**
-dontwarn com.revenuecat.**
-dontwarn com.swmansion.**
-dontwarn com.airbnb.lottie.**
-dontwarn com.horcrux.svg.**
-dontwarn com.oblador.**
-dontwarn com.reactnativecompressor.**
-dontwarn com.zoontek.**
-dontwarn io.invertase.**
-dontwarn okhttp3.**
-dontwarn okio.**
