import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import Video from 'react-native-video';
import { pick } from '@react-native-documents/picker';
import { FileSystem, Dirs } from 'react-native-file-access';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';

// If using an emulator, use 10.0.2.2 for localhost
const BACKEND_URL = Platform.OS === 'android' ? 'http://10.0.2.2:6001' : 'http://localhost:6001';

async function copyContentUriToLocal(originalUri: string) {
  const localPath = `${Dirs.CacheDir}/input_video_temp.mp4`;
  console.log('Copying content URI => local path:', originalUri, '=>', localPath);

  // Copies from content:// to a real file in cache
  const response = await fetch(originalUri);
  const blob = await response.blob();
  const reader = new FileReader();
  
  await new Promise((resolve, reject) => {
    reader.onload = async () => {
      try {
        const buffer = reader.result as string;
        await FileSystem.writeFile(localPath, buffer, 'base64');
        resolve(void 0);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  // Return "file://..." so FFmpegKit can read it
  return 'file://' + localPath;
}

function App(): React.JSX.Element {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [audioClassification, setAudioClassification] = useState('');
  const [imageClassification, setImageClassification] = useState('');
  const [lastFrameTime, setLastFrameTime] = useState(0);
  const [lastAudioTime, setLastAudioTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Request permissions if needed
  const requestPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO
        );
        if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          openAppSettings();
          return false;
        }
        return false;
      } else {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        ]);
        return Object.values(result).every((s) => s === PermissionsAndroid.RESULTS.GRANTED);
      }
    } catch (err) {
      console.error('Permission error:', err);
      return false;
    }
  };

  const openAppSettings = () => {
    Alert.alert(
      'Permission Required',
      'Storage permissions are required but have been permanently denied. Please enable them in app settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]
    );
  };

  // **Pick a video** from the PhotoPicker
  const pickVideo = async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        Alert.alert('Permission Denied', 'Storage permission is required to select videos.');
        return;
      }

      const [result] = await pick({
        type: 'video/*',
        allowMultiSelection: false,
      });

      if (result) {
        // If PhotoPicker returns content://, copy to local path
        let finalUri = result.uri;
        if (finalUri.startsWith('content://')) {
          finalUri = await copyContentUriToLocal(finalUri);
        }

        console.log('Picked video =>', finalUri);

        setVideoUri(finalUri);
        setProcessingStatus(`Video selected: ${result.name}`);
        setAudioClassification('');
        setImageClassification('');
        setLastFrameTime(0);
        setLastAudioTime(0);
      }
    } catch (err) {
      console.error('Error picking video:', err);
      Alert.alert('Error', 'Failed to pick video.');
    }
  };

  // Create subdirectories in cache
  const createSubdirectories = async () => {
    const baseDir = Dirs.CacheDir;
    const videoProcessingDir = `${baseDir}/video_processing`;
    const framesDir = `${videoProcessingDir}/frames`;
    const audioDir = `${videoProcessingDir}/audio`;

    try { await FileSystem.mkdir(videoProcessingDir); } catch {}
    try { await FileSystem.mkdir(framesDir); } catch {}
    try { await FileSystem.mkdir(audioDir); } catch {}

    return { framesDir, audioDir };
  };

  // Extract a frame at a given time
  const captureFrame = async (time: number) => {
    if (!videoUri) return;
    try {
      setIsProcessing(true);
      const { framesDir } = await createSubdirectories();

      const framePath = `${framesDir}/frame_${Math.floor(time)}.jpg`;
      setProcessingStatus(`Extracting frame at ${time.toFixed(1)}s...`);
      console.log('FFmpeg command =>', `-ss ${time} -i "${videoUri}" -vframes 1 -q:v 2 "${framePath}"`);

      const session = await FFmpegKit.execute(
        `-ss ${time} -i "${videoUri}" -vframes 1 -q:v 2 "${framePath}"`
      );
      const returnCode = await session.getReturnCode();
      const logs = await session.getLogsAsString();
      console.log('FFmpeg logs:\n', logs);

      if (ReturnCode.isSuccess(returnCode)) {
        await processVideoFrame(framePath);
      } else {
        console.error('Failed to extract frame at time', time);
      }
    } catch (error) {
      console.error('Error capturing frame:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Send frame to backend
  const processVideoFrame = async (framePath: string) => {
    try {
      console.log(`Sending frame to backend: ${framePath}`);
      const formData = new FormData();
      formData.append('image_file', {
        uri: `file://${framePath}`,
        type: 'image/jpeg',
        name: 'frame.jpg',
      });

      const response = await fetch(`${BACKEND_URL}/predict_image`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = await response.json();
      setImageClassification(result.classification || 'No classification');
      console.log('Image classification result:', result);

      // Delete frame after sending
      await FileSystem.unlink(framePath);
    } catch (error) {
      console.error('Error processing video frame:', error);
    }
  };

  // Extract a 2.5s audio chunk
  const processAudioAtTime = async (time: number) => {
    if (!videoUri) return;
    try {
      setIsProcessing(true);
      const { audioDir } = await createSubdirectories();

      const audioChunkPath = `${audioDir}/chunk_${Math.floor(time)}.wav`;
      setProcessingStatus(`Extracting audio chunk at ${time.toFixed(1)}s...`);
      console.log('FFmpeg command =>', `-ss ${time} -i "${videoUri}" -t 2.5 -acodec pcm_s16le -ar 16000 -ac 1 "${audioChunkPath}"`);

      const session = await FFmpegKit.execute(
        `-ss ${time} -i "${videoUri}" -t 2.5 -acodec pcm_s16le -ar 16000 -ac 1 "${audioChunkPath}"`
      );
      const returnCode = await session.getReturnCode();
      const logs = await session.getLogsAsString();
      console.log('FFmpeg logs:\n', logs);

      if (ReturnCode.isSuccess(returnCode)) {
        await processAudioChunk(audioChunkPath);
      } else {
        console.error('Failed to extract audio chunk at time', time);
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Send audio chunk to backend
  const processAudioChunk = async (audioPath: string) => {
    try {
      console.log(`Sending audio chunk to backend: ${audioPath}`);
      const formData = new FormData();
      formData.append('audio_file', {
        uri: `file://${audioPath}`,
        type: 'audio/wav',
        name: 'audio_chunk.wav',
      });

      const response = await fetch(`${BACKEND_URL}/predict`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = await response.json();
      setAudioClassification(result.classification || 'No classification');
      console.log('Audio classification result:', result);

      // Delete chunk after sending
      await FileSystem.unlink(audioPath);
    } catch (error) {
      console.error('Error processing audio:', error);
    }
  };

  // Called every progress update from the Video player
  const onVideoProgress = ({ currentTime }: { currentTime: number }) => {
    console.log(`Video Progress => ${currentTime.toFixed(2)}s`);

    // Capture a frame every 1 second
    if (currentTime - lastFrameTime >= 1) {
      captureFrame(currentTime);
      setLastFrameTime(currentTime);
    }
    // Extract a 2.5s audio chunk
    if (currentTime - lastAudioTime >= 2.5) {
      processAudioAtTime(currentTime);
      setLastAudioTime(currentTime);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Video Analyzer</Text>
      <TouchableOpacity style={styles.button} onPress={pickVideo} disabled={isProcessing}>
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processing...' : 'Select Video'}
        </Text>
      </TouchableOpacity>

      {videoUri && (
        <Video
          source={{ uri: videoUri }}
          style={styles.video}
          controls
          onProgress={onVideoProgress}
          resizeMode="contain"
          onLoad={(meta) => {
            console.log('Video loaded, duration =>', meta.duration);
          }}
        />
      )}

      {processingStatus ? (
        <Text style={styles.statusText}>{processingStatus}</Text>
      ) : null}

      <View style={styles.resultsContainer}>
        <Text style={styles.resultTitle}>Classification Results:</Text>
        <Text style={styles.resultText}>Audio: {audioClassification || 'Not processed'}</Text>
        <Text style={styles.resultText}>Image: {imageClassification || 'Not processed'}</Text>
      </View>
    </View>
  );
}

export default App;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 50, alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 20, fontWeight: 'bold', color: '#333' },
  button: { backgroundColor: '#2196F3', padding: 12, borderRadius: 8, marginVertical: 10 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  video: { width: '90%', height: 220, backgroundColor: '#000', marginVertical: 20 },
  statusText: { fontSize: 14, color: '#555', marginBottom: 10, textAlign: 'center' },
  resultsContainer: {
    width: '90%',
    marginTop: 20,
    backgroundColor: '#eee',
    padding: 15,
    borderRadius: 8,
  },
  resultTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#333' },
  resultText: { fontSize: 16, marginVertical: 2, color: '#333' },
});
