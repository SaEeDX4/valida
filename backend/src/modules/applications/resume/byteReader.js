/**
 * Bounded random-access readers used by the format inspectors (B4).
 *
 * The inspectors never load a whole upload: they ask for specific windows
 * (a header, a tail, a ZIP directory, one small part). Both readers refuse a
 * window outside the file, so a corrupt offset inside a document cannot make
 * the server read or allocate more than the file itself.
 */
export class ReadOutOfRangeError extends Error {
  constructor() {
    super('read outside the file');
    this.name = 'ReadOutOfRangeError';
  }
}

function assertWindow(size, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
    throw new ReadOutOfRangeError();
  }
}

/** Reader over an open fs.promises FileHandle of a known size. */
export function fileHandleReader(handle, size) {
  return {
    size,
    async read(offset, length) {
      assertWindow(size, offset, length);
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
        if (bytesRead === 0) throw new ReadOutOfRangeError();
        filled += bytesRead;
      }
      return buffer;
    },
  };
}

/** Reader over an in-memory Buffer (unit tests). */
export function bufferReader(buffer) {
  return {
    size: buffer.length,
    async read(offset, length) {
      assertWindow(buffer.length, offset, length);
      return Buffer.from(buffer.subarray(offset, offset + length));
    },
  };
}
