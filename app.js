const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const path = require('path');
const ExcelJS = require('exceljs');
const { parse } = require('json2csv');
const nodemailer = require('nodemailer');

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
app.get('/', async (req, res) => {
    // Get upcoming bookings
    db.all(`
        SELECT * FROM bookings 
        WHERE date(eventDate) >= date('now') 
        ORDER BY eventDate ASC, startTime ASC 
        LIMIT 5
    `, [], (err, rows) => {
        if (err) {
            console.error('Error fetching bookings:', err);
            res.render('index', { upcomingBookings: [], showMessage: false });
        } else {
            // Format dates for display
            const formattedBookings = rows.map(booking => ({
                ...booking,
                eventDate: moment(booking.eventDate).format('DD/MM/YYYY'),
                startTime: moment(booking.startTime, 'HH:mm').format('HH:mm'),
                endTime: moment(booking.endTime, 'HH:mm').format('HH:mm')
            }));
            res.render('index', { 
                upcomingBookings: formattedBookings,
                showMessage: req.query.success || req.query.error
            });
        }
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
                pastEvents: formatEvents(pastRows)
            });
        })
        .catch(err => {
            console.error('Error fetching events:', err);
            res.render('events', { upcomingEvents: [], pastEvents: [] });
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

app.post('/submit-booking', (req, res) => {
    const { projectName, bookedBy, eventDate, startDate, endDate, startTime, endTime, equipment, bookingType } = req.body;
    const dateSubmitted = moment().format('YYYY-MM-DD HH:mm:ss');

    // Convert equipment to array if it's a single value
    const equipmentArray = Array.isArray(equipment) ? equipment : [equipment];

    if (bookingType === 'range') {
        // Generate array of dates between start and end
        const dates = [];
        const currentDate = new Date(startDate);
        const lastDate = new Date(endDate);
        
        while (currentDate <= lastDate) {
            dates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Insert bookings for each date and equipment combination
        const insertPromises = dates.flatMap(date => 
            equipmentArray.map(equipment => 
                new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [projectName, bookedBy, date, startTime, endTime, equipment, dateSubmitted], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                })
            )
        );

        Promise.all(insertPromises)
            .then(() => {
                console.log('Date range booking submitted successfully');
                res.redirect('/?success=true');
            })
            .catch(err => {
                console.error('Error submitting date range booking:', err);
                res.redirect('/?error=true');
            });
    } else {
        // Single date booking
        const insertPromises = equipmentArray.map(equipment =>
            new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            })
        );

        Promise.all(insertPromises)
            .then(() => {
                console.log('Booking submitted successfully');
                res.redirect('/?success=true');
            })
            .catch(err => {
                console.error('Error submitting booking:', err);
                res.redirect('/?error=true');
            });
    }
});

// Check for double bookings
app.get('/check-availability', (req, res) => {
    const { eventDate, startTime, endTime, equipment } = req.query;
    
    // First, check if the requested equipment is available
    db.all(`
        SELECT * FROM bookings 
        WHERE eventDate = ? 
        AND equipment = ?
        AND (
            (startTime <= ? AND endTime > ?) OR
            (startTime < ? AND endTime >= ?) OR
            (startTime >= ? AND endTime <= ?)
        )
    `, [eventDate, equipment, startTime, startTime, endTime, endTime, startTime, endTime], 
    (err, rows) => {
        if (err) {
            res.json({ error: 'Error checking availability' });
            return;
        }

        // If the equipment is available, return success
        if (rows.length === 0) {
            res.json({ available: true });
            return;
        }

        // If a projector is requested and not available, find available projectors
        if (equipment.includes('Projector') && !equipment.includes('Gazebo')) {
            db.all(`
                SELECT DISTINCT equipment
                FROM bookings 
                WHERE eventDate = ? 
                AND equipment LIKE 'Projector%'
                AND (
                    (startTime <= ? AND endTime > ?) OR
                    (startTime < ? AND endTime >= ?) OR
                    (startTime >= ? AND endTime <= ?)
                )
            `, [eventDate, startTime, startTime, endTime, endTime, startTime, endTime],
            (err, bookedProjectors) => {
                if (err) {
                    res.json({ available: false });
                    return;
                }

                // Create array of all projectors
                const allProjectors = ['Projector 1', 'Projector 2', 'Projector 3', 'Projector 4'];
                
                // Filter out booked projectors
                const bookedProjectorNames = bookedProjectors.map(row => row.equipment);
                const availableProjectors = allProjectors.filter(p => !bookedProjectorNames.includes(p));

                res.json({
                    available: false,
                    availableProjectors: availableProjectors
                });
            });
        } else if (equipment === 'Gazebo+Projector 4+Zoom VC') {
            // Check availability for all components
            db.all(`
                SELECT equipment
                FROM bookings 
                WHERE eventDate = ? 
                AND (
                    equipment = 'Gazebo only' OR
                    equipment = 'Projector 4' OR
                    equipment = 'Zoom Video Conferencing' OR
                    equipment = 'Gazebo+Projector 4' OR
                    equipment = 'Gazebo+Projector 4+Zoom VC'
                )
                AND (
                    (startTime <= ? AND endTime > ?) OR
                    (startTime < ? AND endTime >= ?) OR
                    (startTime >= ? AND endTime <= ?)
                )
            `, [eventDate, startTime, startTime, endTime, endTime, startTime, endTime],
            (err, bookedEquipment) => {
                if (err) {
                    res.json({ available: false });
                    return;
                }

                if (bookedEquipment.length === 0) {
                    res.json({ available: true });
                } else {
                    res.json({ available: false });
                }
            });
        } else {
            res.json({ available: false });
        }
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 