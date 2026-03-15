const { app, BrowserWindow } = require('electron');
const serve = require('electron-serve');
const path = require('path');

// Указываем electron-serve раздавать файлы из папки out/ (результат сборки Next.js)
const appServe = serve({ directory: path.join(__dirname, 'out') });

let mainWindow;

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Tax-Modeler 2026",
    autoHideMenuBar: true,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
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
