import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAfoy1c8NVVW3WWbriycd3MtPrWZEaThZ0",
  authDomain: "meet-9acd8.firebaseapp.com",
  projectId: "meet-9acd8",
  storageBucket: "meet-9acd8.firebasestorage.app",
  messagingSenderId: "538282086311",
  appId: "1:538282086311:web:0868d9dcb995f9df273082",
  measurementId: "G-GMMSH8G785"
};

const app = initializeApp(firebaseConfig);

const firestore = getFirestore(app);
const auth = getAuth(app);

export { auth, firestore };
