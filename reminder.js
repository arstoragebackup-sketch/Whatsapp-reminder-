const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
    privateKey: process.env.FIREBASE_PRIVATE_KEY
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .trim(),

const db = admin.firestore();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TEMPLATE_NAME = "upcoming-treatment-reminder";
const TEMPLATE_LANGUAGE = "en_US";

async function sendWhatsAppMessage(
    phone,
    patientName,
    clinicName,
    appointmentDate,
    appointmentTime,
) {
  const url =
    `https://graph.facebook.com/v23.0/` +
    `${PHONE_NUMBER_ID}/messages`;

  const message = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: {code: TEMPLATE_LANGUAGE},
      components: [{
        type: "body",
        parameters: [
          {type: "text", text: patientName},
          {type: "text", text: clinicName},
          {type: "text", text: appointmentDate},
          {type: "text", text: appointmentTime},
        ],
      }],
    },
  };

  const response = await axios.post(url, message, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  return response.data;
}

async function checkReminders() {
  const now = new Date();

  const snapshot = await db
      .collection("appointments")
      .where("status", "==", "booked")
      .get();

  console.log(`Found ${snapshot.size} booked appointments.`);

  for (const appointmentDoc of snapshot.docs) {
    const appointment = appointmentDoc.data();

    if (!appointment.appointmentDate ||
        !appointment.appointmentTime ||
        !appointment.phone) {
      continue;
    }

    const appointmentDateTime = new Date(
        `${appointment.appointmentDate}T` +
        `${appointment.appointmentTime}:00+05:30`,
    );

    const differenceMinutes =
      (appointmentDateTime.getTime() - now.getTime()) / 60000;

    let reminderType = null;

    if (differenceMinutes >= 1435 && differenceMinutes <= 1445) {
      reminderType = "24h";
    }

    if (differenceMinutes >= 115 && differenceMinutes <= 125) {
      reminderType = "2h";
    }

    if (!reminderType) continue;

    const reminderId = `${appointmentDoc.id}_${reminderType}`;
    const reminderRef = db.collection("reminders").doc(reminderId);
    const reminderDoc = await reminderRef.get();

    if (reminderDoc.exists) continue;

    try {
      await sendWhatsAppMessage(
          appointment.phone,
          appointment.patientName,
          appointment.clinicName,
          appointment.appointmentDate,
          appointment.appointmentTime,
      );

      await reminderRef.set({
        appointmentId: appointmentDoc.id,
        type: reminderType,
        phone: appointment.phone,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
          `Sent ${reminderType} reminder to ${appointment.patientName}`,
      );
    } catch (error) {
      console.error(
          `Failed to send ${reminderType} reminder:`,
          error.response?.data || error.message,
      );
    }
  }
}

checkReminders()
    .then(() => console.log("Reminder check completed."))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
