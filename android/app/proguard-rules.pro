# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# AGP 9 (React Native 0.87) no longer accepts proguard-android.txt, so the
# release build now uses proguard-android-optimize.txt. -dontoptimize keeps the
# old behaviour: proguard-android.txt was exactly that file plus -dontoptimize.
# Do not drop this without adding keep rules first - with optimization on and
# no rules, Room/WorkManager (via notifee) crash at launch in release builds.
-dontoptimize

# ── Room / WorkManager launch crash (1.4.7 (39), 2026-09-27) ──────────────────
# "Unable to get provider androidx.startup.InitializationProvider: Failed to
# create an instance of class androidx.work.impl.WorkDatabase.canonicalName".
# Room finds its generated database via getCanonicalName() + "_Impl" and
# reflection; WorkManager (pulled in by notifee) builds it from an
# androidx.startup ContentProvider, so a renamed class or stripped
# InnerClasses/EnclosingMethod kills every launch before any JS runs.
# -dontoptimize above is NOT enough under AGP 9. Targeted keeps only — blanket
# `-keep class androidx.** { *; }` rules trip Play's obfuscation warning.
-keepattributes InnerClasses,EnclosingMethod,Signature,*Annotation*
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keepnames class * extends androidx.room.RoomDatabase
-keep class * implements androidx.startup.Initializer { <init>(); }
