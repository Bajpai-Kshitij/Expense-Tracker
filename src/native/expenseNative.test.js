import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  ExpenseNative,
  setExpenseNativePlugin,
  pickFolder,
  checkFolder,
  listFiles,
  readFile,
  appendLine,
  writeFile,
  readSms,
} from './expenseNative.js';

describe('src/native/expenseNative', () => {
  let mockPlugin;

  beforeEach(() => {
    mockPlugin = {
      pickFolder: vi.fn(),
      checkFolder: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(),
      appendLine: vi.fn(),
      writeFile: vi.fn(),
      readSms: vi.fn(),
    };
    setExpenseNativePlugin(mockPlugin);
  });
  describe('Browser fallback', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    });

    it('every function throws a clear error when run in plain browser', async () => {
      const expectedError = 'ExpenseNative is only available on Android';

      await expect(pickFolder()).rejects.toThrow(expectedError);
      await expect(checkFolder({ uri: 'content://tree' })).rejects.toThrow(expectedError);
      await expect(listFiles({ uri: 'content://tree' })).rejects.toThrow(expectedError);
      await expect(readFile({ uri: 'content://tree', name: 'test.txt' })).rejects.toThrow(expectedError);
      await expect(appendLine({ uri: 'content://tree', name: 'test.txt', line: 'hi\n' })).rejects.toThrow(expectedError);
      await expect(writeFile({ uri: 'content://tree', name: 'test.txt', text: 'hi' })).rejects.toThrow(expectedError);
      await expect(readSms()).rejects.toThrow(expectedError);
    });
  });

  describe('Argument validation (on Android)', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    });

    it('checkFolder validates uri argument', async () => {
      await expect(checkFolder()).rejects.toThrow(TypeError);
      await expect(checkFolder({})).rejects.toThrow('Invalid uri');
      await expect(checkFolder({ uri: '' })).rejects.toThrow('Invalid uri');
      await expect(checkFolder({ uri: 123 })).rejects.toThrow(TypeError);
    });

    it('listFiles validates uri and prefix arguments', async () => {
      await expect(listFiles()).rejects.toThrow(TypeError);
      await expect(listFiles({ uri: '' })).rejects.toThrow('Invalid uri');
      await expect(listFiles({ uri: 'content://tree', prefix: 123 })).rejects.toThrow(TypeError);
    });

    it('readFile rejects invalid uri and invalid filenames (containing /, \\, ..)', async () => {
      await expect(readFile()).rejects.toThrow(TypeError);
      await expect(readFile({ uri: 'content://tree', name: '' })).rejects.toThrow('Invalid file name');
      await expect(readFile({ uri: 'content://tree', name: 'sub/file.txt' })).rejects.toThrow('Invalid file name');
      await expect(readFile({ uri: 'content://tree', name: 'sub\\file.txt' })).rejects.toThrow('Invalid file name');
      await expect(readFile({ uri: 'content://tree', name: '../escape.txt' })).rejects.toThrow('Invalid file name');
    });

    it('appendLine validates uri, filename, and string line', async () => {
      await expect(appendLine({ uri: 'content://tree', name: 'test.txt' })).rejects.toThrow('Line must be a string');
      await expect(appendLine({ uri: 'content://tree', name: 'bad/name.txt', line: 'test\n' })).rejects.toThrow('Invalid file name');
      await expect(appendLine({ uri: '', name: 'test.txt', line: 'test\n' })).rejects.toThrow('Invalid uri');
    });

    it('writeFile validates uri, filename, and string text', async () => {
      await expect(writeFile({ uri: 'content://tree', name: 'test.txt' })).rejects.toThrow('Text must be a string');
      await expect(writeFile({ uri: 'content://tree', name: '../bad.txt', text: 'test' })).rejects.toThrow('Invalid file name');
      await expect(writeFile({ uri: '', name: 'test.txt', text: 'test' })).rejects.toThrow('Invalid uri');
    });

    it('readSms validates numeric limit and sinceEpochMs', async () => {
      await expect(readSms({ limit: 'invalid' })).rejects.toThrow(TypeError);
      await expect(readSms({ sinceEpochMs: 'invalid' })).rejects.toThrow(TypeError);
      await expect(readSms({ limit: -5 })).rejects.toThrow('positive number');
    });
  });

  describe('Plugin method invocation & error pass-through', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    });

    it('pickFolder resolves successfully', async () => {
      const mockResult = { uri: 'content://com.android.externalstorage/tree/primary%3ADocuments%2FExpenseSync', name: 'ExpenseSync' };
      mockPlugin.pickFolder.mockResolvedValue(mockResult);

      const res = await pickFolder();
      expect(res).toEqual(mockResult);
    });

    it('pickFolder error pass-through (e.g. user cancelled)', async () => {
      const cancelError = new Error('User cancelled folder picker');
      cancelError.code = 'CANCELLED';
      mockPlugin.pickFolder.mockRejectedValue(cancelError);

      await expect(pickFolder()).rejects.toMatchObject({ code: 'CANCELLED' });
    });

    it('checkFolder resolves permission status', async () => {
      mockPlugin.checkFolder.mockResolvedValue({ ok: true, canRead: true, canWrite: true });

      const res = await checkFolder({ uri: 'content://tree' });
      expect(res).toEqual({ ok: true, canRead: true, canWrite: true });
      expect(mockPlugin.checkFolder).toHaveBeenCalledWith({ uri: 'content://tree' });
    });

    it('listFiles unwraps files array', async () => {
      const mockFiles = [
        { name: 'events-dev-1.jsonl', size: 1024, lastModified: 1730370000000 },
      ];
      mockPlugin.listFiles.mockResolvedValue({ files: mockFiles });

      const res = await listFiles({ uri: 'content://tree', prefix: 'events-' });
      expect(res).toEqual(mockFiles);
      expect(mockPlugin.listFiles).toHaveBeenCalledWith({ uri: 'content://tree', prefix: 'events-' });
    });

    it('readFile resolves text or passes through NOT_FOUND error', async () => {
      mockPlugin.readFile.mockResolvedValue({ text: '{"v":1}\n' });
      const res = await readFile({ uri: 'content://tree', name: 'events.jsonl' });
      expect(res).toEqual({ text: '{"v":1}\n' });

      const notFoundError = new Error('File not found: missing.jsonl');
      notFoundError.code = 'NOT_FOUND';
      mockPlugin.readFile.mockRejectedValue(notFoundError);
      await expect(readFile({ uri: 'content://tree', name: 'missing.jsonl' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('appendLine returns mode and bytes', async () => {
      mockPlugin.appendLine.mockResolvedValue({ mode: 'append', bytes: 24 });
      const res = await appendLine({ uri: 'content://tree', name: 'events.jsonl', line: 'hello\n' });
      expect(res).toEqual({ mode: 'append', bytes: 24 });
    });

    it('writeFile returns byte count', async () => {
      mockPlugin.writeFile.mockResolvedValue({ bytes: 48 });
      const res = await writeFile({ uri: 'content://tree', name: 'test.txt', text: 'sample content' });
      expect(res).toEqual({ bytes: 48 });
    });

    it('readSms resolves message array or passes through PERMISSION_DENIED', async () => {
      const mockSms = [
        { id: '1', address: 'HDFCBK', body: 'Rs 500 debited', date: 1730370000000 },
      ];
      mockPlugin.readSms.mockResolvedValue({ sms: mockSms });

      const res = await readSms({ sinceEpochMs: 1000, limit: 10 });
      expect(res).toEqual(mockSms);

      const deniedError = new Error('SMS permission was denied');
      deniedError.code = 'PERMISSION_DENIED';
      mockPlugin.readSms.mockRejectedValue(deniedError);
      await expect(readSms()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
