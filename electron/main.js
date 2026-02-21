const path = require('path');
const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const { createFaceTimeServer } = require('../server');

let mainWindow;
let facetimeServer;

function configureCommandLine() {
  // Better Linux WebRTC + screen-sharing behavior on modern compositors.
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

function configurePermissions() {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, _details) => {
    return [
      'media',
      'camera',
      'microphone',
      'display-capture',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write'
    ].includes(permission);
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = [
      'media',
      'camera',
      'microphone',
      'display-capture',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write'
    ].includes(permission);
    callback(allowed);
  });

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 }
      });
      callback({ video: sources[0], audio: 'none' });
    } catch (_error) {
      callback({ video: null, audio: 'none' });
    }
  });
}

function configureIpc() {
  ipcMain.handle('desktop:toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, isFullscreen: false };
    }
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return { ok: true, isFullscreen: next };
  });

  ipcMain.handle('desktop:get-screen-source', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 0, height: 0 }
      });
      if (!sources.length) {
        return { ok: false, sourceId: null };
      }
      return { ok: true, sourceId: sources[0].id };
    } catch (_error) {
      return { ok: false, sourceId: null };
    }
  });
}

async function startEmbeddedServer() {
  facetimeServer = createFaceTimeServer({
    port: Number(process.env.PORT || 3000),
    host: '127.0.0.1',
    ssl: false
  });

  try {
    return await facetimeServer.start();
  } catch (_error) {
    facetimeServer = createFaceTimeServer({ port: 0, host: '127.0.0.1', ssl: false });
    return facetimeServer.start();
  }
}

function createMainWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'FaceTime Clone',
    backgroundColor: '#f6f8f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(appUrl);
}

async function boot() {
  configureCommandLine();
  await app.whenReady();
  configurePermissions();
  configureIpc();

  const serverInfo = await startEmbeddedServer();
  createMainWindow(serverInfo.url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(serverInfo.url);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (!facetimeServer) {
    return;
  }

  event.preventDefault();
  const serverRef = facetimeServer;
  facetimeServer = null;
  try {
    await serverRef.stop();
  } catch (error) {
    console.error('Failed to stop embedded server cleanly:', error);
  }
  app.exit(0);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  boot().catch((error) => {
    console.error('Electron boot failed:', error);
    app.exit(1);
  });
}
