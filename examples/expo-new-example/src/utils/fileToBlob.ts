import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { FileData } from './filePickers';

/**
 * Convert a React Native file to a format Uppy can handle
 */
export const fileToUploadData = async (fileData: FileData): Promise<Blob | string> => {
  if (Platform.OS === 'web') {
    // On web, try to create a proper Blob
    try {
      if (fileData.uri.startsWith('blob:') || fileData.uri.startsWith('data:')) {
        const response = await fetch(fileData.uri);
        return await response.blob();
      }
      // Fallback to URI for web
      return fileData.uri;
    } catch (error) {
      console.warn('Failed to create blob from URI:', error);
      return fileData.uri;
    }
  } else {
    // On React Native, read the file as base64 and create a blob-like object
    try {
      const base64Data = await FileSystem.readAsStringAsync(fileData.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      // Create a data URL
      const dataUrl = `data:${fileData.mimeType || 'application/octet-stream'};base64,${base64Data}`;
      
      // Convert to blob if possible (for upload)
      if (typeof Blob !== 'undefined') {
        const response = await fetch(dataUrl);
        return await response.blob();
      }
      
      return dataUrl;
    } catch (error) {
      console.error('Failed to read file:', error);
      // Fallback to URI
      return fileData.uri;
    }
  }
};
