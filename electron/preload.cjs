const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  saveServerUrl: (url) => ipcRenderer.invoke('save-server-url', url),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printReceipt: (options) => ipcRenderer.invoke('print-receipt', options),
  shareBillWhatsApp: (options) => ipcRenderer.invoke('share-bill-whatsapp', options),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
});
