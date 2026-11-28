const electron = require('electron');
if (!electron || typeof electron !== 'object' || !electron.app) {
  console.error('[A2Z Desktop] Electron main process APIs unavailable. Ensure the app is launched via Electron, not Node CLI.');
  process.exit(1);
}
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = electron;
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const LIVE_PRODUCTION_URL = 'https://billing.atriowings.in/';

let mainWindow = null;

// Persistent log helper
function logToFile(message) {
  try {
    if (!app || typeof app.getPath !== 'function') return;
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'desktop-app.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (err) {
    console.error('[A2Z Desktop] Log error:', err);
  }
}

// Global crash and rejection protection so app never silently disappears
process.on('uncaughtException', (error) => {
  console.error('[A2Z Desktop] Uncaught exception:', error);
  logToFile(`FATAL UNCAUGHT EXCEPTION: ${error ? (error.stack || error.message || error) : 'Unknown error'}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[A2Z Desktop] Unhandled rejection:', reason);
  logToFile(`UNHANDLED REJECTION: ${reason ? (reason.stack || reason.message || reason) : 'Unknown rejection'}`);
});

// Ignore certificate errors for the production domain and local counter endpoints
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === 'billing.atriowings.in' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.startsWith('192.168.') ||
      parsed.hostname.startsWith('10.')
    ) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {}
  callback(false);
});

// Config file path in user data directory
function getConfigPath() {
  return path.join(app.getPath('userData'), 'server-config.json');
}

function getSavedServerUrl() {
  try {
    const cfgPath = getConfigPath();
    if (fs.existsSync(cfgPath)) {
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (data && data.serverUrl) return data.serverUrl;
    }
  } catch (err) {
    console.error('[A2Z Desktop] Error reading server config:', err);
    logToFile(`Error reading server config: ${err.message}`);
  }
  // In packaged desktop application, connect directly to the live production site
  if (app.isPackaged) {
    return process.env.APP_URL || LIVE_PRODUCTION_URL;
  }
  return process.env.APP_URL || (process.env.ELECTRON_DEV === 'true' ? `http://localhost:${process.env.PORT || 3001}` : LIVE_PRODUCTION_URL);
}

function saveServerUrl(url) {
  try {
    const cfgPath = getConfigPath();
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({ serverUrl: url.trim(), updatedAt: new Date().toISOString() }, null, 2));
    logToFile(`Saved server URL: ${url.trim()}`);
    return true;
  } catch (err) {
    console.error('[A2Z Desktop] Error saving server config:', err);
    logToFile(`Error saving server config: ${err.message}`);
    return false;
  }
}

// Determine icon path
function getIconPath() {
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  if (fs.existsSync(icoPath)) return icoPath;
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(pngPath)) return pngPath;
  const defaultPng = path.join(__dirname, '..', 'client', 'public', 'icon.png');
  if (fs.existsSync(defaultPng)) return defaultPng;
  return undefined;
}

function pollServer(url, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      try {
        http.get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else {
            retry();
          }
        }).on('error', () => {
          retry();
        });
      } catch {
        retry();
      }
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function getFallbackHtml(currentUrl, errorMsg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>A2Z - Server Connection</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #ffffff; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
    .label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 8px; }
    .input {
      width: 100%;
      padding: 12px 14px;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 8px;
      color: #ffffff;
      font-size: 14px;
      margin-bottom: 20px;
      outline: none;
    }
    .input:focus { border-color: #0f766e; }
    .actions { display: flex; gap: 12px; }
    .btn-primary {
      flex: 1;
      padding: 12px;
      background: #0f766e;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-primary:hover { background: #115e59; }
    .btn-secondary {
      padding: 12px 18px;
      background: #334155;
      color: #cbd5e1;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-secondary:hover { background: #475569; }
    .tip { margin-top: 20px; font-size: 12px; color: #64748b; line-height: 1.4; border-top: 1px solid #334155; padding-top: 16px; }
    .err-detail { font-size: 12px; color: #f87171; background: #291415; padding: 8px 12px; border-radius: 6px; margin-bottom: 16px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Connection Offline</div>
    <h1>Connecting to A2Z Server</h1>
    <p>Could not reach the server at <strong>${currentUrl || 'https://billing.atriowings.in/'}</strong>.</p>
    ${errorMsg ? `<div class="err-detail">Details: ${errorMsg}</div>` : ''}
    
    <label class="label">Server Address (URL):</label>
    <input id="serverUrl" class="input" type="text" value="${currentUrl || 'https://billing.atriowings.in/'}" placeholder="https://billing.atriowings.in/" />
    
    <div class="actions">
      <button class="btn-primary" onclick="reconnect()">Save & Connect</button>
      <button class="btn-secondary" onclick="window.location.reload()">Retry</button>
    </div>

    <div class="tip">
      💡 Tip: Check your internet connection. For counter PCs, enter the store manager's IP address (e.g., <code>http://192.168.1.100:3001</code>).
    </div>
  </div>

  <script>
    async function reconnect() {
      const url = document.getElementById('serverUrl').value.trim();
      if (!url) return alert('Please enter a server URL');
      if (window.electronAPI && window.electronAPI.saveServerUrl) {
        await window.electronAPI.saveServerUrl(url);
      }
      window.location.href = url;
    }
  </script>
</body>
</html>`;
}

async function createWindow() {
  const icon = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'A2Z',
    icon: icon,
    show: false, // Show once ready-to-show to prevent blank screen flicker
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Show window smoothly when content is ready, with safety timeout fallback
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1500);

  const isDev = process.env.ELECTRON_DEV === 'true' || !app.isPackaged;
  const targetUrl = getSavedServerUrl();

  logToFile(`Target URL: ${targetUrl}, isDev: ${isDev}, isPackaged: ${app.isPackaged}`);

  // Handle connection errors gracefully
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // Error code -3 is aborted (e.g. redirected or user cancelled), do not show error page for it
    if (errorCode === -3) return;
    console.warn(`[A2Z Desktop] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    logToFile(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    if (mainWindow) {
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getFallbackHtml(validatedURL || targetUrl, errorDescription))}`).catch(() => {});
    }
  });

  if (isDev) {
    console.log(`[A2Z Desktop] Checking connection to dev server at ${targetUrl}...`);
    const ready = await pollServer(targetUrl, 25000);
    if (mainWindow) {
      console.log(`[A2Z Desktop] Loading ${targetUrl}`);
      mainWindow.loadURL(targetUrl).catch((err) => {
        logToFile(`Error loading dev URL: ${err.message}`);
        if (mainWindow) {
          mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getFallbackHtml(targetUrl, err.message))}`).catch(() => {});
        }
      });
    }
  } else {
    console.log(`[A2Z Desktop] Loading target URL: ${targetUrl}`);
    mainWindow.loadURL(targetUrl).catch((err) => {
      logToFile(`Error loading target URL: ${err.message}`);
      if (mainWindow) {
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getFallbackHtml(targetUrl, err.message))}`).catch(() => {});
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logToFile('Another instance is already running. Quitting duplicate process.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logToFile('Second instance launch intercepted. Bringing window to focus.');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    logToFile('App ready. Creating main window...');
    createWindow().catch((err) => {
      logToFile(`Fatal createWindow error: ${err.stack || err.message || err}`);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err) => {
    logToFile(`Fatal whenReady error: ${err.stack || err.message || err}`);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-server-url', () => getSavedServerUrl());

ipcMain.handle('save-server-url', (event, url) => saveServerUrl(url));

ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  return mainWindow.webContents.getPrintersAsync();
});

ipcMain.handle('print-receipt', async (event, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  return new Promise((resolve) => {
    mainWindow.webContents.print(
      {
        silent: options.silent !== false,
        printBackground: true,
        deviceName: options.deviceName || '',
        margins: { marginType: 'none' },
      },
      (success, failureReason) => {
        if (!success) {
          resolve({ success: false, error: failureReason });
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

ipcMain.handle('share-bill-whatsapp', async (event, { base64Data, filename, phone, message } = {}) => {
  try {
    const tempDir = app.getPath('temp');
    const safeFilename = (filename || 'Bill.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tempDir, safeFilename);

    if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
    }

    const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    const encodedText = encodeURIComponent(message || '');
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;

    await shell.openExternal(waUrl);

    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
      }
    } catch (err) {
      logToFile(`showItemInFolder error: ${err.message}`);
    }

    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {}
    }, 5 * 60 * 1000);

    return { success: true, filePath };
  } catch (err) {
    logToFile(`share-bill-whatsapp error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});
