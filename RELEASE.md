# Release & Hardening Guide

## 1. One-Time Keystore Setup
Create a dedicated keystore outside the repository:
mkdir -p ~/keys
keytool -genkeypair -v -keystore ~/keys/expense-tracker-release.jks -alias expense -keyalg RSA -keysize 2048 -validity 10000
Create `android/keystore.properties` (never committed to git):
storeFile=~/keys/expense-tracker-release.jks
storePassword=<YOUR_STORE_PASSWORD>
keyAlias=expense
keyPassword=<YOUR_KEY_PASSWORD>
Warning: Back up keystore and passwords offline and in a password manager. If lost, future updates cannot be installed without uninstalling (which erases local data).

## 2. Cloud Backup & Privacy Architecture
Cloud backup is disabled (`android:allowBackup="false"`). Local SQLite and raw SMS messages are disposable; the SAF shared sync folder is the single source of truth. Disabling cloud backup prevents sensitive financial SMS text from being uploaded to Google servers.

## 3. Build Release APK
Run: `npm run release` (or `./scripts/release.sh`).
Build outputs to `android/app/build/outputs/apk/release/app-release.apk`.

## 4. Installation & Updates
First-time install: If a debug build is installed, uninstall it first (signature mismatch). Then:
adb install -r android/app/build/outputs/apk/release/app-release.apk
Onboarding will detect existing sync data; tap "Restore" to reload history.
Second phone: Copy APK, enable "Install unknown apps" for file manager, and accept Play Protect untrusted developer warning.
Updating: Increment `versionCode` in `android/app/build.gradle`, rebuild, and install over existing app (`adb install -r` or file manager). Same signature preserves all local app data without needing restore.

## 5. Verification Commands
Verify signature:
/var/home/student/Android/Sdk/build-tools/34.0.0/apksigner verify --verbose <apk-path>
Verify permissions (only READ_SMS expected):
/var/home/student/Android/Sdk/cmdline-tools/latest/bin/apkanalyzer manifest permissions <apk-path>
Verify not debuggable:
/var/home/student/Android/Sdk/build-tools/34.0.0/aapt2 dump badging <apk-path> | grep -i debuggable
Verify no logcat leakage during use:
adb logcat -d | grep -E "INSERT INTO|SELECT|amount"

## 6. Pre-Release Checklist
- [ ] Automated tests pass (`npm test`)
- [ ] Permissions verified: exactly READ_SMS
- [ ] Release APK is signed and not debuggable
- [ ] Logcat verified clean (no SQL, amounts, merchant or SMS text)
- [ ] Clean install in airplane mode starts properly
- [ ] Onboarding "Restore" verified from sync folder
- [ ] In-place update preserves local data across versionCode bump

