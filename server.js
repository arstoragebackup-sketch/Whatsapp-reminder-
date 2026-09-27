require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WHATSAPP_TOKEN', 'PHONE_NUMBER_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
const TEMPLATE = process.env.WHATSAPP_TEMPLATE || 'upcoming_treatment_reminder';
const LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v22.0';
const PORT = Number(process.env.PORT || 3000);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CLINICS = ['Revive Dental & Implant Center', 'AR Plastic Surgery', 'Ayodhya Hospital', 'Dhruva Hospital'];
const SERVICES = ['Surgery', 'Appointment', 'Review', 'Dressing', 'Follow-up', 'Procedure'];
const OFFSETS = [24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000];
const IST = '+05:30';

function appointmentDateTime(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00${IST}`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject normalized invalid calendar dates/times.
  if (d.toISOString().slice(0, 10) !== date || d.toISOString().slice(11, 16) !== time) return null;
  return d;
}
function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function validate(body) {
  const { patient_name, age, phone, clinic, service, appointment_date, appointment_time } = body || {};
  if (![patient_name, age, phone, clinic, service, appointment_date, appointment_time].every(v => v !== undefined && String(v).trim() !== '')) return 'Please complete all fields.';
  if (String(patient_name).trim().length > 120) return 'Patient name is too long.';
  if (!CLINICS.includes(clinic)) return 'Invalid clinic.';
  if (!SERVICES.includes(service)) return 'Invalid service.';
  const a = Number(age);
  if (!Number.isInteger(a) || a < 0 || a > 120) return 'Enter a valid age.';
  if (!/^\d{10,15}$/.test(normalizePhone(phone))) return 'Enter a valid WhatsApp number with country code (digits only, 10–15 digits).';
  const dt = appointmentDateTime(appointment_date, appointment_time);
  if (!dt) return 'Invalid appointment date or time.';
  if (dt <= new Date()) return 'Appointment must be in the future.';
  return null;
}
async function getClinicId(name) {
  const { data, error } = await supabase.from('clinics').select('id').eq('name', name).single();
  if (error) throw error;
  return data.id;
}
async function createReminders(appointment, dt) {
  const now = Date.now();
  const rows = OFFSETS.map((offset, index) => ({
    appointment_id: appointment.id,
    reminder_type: index === 0 ? '24h' : '2h',
    scheduled_at: new Date(dt.getTime() - offset).toISOString(),
    status: 'pending'
  })).filter(row => new Date(row.scheduled_at).getTime() > now);
  if (!rows.length) return;
  const { error } = await supabase.from('reminders').insert(rows);
  if (error) throw error;
}

app.get('/api/clinics', (_req, res) => res.json(CLINICS));
app.get('/api/appointments', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('appointments')
      .select('*, clinics(name), reminders(*)')
      .order('appointment_date', { ascending: true }).order('appointment_time', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load appointments. Check the Supabase tables and relationship.' }); }
});

app.post('/api/appointments', async (req, res) => {
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  let appointment;
  try {
    const b = req.body;
    const clinic_id = await getClinicId(b.clinic);
    const { data, error } = await supabase.from('appointments').insert({
      patient_name: String(b.patient_name).trim(), age: Number(b.age), phone: normalizePhone(b.phone),
      clinic_id, service: b.service, appointment_date: b.appointment_date,
      appointment_time: b.appointment_time, status: 'scheduled'
    }).select().single();
    if (error) throw error;
    appointment = data;
    await createReminders(appointment, appointmentDateTime(b.appointment_date, b.appointment_time));
    res.status(201).json({ success: true, appointment });
  } catch (e) {
    console.error('Create appointment failed:', e);
    if (appointment?.id) await supabase.from('appointments').delete().eq('id', appointment.id);
    res.status(500).json({ error: 'Could not save appointment. Check database setup and server logs.' });
  }
});

app.put('/api/appointments/:id', async (req, res) => {
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const b = req.body;
    const clinic_id = await getClinicId(b.clinic);
    const { data: appointment, error } = await supabase.from('appointments').update({
      patient_name: String(b.patient_name).trim(), age: Number(b.age), phone: normalizePhone(b.phone),
      clinic_id, service: b.service, appointment_date: b.appointment_date,
      appointment_time: b.appointment_time
    }).eq('id', req.params.id).eq('status', 'scheduled').select().maybeSingle();
    if (error) throw error;
    if (!appointment) return res.status(404).json({ error: 'Scheduled appointment not found.' });
    const { error: cancelError } = await supabase.from('reminders').update({ status: 'cancelled' })
      .eq('appointment_id', appointment.id).in('status', ['pending', 'failed']);
    if (cancelError) throw cancelError;
    await createReminders(appointment, appointmentDateTime(b.appointment_date, b.appointment_time));
    res.json({ success: true, appointment });
  } catch (e) { console.error('Update appointment failed:', e); res.status(500).json({ error: 'Could not update appointment. Check server logs.' }); }
});

app.delete('/api/appointments/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('appointments').update({ status: 'cancelled' })
      .eq('id', req.params.id).eq('status', 'scheduled').select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Scheduled appointment not found.' });
    const { error: reminderError } = await supabase.from('reminders').update({ status: 'cancelled' })
      .eq('appointment_id', req.params.id).in('status', ['pending', 'failed']);
    if (reminderError) throw reminderError;
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not cancel appointment.' }); }
});

async function sendWhatsApp(appointment) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
  const response = await axios.post(url, {
    messaging_product: 'whatsapp', to: appointment.phone, type: 'template',
    template: {
      name: TEMPLATE,
      language: { code: LANGUAGE },
      components: [{ type: 'body', parameters: [
        { type: 'text', text: appointment.patient_name },
        { type: 'text', text: appointment.clinics.name },
        { type: 'text', text: appointment.appointment_date },
        { type: 'text', text: String(appointment.appointment_time).slice(0, 5) }
      ] }]
    }
  }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 20000 });
  return response.data.messages?.[0]?.id || null;
}

let processing = false;
async function processReminders() {
  if (processing) return;
  processing = true;
  try {
    const { data: due, error } = await supabase.from('reminders')
      .select('*, appointments(*, clinics(name))').eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(20);
    if (error) throw error;
    for (const reminder of due || []) {
      const appointment = reminder.appointments;
      if (!appointment || appointment.status !== 'scheduled') {
        await supabase.from('reminders').update({ status: 'cancelled' }).eq('id', reminder.id).eq('status', 'pending');
        continue;
      }
      const { data: claimed, error: claimError } = await supabase.from('reminders')
        .update({ status: 'sending', attempts: (reminder.attempts || 0) + 1 })
        .eq('id', reminder.id).eq('status', 'pending').select('id').maybeSingle();
      if (claimError || !claimed) continue;
      try {
        const messageId = await sendWhatsApp(appointment);
        const { error: sentError } = await supabase.from('reminders').update({
          status: 'sent', whatsapp_message_id: messageId, sent_at: new Date().toISOString(), error_message: null
        }).eq('id', reminder.id);
        if (sentError) console.error('Could not update sent status:', sentError);
      } catch (e) {
        const details = e.response?.data || e.message;
        console.error('WhatsApp send failed:', details);
        await supabase.from('reminders').update({ status: 'failed', error_message: JSON.stringify(details).slice(0, 1000) }).eq('id', reminder.id);
      }
    }
  } catch (e) { console.error('Reminder scheduler error:', e); }
  finally { processing = false; }
}
cron.schedule('* * * * *', processReminders, { timezone: 'Asia/Kolkata' });
app.listen(PORT, () => console.log(`Reminder system running on port ${PORT}; template: ${TEMPLATE} (${LANGUAGE})`));
