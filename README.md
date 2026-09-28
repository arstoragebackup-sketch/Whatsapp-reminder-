# Clinic WhatsApp Reminders

This repository runs the appointment reminder checker with GitHub Actions.

It reads booked appointments from Firebase Firestore and sends:
- 24-hour WhatsApp reminders
- 2-hour WhatsApp reminders

Credentials are supplied through GitHub Actions Secrets.

Required secrets:
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- WHATSAPP_TOKEN
- PHONE_NUMBER_ID

Do not put real credentials in source files.
