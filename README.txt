MULTI-CLINIC WHATSAPP APPOINTMENT REMINDER SYSTEM

FILES
- server.js: backend API and automatic reminder scheduler
- public/index.html, public/style.css, public/script.js: dashboard
- database.sql: Supabase tables and four clinic records
- .env.example: required environment variables

TEMPLATE REQUIREMENT
The backend uses the approved WhatsApp template name:
upcoming_treatment_reminder
Language: en
It sends exactly four BODY parameters, in this order:
1. Patient name
2. Clinic name
3. Appointment date (YYYY-MM-DD)
4. Appointment time (HH:MM)
Your approved Meta template must have exactly four body placeholders in that order and use language code en. If the approved template differs, update the code/environment to match it exactly.

SETUP
1. Install Node.js 18 or newer.
2. Create a Supabase project. In SQL Editor, run database.sql once.
3. Copy .env.example to .env and fill in your Supabase URL, service-role key, Meta access token, and WhatsApp Phone Number ID. Never share or commit .env.
4. Confirm the Meta WhatsApp template is approved and matches the name, language, and four parameters above.
5. In this folder run: npm install
6. Run: npm start
7. Open http://localhost:3000

REMINDER BEHAVIOR
The scheduler checks every minute. It creates reminders at 24 hours and 2 hours before the appointment, but only if that reminder time is still in the future when the appointment is saved/edited. A reminder is marked sent when Meta accepts the message request; this code does not confirm handset delivery/read receipts. Failed sends are marked failed and are not automatically retried.

IMPORTANT SECURITY / HOSTING
This starter dashboard has no login or user authentication. Do not expose it publicly or enter real patient data until access control, HTTPS, privacy safeguards, and deployment security are added. Keep the server running continuously on a persistent Node.js host; serverless/static hosting will not reliably run the minute scheduler. Use a separate production-ready authentication layer before public deployment.
