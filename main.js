const { app, BrowserWindow } = require('electron');
const electronServe = require('electron-serve');
// Подхватываем функцию, даже если она спрятана в .default
const serve = electronServe.default || electronServe;
const path = require('path');

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
