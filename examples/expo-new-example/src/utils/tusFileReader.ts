import { Platform } from 'react-native';
import base64 from 'base64-js';
import * as FileSystem from 'expo-file-system';

export interface TusFileReader {
  openFile(input: any, chunkSize: number): Promise<FileReaderInstance>;
}

export interface SliceResult {
  value: Uint8Array;
  done: boolean;
}

export interface FileReaderInstance {
  slice(start: number, end: number): Promise<SliceResult>;
  size: number;
  close?(): void;
}

// Native implementation using expo-file-system
class NativeFileReaderImpl implements FileReaderInstance {
  private file: { uri: string };
  public size: number;

  constructor(file: { uri: string }, size: number) {
    this.file = file;
    this.size = size;
  }

  async slice(start: number, end: number): Promise<SliceResult> {
    const chunkSize = Math.min(end, this.size) - start;
    
    if (start >= this.size) {
      return {
        value: new Uint8Array(0),
        done: true,
      };
    }

    if (chunkSize <= 0) {
      return {
        value: new Uint8Array(0),
        done: true,
      };
    }

    const options = {
      encoding: FileSystem.EncodingType.Base64,
      length: chunkSize,
      position: start,
    };

    try {
      console.log(`Reading file chunk: start=${start}, end=${end}, size=${chunkSize}`);
      const data = await FileSystem.readAsStringAsync(this.file.uri, options);
      
      if (!data) {
        throw new Error('No data read from file');
      }
      
      const bytes = base64.toByteArray(data);
      console.log(`Successfully read ${bytes.length} bytes`);
      
      return {
        value: bytes,
        done: end >= this.size,
      };
    } catch (error) {
      console.error('Failed to read file chunk:', error);
      console.error('Options:', options);
      console.error('File URI:', this.file.uri);
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  close() {
    // No cleanup needed for this implementation
  }
}

// Web implementation using fetch and ArrayBuffer
class WebFileReaderImpl implements FileReaderInstance {
  private buffer: ArrayBuffer;
  public size: number;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.size = buffer.byteLength;
  }

  async slice(start: number, end: number): Promise<SliceResult> {
    if (start >= this.size) {
      return {
        value: new Uint8Array(0),
        done: true,
      };
    }

    const actualEnd = Math.min(end, this.size);
    const slicedBuffer = this.buffer.slice(start, actualEnd);
    const bytes = new Uint8Array(slicedBuffer);
    
    return {
      value: bytes,
      done: actualEnd >= this.size,
    };
  }

  close() {
    // No cleanup needed for this implementation
  }
}

class TusFileReaderImpl implements TusFileReader {
  async openFile(input: any, chunkSize: number): Promise<FileReaderInstance> {
    // input should be our file data object with uri
    if (!input || !input.uri) {
      console.error('Invalid file input:', input);
      throw new Error('Invalid file input: missing uri');
    }

    console.log('Opening file:', input);
    console.log('Platform:', Platform.OS);

    try {
      if (Platform.OS === 'web') {
        // Web implementation: fetch the file data
        if (input.uri.startsWith('data:')) {
          // Handle data URIs
          const response = await fetch(input.uri);
          const buffer = await response.arrayBuffer();
          console.log('Web - data URI file size:', buffer.byteLength);
          return new WebFileReaderImpl(buffer);
        } else {
          // Handle blob URIs or file URIs on web
          const response = await fetch(input.uri);
          if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.statusText}`);
          }
          const buffer = await response.arrayBuffer();
          console.log('Web - blob/file URI file size:', buffer.byteLength);
          return new WebFileReaderImpl(buffer);
        }
      } else {
        // Native implementation: use expo-file-system
        console.log('Getting file info for:', input.uri);
        const info = await FileSystem.getInfoAsync(input.uri, { size: true });
        console.log('File info:', info);
        
        if (!info.exists) {
          throw new Error('File does not exist');
        }
        
        const fileSize = info.size || 0;
        if (fileSize === 0) {
          throw new Error('File is empty or size could not be determined');
        }
        
        console.log('Native - file size:', fileSize);
        return new NativeFileReaderImpl(input, fileSize);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
      console.error('Input was:', input);
      throw new Error(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export a singleton instance
const tusFileReader = new TusFileReaderImpl();
export default tusFileReader;
