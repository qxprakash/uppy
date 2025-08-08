import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { formatFileSize } from '../utils/filePickers';

interface FileItem {
  id: string;
  name: string;
  size?: number;
  type?: string;
  progress?: {
    bytesUploaded: number;
    bytesTotal: number;
  };
  error?: any;
  uploadURL?: string;
}

interface FileListProps {
  files: Record<string, FileItem>;
  onRemoveFile: (fileId: string) => void;
  completedUploads?: any[];
  style?: any;
}

interface FileListItemProps {
  file: FileItem;
  onRemove: () => void;
  isCompleted: boolean;
}

const FileListItem: React.FC<FileListItemProps> = ({ file, onRemove, isCompleted }) => {
  const getFileIcon = (type?: string) => {
    if (!type) return '📄';
    
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.includes('pdf')) return '📕';
    if (type.includes('doc') || type.includes('word')) return '📘';
    if (type.includes('excel') || type.includes('sheet')) return '📊';
    if (type.includes('text')) return '📝';
    
    return '📄';
  };

  const getProgressPercentage = () => {
    if (!file.progress) return 0;
    if (file.progress.bytesTotal === 0) return 0;
    return (file.progress.bytesUploaded / file.progress.bytesTotal) * 100;
  };

  const getStatusText = () => {
    if (file.error) return 'Error';
    if (isCompleted) return 'Completed';
    if (file.progress && file.progress.bytesUploaded > 0) {
      return `${Math.round(getProgressPercentage())}%`;
    }
    return 'Pending';
  };

  const getStatusColor = () => {
    if (file.error) return '#FF3B30';
    if (isCompleted) return '#34C759';
    if (file.progress && file.progress.bytesUploaded > 0) return '#007AFF';
    return '#8E8E93';
  };

  return (
    <View style={styles.fileItem}>
      <View style={styles.fileIcon}>
        <Text style={styles.fileIconText}>{getFileIcon(file.type)}</Text>
      </View>
      
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={1}>
          {file.name}
        </Text>
        <View style={styles.fileDetails}>
          <Text style={styles.fileSize}>
            {formatFileSize(file.size)}
          </Text>
          <Text style={[styles.fileStatus, { color: getStatusColor() }]}>
            {getStatusText()}
          </Text>
        </View>
        
        {file.progress && file.progress.bytesUploaded > 0 && !isCompleted && (
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressBar,
                { width: `${getProgressPercentage()}%` },
              ]}
            />
          </View>
        )}
      </View>
      
      <TouchableOpacity onPress={onRemove} style={styles.removeButton}>
        <Text style={styles.removeButtonText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

export const FileList: React.FC<FileListProps> = ({
  files,
  onRemoveFile,
  completedUploads = [],
  style,
}) => {
  const fileArray = Object.keys(files).map((id) => ({
    ...files[id],
    id,
  }));

  const isFileCompleted = (fileId: string) => {
    return completedUploads.some((upload) => upload.id === fileId);
  };

  const renderItem = ({ item }: { item: FileItem }) => (
    <FileListItem
      file={item}
      onRemove={() => onRemoveFile(item.id)}
      isCompleted={isFileCompleted(item.id)}
    />
  );

  if (fileArray.length === 0) {
    return (
      <View style={[styles.emptyContainer, style]}>
        <Text style={styles.emptyText}>No files selected</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>Files ({fileArray.length})</Text>
      <FlatList
        data={fileArray}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#000',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F2F2F7',
    marginBottom: 8,
    borderRadius: 8,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileIconText: {
    fontSize: 18,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 4,
  },
  fileDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fileSize: {
    fontSize: 14,
    color: '#8E8E93',
  },
  fileStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  progressContainer: {
    height: 2,
    backgroundColor: '#E5E5EA',
    borderRadius: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 1,
  },
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default FileList;
