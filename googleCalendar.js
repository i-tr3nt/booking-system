const { google } = require('googleapis');
const path = require('path');

// Load credentials from the credentials.json file
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function getAuthClient() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: SCOPES,
        });
        return auth;
    } catch (error) {
        console.error('Error creating auth client:', error);
        throw error;
    }
}

async function addBookingToCalendar(booking) {
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });

        // Format the event details
        const event = {
            summary: `Booking: ${booking.serviceName}`,
            description: `Customer: ${booking.customerName}\nPhone: ${booking.phone}\nEmail: ${booking.email}\nNotes: ${booking.notes || 'No notes'}`,
            start: {
                dateTime: booking.date,
                timeZone: 'UTC',
            },
            end: {
                dateTime: new Date(new Date(booking.date).getTime() + booking.duration * 60000).toISOString(),
                timeZone: 'UTC',
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 30 },
                ],
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        return response.data;
    } catch (error) {
        console.error('Error adding event to calendar:', error);
        throw error;
    }
}

module.exports = {
    addBookingToCalendar
}; 