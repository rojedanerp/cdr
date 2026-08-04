// ============================================
// CONFIGURACIÓN FIREBASE — proyecto: cdremesas
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyDfWvVCT5iUg4cA9WCDVB9wuewBv8oEgqQ",
  authDomain: "cdremesas.firebaseapp.com",
  projectId: "cdremesas",
  storageBucket: "cdremesas.firebasestorage.app",
  messagingSenderId: "212525185973",
  appId: "1:212525185973:web:c6b9566f88a932c510f7fc"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Habilitar persistencia offline
db.enablePersistence({ synchronizeTabs: true })
  .catch(err => console.log('Persistencia no disponible:', err));

export { auth, db };
