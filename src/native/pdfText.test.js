import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractPdfText, setPdfjsLib } from './pdfText.js';

describe('src/native/pdfText.js - extractPdfText wrapper', () => {
  let mockPdfjs;

  beforeEach(() => {
    mockPdfjs = {
      getDocument: vi.fn(),
      GlobalWorkerOptions: { workerSrc: '' },
    };
    setPdfjsLib(mockPdfjs);
  });

  afterEach(() => {
    setPdfjsLib(null);
  });

  it('rejects with TOO_LARGE if arrayBuffer exceeds 15 MB', async () => {
    const largeBuffer = { byteLength: 16 * 1024 * 1024 };
    const result = await extractPdfText(largeBuffer);
    expect(result).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('rejects with NOT_A_PDF if buffer is empty or null', async () => {
    expect(await extractPdfText(null)).toEqual({ ok: false, code: 'NOT_A_PDF' });
    expect(await extractPdfText(new Uint8Array(0))).toEqual({ ok: false, code: 'NOT_A_PDF' });
  });

  it('maps PasswordException (code 1 / need password) to NEEDS_PASSWORD', async () => {
    const err = new Error('Password needed');
    err.name = 'PasswordException';
    err.code = 1;

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(err),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ ok: false, code: 'NEEDS_PASSWORD' });
  });

  it('maps PasswordException (code 2 / incorrect password) to WRONG_PASSWORD', async () => {
    const err = new Error('Incorrect password');
    err.name = 'PasswordException';
    err.code = 2;

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(err),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]), { password: 'mySecretPassword123' });
    expect(result).toEqual({ ok: false, code: 'WRONG_PASSWORD' });
  });

  it('maps InvalidPDFException to NOT_A_PDF', async () => {
    const err = new Error('Invalid PDF structure');
    err.name = 'InvalidPDFException';

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(err),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ ok: false, code: 'NOT_A_PDF' });
  });

  it('maps NO_TEXT when extracted characters count is under 20 (scanned image)', async () => {
    const mockDestroy = vi.fn().mockResolvedValue();
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: '   ', transform: [1, 0, 0, 1, 10, 20], width: 10, height: 10 }],
      }),
    };
    const mockDoc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(mockPage),
      destroy: mockDestroy,
    };

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(mockDoc),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_TEXT');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('reads at most 40 pages and destroys document afterwards', async () => {
    const mockDestroy = vi.fn().mockResolvedValue();
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: 'Statement Line on page with lots of text', transform: [1, 0, 0, 1, 10, 500], width: 100, height: 10 },
        ],
      }),
    };
    const mockDoc = {
      numPages: 65, // more than 40 pages!
      getPage: vi.fn().mockResolvedValue(mockPage),
      destroy: mockDestroy,
    };

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(mockDoc),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(true);
    expect(mockDoc.getPage).toHaveBeenCalledTimes(40); // capped at 40
    expect(result.pageCount).toBe(65);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('ensures password never appears in any returned error or log', async () => {
    const secretPassword = 'VERY_SECRET_PASSPHRASE_XYZ_999';
    const err = new Error('Incorrect password');
    err.name = 'PasswordException';
    err.code = 2;

    mockPdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(err),
    });

    const result = await extractPdfText(new Uint8Array([1, 2, 3]), { password: secretPassword });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretPassword);
  });
});

