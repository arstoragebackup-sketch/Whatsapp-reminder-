const admin = require("firebase-admin");

console.log("=== FIREBASE KEY CHECK ===");

const rawKey = process.env.FIREBASE_PRIVATE_KEY || "";

console.log("Key exists:", rawKey.length > 0);
console.log("Key length:", rawKey.length);
console.log("Starts with:", JSON.stringify(rawKey.substring(0, 30)));
console.log("Ends with:", JSON.stringify(rawKey.substring(rawKey.length - 30)));

const privateKey = rawKey
  .replace(/\\n/g, "\n")
  .replace(/\r/g, "");

console.log("After conversion length:", privateKey.length);
console.log(
  "Converted starts with:",
  JSON.stringify(privateKey.substring(0, 30))
);

console.log("Has BEGIN:", privateKey.includes("-----BEGIN PRIVATE KEY-----"));
console.log("Has END:", privateKey.includes("-----END PRIVATE KEY-----"));

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
});

console.log("✅ Firebase initialized successfully");
