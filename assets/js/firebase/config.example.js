// File: assets/js/firebase/config.example.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import { initSyncQueue } from "../utils/sync-queue.js";

const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const storageKey = '__absensi_firebase_state__';
const existingState = globalThis[storageKey];

const app = existingState?.app || (getApps().length ? getApps()[0] : initializeApp(firebaseConfig));
const db = existingState?.db || initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
const auth = existingState?.auth || getAuth(app);
const storage = existingState?.storage || getStorage(app);

if (!existingState) {
  globalThis[storageKey] = { app, db, auth, storage };
}

initSyncQueue(db);

export { db, auth, app, storage };
