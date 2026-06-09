function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the browser has picked up the URL (immediate revoke cancels multi-file exports).
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Download JSON file with given filename and content. */
export function downloadJSON(filename: string, data: object): void {
  const json = JSON.stringify(data, null, 2);
  triggerDownload(filename, new Blob([json], { type: 'application/json' }));
}

/** Download a blob as a file (e.g. ink layer PNG). */
export function downloadBlob(filename: string, blob: Blob): void {
  triggerDownload(filename, blob);
}

const MULTI_DOWNLOAD_GAP_MS = 400;

/** Download multiple files in sequence (avoids browser blocking back-to-back saves). */
export async function downloadFiles(
  files: Array<{ filename: string; blob: Blob }>
): Promise<void> {
  for (const { filename, blob } of files) {
    triggerDownload(filename, blob);
    await new Promise((resolve) => window.setTimeout(resolve, MULTI_DOWNLOAD_GAP_MS));
  }
}
