// api/cleanup.js — Vercel serverless function
// Deletes rooms older than 24 hours
// Runs on a schedule via vercel.json cron


const admin = require('firebase-admin');


// Initialise Firebase Admin SDK (uses service account credentials from env vars)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}


export default async function handler(req, res) {
  const db = admin.database();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago


  const snapshot = await db.ref('rooms')
    .orderByChild('createdAt')
    .endAt(cutoff)
    .get();


  if (!snapshot.exists()) {
    return res.json({ deleted: 0 });
  }


  const updates = {};
  snapshot.forEach(child => {
    updates[child.key] = null; // Setting to null deletes in Firebase
  });


  await db.ref('rooms').update(updates);
  return res.json({ deleted: Object.keys(updates).length });
}
