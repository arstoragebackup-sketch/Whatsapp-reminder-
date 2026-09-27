-- Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

insert into public.clinics (name) values
  ('Revive Dental & Implant Center'),
  ('AR Plastic Surgery'),
  ('Ayodhya Hospital'),
  ('Dhruva Hospital')
on conflict (name) do nothing;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_name text not null,
  age integer not null check (age between 0 and 120),
  phone text not null,
  clinic_id uuid not null references public.clinics(id),
  service text not null check (service in ('Surgery','Appointment','Review','Dressing','Follow-up','Procedure')),
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('24h','2h')),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  whatsapp_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_idx on public.reminders(status, scheduled_at);
create index if not exists appointments_date_idx on public.appointments(appointment_date, appointment_time);
