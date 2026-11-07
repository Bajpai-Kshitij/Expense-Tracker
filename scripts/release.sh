#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FORCE=false
VERIFY=false

for arg in "$@"; do
  case "$arg" in
    --force)
      FORCE=true
      ;;
    --verify)
      VERIFY=true
      ;;
    *)
      ;;
  esac
done

# Check uncommitted git changes unless --force
if [ "$FORCE" = false ]; then
  if ! git diff-index --quiet HEAD -- 2>/dev/null || [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "ERROR: Git working directory has uncommitted changes." >&2
    echo "Commit or stash your changes before building a release, or pass --force to proceed." >&2
    exit 1
  fi
fi

# Helper to run npm commands
run_npm() {
  if command -v npm >/dev/null 2>&1; then
    npm "$@"
  elif command -v toolbox >/dev/null 2>&1; then
    toolbox run --container expense_tracker npm "$@"
  else
    echo "ERROR: Neither npm nor toolbox was found." >&2
    exit 1
  fi
}

# Helper to run npx commands
run_npx() {
  if command -v npx >/dev/null 2>&1; then
    npx "$@"
  elif command -v toolbox >/dev/null 2>&1; then
    toolbox run --container expense_tracker npx "$@"
  else
    echo "ERROR: Neither npx nor toolbox was found." >&2
    exit 1
  fi
}

echo "=== 1. Running Automated Tests ==="
run_npm test

echo "=== 2. Building Web Assets ==="
run_npm run build

echo "=== 3. Syncing Capacitor Android Platform ==="
run_npx cap sync android

echo "=== 4. Assembling Android Release APK ==="
(cd android && ./gradlew assembleRelease)

APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  APK_PATH="$(find android/app/build/outputs/apk/release -name "*.apk" | head -n 1 || true)"
fi

if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
  echo "ERROR: Release APK was not found in android/app/build/outputs/apk/release/" >&2
  exit 1
fi

VERSION_CODE=$(grep -E '^\s*versionCode\s+[0-9]+' android/app/build.gradle | head -n 1 | awk '{print $2}')
VERSION_NAME=$(grep -E '^\s*versionName\s+["'"'"'][^"'"'"']+["'"'"']' android/app/build.gradle | head -n 1 | sed -E 's/.*["'"'"']([^"'"'"']+)["'"'"'].*/\1/')

APK_SIZE=$(ls -lh "$APK_PATH" | awk '{print $5}')
APK_SHA256=$(sha256sum "$APK_PATH" | awk '{print $1}')

echo ""
echo "============================================================"
echo " RELEASE BUILD SUMMARY"
echo "============================================================"
echo "APK Path:     $APK_PATH"
echo "VersionCode:  $VERSION_CODE"
echo "VersionName:  $VERSION_NAME"
echo "APK Size:     $APK_SIZE"
echo "SHA-256:      $APK_SHA256"
echo "============================================================"
echo ""
echo "Android SDK Verification Commands:"

AAPT2_PATH="/var/home/student/Android/Sdk/build-tools/34.0.0/aapt2"
[ -f "$AAPT2_PATH" ] || AAPT2_PATH="$(find /var/home/student/Android/Sdk -name aapt2 2>/dev/null | head -n 1 || which aapt2 2>/dev/null || echo aapt2)"

APKANALYZER_PATH="/var/home/student/Android/Sdk/cmdline-tools/latest/bin/apkanalyzer"
[ -f "$APKANALYZER_PATH" ] || APKANALYZER_PATH="$(find /var/home/student/Android/Sdk -name apkanalyzer 2>/dev/null | head -n 1 || which apkanalyzer 2>/dev/null || echo apkanalyzer)"

APKSIGNER_PATH="/var/home/student/Android/Sdk/build-tools/34.0.0/apksigner"
[ -f "$APKSIGNER_PATH" ] || APKSIGNER_PATH="$(find /var/home/student/Android/Sdk -name apksigner 2>/dev/null | head -n 1 || which apksigner 2>/dev/null || echo apksigner)"

echo "  Verify signature:"
echo "    $APKSIGNER_PATH verify --verbose $APK_PATH"
echo "  Verify permissions (expect READ_SMS only):"
echo "    $APKANALYZER_PATH manifest permissions $APK_PATH"
echo "  Verify not debuggable (expect empty or false):"
echo "    $AAPT2_PATH dump badging $APK_PATH | grep -i debuggable || true"
echo ""

if [ "$VERIFY" = true ]; then
  echo "=== Running APK Verifications ==="
  echo "--> Checking Signature:"
  "$APKSIGNER_PATH" verify --verbose "$APK_PATH"
  echo "--> Checking Permissions:"
  "$APKANALYZER_PATH" manifest permissions "$APK_PATH"
  echo "--> Checking Debuggable:"
  "$AAPT2_PATH" dump badging "$APK_PATH" | grep -i debuggable || echo "Not debuggable (flag absent or false, as expected)."
  echo "=== Verification Complete ==="
fi

