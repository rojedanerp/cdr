// ============================================
// CONFIGURACIÓN FIREBASE - REEMPLAZAR CON TUS CREDENCIALES
// Obténlas en: https://console.firebase.google.com
// ============================================

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Habilitar persistencia offline
db.enablePersistence({ synchronizeTabs: true })
  .catch(err => console.log('Persistencia no disponible:', err));

export { auth, db };
