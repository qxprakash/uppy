# Uppy React Native Expo Example

This is a modern, unopinionated React Native Expo example demonstrating how to use Uppy for file uploads without the deprecated `@uppy/react-native` package.

## Features

- **Multiple file selection**: Photos, videos, and documents
- **Camera integration**: Take pictures directly from the app
- **TUS resumable uploads**: Robust upload handling with pause/resume functionality
- **Progress tracking**: Real-time upload progress with visual indicators
- **Error handling**: Comprehensive error handling and user feedback
- **Customizable UI**: Flexible components that can be styled to match your app
- **TypeScript support**: Full TypeScript implementation

## Architecture

This example demonstrates the recommended approach for React Native file uploads:

### Core Components

- **File Selection Utilities** (`src/utils/filePickers.ts`): Direct Expo API integration
- **Upload Hook** (`src/hooks/useUppyUpload.ts`): Uppy integration with React hooks
- **TUS File Reader** (`src/utils/tusFileReader.ts`): Custom file reader for React Native
- **UI Components**: Modular, reusable components

### Key Benefits

1. **No opinionated UI dependencies**: Use Uppy's core functionality with your own UI
2. **Full customization**: Every component can be styled and modified
3. **Modern React patterns**: Hooks-based implementation
4. **Production ready**: Comprehensive error handling and edge cases

## Installation & Setup

### Prerequisites

1. **Expo CLI**: `npm install -g @expo/cli`
2. **Repository setup**: From the repository root:
   ```bash
   yarn install
   yarn run build
   ```

### Running the Example

1. **Navigate to the example**:
   ```bash
   cd examples/expo-new-example
   ```

2. **Start the development server**:
   ```bash
   yarn workspace expo-new-example start
   ```
   
   Or from the repository root:
   ```bash
   yarn workspace expo-new-example start
   ```

3. **Choose your platform**:
   - Press `a` for Android
   - Press `i` for iOS simulator
   - Press `w` for web
   - Scan QR code with Expo Go app

## Usage

### Basic Implementation

```typescript
import { useUppyUpload } from './hooks/useUppyUpload';
import { selectImage, selectDocument, takePicture } from './utils/filePickers';

const MyComponent = () => {
  const { uploadState, addFile, startUpload } = useUppyUpload({
    uploadType: 'tus',
    endpoint: 'https://your-upload-endpoint.com/files/',
    maxFileSize: 100 * 1024 * 1024, // 100MB
  });

  const handleSelectImage = async () => {
    const files = await selectImage({ allowsMultipleSelection: true });
    for (const file of files) {
      await addFile(file);
    }
  };

  // ... rest of your component
};
```

### Customization Options

#### Upload Configuration

```typescript
const uploadConfig = {
  uploadType: 'tus', // or 'xhr'
  endpoint: 'https://your-server.com/upload',
  autoProceed: false,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxNumberOfFiles: 10,
  allowedFileTypes: ['image/*', 'video/*', '.pdf'],
  chunkSize: 5 * 1024 * 1024, // 5MB chunks
  tusOptions: {
    retryDelays: [0, 1000, 3000, 5000],
  }
};
```

#### File Selection Options

```typescript
// Image selection with editing
const files = await selectImage({
  allowsEditing: true,
  quality: 0.8,
  allowsMultipleSelection: true,
});

// Camera with custom settings
const photo = await takePicture({
  allowsEditing: true,
  quality: 0.9,
  aspect: [16, 9],
});
```

## File Structure

```
src/
├── components/           # Reusable UI components
│   ├── FileSelectionSheet.tsx
│   ├── FileList.tsx
│   ├── ProgressBar.tsx
│   └── UploadControls.tsx
├── hooks/               # React hooks
│   └── useUppyUpload.ts
├── utils/               # Utility functions
│   ├── filePickers.ts
│   ├── tusFileReader.ts
│   └── asyncStorageUrlStorage.ts
└── App.tsx              # Main application component
```

## Migration from @uppy/react-native

If you're migrating from the old `@uppy/react-native` package:

1. **Remove the dependency**: `@uppy/react-native`
2. **Copy the utilities**: Use the `filePickers.ts` and `useUppyUpload.ts`
3. **Replace FilePicker**: Use `FileSelectionSheet` component
4. **Update imports**: Import from your local utilities instead

### Before (with @uppy/react-native)

```javascript
import FilePicker from '@uppy/react-native';

<FilePicker
  uppy={uppy}
  show={visible}
  onRequestClose={onClose}
/>
```

### After (with this example)

```typescript
import { FileSelectionSheet } from './components/FileSelectionSheet';

<FileSelectionSheet
  visible={visible}
  onClose={onClose}
  onSelectImage={handleSelectImage}
  onSelectDocument={handleSelectDocument}
  onTakePicture={handleTakePicture}
/>
```

## Deployment Considerations

### iOS

- Ensure camera permissions are configured in `app.json`
- Test on physical device for camera functionality

### Android

- Configure file access permissions
- Test file selection on different Android versions

### Web

- File APIs work in modern browsers
- Camera functionality requires HTTPS in production

## Contributing

This example serves as a template for React Native file uploads with Uppy. Feel free to:

1. Copy and modify components for your needs
2. Extend functionality for your use case
3. Submit improvements back to the repository

## Support

For issues related to:
- **Uppy Core**: [Uppy repository](https://github.com/transloadit/uppy)
- **Expo APIs**: [Expo documentation](https://docs.expo.dev/)
- **This example**: Create an issue in the Uppy repository

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
