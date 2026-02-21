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

## Installation (All Linux Distros)

Pick one method:

1. Install from release artifact (recommended for end users).
2. Build from source (recommended for developers).

### 1) Install from release artifact

Download the latest release package that matches your distro from GitHub Releases.

- Ubuntu/Debian/Linux Mint/Pop!_OS: `*.deb`
- Fedora/RHEL/CentOS/Rocky/Alma: `*.rpm`
- Arch/Manjaro/EndeavourOS: `*.pacman`
- Any distro: `*.AppImage` (portable) or `*.tar.gz`

#### Ubuntu / Debian / Linux Mint / Pop!_OS

```bash
sudo apt update
sudo apt install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2t64 || sudo apt install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2
sudo dpkg -i FaceTime\ Clone-*.deb
sudo apt -f install -y
```

#### Fedora / RHEL / CentOS / Rocky / Alma

```bash
sudo dnf install -y nss atk at-spi2-atk gtk3 libXScrnSaver alsa-lib
sudo rpm -i FaceTime\ Clone-*.rpm
```

#### Arch / Manjaro / EndeavourOS

```bash
sudo pacman -S --needed nss atk at-spi2-atk gtk3 libxss alsa-lib
sudo pacman -U FaceTime\ Clone-*.pacman
```

#### openSUSE (Tumbleweed / Leap)

Use the RPM build:

```bash
sudo zypper install -y mozilla-nss atk at-spi2-atk gtk3 libXScrnSaver alsa
sudo rpm -i FaceTime\ Clone-*.rpm
```

#### Any distro (portable AppImage)

```bash
chmod +x FaceTime\ Clone-*.AppImage
./FaceTime\ Clone-*.AppImage
```

### 2) Build and install from source (any distro)

```bash
npm install
npm run dist:linux
```

Then install from `dist/` with the distro-specific commands above.

### Uninstall

```bash
# Debian/Ubuntu
sudo apt remove facetime-clone

# Fedora/RHEL/openSUSE RPM installs
sudo rpm -e facetime-clone

# Arch
sudo pacman -R facetime-clone
```

### Troubleshooting

- Camera/Microphone not detected:
  - Confirm OS privacy permissions allow camera/mic access for the app.
  - Close other apps locking the webcam/mic and relaunch FaceTime Clone.
  - In browser mode, use HTTPS (or `localhost`) so media APIs are allowed.

- Wayland screen sharing issues (black/empty share):
  - On Linux desktop builds, screen capture relies on PipeWire/portal integration.
  - Install portal components if missing:
    - Ubuntu/Debian: `sudo apt install xdg-desktop-portal xdg-desktop-portal-gtk pipewire`
    - Fedora: `sudo dnf install xdg-desktop-portal xdg-desktop-portal-gtk pipewire`
    - Arch: `sudo pacman -S xdg-desktop-portal xdg-desktop-portal-gtk pipewire`
  - Log out/in after installing portal packages.

- Missing shared libraries at launch:
  - Install base Electron runtime libs for your distro (examples below):
    - Debian/Ubuntu: `sudo apt install libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1`
    - Fedora/RHEL: `sudo dnf install nss atk at-spi2-atk gtk3 libXScrnSaver`
    - Arch: `sudo pacman -S nss atk at-spi2-atk gtk3 libxss`

## Notes

- WebRTC media uses DTLS/SRTP encryption by default.
- Optional app-layer E2EE is available in-call via `E2EE Off/On` button.
  Use the same passphrase on all participants to decrypt media.
- Rooms are private-by-code and kept in-memory.
- Group limit remains 8 participants.
- STUN/TURN configuration is in `public/call.js`.
- On Electron/Linux, screen sharing and fullscreen are routed through Electron permission + IPC handlers for reliability.
- If a user's distro lacks desktop dependencies for Electron runtime, install standard Chromium/Electron runtime libs from the distro repos
