# FaceTime Clone Desktop (Linux)

Electron desktop packaging for the existing Node.js + WebRTC FaceTime clone.

## What this build provides

- Desktop app runtime on Linux (no native setup beyond Node/npm for building)
- Embedded Express + Socket.io + PeerJS server inside Electron
- Camera/microphone/screen-share permission wiring for Electron
- Single-instance desktop app behavior
- Linux distribution artifacts via `electron-builder`:
  - `AppImage` (portable, distro-agnostic)
  - `deb` (Ubuntu/Debian)
  - `rpm` (Fedora/RHEL family)
  - `pacman` (Arch Linux)
  - `tar.gz` (generic archive)

## Development run

```bash
npm install
npm start
```

This launches the Electron desktop app.

If you still want the pure web server mode:

```bash
npm run start:web
```

## Build packages for Linux

One command:

```bash
./scripts/build-linux.sh
```

Or directly:

```bash
npm install
npm run dist:linux
```

Output artifacts are generated in `dist/`.

## App Icons and Metadata

- Linux icon set is generated in `build/icons/` by `scripts/generate-icons.js`.
- `npm run dist:linux` regenerates icons automatically before packaging.
- Desktop metadata (name, comment, keywords, categories, maintainer, synopsis) is defined in `package.json` under `build.linux`.

## GitHub Actions Release Automation

The workflow at `.github/workflows/release-linux.yml` automatically:

- triggers on tags like `v1.0.0`
- builds Linux artifacts (`AppImage`, `deb`, `rpm`, `pacman`, `tar.gz`)
- uploads artifacts to workflow run
- attaches artifacts to the GitHub Release for that tag

Create and push a release tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Install examples

```bash
# Debian/Ubuntu
sudo dpkg -i dist/FaceTime\ Clone-*.deb

# Fedora/RHEL
sudo rpm -i dist/FaceTime\ Clone-*.rpm

# Arch
sudo pacman -U dist/FaceTime\ Clone-*.pacman

# Any distro (portable)
chmod +x dist/FaceTime\ Clone-*.AppImage
./dist/FaceTime\ Clone-*.AppImage
```

## Notes

- WebRTC media uses DTLS/SRTP encryption by default.
- Optional app-layer E2EE is available in-call via `E2EE Off/On` button.
  Use the same passphrase on all participants to decrypt media.
- Rooms are private-by-code and kept in-memory.
- Group limit remains 8 participants.
- STUN/TURN configuration is in `public/call.js`.
- On Electron/Linux, screen sharing and fullscreen are routed through Electron permission + IPC handlers for reliability.
- If a user's distro lacks desktop dependencies for Electron runtime, install standard Chromium/Electron runtime libs from the distro repos
