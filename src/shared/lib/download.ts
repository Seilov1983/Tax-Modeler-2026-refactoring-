/**
 * Cross-platform file download utility.
 *
 * Two runtime paths:
 *   1. Electron Desktop — window.electronAPI.saveFile (native dialog via IPC)
 *   2. Browser          — <a download> attached to document.body
 *
 * All export functions (PDF, PNG, JSON, Markdown) should use saveFile()
 * instead of creating their own <a> elements.
 */

// ─── Electron bridge typing ──────────────────────────────────────────────────

interface ElectronSaveResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

interface ElectronAPI {
  isElectron: boolean;
  saveFile: (buf: ArrayBuffer, filename: string, mimeType: string) => Promise<ElectronSaveResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// ─── Detection ───────────────────────────────────────────────────────────────

function getElectronAPI(): ElectronAPI | null {
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    return window.electronAPI;
  }
  return null;
}

export function isElectron(): boolean {
  return getElectronAPI() !== null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Save a Blob to the user's filesystem.
 *
 * In Electron: opens native OS "Save As" dialog, writes via Node fs.
 * In browser:  creates a temporary `<a download>` element.
 *
 * @throws Error if the save fails (not if the user cancels).
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const api = getElectronAPI();

  if (api) {
    const arrayBuffer = await blob.arrayBuffer();
    const result = await api.saveFile(arrayBuffer, filename, blob.type);
    if (result.canceled) return; // user cancelled — not an error
    if (!result.success) {
      throw new Error(result.error || 'Electron file save failed');
    }
    return;
  }

  // Browser path
  await browserDownload(blob, filename);
}

// ─── Browser download ────────────────────────────────────────────────────────

/**
 * Trigger a file download in the browser using Blob URL + <a download>.
 *
 * The element is attached to document.body, rendered via requestAnimationFrame,
 * clicked, and cleaned up after 500ms. This sequence is required because
 * some environments (including certain Electron webview configs) silently
 * ignore clicks on detached or invisible elements.
 */
function browserDownload(blob: Blob, filename: string): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // Position off-screen but rendered (not display:none — some browsers ignore hidden clicks)
    a.style.position = 'fixed';
    a.style.left = '-9999px';
    a.style.top = '-9999px';
    document.body.appendChild(a);

    // Wait for next paint to ensure the element is in the DOM tree
    requestAnimationFrame(() => {
      a.click();
      // Give browser time to initiate the download before cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      }, 500);
    });
  });
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

/** Convert a data URL (e.g. from canvas.toDataURL) to a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
