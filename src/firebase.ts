import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import localConfig from '../firebase-applet-config.json';

const rawConfig = (localConfig as any).default || localConfig;

const getVal = (envKey: string, fallback: string): string => {
  const envVal = import.meta.env[envKey];
  if (typeof envVal === 'string' && envVal.trim().length > 0) {
    return envVal.trim();
  }
  return fallback;
};

const firebaseConfig = {
  projectId: getVal('VITE_FIREBASE_PROJECT_ID', rawConfig.projectId),
  appId: getVal('VITE_FIREBASE_APP_ID', rawConfig.appId),
  apiKey: getVal('VITE_FIREBASE_API_KEY', rawConfig.apiKey),
  authDomain: getVal('VITE_FIREBASE_AUTH_DOMAIN', rawConfig.authDomain),
  firestoreDatabaseId: getVal(
    'VITE_FIREBASE_DATABASE_ID',
    rawConfig.firestoreDatabaseId || '(default)'
  ),
  storageBucket: getVal('VITE_FIREBASE_STORAGE_BUCKET', rawConfig.storageBucket),
  messagingSenderId: getVal('VITE_FIREBASE_MESSAGING_SENDER_ID', rawConfig.messagingSenderId),
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// CRITICAL: Initialize Firestore with firestoreDatabaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);

// Attempt browserLocalPersistence safely without throwing
try {
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // Ignore if not supported in current environment
  });
} catch {
  // Ignore
}

// Test Firestore connection on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline warning. Please check database connection.');
    }
  }
}
testConnection();

export { onAuthStateChanged };
