/**
 * PDF Text Extraction native wrapper using pdfjs-dist.
 *
 * This is the ONLY file in the project that imports pdfjs-dist.
 * Extracts text items from PDF ArrayBuffer without storing passwords or file contents.
 */

import * as pdfjsDist from 'pdfjs-dist/legacy/build/pdf.js';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';

let activePdfjs = pdfjsDist.default || pdfjsDist;

if (activePdfjs && activePdfjs.GlobalWorkerOptions && !activePdfjs.GlobalWorkerOptions.workerSrc) {
  activePdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Sets a custom or mock pdfjs instance (useful for unit testing).
 * 
 * @param {object|null} mock
 */
export function setPdfjsLib(mock) {
  if (mock) {
    activePdfjs = mock;
  } else {
    activePdfjs = pdfjsDist.default || pdfjsDist;
  }
}

/**
 * Extracts raw text items from a PDF ArrayBuffer.
 *
 * @param {ArrayBuffer|Uint8Array} arrayBuffer - PDF file bytes
 * @param {object} [options]
 * @param {string} [options.password] - Optional password for encrypted PDF
 * @returns {Promise<{ ok: true, items: Array<object>, pageCount: number } | { ok: false, code: string }>}
 */
export async function extractPdfText(arrayBuffer, options = {}) {
  const { password } = options;

  // 1. Validate input and check 15 MB size limit
  if (!arrayBuffer) {
    return { ok: false, code: 'NOT_A_PDF' };
  }

  const byteLength = arrayBuffer.byteLength ?? arrayBuffer.length ?? 0;
  if (byteLength > 15 * 1024 * 1024) {
    return { ok: false, code: 'TOO_LARGE' };
  }
  if (byteLength === 0) {
    return { ok: false, code: 'NOT_A_PDF' };
  }

  const data = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer;

  let loadingTask = null;
  let pdfDoc = null;

  try {
    const pdfjs = activePdfjs;
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
      return { ok: false, code: 'FAILED' };
    }

    loadingTask = pdfjs.getDocument({
      data,
      password: typeof password === 'string' && password ? password : undefined,
    });

    pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages || 0;
    const pagesToRead = Math.min(numPages, 40);
    const allItems = [];

    for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent?.items || [];

      for (const item of items) {
        if (item && typeof item.str === 'string') {
          const transform = item.transform || [1, 0, 0, 1, 0, 0];
          allItems.push({
            str: item.str,
            x: Number(transform[4]) || 0,
            y: Number(transform[5]) || 0,
            width: Number(item.width) || 0,
            height: Number(item.height) || Math.abs(Number(transform[0])) || Math.abs(Number(transform[3])) || 10,
            page: pageNum,
          });
        }
      }
    }

    // Check if total non-whitespace characters is under 20 (meaning scanned image)
    const totalChars = allItems.reduce((acc, it) => acc + (it.str ? it.str.trim().length : 0), 0);
    if (totalChars < 20) {
      return { ok: false, code: 'NO_TEXT', pageCount: numPages, items: allItems };
    }

    return {
      ok: true,
      items: allItems,
      pageCount: numPages,
    };
  } catch (err) {
    // Map PasswordException and InvalidPDFException
    const errName = err?.name || '';
    const errCode = err?.code;
    const errMsg = (err?.message || '').toLowerCase();

    // Password exceptions
    if (errName === 'PasswordException' || errMsg.includes('password')) {
      if (errCode === 1 || errMsg.includes('need') || !password) {
        return { ok: false, code: 'NEEDS_PASSWORD' };
      }
      if (errCode === 2 || errMsg.includes('incorrect') || errMsg.includes('wrong')) {
        return { ok: false, code: 'WRONG_PASSWORD' };
      }
      return { ok: false, code: password ? 'WRONG_PASSWORD' : 'NEEDS_PASSWORD' };
    }

    // Invalid PDF
    if (
      errName === 'InvalidPDFException' ||
      errName === 'MissingPDFException' ||
      errMsg.includes('invalid pdf') ||
      errMsg.includes('pdf header')
    ) {
      return { ok: false, code: 'NOT_A_PDF' };
    }

    return { ok: false, code: 'FAILED' };
  } finally {
    if (pdfDoc) {
      try {
        await pdfDoc.destroy();
      } catch {}
    }
  }
}

