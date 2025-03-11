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
} from 'react-native';
import { pick } from '@react-native-documents/picker';

// Adjust the backend URL as needed (for Android use 10.0.2.2 for localhost)
const BACKEND_URL = Platform.OS === 'android' ? 'http://10.0.2.2:6001' : 'http://localhost:6001';

function App(): React.JSX.Element {
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [imageClassification, setImageClassification] = useState('');
  const [audioClassification, setAudioClassification] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Request permissions (for Android) to read external storage or media
  const requestPermissions = async (mediaType: 'image' | 'audio') => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Platform.Version >= 33) {
        const permission =
          mediaType === 'image'
            ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
            : PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO;
        const result = await PermissionsAndroid.request(permission);
        if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          openAppSettings();
          return false;
        }
        return false;
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.error('Permission error:', err);
      return false;
    }
  };

  const openAppSettings = () => {
    Alert.alert(
      'Permission Required',
      'Storage permissions have been permanently denied. Please enable them in app settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]
    );
  };

  // Pick and upload an image directly to the backend
  const pickImage = async () => {
    try {
      const hasPermission = await requestPermissions('image');
      if (!hasPermission) {
        Alert.alert('Permission Denied', 'Storage permission is required to select images.');
        return;
      }

      const [result] = await pick({
        type: 'image/*',
        allowMultiSelection: false,
      });

      if (result) {
        setProcessingStatus(`Uploading image: ${result.name}`);
        await uploadImage(result.uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  // Pick and upload an audio file directly to the backend
  const pickAudio = async () => {
    try {
      const hasPermission = await requestPermissions('audio');
      if (!hasPermission) {
        Alert.alert('Permission Denied', 'Storage permission is required to select audio.');
        return;
      }

      const [result] = await pick({
        type: 'audio/*',
        allowMultiSelection: false,
      });

      if (result) {
        setProcessingStatus(`Uploading audio: ${result.name}`);
        await uploadAudio(result.uri);
      }
    } catch (err) {
      console.error('Error picking audio:', err);
      Alert.alert('Error', 'Failed to pick audio.');
    }
  };

  // Upload image file using FormData to the backend
  const uploadImage = async (uri: string) => {
    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('image_file', {
        uri: uri,
        type: 'image/jpeg', // adjust as needed based on file type
        name: 'uploaded_image.jpg',
      });

      const response = await fetch(`${BACKEND_URL}/predict_image`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = await response.json();
      // Use the correct key from your backend response
      setImageClassification(result.predicted_class || 'No classification');
      setProcessingStatus('Image classification complete.');
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', 'Failed to upload image.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Upload audio file using FormData to the backend
  const uploadAudio = async (uri: string) => {
    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('audio_file', {
        uri: uri,
        type: 'audio/wav', // adjust as needed based on file type
        name: 'uploaded_audio.wav',
      });

      const response = await fetch(`${BACKEND_URL}/predict`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = await response.json();
      // Use the correct key from your backend response
      setAudioClassification(result.emotion || 'No classification');
      setProcessingStatus('Audio classification complete.');
    } catch (error) {
      console.error('Error uploading audio:', error);
      Alert.alert('Error', 'Failed to upload audio.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Media Analyzer</Text>
      <TouchableOpacity style={styles.button} onPress={pickImage} disabled={isProcessing}>
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processing...' : 'Upload Image'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={pickAudio} disabled={isProcessing}>
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processing...' : 'Upload Audio'}
        </Text>
      </TouchableOpacity>

      {processingStatus ? <Text style={styles.statusText}>{processingStatus}</Text> : null}

      <View style={styles.resultsContainer}>
        <Text style={styles.resultTitle}>Classification Results:</Text>
        <Text style={styles.resultText}>
          Image: {imageClassification || 'Not processed'}
        </Text>
        <Text style={styles.resultText}>
          Audio: {audioClassification || 'Not processed'}
        </Text>
      </View>
    </View>
  );
}

export default App;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 50, alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 20, fontWeight: 'bold', color: '#333' },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    marginVertical: 10,
    width: '80%',
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
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
