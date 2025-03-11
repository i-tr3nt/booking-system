const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const path = require('path');
const ExcelJS = require('exceljs');
const { parse } = require('json2csv');

const app = express();
const port = process.env.PORT || 3000;

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
    db.all(`
        SELECT * FROM bookings 
        WHERE date(eventDate) >= date('now') 
        ORDER BY eventDate ASC, startTime ASC
    `, [], (err, rows) => {
        if (err) {
            console.error('Error fetching events:', err);
            res.render('events', { events: [] });
        } else {
            // Format dates for display
            const formattedEvents = rows.map(event => ({
                ...event,
                eventDate: moment(event.eventDate).format('DD/MM/YYYY'),
                startTime: moment(event.startTime, 'HH:mm').format('HH:mm'),
                endTime: moment(event.endTime, 'HH:mm').format('HH:mm')
            }));
            res.render('events', { events: formattedEvents });
        }
    });
});

// Export events route
app.get('/export-events', async (req, res) => {
    try {
        // Get data from database
        const rows = await new Promise((resolve, reject) => {
            db.all(`
                SELECT projectName, bookedBy, eventDate, startTime, endTime, equipment
                FROM bookings 
                WHERE date(eventDate) >= date('now')
                ORDER BY eventDate ASC, startTime ASC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Format dates
        const formattedRows = rows.map(row => ({
            ...row,
            eventDate: moment(row.eventDate).format('DD/MM/YYYY'),
            startTime: moment(row.startTime, 'HH:mm').format('HH:mm'),
            endTime: moment(row.endTime, 'HH:mm').format('HH:mm')
        }));

        const format = req.query.format || 'excel';

        switch (format) {
            case 'excel':
                // Create Excel workbook
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Scheduled Events');

                // Add headers with styling
                worksheet.columns = [
                    { header: 'Project Name', key: 'projectName', width: 30 },
                    { header: 'Booked By', key: 'bookedBy', width: 20 },
                    { header: 'Event Date', key: 'eventDate', width: 15 },
                    { header: 'Start Time', key: 'startTime', width: 12 },
                    { header: 'End Time', key: 'endTime', width: 12 },
                    { header: 'Equipment', key: 'equipment', width: 20 }
                ];

                // Style header row
                worksheet.getRow(1).font = { bold: true };
                worksheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE5E7EB' }
                };

                // Add data rows
                worksheet.addRows(formattedRows);

                // Set response headers
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=scheduled-events.xlsx');

                // Write to response
                await workbook.xlsx.write(res);
                res.end();
                break;

            case 'csv':
                // Convert to CSV
                const fields = ['projectName', 'bookedBy', 'eventDate', 'startTime', 'endTime', 'equipment'];
                const csv = parse(formattedRows, { fields });

                // Set response headers
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=scheduled-events.csv');

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
    const { projectName, bookedBy, eventDate, startTime, endTime, equipment } = req.body;
    const dateSubmitted = moment().format('YYYY-MM-DD HH:mm:ss');

    // Insert new booking
    db.run(`
        INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted], (err) => {
        if (err) {
            console.error('Error submitting booking:', err);
            res.redirect('/?error=true');
        } else {
            console.log('Booking submitted successfully');
            res.redirect('/?success=true');
        }
    });
});

// Check for double bookings
app.get('/check-availability', (req, res) => {
    const { eventDate, startTime, endTime } = req.query;
    
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
        } else {
            res.json({ available: rows.length === 0, existingBookings: rows });
        }
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 