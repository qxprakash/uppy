import { useState, useCallback, useEffect } from 'react';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import XHRUpload from '@uppy/xhr-upload';
import tusFileReader from '../utils/tusFileReader';
import { AsyncStorageUrlStorage } from '../utils/asyncStorageUrlStorage';
import type { FileData } from '../utils/filePickers';

export interface UploadConfig {
  uploadType?: 'tus' | 'xhr';
  endpoint: string;
  autoProceed?: boolean;
  debug?: boolean;
  maxFileSize?: number;
  maxNumberOfFiles?: number;
  allowedFileTypes?: string[];
  chunkSize?: number;
  tusOptions?: Record<string, any>;
  xhrOptions?: Record<string, any>;
}

export interface UploadState {
  files: Record<string, any>;
  totalProgress: number;
  isUploading: boolean;
  error: string | null;
  completedUploads: any[];
}

export const useUppyUpload = (config: UploadConfig) => {
  const [uppy] = useState(() => {
    const instance = new Uppy({
      autoProceed: config.autoProceed || false,
      debug: config.debug || false,
      restrictions: {
        maxFileSize: config.maxFileSize || null,
        maxNumberOfFiles: config.maxNumberOfFiles || null,
        allowedFileTypes: config.allowedFileTypes || null,
      },
    });

    // Configure upload method
    if (config.uploadType === 'tus') {
      instance.use(Tus, {
        endpoint: config.endpoint,
        urlStorage: new AsyncStorageUrlStorage(),
        fileReader: tusFileReader,
        chunkSize: config.chunkSize || 10 * 1024 * 1024, // 10MB default
        ...config.tusOptions,
      });
    } else {
      instance.use(XHRUpload, {
        endpoint: config.endpoint,
        ...config.xhrOptions,
      });
    }

    return instance;
  });

  const [uploadState, setUploadState] = useState<UploadState>({
    files: {},
    totalProgress: 0,
    isUploading: false,
    error: null,
    completedUploads: [],
  });

  useEffect(() => {
    const updateState = () => {
      setUploadState((prev) => ({
        ...prev,
        files: uppy.getState().files,
        totalProgress: uppy.getState().totalProgress,
      }));
    };

    const handleUploadStarted = () => {
      setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));
    };

    const handleComplete = (result: any) => {
      setUploadState((prev) => ({
        ...prev,
        isUploading: false,
        completedUploads: result.successful,
        error: result.failed.length > 0 ? `${result.failed.length} files failed to upload` : null,
      }));
    };

    const handleError = (error: Error) => {
      setUploadState((prev) => ({
        ...prev,
        isUploading: false,
        error: error.message,
      }));
    };

    // Register event listeners
    uppy.on('file-added', updateState);
    uppy.on('file-removed', updateState);
    uppy.on('upload-progress', updateState);
    uppy.on('upload', handleUploadStarted);
    uppy.on('complete', handleComplete);
    uppy.on('error', handleError);

    return () => {
      // Cleanup event listeners
      uppy.off('file-added', updateState);
      uppy.off('file-removed', updateState);
      uppy.off('upload-progress', updateState);
      uppy.off('upload', handleUploadStarted);
      uppy.off('complete', handleComplete);
      uppy.off('error', handleError);
    };
  }, [uppy]);

  const addFile = useCallback(
    async (fileData: FileData) => {
      try {
        uppy.addFile({
          source: 'React Native',
          name: fileData.name,
          type: fileData.mimeType || fileData.type,
          data: {
            ...fileData,
            size: fileData.size || null,
          },
          meta: {
            size: fileData.size || null,
            type: fileData.type,
          },
        });
      } catch (error) {
        setUploadState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to add file',
        }));
      }
    },
    [uppy]
  );

  const removeFile = useCallback(
    (fileId: string) => {
      uppy.removeFile(fileId);
    },
    [uppy]
  );

  const startUpload = useCallback(() => {
    uppy.upload();
  }, [uppy]);

  const pauseUpload = useCallback(() => {
    uppy.pauseAll();
  }, [uppy]);

  const resumeUpload = useCallback(() => {
    uppy.resumeAll();
  }, [uppy]);

  const cancelUpload = useCallback(() => {
    uppy.cancelAll();
  }, [uppy]);

  const retryUpload = useCallback(() => {
    uppy.retryAll();
  }, [uppy]);

  return {
    uppy,
    uploadState,
    addFile,
    removeFile,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    retryUpload,
  };
};
