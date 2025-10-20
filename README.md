# THRU ZIM Booking System

A Node.js/Express booking system for equipment and vehicle reservations.

## Features

- Equipment booking (rooms, projectors, audio equipment, vehicles)
- Vehicle availability tracking
- Admin dashboard
- Email notifications for new bookings
- Calendar integration (Google Calendar, Outlook, iCal)

## Email Notifications Setup

To receive email notifications when new bookings are made:

### 1. Create Environment File
Create a `.env` file in the project root:

```bash
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
NOTIFICATION_EMAIL=admin@yourcompany.com
```

### 2. Gmail Setup
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account Settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
   - Use this password (not your regular Gmail password)

### 3. Configure Variables
- `EMAIL_USER`: Your Gmail address
- `EMAIL_PASS`: The App Password from step 2
- `NOTIFICATION_EMAIL`: Email address to receive booking notifications

### 4. Test
After setup, restart the server and submit a test booking. Check the server console for "Booking notification email sent successfully".

## Deployment on Render

1. Connect GitHub repository to Render
2. Add environment variables in Render dashboard:
   - `EMAIL_USER`
   - `EMAIL_PASS` 
   - `NOTIFICATION_EMAIL`
3. Deploy with:
   - Build Command: `npm install`
   - Start Command: `node server.js`

## Local Development

```bash
npm install
npm start
```

Server runs on http://localhost:3000
