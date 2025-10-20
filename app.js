const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const path = require('path');
const ExcelJS = require('exceljs');
const { parse } = require('json2csv');
const nodemailer = require('nodemailer');
const { addBookingToCalendar } = require('./googleCalendar');

const app = express();
const port = process.env.PORT || 3000;

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your-email@gmail.com', // Replace with your Gmail address
        pass: 'your-app-password' // Replace with your Gmail app password
    }
});

// Function to send booking notification email
async function sendBookingNotification(booking) {
    const emailTemplate = `
        <h2>New Booking Notification</h2>
        <p>A new booking has been made with the following details:</p>
        <ul>
            <li><strong>Project Name:</strong> ${booking.projectName}</li>
            <li><strong>Booked By:</strong> ${booking.bookedBy}</li>
            <li><strong>Event Date:</strong> ${moment(booking.eventDate).format('DD/MM/YYYY')}</li>
            <li><strong>Time:</strong> ${moment(booking.startTime, 'HH:mm').format('HH:mm')} - ${moment(booking.endTime, 'HH:mm').format('HH:mm')}</li>
            <li><strong>Equipment:</strong> ${booking.equipment}</li>
        </ul>
        <p>This booking was submitted on ${moment(booking.dateSubmitted).format('DD/MM/YYYY [at] HH:mm')}</p>
    `;

    const mailOptions = {
        from: 'your-email@gmail.com', // Replace with your Gmail address
        to: 'takudzatrenttaderera@gmail.com',
        subject: `New Equipment Booking: ${booking.projectName}`,
        html: emailTemplate
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Booking notification email sent successfully');
    } catch (error) {
        console.error('Error sending booking notification email:', error);
    }
}

// Function to generate calendar links
function generateCalendarLinks(booking) {
    const startDateTime = moment(`${booking.eventDate}T${booking.startTime}`).format('YYYYMMDDTHHmmss');
    const endDateTime = moment(`${booking.eventDate}T${booking.endTime}`).format('YYYYMMDDTHHmmss');
    
    // Format description with booking details
    const description = `Project: ${booking.projectName}\nBooked By: ${booking.bookedBy}\nEquipment: ${booking.equipment}`;
    
    // Google Calendar link
    const googleCalendarLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(booking.projectName)}&dates=${startDateTime}/${endDateTime}&details=${encodeURIComponent(description)}`;
    
    // Outlook Calendar link
    const outlookCalendarLink = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(booking.projectName)}&startdt=${startDateTime}&enddt=${endDateTime}&body=${encodeURIComponent(description)}`;
    
    // iCal format
    const icalData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `DTSTART:${startDateTime}`,
        `DTEND:${endDateTime}`,
        `SUMMARY:${booking.projectName}`,
        `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    return {
        googleCalendarLink,
        outlookCalendarLink,
        icalData
    };
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Initialize SQLite database
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/bookings.db' : './bookings.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Create bookings table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            projectName TEXT NOT NULL,
            bookedBy TEXT NOT NULL,
            eventDate TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT NOT NULL,
            equipment TEXT NOT NULL,
            dateSubmitted TEXT NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err);
            } else {
                console.log('Bookings table ready');
            }
        });
    }
});

// Routes
app.get('/', (req, res) => {
    const today = moment().format('YYYY-MM-DD');
    
    db.all(`
        SELECT * FROM bookings 
        WHERE eventDate >= ? 
        ORDER BY eventDate ASC, startTime ASC
        LIMIT 5
    `, [today], (err, upcomingBookings) => {
        if (err) {
            console.error('Error fetching upcoming bookings:', err);
            upcomingBookings = [];
        }

        res.render('index', {
            upcomingBookings,
            showMessage: true,
            success: req.query.success === 'true',
            error: req.query.error === 'true'
        });
    });
});

// Events page route
app.get('/events', (req, res) => {
    const promises = [
        // Get upcoming events
        new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM bookings 
                WHERE date(eventDate) >= date('now') 
                ORDER BY eventDate ASC, startTime ASC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        }),
        // Get past events
        new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM bookings 
                WHERE date(eventDate) < date('now') 
                ORDER BY eventDate DESC, startTime DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    ];

    Promise.all(promises)
        .then(([upcomingRows, pastRows]) => {
            // Format dates for display
            const formatEvents = (events) => events.map(event => ({
                ...event,
                eventDate: moment(event.eventDate).format('DD/MM/YYYY'),
                startTime: moment(event.startTime, 'HH:mm').format('HH:mm'),
                endTime: moment(event.endTime, 'HH:mm').format('HH:mm')
            }));

            res.render('events', {
                upcomingEvents: formatEvents(upcomingRows),
                pastEvents: formatEvents(pastRows),
                moment: moment
            });
        })
        .catch(err => {
            console.error('Error fetching events:', err);
            res.render('events', { 
                upcomingEvents: [], 
                pastEvents: [],
                moment: moment
            });
        });
});

// Export events route
app.get('/export-events', async (req, res) => {
    try {
        // Get both upcoming and past events
        const [upcomingRows, pastRows] = await Promise.all([
            // Get upcoming events
            new Promise((resolve, reject) => {
                db.all(`
                    SELECT projectName, bookedBy, eventDate, startTime, endTime, equipment
                    FROM bookings 
                    WHERE date(eventDate) >= date('now')
                    ORDER BY eventDate ASC, startTime ASC
                `, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }),
            // Get past events
            new Promise((resolve, reject) => {
                db.all(`
                    SELECT projectName, bookedBy, eventDate, startTime, endTime, equipment
                    FROM bookings 
                    WHERE date(eventDate) < date('now')
                    ORDER BY eventDate DESC, startTime DESC
                `, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            })
        ]);

        // Format dates
        const formatRows = (rows) => rows.map(row => ({
            ...row,
            eventDate: moment(row.eventDate).format('DD/MM/YYYY'),
            startTime: moment(row.startTime, 'HH:mm').format('HH:mm'),
            endTime: moment(row.endTime, 'HH:mm').format('HH:mm')
        }));

        const formattedUpcomingRows = formatRows(upcomingRows);
        const formattedPastRows = formatRows(pastRows);

        const format = req.query.format || 'excel';

        switch (format) {
            case 'excel':
                // Create Excel workbook
                const workbook = new ExcelJS.Workbook();
                
                // Add Upcoming Events worksheet
                const upcomingWorksheet = workbook.addWorksheet('Upcoming Events');
                upcomingWorksheet.columns = [
                    { header: 'Project Name', key: 'projectName', width: 30 },
                    { header: 'Booked By', key: 'bookedBy', width: 20 },
                    { header: 'Event Date', key: 'eventDate', width: 15 },
                    { header: 'Start Time', key: 'startTime', width: 12 },
                    { header: 'End Time', key: 'endTime', width: 12 },
                    { header: 'Equipment', key: 'equipment', width: 20 }
                ];

                // Style header row for upcoming events
                upcomingWorksheet.getRow(1).font = { bold: true };
                upcomingWorksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE5E7EB' }
                };

                // Add upcoming events data
                upcomingWorksheet.addRows(formattedUpcomingRows);

                // Add Past Events worksheet
                const pastWorksheet = workbook.addWorksheet('Event History');
                pastWorksheet.columns = [
                    { header: 'Project Name', key: 'projectName', width: 30 },
                    { header: 'Booked By', key: 'bookedBy', width: 20 },
                    { header: 'Event Date', key: 'eventDate', width: 15 },
                    { header: 'Start Time', key: 'startTime', width: 12 },
                    { header: 'End Time', key: 'endTime', width: 12 },
                    { header: 'Equipment', key: 'equipment', width: 20 }
                ];

                // Style header row for past events
                pastWorksheet.getRow(1).font = { bold: true };
                pastWorksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE5E7EB' }
                };

                // Add past events data
                pastWorksheet.addRows(formattedPastRows);

                // Set response headers
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=events.xlsx');

                // Write to response
                await workbook.xlsx.write(res);
                res.end();
                break;

            case 'csv':
                // Prepare CSV data with sections
                const fields = ['projectName', 'bookedBy', 'eventDate', 'startTime', 'endTime', 'equipment'];
                
                // Create section headers and combine data
                const csvData = [
                    { projectName: '=== UPCOMING EVENTS ===' },
                    ...formattedUpcomingRows,
                    { projectName: '' }, // Empty row as separator
                    { projectName: '=== EVENT HISTORY ===' },
                    ...formattedPastRows
                ];

                const csv = parse(csvData, { fields });

                // Set response headers
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=events.csv');

                // Send CSV
                res.send(csv);
                break;

            default:
                res.status(400).send('Invalid export format');
        }
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).send('Error generating export file');
    }
});

app.post('/submit-booking', async (req, res) => {
    console.log('Received booking data:', req.body);
    
    const { projectName, bookedBy, eventDate, startDate, endDate, startTime, endTime, equipment, bookingType } = req.body;
    
    // Validate required fields
    if (!projectName || !bookedBy || !startTime || !endTime || !equipment) {
        console.error('Missing required fields:', { projectName, bookedBy, startTime, endTime, equipment });
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const dateSubmitted = moment().format('YYYY-MM-DD HH:mm:ss');

    try {
        if (bookingType === 'range') {
            if (!startDate || !endDate) {
                return res.status(400).json({ error: 'Start and end dates are required for range bookings' });
            }

            // Generate array of dates between start and end
            const dates = [];
            const currentDate = new Date(startDate);
            const lastDate = new Date(endDate);
            
            while (currentDate <= lastDate) {
                dates.push(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Insert bookings for each date
            const insertPromises = dates.map(date => 
                new Promise((resolve, reject) => {
                    const booking = {
                        projectName,
                        bookedBy,
                        eventDate: date,
                        startTime,
                        endTime,
                        equipment,
                        dateSubmitted
                    };

                    db.run(`
                        INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [projectName, bookedBy, date, startTime, endTime, equipment, dateSubmitted], (err) => {
                        if (err) {
                            console.error('Error inserting booking:', err);
                            reject(err);
                        } else {
                            console.log('Booking inserted successfully for date:', date);
                            resolve(booking);
                        }
                    });
                })
            );

            const bookings = await Promise.all(insertPromises);
            const calendarLinks = bookings.map(booking => {
                const startDateTime = moment(`${booking.eventDate}T${booking.startTime}`).format('YYYYMMDDTHHmmss');
                const endDateTime = moment(`${booking.eventDate}T${booking.endTime}`).format('YYYYMMDDTHHmmss');
                
                // Format description with booking details
                const description = `Project: ${booking.projectName}\nBooked By: ${booking.bookedBy}\nEquipment: ${booking.equipment}`;
                
                // Google Calendar link
                const googleCalendarLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(booking.projectName)}&dates=${startDateTime}/${endDateTime}&details=${encodeURIComponent(description)}`;
                
                // Outlook Calendar link
                const outlookCalendarLink = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(booking.projectName)}&startdt=${startDateTime}&enddt=${endDateTime}&body=${encodeURIComponent(description)}`;
                
                // iCal format
                const icalData = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    'BEGIN:VEVENT',
                    `DTSTART:${startDateTime}`,
                    `DTEND:${endDateTime}`,
                    `SUMMARY:${booking.projectName}`,
                    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
                    'END:VEVENT',
                    'END:VCALENDAR'
                ].join('\r\n');

                return {
                    googleCalendarLink,
                    outlookCalendarLink,
                    icalData
                };
            });
            
            console.log('Date range booking submitted successfully');
            res.json({ 
                success: true,
                calendarLinks
            });
        } else {
            // Single date booking
            if (!eventDate) {
                return res.status(400).json({ error: 'Event date is required for single date bookings' });
            }

            const booking = {
                projectName,
                bookedBy,
                eventDate,
                startTime,
                endTime,
                equipment,
                dateSubmitted
            };

            db.run(`
                INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted], (err) => {
                if (err) {
                    console.error('Error submitting booking:', err);
                    res.status(500).json({ error: 'Error submitting booking' });
                } else {
                    console.log('Booking submitted successfully');
                    
                    // Generate calendar links for single booking
                    const startDateTime = moment(`${eventDate}T${startTime}`).format('YYYYMMDDTHHmmss');
                    const endDateTime = moment(`${eventDate}T${endTime}`).format('YYYYMMDDTHHmmss');
                    
                    const description = `Project: ${projectName}\nBooked By: ${bookedBy}\nEquipment: ${equipment}`;
                    
                    const googleCalendarLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(projectName)}&dates=${startDateTime}/${endDateTime}&details=${encodeURIComponent(description)}`;
                    
                    const outlookCalendarLink = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(projectName)}&startdt=${startDateTime}&enddt=${endDateTime}&body=${encodeURIComponent(description)}`;
                    
                    const icalData = [
                        'BEGIN:VCALENDAR',
                        'VERSION:2.0',
                        'BEGIN:VEVENT',
                        `DTSTART:${startDateTime}`,
                        `DTEND:${endDateTime}`,
                        `SUMMARY:${projectName}`,
                        `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
                        'END:VEVENT',
                        'END:VCALENDAR'
                    ].join('\r\n');

                    const calendarLinks = [{
                        googleCalendarLink,
                        outlookCalendarLink,
                        icalData
                    }];

                    res.json({ 
                        success: true,
                        calendarLinks
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error in booking submission:', error);
        res.status(500).json({ error: 'Error submitting booking' });
    }
});

// Update availability check to handle combined equipment
app.get('/check-availability', (req, res) => {
    const { eventDate, startTime, endTime, equipment } = req.query;
    
    // First, check if any of the requested equipment is booked
    db.all(`
        SELECT * FROM bookings 
        WHERE eventDate = ? 
        AND (
            (startTime <= ? AND endTime > ?) OR
            (startTime < ? AND endTime >= ?) OR
            (startTime >= ? AND endTime <= ?)
        )
    `, [eventDate, startTime, startTime, endTime, endTime, startTime, endTime], 
    (err, rows) => {
        if (err) {
            res.json({ error: 'Error checking availability' });
            return;
        }

        // If no bookings found, the equipment is available
        if (rows.length === 0) {
            res.json({ available: true });
            return;
        }

        // Check if any of the booked equipment conflicts with the requested equipment
        const bookedEquipment = rows.map(row => row.equipment);
        const requestedEquipment = equipment.split(' + ');

        // Check for conflicts
        const hasConflict = bookedEquipment.some(booked => {
            const bookedItems = booked.split(' + ');
            return requestedEquipment.some(requested => 
                bookedItems.some(item => item === requested)
            );
        });

        // Special handling for vehicles - check if any vehicle is already booked
        const vehicleNames = [
            'SILVER HONDA VEZEL AFY 6842',
            'WHITE HONDA FIT AFT 5672',
            'BLACK HONDA FIT AFT 8608',
            'SILVER HONDA FIT AFB 3293',
            'TOYOTA HILUX AFX 5650',
            'BLACK HONDA FIT AFT 5131',
            'NISSAN KOMBI AFV 1122',
            'KOMBI H/RF AEY 8397',
            'WHITE HONDA VEZEL AGY 7776'
        ];

        // Check if any requested vehicle is already booked
        const vehicleConflict = requestedEquipment.some(requested => {
            if (vehicleNames.includes(requested)) {
                return bookedEquipment.some(booked => {
                    const bookedItems = booked.split(' + ');
                    return bookedItems.includes(requested);
                });
            }
            return false;
        });

        if (hasConflict || vehicleConflict) {
            res.json({ available: false });
        } else {
            res.json({ available: true });
        }
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 