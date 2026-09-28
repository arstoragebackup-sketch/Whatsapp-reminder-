const admin = require("firebase-admin");

const formatPrivateKey = (key) => {
  if (!key) return "";
  return key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
};

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

// SAFE DIAGNOSTIC LOGS (No secrets exposed)
console.log("=== CREDENTIAL DIAGNOSTIC ===");
console.log("Project ID:", projectId || "MISSING");
console.log("Client Email:", clientEmail || "MISSING");
console.log("Private Key Length:", rawPrivateKey ? rawPrivateKey.length : 0);
console.log("Private Key Starts Correctly:", rawPrivateKey ? rawPrivateKey.trim().startsWith("-----BEGIN PRIVATE KEY-----") : false);
console.log("Private Key Ends Correctly:", rawPrivateKey ? rawPrivateKey.trim().endsWith("-----END PRIVATE KEY-----") : false);
console.log("WhatsApp Token Defined:", !!whatsappToken);
console.log("Phone Number ID Defined:", !!phoneNumberId);
console.log("==============================");

if (!projectId || !clientEmail || !rawPrivateKey || !whatsappToken || !phoneNumberId) {
  console.error("Fatal Error: Missing one or more required environment variables in GitHub Secrets.");
  process.exit(1);
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        clientEmail: clientEmail,
        privateKey: formatPrivateKey(rawPrivateKey),
      }),
    });
    console.log("Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error.message);
    process.exit(1);
  }
}

const db = admin.firestore();

async function sendWhatsAppMessage(phone, message) {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`WhatsApp API Error (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function processReminders() {
  console.log("Checking Firestore for pending reminders...");
  const now = admin.firestore.Timestamp.now();

  try {
    const snapshot = await db
      .collection("reminders")
      .where("sent", "!=", true)
      .where("reminderTime", "<=", now)
      .get();

    if (snapshot.empty) {
      console.log("No pending reminders due at this time.");
      return;
    }

    console.log(`Found ${snapshot.size} reminder(s) ready to send.`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const phone = data.phone;
      const message = data.message;

      if (!phone || !message) {
        console.warn(`Skipping document ${doc.id}: Missing 'phone' or 'message' field.`);
        continue;
      }

      try {
        console.log(`Sending reminder to ${phone} (Doc ID: ${doc.id})...`);
        await sendWhatsAppMessage(phone, message);

        await doc.ref.update({
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Successfully sent and marked reminder ${doc.id} as sent.`);
      } catch (err) {
        console.error(`Failed to send reminder ${doc.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Error querying Firestore collection:", error.message);
    throw error;
  }
}

processReminders()
  .then(() => {
    console.log("Reminder check completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unhandled fatal error during execution:", error);
    process.exit(1);
  });
