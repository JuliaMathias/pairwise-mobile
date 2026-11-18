#!/usr/bin/env bash
set -euo pipefail

android_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(dirname "$android_dir")"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
platform="$sdk/platforms/android-35/android.jar"
build_tools="$sdk/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
output="${1:-$android_dir/build/Pairwise.apk}"

if [[ -z "$sdk" || ! -f "$platform" || ! -x "$build_tools/aapt2" ]]; then
  echo 'Install Android SDK Platform 35 and Build Tools 36.0.0, then set ANDROID_SDK_ROOT.' >&2
  exit 1
fi
: "${PAIRWISE_KEYSTORE:?Set PAIRWISE_KEYSTORE to a private signing keystore}"
: "${PAIRWISE_SIGNING_PASSWORD:?Set PAIRWISE_SIGNING_PASSWORD in the build environment}"
export PAIRWISE_SIGNING_PASSWORD

build_dir="$(mktemp -d)"
trap 'rm -rf -- "$build_dir"' EXIT
mkdir -p "$build_dir/classes" "$build_dir/dex" "$(dirname -- "$output")"
sources=()
while IFS= read -r source; do sources+=("$source"); done < <(find "$android_dir/src" -name '*.java' | sort)

if [[ -n "${PAIRWISE_ECJ_JAR:-}" ]]; then
  java -jar "$PAIRWISE_ECJ_JAR" -8 -encoding UTF-8 -proc:none -classpath "$platform" -d "$build_dir/classes" "${sources[@]}"
else
  javac --release 11 -encoding UTF-8 -classpath "$platform" -d "$build_dir/classes" "${sources[@]}"
fi

(cd "$build_dir/classes" && zip -qr "$build_dir/classes.jar" .)
"$build_tools/d8" --release --min-api 30 --lib "$platform" --output "$build_dir/dex" "$build_dir/classes.jar"
"$build_tools/aapt2" compile --dir "$android_dir/res" -o "$build_dir/resources.zip"
"$build_tools/aapt2" link -I "$platform" --manifest "$android_dir/AndroidManifest.xml" \
  -A "$project_dir/dist" -o "$build_dir/unsigned.apk" "$build_dir/resources.zip"
(cd "$build_dir/dex" && zip -q -0 "$build_dir/unsigned.apk" classes.dex)
"$build_tools/zipalign" -f 4 "$build_dir/unsigned.apk" "$build_dir/aligned.apk"
"$build_tools/apksigner" sign --ks "$PAIRWISE_KEYSTORE" --ks-key-alias "${PAIRWISE_KEY_ALIAS:-pairwise}" \
  --ks-pass env:PAIRWISE_SIGNING_PASSWORD --out "$output" "$build_dir/aligned.apk"
"$build_tools/apksigner" verify "$output"
