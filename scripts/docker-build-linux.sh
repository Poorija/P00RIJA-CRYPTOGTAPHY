#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$ROOT/artifacts/linux"

mkdir -p "$ARTIFACTS_DIR/deb" "$ARTIFACTS_DIR/rpm" "$ARTIFACTS_DIR/appimage" "$ARTIFACTS_DIR/arch"
rm -f "$ARTIFACTS_DIR"/deb/*.deb "$ARTIFACTS_DIR"/rpm/*.rpm "$ARTIFACTS_DIR"/appimage/*.AppImage "$ARTIFACTS_DIR"/arch/*.pkg.tar.zst 2>/dev/null || true

docker run --rm \
  --platform linux/amd64 \
  -v "$ROOT":/workspace \
  -w /workspace \
  -e CARGO_HOME=/tmp/cargo \
  -e RUSTUP_HOME=/tmp/rustup \
  -e CARGO_TARGET_DIR=/workspace/src-tauri/target/linux-x64 \
  node:22-bookworm \
  bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive

    apt-get update
    apt-get install -y \
      curl \
      build-essential \
      pkg-config \
      file \
      zstd \
      rpm \
      libgtk-3-dev \
      libwebkit2gtk-4.1-dev \
      libsoup-3.0-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      patchelf \
      xz-utils

    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    . /tmp/cargo/env
    rustup target add x86_64-unknown-linux-gnu

    rm -rf /workspace/src-tauri/target/linux-x64/x86_64-unknown-linux-gnu/release/bundle
    npm ci
    npm run tauri -- build --target x86_64-unknown-linux-gnu --config "{\"bundle\":{\"targets\":[\"deb\",\"rpm\",\"appimage\"]}}" --ci --no-sign

    find /workspace/src-tauri/target/linux-x64 -type f -name "*.deb" -exec cp {} /workspace/artifacts/linux/deb/ \;
    find /workspace/src-tauri/target/linux-x64 -type f -name "*.rpm" -exec cp {} /workspace/artifacts/linux/rpm/ \;
    find /workspace/src-tauri/target/linux-x64 -type f -name "*.AppImage" -exec cp {} /workspace/artifacts/linux/appimage/ \;
  '

docker run --rm \
  --platform linux/amd64 \
  -v "$ROOT":/workspace \
  -w /workspace \
  archlinux:base-devel \
  bash -lc '
    set -euo pipefail

    ARCH_ROOT=/tmp/p00rija-arch
    PKGDIR="$ARCH_ROOT/package-root"
    rm -rf "$ARCH_ROOT"
    mkdir -p "$PKGDIR/usr/bin" "$PKGDIR/usr/share/applications" "$PKGDIR/usr/share/icons/hicolor/128x128/apps"

    install -Dm755 /workspace/src-tauri/target/linux-x64/x86_64-unknown-linux-gnu/release/poorija_cryptography_desktop "$PKGDIR/usr/bin/p00rija-cryptography"
    install -Dm644 /workspace/src-tauri/icons/128x128.png "$PKGDIR/usr/share/icons/hicolor/128x128/apps/p00rija-cryptography.png"

    cat > "$PKGDIR/usr/share/applications/p00rija-cryptography.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=P00RIJA Cryptography
Exec=/usr/bin/p00rija-cryptography
Icon=p00rija-cryptography
Categories=Utility;Security;
Terminal=false
EOF

    cat > "$ARCH_ROOT/PKGBUILD" <<EOF
pkgname=p00rija-cryptography
pkgver=2.80.0
pkgrel=1
pkgdesc="Client-side cryptography dashboard with secure sharing, signatures, and offline-first delivery"
arch=("x86_64")
url="https://github.com/Poorija/P00RIJA-Cryptography"
license=("GPL-3.0")
depends=("gtk3" "webkit2gtk-4.1")
options=("!debug")
source=()
sha256sums=()

package() {
  cp -a /tmp/p00rija-arch/package-root/. "\$pkgdir"/
}
EOF

    useradd -m builduser
    chown -R builduser:builduser "$ARCH_ROOT"
    su - builduser -c "cd $ARCH_ROOT && makepkg --nodeps --force --skipinteg --noconfirm"
    cp "$ARCH_ROOT"/p00rija-cryptography-*.pkg.tar.zst /workspace/artifacts/linux/arch/

    pacman -Qip "$ARCH_ROOT"/p00rija-cryptography-*.pkg.tar.zst
  '
