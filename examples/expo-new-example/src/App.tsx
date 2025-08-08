import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useUppyUpload } from './hooks/useUppyUpload';
import {
  selectImage,
  selectDocument,
  takePicture,
  type FileData,
} from './utils/filePickers';
import FileSelectionSheet from './components/FileSelectionSheet';
import FileList from './components/FileList';
import UploadControls from './components/UploadControls';
import ProgressBar from './components/ProgressBar';

export default function App() {
  const [showFilePicker, setShowFilePicker] = useState(false);

  const {
    uploadState,
    addFile,
    removeFile,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
  } = useUppyUpload({
    uploadType: 'tus',
    endpoint: 'https://tusd.tusdemo.net/files/',
    autoProceed: false, // More control over uploads
    debug: true,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    chunkSize: 5 * 1024 * 1024, // 5MB chunks
    tusOptions: {
      retryDelays: [0, 1000, 3000, 5000],
    },
  });

  const handleSelectImage = async () => {
    try {
      const files = await selectImage({
        quality: 0.8,
        allowsEditing: false,
        allowsMultipleSelection: true,
      });

      for (const file of files) {
        await addFile(file);
      }

      setShowFilePicker(false);
    } catch (error) {
      console.error('Error selecting image:', error);
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  };

  const handleSelectDocument = async () => {
    try {
      const files = await selectDocument();

      for (const file of files) {
        await addFile(file);
      }

      setShowFilePicker(false);
    } catch (error) {
      console.error('Error selecting document:', error);
      Alert.alert('Error', 'Failed to select document. Please try again.');
    }
  };

  const handleTakePicture = async () => {
    try {
      const file = await takePicture({
        allowsEditing: true,
        quality: 0.8,
      });

      if (file) {
        await addFile(file);
      }

      setShowFilePicker(false);
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const handleCancelUpload = () => {
    Alert.alert(
      'Cancel Upload',
      'Are you sure you want to cancel the upload?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes', onPress: cancelUpload },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />

      <View style={styles.content}>
        <Text style={styles.title}>Uppy React Native Example</Text>
        <Text style={styles.subtitle}>
          Unopinionated file upload with TUS support
        </Text>

        <UploadControls
          onSelectFiles={() => setShowFilePicker(true)}
          onStartUpload={startUpload}
          onPauseUpload={pauseUpload}
          onResumeUpload={resumeUpload}
          onCancelUpload={handleCancelUpload}
          isUploading={uploadState.isUploading}
          hasFiles={Object.keys(uploadState.files).length > 0}
          style={styles.controls}
        />

        {uploadState.totalProgress > 0 && (
          <ProgressBar
            progress={uploadState.totalProgress}
            style={styles.progressBar}
          />
        )}

        <FileList
          files={uploadState.files}
          onRemoveFile={removeFile}
          completedUploads={uploadState.completedUploads}
          style={styles.fileList}
        />

        {uploadState.error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {uploadState.error}</Text>
          </View>
        )}

        {uploadState.completedUploads.length > 0 && (
          <View style={styles.successContainer}>
            <Text style={styles.successText}>
              ✅ {uploadState.completedUploads.length} file(s) uploaded successfully!
            </Text>
          </View>
        )}
      </View>

      <FileSelectionSheet
        visible={showFilePicker}
        onClose={() => setShowFilePicker(false)}
        onSelectImage={handleSelectImage}
        onSelectDocument={handleSelectDocument}
        onTakePicture={handleTakePicture}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#000',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    color: '#666',
    lineHeight: 22,
  },
  controls: {
    marginBottom: 24,
  },
  progressBar: {
    marginBottom: 24,
  },
  fileList: {
    flex: 1,
    minHeight: 200,
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    fontWeight: '500',
  },
  successContainer: {
    backgroundColor: '#E8F5E8',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  successText: {
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '500',
  },
});
