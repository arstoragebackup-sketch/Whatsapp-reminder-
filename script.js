const form = document.getElementById("patientForm");
const appointmentsBox = document.getElementById("appointments");
const message = document.getElementById("message");

let editingId = null;
let appointmentCache = [];

function showMessage(text, success = true) {
    message.textContent = text;
    message.style.color = success ? "green" : "red";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}


// SAVE OR UPDATE APPOINTMENT

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = {
        patient_name:
            document.getElementById("patientName").value.trim(),

        age:
            document.getElementById("age").value,

        phone:
            document.getElementById("phone").value.trim(),

        clinic:
            document.getElementById("clinic").value,

        service:
            document.getElementById("service").value,

        appointment_date:
            document.getElementById("date").value,

        appointment_time:
            document.getElementById("time").value
    };

    const button = document.getElementById("saveButton");
    button.disabled = true;

    try {
        const url = editingId
            ? `/api/appointments/${editingId}`
            : "/api/appointments";

        const response = await fetch(url, {
            method: editingId ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Unable to save.");
        }

        showMessage(
            editingId
                ? "Appointment updated successfully."
                : "Appointment saved and reminders scheduled."
        );

        form.reset();
        editingId = null;

        document.getElementById("formTitle").textContent =
            "Add Patient Appointment";

        button.textContent = "Save Appointment";

        document.getElementById("cancelEdit")
            .classList.add("hidden");

        await loadAppointments();

    } catch (error) {
        showMessage(error.message, false);
    } finally {
        button.disabled = false;
    }
});


// LOAD APPOINTMENTS

async function loadAppointments() {
    appointmentsBox.textContent = "Loading...";

    try {
        const response = await fetch("/api/appointments");

        if (!response.ok) {
            throw new Error("Unable to load appointments.");
        }

        appointmentCache = await response.json();
        renderAppointments();

    } catch (error) {
        appointmentsBox.textContent = error.message;
    }
}


// DISPLAY APPOINTMENTS

function renderAppointments() {
    const clinicFilter =
        document.getElementById("clinicFilter").value;

    const dateFilter =
        document.getElementById("dateFilter").value;

    const filtered = appointmentCache.filter(item => {
        const clinicName = item.clinics?.name || "";

        return (
            item.status !== "cancelled" &&
            (!clinicFilter || clinicName === clinicFilter) &&
            (!dateFilter || item.appointment_date === dateFilter)
        );
    });

    if (!filtered.length) {
        appointmentsBox.textContent = "No appointments found.";
        return;
    }

    appointmentsBox.innerHTML = filtered.map(item => {
        const reminders = item.reminders || [];

        const reminderStatus = reminders.length
            ? reminders.map(r =>
                `${escapeHTML(r.status)}`
              ).join(", ")
            : "No upcoming reminders";

        return `
            <div class="appointment">
                <h3>${escapeHTML(item.patient_name)}</h3>

                <p><b>Age:</b> ${escapeHTML(item.age)}</p>
                <p><b>Phone:</b> ${escapeHTML(item.phone)}</p>
                <p><b>Clinic:</b> ${escapeHTML(item.clinics?.name)}</p>
                <p><b>Service:</b> ${escapeHTML(item.service)}</p>
                <p><b>Date:</b> ${escapeHTML(item.appointment_date)}</p>
                <p><b>Time:</b> ${escapeHTML(item.appointment_time)}</p>
                <p><b>Reminders:</b> ${reminderStatus}</p>

                <span class="status">
                    ${escapeHTML(item.status)}
                </span>

                <div class="actions">
                    <button onclick="editAppointment('${item.id}')">
                        Edit
                    </button>

                    <button class="danger"
                        onclick="cancelAppointment('${item.id}')">
                        Cancel
                    </button>
                </div>
            </div>
        `;
    }).join("");
}


// EDIT APPOINTMENT

function editAppointment(id) {
    const item = appointmentCache.find(a => a.id === id);

    if (!item) return;

    editingId = id;

    document.getElementById("patientName").value =
        item.patient_name;

    document.getElementById("age").value = item.age;

    document.getElementById("phone").value = item.phone;

    document.getElementById("clinic").value =
        item.clinics?.name || "";

    document.getElementById("service").value =
        item.service;

    document.getElementById("date").value =
        item.appointment_date;

    document.getElementById("time").value =
        item.appointment_time.slice(0, 5);

    document.getElementById("formTitle").textContent =
        "Edit Appointment";

    document.getElementById("saveButton").textContent =
        "Update Appointment";

    document.getElementById("cancelEdit")
        .classList.remove("hidden");

    window.scrollTo({ top: 0, behavior: "smooth" });
}


// CANCEL APPOINTMENT

async function cancelAppointment(id) {
    if (!confirm("Cancel this appointment and its pending reminders?")) {
        return;
    }

    try {
        const response = await fetch(
            `/api/appointments/${id}`,
            { method: "DELETE" }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Cancellation failed.");
        }

        showMessage("Appointment cancelled.");
        await loadAppointments();

    } catch (error) {
        showMessage(error.message, false);
    }
}


// CANCEL EDITING

document.getElementById("cancelEdit")
    .addEventListener("click", () => {
        editingId = null;
        form.reset();

        document.getElementById("formTitle").textContent =
            "Add Patient Appointment";

        document.getElementById("saveButton").textContent =
            "Save Appointment";

        document.getElementById("cancelEdit")
            .classList.add("hidden");
    });


// FILTERS AND REFRESH

document.getElementById("clinicFilter")
    .addEventListener("change", renderAppointments);

document.getElementById("dateFilter")
    .addEventListener("change", renderAppointments);

document.getElementById("refreshButton")
    .addEventListener("click", loadAppointments);


// INITIAL LOAD

loadAppointments();