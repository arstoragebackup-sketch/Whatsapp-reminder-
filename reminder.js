const admin = require("firebase-admin");

console.log("=== PARSING GITHUB SERVICE ACCOUNT SECRET ===");

let serviceAccount;
try {
  const rawSecret = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawSecret) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret environment variable is empty.");
  }
  
  // Parse the JSON string from GitHub secrets
  const parsed = JSON.parse(rawSecret);

  // Explicitly map out the required properties
  serviceAccount = {
    projectId: parsed.project_id || parsed.projectId,
    clientEmail: parsed.client_email || parsed.clientEmail,
    privateKey: parsed.private_key || parsed.privateKey,
  };

  console.log("Mapped Project ID:", serviceAccount.projectId ? "EXISTS" : "MISSING");
  console.log("Mapped Client Email:", serviceAccount.clientEmail ? "EXISTS" : "MISSING");
  console.log("Mapped Private Key Length:", serviceAccount.privateKey ? serviceAccount.privateKey.length : 0);

} catch (error) {
  console.error("Fatal Error: Failed to parse or map FIREBASE_SERVICE_ACCOUNT JSON:", error.message);
  process.exit(1);
}

const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

if (!whatsappToken || !phoneNumberId) {
  console.error("Fatal Error: Missing WhatsApp Token or Phone Number ID in GitHub Secrets.");
  process.exit(1);
}

// Initialize Firebase Admin SDK safely
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
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
      } cmatch (err) {
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
                      
