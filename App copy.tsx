import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  StatusBar,
} from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import AudioRecord from 'react-native-audio-record';

function App(): React.JSX.Element {
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [device, setDevice] = useState<CameraDevice | null>(null);
  const cameraRef = useRef<Camera>(null);

  const [audioClassification, setAudioClassification] = useState('');
  const [imageClassification, setImageClassification] = useState('');

  const audioChunkInterval = useRef<NodeJS.Timeout>();
  const frameInterval = useRef<NodeJS.Timeout>();
  const isRecording = useRef(false);

  useEffect(() => {
    (async () => {
      let cameraPermission = false;
      let audioPermission = false;

      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);

        cameraPermission = granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
        audioPermission = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        cameraPermission = await Camera.requestCameraPermission();
        audioPermission = await Camera.requestMicrophonePermission();
      }

      if (cameraPermission === 'granted' && audioPermission === 'granted') {
        setHasPermission(true);
        
        // Only access useCameraDevices() after permissions are granted
        const devices = useCameraDevices();
        if (devices?.back) {
          setDevice(devices.back);
        }
      }

      setIsLoading(false);
    })();
  }, []);

  const initAudioRecorder = () => {
    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      wavFile: 'audio_chunk.wav',
    };
    AudioRecord.init(options);
  };

  const startRecording = async () => {
    try {
      if (!isRecording.current) {
        isRecording.current = true;
        await AudioRecord.start();
      }
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = async () => {
    try {
      if (isRecording.current) {
        const audioFile = await AudioRecord.stop();
        isRecording.current = false;
        return audioFile;
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
    return null;
  };

  const processAudioChunk = async (audioData: any) => {
    try {
      const formData = new FormData();
      formData.append('audio_file', {
        uri: audioData.uri,
        type: 'audio/wav',
        name: 'audio_chunk.wav',
      });

      const response = await fetch('http://localhost:8001/predict', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = await response.json();
      setAudioClassification(result.classification);
    } catch (error) {
      console.error('Error processing audio:', error);
    }
  };

  const processVideoFrame = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePhoto();
        const formData = new FormData();
        formData.append('image_file', {
          uri: `file://${photo.path}`,
          type: 'image/jpeg',
          name: 'frame.jpg',
        });

        const response = await fetch('http://localhost:9001/predict_image', {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        const result = await response.json();
        setImageClassification(result.classification);
      } catch (error) {
        console.error('Error processing video frame:', error);
      }
    }
  };

  useEffect(() => {
    if (hasPermission) {
      initAudioRecorder();

      // Start audio processing every 2.5 seconds
      audioChunkInterval.current = setInterval(async () => {
        await startRecording();
        setTimeout(async () => {
          const audioFile = await stopRecording();
          if (audioFile) {
            await processAudioChunk({ uri: audioFile });
          }
        }, 2000); // Record for 2 seconds
      }, 2500);

      // Start frame capture every 1 second
      frameInterval.current = setInterval(processVideoFrame, 1000);
    }

    return () => {
      if (audioChunkInterval.current) clearInterval(audioChunkInterval.current);
      if (frameInterval.current) clearInterval(frameInterval.current);
      AudioRecord.stop();
    };
  }, [hasPermission]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>Loading camera...</Text>
      </View>
    );
  }

  if (!device || !hasPermission) {
    return (
      <View style={styles.container}>
        <Text>{!device ? 'No Camera Found' : 'Permissions Required'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        enableZoomGesture
      />
      <View style={styles.overlay}>
        <Text style={styles.classificationText}>Audio: {audioClassification}</Text>
        <Text style={styles.classificationText}>Image: {imageClassification}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 10,
    borderRadius: 10,
  },
  classificationText: {
    color: '#fff',
    fontSize: 16,
    marginVertical: 5,
  },
});

export default App;
