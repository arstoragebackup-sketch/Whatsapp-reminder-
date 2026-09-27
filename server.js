require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const cron = require("node-cron");

const app = express();

app.use(express.json());
app.use(express.static("public"));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const clinics = [
    "Revive Dental & Implant Center",
    "AR Plastic Surgery",
    "Ayodhya Hospital",
    "Dhruva Hospital"
];

const services = [
    "Surgery",
    "Appointment",
    "Review",
    "Dressing",
    "Follow-up",
    "Procedure"
];

const IST_OFFSET = "+05:30";

function appointmentISO(date, time) {
    return new Date(
        `${date}T${time}:00${IST_OFFSET}`
    );
}

function normalizePhone(phone) {
    return String(phone).replace(/\D/g, "");
}


// GET CLINICS

app.get("/api/clinics", (req, res) => {
    res.json(clinics);
});


// GET APPOINTMENTS

app.get("/api/appointments", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("appointments")
            .select("*, clinics(name), reminders(*)")
            .order("appointment_date", {
                ascending: true
            });

        if (error) throw error;

        res.json(data);
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});


// ADD APPOINTMENT

app.post("/api/appointments", async (req, res) => {
    try {
        const {
            patient_name,
            age,
            phone,
            clinic,
            service,
            appointment_date,
            appointment_time
        } = req.body;

        if (
            !patient_name ||
            age === "" ||
            age === undefined ||
            !phone ||
            !clinic ||
            !service ||
            !appointment_date ||
            !appointment_time
        ) {
            return res.status(400).json({
                error: "Please complete all fields."
            });
        }

        if (!clinics.includes(clinic)) {
            return res.status(400).json({
                error: "Invalid clinic."
            });
        }

        if (!services.includes(service)) {
            return res.status(400).json({
                error: "Invalid service."
            });
        }

        const patientAge = Number(age);
        const phoneNumber = normalizePhone(phone);

        if (
            !Number.isInteger(patientAge) ||
            patientAge < 0 ||
            patientAge > 120
        ) {
            return res.status(400).json({
                error: "Enter a valid age."
            });
        }

        if (!/^\d{10,15}$/.test(phoneNumber)) {
            return res.status(400).json({
                error: "Enter a valid phone number with country code."
            });
        }

        const appointmentDateTime = appointmentISO(
            appointment_date,
            appointment_time
        );

        if (Number.isNaN(appointmentDateTime.getTime())) {
            return res.status(400).json({
                error: "Invalid appointment date or time."
            });
        }

        if (appointmentDateTime <= new Date()) {
            return res.status(400).json({
                error: "Appointment must be in the future."
            });
        }

        const { data: clinicData, error: clinicError } =
            await supabase
                .from("clinics")
                .select("id")
                .eq("name", clinic)
                .single();

        if (clinicError) throw clinicError;

        const { data: appointment, error } =
            await supabase
                .from("appointments")
                .insert({
                    patient_name,
                    age: patientAge,
                    phone: phoneNumber,
                    clinic_id: clinicData.id,
                    service,
                    appointment_date,
                    appointment_time
                })
                .select()
                .single();

        if (error) throw error;

        // Schedule reminders 24 hours and 2 hours before.
        const reminderOffsets = [
            24 * 60 * 60 * 1000,
            2 * 60 * 60 * 1000
        ];

        const reminders = reminderOffsets
            .map(offset => ({
                appointment_id: appointment.id,
                scheduled_at: new Date(
                    appointmentDateTime.getTime() - offset
                ).toISOString(),
                status: "pending"
            }))
            .filter(reminder =>
                new Date(reminder.scheduled_at) > new Date()
            );

        if (reminders.length) {
            const { error: reminderError } = await supabase
                .from("reminders")
                .insert(reminders);

            if (reminderError) {
                await supabase
                    .from("appointments")
                    .delete()
                    .eq("id", appointment.id);

                throw reminderError;
            }
        }

        res.json({
            success: true,
            appointment
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not save appointment."
        });
    }
});


// EDIT APPOINTMENT

app.put("/api/appointments/:id", async (req, res) => {
    try {
        const {
            patient_name,
            age,
            phone,
            clinic,
            service,
            appointment_date,
            appointment_time
        } = req.body;

        if (
            !patient_name ||
            age === "" ||
            age === undefined ||
            !phone ||
            !clinic ||
            !service ||
            !appointment_date ||
            !appointment_time
        ) {
            return res.status(400).json({
                error: "Please complete all fields."
            });
        }

        if (!clinics.includes(clinic) ||
            !services.includes(service)) {
            return res.status(400).json({
                error: "Invalid clinic or service."
            });
        }

        const patientAge = Number(age);
        const phoneNumber = normalizePhone(phone);

        if (
            !Number.isInteger(patientAge) ||
            patientAge < 0 ||
            patientAge > 120 ||
            !/^\d{10,15}$/.test(phoneNumber)
        ) {
            return res.status(400).json({
                error: "Invalid age or phone number."
            });
        }

        const dateTime = appointmentISO(
            appointment_date,
            appointment_time
        );

        if (
            Number.isNaN(dateTime.getTime()) ||
            dateTime <= new Date()
        ) {
            return res.status(400).json({
                error: "Choose a future appointment."
            });
        }

        const { data: clinicData, error: clinicError } =
            await supabase
                .from("clinics")
                .select("id")
                .eq("name", clinic)
                .single();

        if (clinicError) throw clinicError;

        const { data: appointment, error } =
            await supabase
                .from("appointments")
                .update({
                    patient_name,
                    age: patientAge,
                    phone: phoneNumber,
                    clinic_id: clinicData.id,
                    service,
                    appointment_date,
                    appointment_time
                })
                .eq("id", req.params.id)
                .eq("status", "scheduled")
                .select()
                .single();

        if (error) throw error;

        // Cancel old pending reminders.
        const { error: cancelError } = await supabase
            .from("reminders")
            .update({ status: "cancelled" })
            .eq("appointment_id", appointment.id)
            .eq("status", "pending");

        if (cancelError) throw cancelError;

        // Create reminders for the revised appointment.
        const offsets = [
            24 * 60 * 60 * 1000,
            2 * 60 * 60 * 1000
        ];

        const reminders = offsets
            .map(offset => ({
                appointment_id: appointment.id,
                scheduled_at: new Date(
                    dateTime.getTime() - offset
                ).toISOString(),
                status: "pending"
            }))
            .filter(r => new Date(r.scheduled_at) > new Date());

        if (reminders.length) {
            const { error: reminderError } = await supabase
                .from("reminders")
                .insert(reminders);

            if (reminderError) throw reminderError;
        }

        res.json({ success: true, appointment });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not update appointment."
        });
    }
});


// CANCEL APPOINTMENT

app.delete("/api/appointments/:id", async (req, res) => {
    try {
        const { error } = await supabase
            .from("appointments")
            .update({ status: "cancelled" })
            .eq("id", req.params.id);

        if (error) throw error;

        const { error: reminderError } = await supabase
            .from("reminders")
            .update({ status: "cancelled" })
            .eq("appointment_id", req.params.id)
            .eq("status", "pending");

        if (reminderError) throw reminderError;

        res.json({ success: true });

    } catch (error) {
        res.status(500).json({
            error: "Could not cancel appointment."
        });
    }
});


// SEND WHATSAPP TEMPLATE

async function sendWhatsApp(appointment) {
    const url =
        `https://graph.facebook.com/` +
        `${process.env.GRAPH_API_VERSION}/` +
        `${process.env.PHONE_NUMBER_ID}/messages`;

    const response = await axios.post(
        url,
        {
            messaging_product: "whatsapp",
            to: appointment.phone,
            type: "template",
            template: {
                name: process.env.WHATSAPP_TEMPLATE,
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            {
                                type: "text",
                                text: appointment.patient_name
                            },
                            {
                                type: "text",
                                text: appointment.clinics.name
                            },
                            {
                                type: "text",
                                text: appointment.appointment_date
                            },
                            {
                                type: "text",
                                text: appointment.appointment_time
                            }
                        ]
                    }
                ]
            }
        },
        {
            headers: {
                Authorization:
                    `Bearer ${process.env.WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data.messages?.[0]?.id;
}


// REMINDER SCHEDULER

async function processReminders() {
    const { data: reminders, error } = await supabase
        .from("reminders")
        .select(
            "*, appointments(*, clinics(name))"
        )
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(20);

    if (error) {
        console.error("Reminder lookup failed:", error);
        return;
    }

    for (const reminder of reminders || []) {
        const appointment = reminder.appointments;

        if (!appointment || appointment.status !== "scheduled") {
            await supabase
                .from("reminders")
                .update({ status: "cancelled" })
                .eq("id", reminder.id)
                .eq("status", "pending");

            continue;
        }

        // Claim the reminder to avoid concurrent processing.
        const { data: claimed, error: claimError } = await supabase
            .from("reminders")
            .update({ status: "sending" })
            .eq("id", reminder.id)
            .eq("status", "pending")
            .select()
            .maybeSingle();

        if (claimError || !claimed) continue;

        try {
            const messageId = await sendWhatsApp(appointment);

            await supabase
                .from("reminders")
                .update({
                    status: "sent",
                    whatsapp_message_id: messageId || null,
                    sent_at: new Date().toISOString()
                })
                .eq("id", reminder.id);

        } catch (error) {
            console.error(
                "WhatsApp send failed:",
                error.response?.data || error.message
            );

            await supabase
                .from("reminders")
                .update({
                    status: "failed",
                    error_message: JSON.stringify(
                        error.response?.data || error.message
                    ).slice(0, 1000)
                })
                .eq("id", reminder.id);
        }
    }
}

cron.schedule("* * * * *", processReminders);

app.listen(process.env.PORT || 3000, () => {
    console.log("WhatsApp reminder system running");
});