
  const firebaseConfig = {
    apiKey: "FIREBASE_API",
    authDomain: "FIREBASE_AUTH",
    databaseURL: "https://wikiracer-79f05-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "FIREBASE_PROJECT_ID",
    storageBucket: "FIREBASE_BUCKET",
    messagingSenderId: "FIREBASE_SENDER",
    appId: "FIREBASE_APP_ID",
    measurementId: "FIREBASE_MEASUREMENT_ID"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  