import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface FileData {
  uri: string;
  name: string;
  type: string;
  size?: number;
  mimeType?: string;
}

export interface ImagePickerOptions {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  allowsMultipleSelection?: boolean;
}

export interface CameraOptions {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
}

/**
 * Select images or videos from the device gallery
 */
export const selectImage = async (options: ImagePickerOptions = {}): Promise<FileData[]> => {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: options.allowsEditing || false,
      aspect: options.aspect || [4, 3],
      quality: options.quality || 1,
      allowsMultipleSelection: options.allowsMultipleSelection || false,
      ...options,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      return result.assets.map((asset, index) => ({
        uri: asset.uri,
        type: asset.type || 'image',
        name: `media_${Date.now()}_${index}.${getFileExtension(asset.uri)}`,
        size: asset.fileSize,
        mimeType: asset.type === 'video' ? 'video/mp4' : 'image/jpeg',
      }));
    }
    return [];
  } catch (error) {
    console.error('Error selecting image:', error);
    throw new Error(`Failed to select image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Select documents from the device
 */
export const selectDocument = async (): Promise<FileData[]> => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: false,
      multiple: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      return result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        size: asset.size || undefined,
        type: 'document',
        mimeType: asset.mimeType || 'application/octet-stream',
      }));
    }
    return [];
  } catch (error) {
    console.error('Error selecting document:', error);
    throw new Error(`Failed to select document: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Take a picture with the camera
 */
export const takePicture = async (options: CameraOptions = {}): Promise<FileData | null> => {
  try {
    // Request camera permissions
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Camera permission denied');
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: options.allowsEditing || true,
      aspect: options.aspect || [4, 3],
      quality: options.quality || 0.8,
      ...options,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        type: 'image',
        name: `photo_${Date.now()}.jpg`,
        size: asset.fileSize,
        mimeType: 'image/jpeg',
      };
    }
    return null;
  } catch (error) {
    console.error('Error taking picture:', error);
    throw new Error(`Failed to take picture: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Utility function to get file extension from URI
 */
const getFileExtension = (uri: string): string => {
  const parts = uri.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'jpg';
};

/**
 * Get human-readable file size
 */
export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return 'Unknown size';
  
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Check if file type is supported
 */
export const isSupportedFileType = (mimeType: string): boolean => {
  const supportedTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  
  return supportedTypes.includes(mimeType);
};
