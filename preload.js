/**
 * Electron Preload Script — exposes a safe IPC bridge to the renderer.
 *
 * This file runs in a privileged context with access to Node.js APIs.
 * Only the functions listed in contextBridge.exposeInMainWorld are
 * accessible from the renderer (via window.electronAPI).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** True when running inside Electron desktop shell. */
  isElectron: true,

  /**
   * Save a file to the user's filesystem via native OS dialog.
   *
   * @param {ArrayBuffer} arrayBuffer  — raw file bytes
   * @param {string}      filename     — suggested filename (e.g. "report.pdf")
   * @param {string}      mimeType     — MIME type for the OS filter (e.g. "application/pdf")
   * @returns {Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>}
   */
  saveFile: (arrayBuffer, filename, mimeType) => {
    // Convert ArrayBuffer → base64 for safe IPC serialization
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return ipcRenderer.invoke('save-file', { base64, filename, mimeType });
  },
});
