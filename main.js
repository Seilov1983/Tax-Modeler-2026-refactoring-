const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const electronServe = require('electron-serve');
// Подхватываем функцию, даже если она спрятана в .default
const serve = electronServe.default || electronServe;
const path = require('path');
const fs = require('fs');

const appServe = serve({ directory: path.join(__dirname, 'out') });

let mainWindow;

// ─── IPC: Native file save via dialog.showSaveDialog ─────────────────────────

const EXT_MAP = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'application/json': 'json',
  'text/markdown': 'md',
};

ipcMain.handle('save-file', async (_event, { base64, filename, mimeType }) => {
  try {
    const ext = EXT_MAP[mimeType] || path.extname(filename).slice(1) || '*';
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }],
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Tax-Modeler 2026',
    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  appServe(mainWindow).then(() => {
    mainWindow.loadURL('app://-');
  });

  // mainWindow.webContents.openDevTools();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
