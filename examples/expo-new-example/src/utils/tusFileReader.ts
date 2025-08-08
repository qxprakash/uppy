import base64 from 'base64-js';
import * as FileSystem from 'expo-file-system';

export interface TusFileReader {
  openFile(input: any, chunkSize: number): Promise<FileReaderInstance>;
}

export interface FileReaderInstance {
  slice(start: number, end: number): Promise<Uint8Array>;
  size: number;
  close?(): void;
}

class FileReaderImpl implements FileReaderInstance {
  private file: { uri: string };
  public size: number;

  constructor(file: { uri: string }, size: number) {
    this.file = file;
    this.size = size;
  }

  async slice(start: number, end: number): Promise<Uint8Array> {
    const options = {
      encoding: FileSystem.EncodingType.Base64,
      length: Math.min(end, this.size) - start,
      position: start,
    };

    try {
      const data = await FileSystem.readAsStringAsync(this.file.uri, options);
      return base64.toByteArray(data);
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  close() {
    // No cleanup needed for this implementation
  }
}

class TusFileReaderImpl implements TusFileReader {
  async openFile(input: any, chunkSize: number): Promise<FileReaderInstance> {
    // input should be our file data object with uri
    if (!input || !input.uri) {
      throw new Error('Invalid file input: missing uri');
    }

    try {
      const info = await FileSystem.getInfoAsync(input.uri, { size: true });
      if (!info.exists) {
        throw new Error('File does not exist');
      }
      return new FileReaderImpl(input, info.size || 0);
    } catch (error) {
      throw new Error(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export a singleton instance
const tusFileReader = new TusFileReaderImpl();
export default tusFileReader;
