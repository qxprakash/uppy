import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UrlStorage {
  findAllUploads(): Promise<any[]>;
  findUploadsByFingerprint(fingerprint: string): Promise<any[]>;
  removeUpload(uploadUrl: string): Promise<void>;
  addUpload(fingerprint: string, upload: any): Promise<string>;
}

/**
 * Uppy URL storage adapter for React Native AsyncStorage
 */
export class AsyncStorageUrlStorage implements UrlStorage {
  private readonly namespace = 'uppy_url_storage_';

  async findAllUploads(): Promise<any[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const uppyKeys = keys.filter(key => key.startsWith(this.namespace));
      const items = await AsyncStorage.multiGet(uppyKeys);
      
      return items
        .map(([, value]) => {
          if (value) {
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          }
          return null;
        })
        .filter(Boolean);
    } catch (error) {
      console.error('Error finding all uploads:', error);
      return [];
    }
  }

  async findUploadsByFingerprint(fingerprint: string): Promise<any[]> {
    try {
      const key = `${this.namespace}${fingerprint}`;
      const value = await AsyncStorage.getItem(key);
      
      if (value) {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      }
      return [];
    } catch (error) {
      console.error('Error finding uploads by fingerprint:', error);
      return [];
    }
  }

  async removeUpload(uploadUrl: string): Promise<void> {
    try {
      // Find the key by searching through all uploads
      const keys = await AsyncStorage.getAllKeys();
      const uppyKeys = keys.filter(key => key.startsWith(this.namespace));
      
      for (const key of uppyKeys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          try {
            const upload = JSON.parse(value);
            if (upload.uploadURL === uploadUrl || upload.url === uploadUrl) {
              await AsyncStorage.removeItem(key);
              break;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (error) {
      console.error('Error removing upload:', error);
    }
  }

  async addUpload(fingerprint: string, upload: any): Promise<string> {
    try {
      const key = `${this.namespace}${fingerprint}`;
      await AsyncStorage.setItem(key, JSON.stringify(upload));
      return upload.uploadURL || upload.url || '';
    } catch (error) {
      console.error('Error adding upload:', error);
      return '';
    }
  }
}
