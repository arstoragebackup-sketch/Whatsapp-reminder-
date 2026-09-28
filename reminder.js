const admin = require("firebase-admin");

// Hardcoded verified credentials as a foolproof fallback
let serviceAccount = {
  projectId: "clinic-appointment-reminder",
  clientEmail: "firebase-adminsdk-fbsvc@clinic-appointment-reminder.iam.gserviceaccount.com",
};

// Try loading private key from GitHub Secrets (either JSON secret or individual private key)
let privateKey = "";

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (parsed.private_key) {
      privateKey = parsed.private_key;
    }
  } catch (e) {
    console.log("Could not parse FIREBASE_SERVICE_ACCOUNT as JSON, trying individual key...");
  }
}

if (!privateKey && process.env.FIREBASE_PRIVATE_KEY) {
  privateKey = process.env.FIREBASE_PRIVATE_KEY;
}

// Clean the private key formatting
if (privateKey) {
  privateKey = privateKey.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
}

console.log("=== FINAL INITIALIZATION CHECK ===");
console.log("Project ID:", serviceAccount.projectId);
console.log("Client Email:", serviceAccount.clientEmail);
console.log("Private Key Loaded:", !!privateKey);
console.log("Private Key Length:", privateKey ? privateKey.length : 0);
console.log("==================================");

if (!privateKey) {
  console.error("Fatal Error: Private key could not be loaded from GitHub Secrets.");
  process.exit(1);
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: privateKey,
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
  const whatsappToken = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
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
