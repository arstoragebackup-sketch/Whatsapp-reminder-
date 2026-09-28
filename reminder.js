const admin = require("firebase-admin");

// ===============================
// Firebase configuration
// ===============================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ===============================
// WhatsApp configuration
// ===============================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ WhatsApp environment variables are missing.");
  process.exit(1);
}

// ===============================
// Send WhatsApp message
// ===============================
async function sendWhatsAppMessage(phoneNumber, message) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phoneNumber,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ WhatsApp API error:", data);
      return false;
    }

    console.log("✅ WhatsApp message sent:", phoneNumber);
    return true;
  } catch (error) {
    console.error("❌ WhatsApp request failed:", error);
    return false;
  }
}

// ===============================
// Main reminder function
// ===============================
async function sendReminders() {
  console.log("🔄 Checking reminders...");

  try {
    const snapshot = await db.collection("reminders").get();

    if (snapshot.empty) {
      console.log("ℹ️ No reminders found.");
      return;
    }

    const now = new Date();

    for (const doc of snapshot.docs) {
      const reminder = doc.data();

      console.log(`📋 Checking reminder: ${doc.id}`);

      // Expected Firestore fields:
      // phone
      // message
      // reminderTime
      // sent

      if (!reminder.phone || !reminder.message || !reminder.reminderTime) {
        console.log(`⚠️ Skipping ${doc.id}: missing required fields.`);
        continue;
      }

      // Don't send already-sent reminders
      if (reminder.sent === true) {
        console.log(`✓ ${doc.id} already sent.`);
        continue;
      }

      let reminderDate;

      // Handle Firestore Timestamp
      if (
        reminder.reminderTime &&
        typeof reminder.reminderTime.toDate === "function"
      ) {
        reminderDate = reminder.reminderTime.toDate();
      } else {
        reminderDate = new Date(reminder.reminderTime);
      }

      if (isNaN(reminderDate.getTime())) {
        console.log(`⚠️ Invalid reminder time for ${doc.id}`);
        continue;
      }

      // Check whether reminder time has arrived
      if (reminderDate <= now) {
        console.log(`📲 Sending reminder for ${doc.id}...`);

        const success = await sendWhatsAppMessage(
          reminder.phone,
          reminder.message
        );

        if (success) {
          await db.collection("reminders").doc(doc.id).update({
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`✅ Reminder ${doc.id} marked as sent.`);
        }
      } else {
        console.log(
          `⏳ Reminder ${doc.id} is scheduled for ${reminderDate.toISOString()}`
        );
      }
    }

    console.log("✅ Reminder check completed.");
  } catch (error) {
    console.error("❌ Error checking reminders:", error);
    process.exit(1);
  }
}

// ===============================
// Run
// ===============================
sendReminders()
  .then(() => {
    console.log("🏁 Finished.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
