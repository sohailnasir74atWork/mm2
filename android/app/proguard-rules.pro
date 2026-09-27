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
