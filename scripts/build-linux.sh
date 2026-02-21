#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Building Linux artifacts (AppImage, deb, rpm, pacman, tar.gz)..."
npm run dist:linux

echo "Build complete. Artifacts are in: $ROOT_DIR/dist"
