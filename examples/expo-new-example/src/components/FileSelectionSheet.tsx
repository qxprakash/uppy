import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';

interface FileSelectionSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectImage: () => void;
  onSelectDocument: () => void;
  onTakePicture: () => void;
  theme?: Theme;
}

interface Theme {
  colors: {
    background: string;
    text: string;
    primary: string;
    secondary: string;
    border: string;
    surface: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}

const defaultTheme: Theme = {
  colors: {
    background: '#ffffff',
    text: '#000000',
    primary: '#007AFF',
    secondary: '#8E8E93',
    border: '#C6C6C8',
    surface: '#F2F2F7',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
};

interface FileOptionProps {
  title: string;
  subtitle: string;
  onPress: () => void;
  icon: string;
  theme: Theme;
}

const FileOption: React.FC<FileOptionProps> = ({ title, subtitle, onPress, icon, theme }) => {
  const styles = createStyles(theme);

  return (
    <TouchableOpacity style={styles.option} onPress={onPress}>
      <Text style={styles.optionIcon}>{icon}</Text>
      <View style={styles.optionTextContainer}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
};

export const FileSelectionSheet: React.FC<FileSelectionSheetProps> = ({
  visible,
  onClose,
  onSelectImage,
  onSelectDocument,
  onTakePicture,
  theme = defaultTheme,
}) => {
  const styles = createStyles(theme);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />

        <View style={styles.header}>
          <Text style={styles.title}>Select File</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <FileOption
            title="Photo Library"
            subtitle="Choose from your photos and videos"
            onPress={onSelectImage}
            icon="🖼️"
            theme={theme}
          />

          <FileOption
            title="Camera"
            subtitle="Take a new photo"
            onPress={onTakePicture}
            icon="📸"
            theme={theme}
          />

          <FileOption
            title="Files"
            subtitle="Browse your documents"
            onPress={onSelectDocument}
            icon="📄"
            theme={theme}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
    },
    closeButton: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
    closeButtonText: {
      fontSize: 16,
      color: theme.colors.primary,
      fontWeight: '500',
    },
    content: {
      flex: 1,
      paddingTop: theme.spacing.lg,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      backgroundColor: theme.colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    optionIcon: {
      fontSize: 24,
      marginRight: theme.spacing.md,
      width: 32,
      textAlign: 'center',
    },
    optionTextContainer: {
      flex: 1,
    },
    optionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
      marginBottom: 2,
    },
    optionSubtitle: {
      fontSize: 14,
      color: theme.colors.secondary,
    },
    chevron: {
      fontSize: 18,
      color: theme.colors.secondary,
      fontWeight: '300',
    },
  });

export default FileSelectionSheet;
