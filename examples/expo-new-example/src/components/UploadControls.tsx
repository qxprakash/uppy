import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface UploadControlsProps {
  onSelectFiles: () => void;
  onStartUpload: () => void;
  onPauseUpload: () => void;
  onResumeUpload: () => void;
  onCancelUpload?: () => void;
  isUploading: boolean;
  isPaused?: boolean;
  hasFiles: boolean;
  style?: any;
}

export const UploadControls: React.FC<UploadControlsProps> = ({
  onSelectFiles,
  onStartUpload,
  onPauseUpload,
  onResumeUpload,
  onCancelUpload,
  isUploading,
  isPaused = false,
  hasFiles,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity style={styles.primaryButton} onPress={onSelectFiles}>
        <Text style={styles.primaryButtonText}>Select Files</Text>
      </TouchableOpacity>

      {hasFiles && (
        <View style={styles.uploadControls}>
          {!isUploading ? (
            <TouchableOpacity style={styles.uploadButton} onPress={onStartUpload}>
              <Text style={styles.uploadButtonText}>Start Upload</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.uploadingControls}>
              {isPaused ? (
                <TouchableOpacity style={styles.resumeButton} onPress={onResumeUpload}>
                  <Text style={styles.resumeButtonText}>Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pauseButton} onPress={onPauseUpload}>
                  <Text style={styles.pauseButtonText}>Pause</Text>
                </TouchableOpacity>
              )}

              {onCancelUpload && (
                <TouchableOpacity style={styles.cancelButton} onPress={onCancelUpload}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadControls: {
    gap: 8,
  },
  uploadButton: {
    backgroundColor: '#34C759',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  uploadingControls: {
    flexDirection: 'row',
    gap: 8,
  },
  pauseButton: {
    flex: 1,
    backgroundColor: '#FF9500',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  pauseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  resumeButton: {
    flex: 1,
    backgroundColor: '#34C759',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  resumeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#FF3B30',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default UploadControls;
