#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$ROOT/artifacts/windows"

mkdir -p "$ARTIFACTS_DIR"
rm -f "$ARTIFACTS_DIR"/*.exe "$ARTIFACTS_DIR"/*.msi 2>/dev/null || true

docker run --rm \
  --platform linux/amd64 \
  -v "$ROOT":/workspace \
  -w /workspace \
  -e CARGO_HOME=/tmp/cargo \
  -e RUSTUP_HOME=/tmp/rustup \
  -e CARGO_TARGET_DIR=/workspace/src-tauri/target/windows-x64 \
  node:22-bookworm \
  bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive

    apt-get update
    apt-get install -y \
      curl \
      mingw-w64 \
      nsis \
      zip \
      unzip \
      perl \
      make

    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    . /tmp/cargo/env
    rustup target add x86_64-pc-windows-gnu

    npm ci
    npm run tauri -- build --target x86_64-pc-windows-gnu --config "{\"bundle\":{\"targets\":[\"nsis\"]}}" --ci --no-sign

    find /workspace/src-tauri/target/windows-x64 -type f -path "*/bundle/nsis/*.exe" -exec cp {} /workspace/artifacts/windows/ \;
    find /workspace/src-tauri/target/windows-x64 -type f -path "*/bundle/msi/*.msi" -exec cp {} /workspace/artifacts/windows/ \;
  '
