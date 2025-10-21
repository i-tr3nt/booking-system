const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const moment = require('moment');
const fs = require('fs');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Email configuration
let transporter;
try {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER || 'your-email@gmail.com',
            pass: process.env.EMAIL_PASS || 'your-app-password'
        }
    });
    console.log('Email transporter configured successfully');
} catch (error) {
    console.error('Error configuring email transporter:', error);
    transporter = null;
}

// Function to send booking notification email
async function sendBookingNotification(booking) {
    if (!transporter) {
        console.log('Email transporter not available, skipping email notification');
        return;
    }

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
        from: process.env.EMAIL_USER || 'your-email@gmail.com',
        to: process.env.NOTIFICATION_EMAIL || 'takudzatrenttaderera@gmail.com',
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

// Database connection
const db = new sqlite3.Database('bookings.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating bookings table:', err);
            } else {
                console.log('Bookings table ready');
            }
        });

        // Create inventory table
        db.run(`CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            serial_number TEXT,
            project TEXT,
            description TEXT,
            notes TEXT,
            supplier TEXT,
            date_received TEXT,
            storage_location TEXT DEFAULT 'Data Office',
            condition TEXT DEFAULT 'New',
            status TEXT DEFAULT 'Available',
            quantity INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating inventory table:', err);
            } else {
                console.log('Inventory table ready');
                
                // First, check if status column exists
                db.get("PRAGMA table_info(inventory)", (err, rows) => {
                    if (err) {
                        console.error('Error checking table structure:', err);
                        return;
                    }
                    
                    // Add status column if it doesn't exist
                    db.run("ALTER TABLE inventory ADD COLUMN status TEXT DEFAULT 'Available'", (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.error('Error adding status column:', err);
                        } else {
                            // Only update records after ensuring the column exists
                            db.run("UPDATE inventory SET status = 'Available' WHERE status IS NULL", (err) => {
                                if (err) {
                                    console.error('Error updating existing inventory records:', err);
                                } else {
                                    console.log('Successfully updated inventory records with default status');
                                }
                            });
                        }
                    });
                });
            }
        });

        // Create stock movements table
        db.run(`CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER NOT NULL,
            movement_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            from_location TEXT,
            to_location TEXT,
            notes TEXT,
            performed_by TEXT NOT NULL,
            movement_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_id) REFERENCES inventory(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating stock movements table:', err);
            } else {
                console.log('Stock movements table ready');
            }
        });

        // Create inventory history table
        db.run(`CREATE TABLE IF NOT EXISTS inventory_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            action_details TEXT,
            performed_by TEXT NOT NULL,
            action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (inventory_id) REFERENCES inventory(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating inventory history table:', err);
            } else {
                console.log('Inventory history table ready');
            }
        });
    }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Session configuration
app.use(session({
    secret: 'thruzim-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: false, // Set to false for now to ensure it works
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make moment available to all templates
app.use((req, res, next) => {
    res.locals.moment = moment;
    next();
});

// Admin authentication middleware
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};

// Admin login page
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

// Admin login handler
app.post('/admin/login', (req, res) => {
    const { email, password } = req.body;
    console.log('Login attempt:', { email, password }); // Debug log

    const validAdmins = [
        { email: 'jchipanga@gmail.com', password: 'thruzimadmin2025' },
        { email: 'takudzwatrenttaderera@gmail.com', password: 'thruzimadmin2025' } // Fixed email address
    ];

    const admin = validAdmins.find(a => a.email === email && a.password === password);
    console.log('Admin found:', admin); // Debug log

    if (admin) {
        req.session.isAdmin = true;
        req.session.adminEmail = email; // Store the admin's email in session
        console.log('Session set:', req.session); // Debug log
        res.redirect('/admin');
    } else {
        console.log('Login failed'); // Debug log
        res.render('admin-login', { error: 'Invalid email or password' });
    }
});

// Admin logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Admin dashboard
app.get('/admin', isAdmin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const dashboard = req.query.dashboard || 'booking'; // Default to 'booking' if not specified
    
    // Get today's bookings
    db.all(`SELECT * FROM bookings WHERE date(eventDate) = date(?) ORDER BY startTime`, [today], (err, todayBookings) => {
        if (err) {
            console.error('Error fetching today\'s bookings:', err);
            return res.status(500).send('Error fetching bookings');
        }

        // Get upcoming events
        db.all(`SELECT * FROM bookings WHERE date(eventDate) > date(?) ORDER BY eventDate, startTime`, [today], (err, upcomingEvents) => {
            if (err) {
                console.error('Error fetching upcoming events:', err);
                return res.status(500).send('Error fetching events');
            }

            // Get past events
            db.all(`SELECT * FROM bookings WHERE date(eventDate) < date(?) ORDER BY eventDate DESC, startTime`, [today], (err, pastEvents) => {
                if (err) {
                    console.error('Error fetching past events:', err);
                    return res.status(500).send('Error fetching events');
                }

                // Get inventory items
                db.all(`SELECT * FROM inventory ORDER BY created_at DESC`, [], (err, inventoryItems) => {
                    if (err) {
                        console.error('Error fetching inventory items:', err);
                        return res.status(500).send('Error fetching inventory');
                    }

                    // Get stock movements
                    db.all(`SELECT m.*, i.name as item_name, i.serial_number 
                           FROM stock_movements m 
                           LEFT JOIN inventory i ON m.inventory_id = i.id 
                           ORDER BY m.movement_date DESC`, [], (err, stockMovements) => {
                        if (err) {
                            console.error('Error fetching stock movements:', err);
                            return res.status(500).send('Error fetching stock movements');
                        }

                        // Get recent activities
                        db.all(`SELECT h.*, i.name as item_name 
                               FROM inventory_history h 
                               LEFT JOIN inventory i ON h.inventory_id = i.id 
                               ORDER BY h.action_date DESC LIMIT 10`, [], (err, recentActivities) => {
                            if (err) {
                                console.error('Error fetching recent activities:', err);
                                return res.status(500).send('Error fetching recent activities');
                            }

                            // Calculate equipment availability
                            const equipmentAvailability = {
                                'Meeting Room': { total: 1, available: 1 },
                                'Projector': { total: 2, available: 2 },
                                'Study Room': { total: 1, available: 1 },
                                'Gazebo': { total: 1, available: 1 },
                                'Zoom Video Conferencing': { total: 1, available: 1 },
                                'Vehicles': { total: 9, available: 9 }
                            };

                            let adminName = 'Admin';
                            if (req.session.adminEmail === 'takudzwatrenttaderera@gmail.com') {
                                adminName = 'Takudzwa';
                            } else if (req.session.adminEmail === 'jchipanga@gmail.com') {
                                adminName = 'Joseph';
                            }

                            // Render the dashboard with all data
                            res.render('admin-dashboard', {
                                adminName,
                                todayBookings,
                                upcomingEvents,
                                pastEvents,
                                inventoryItems,
                                stockMovements,
                                recentActivities,
                                equipmentAvailability,
                                success: req.query.success,
                                error: req.query.error,
                                dashboard // Make sure this is always passed
                            });
                        });
                    });
                });
            });
        });
    });
});

// Admin booking actions
app.post('/admin/bookings', isAdmin, (req, res) => {
    const { action, id, projectName, bookedBy, eventDate, startTime, endTime, equipment } = req.body;

    try {
        switch (action) {
            case 'add':
                db.run(`INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                    [projectName, bookedBy, eventDate, startTime, endTime, equipment],
                    function(err) {
                        if (err) {
                            res.redirect('/admin?error=Failed to add booking');
                        } else {
                            res.redirect('/admin?success=Booking added successfully');
                        }
                    });
                break;

            case 'edit':
                db.run(`UPDATE bookings 
                        SET projectName = ?, bookedBy = ?, eventDate = ?, startTime = ?, endTime = ?, equipment = ?
                        WHERE id = ?`,
                    [projectName, bookedBy, eventDate, startTime, endTime, equipment, id],
                    function(err) {
                        if (err) {
                            res.redirect('/admin?error=Failed to update booking');
                        } else if (this.changes === 0) {
                            res.redirect('/admin?error=Booking not found');
                        } else {
                            res.redirect('/admin?success=Booking updated successfully');
                        }
                    });
                break;

            case 'delete':
                db.run('DELETE FROM bookings WHERE id = ?', [id], function(err) {
                    if (err) {
                        res.redirect('/admin?error=Failed to delete booking');
                    } else if (this.changes === 0) {
                        res.redirect('/admin?error=Booking not found');
                    } else {
                        res.redirect('/admin?success=Booking deleted successfully');
                    }
                });
                break;

            case 'cancel':
                db.run('DELETE FROM bookings WHERE id = ?', [id], function(err) {
                    if (err) {
                        res.redirect('/admin?error=Failed to cancel booking');
                    } else if (this.changes === 0) {
                        res.redirect('/admin?error=Booking not found');
                    } else {
                        res.redirect('/admin?success=Booking cancelled successfully');
                    }
                });
                break;

            default:
                res.redirect('/admin?error=Invalid action');
        }
    } catch (error) {
        res.redirect('/admin?error=An error occurred');
    }
});

// Inventory management routes
app.post('/admin/inventory', isAdmin, (req, res) => {
    console.log('Received inventory request:', req.body);
    
    const { action, id, name, serial_number, project, description, notes, supplier, date_received, storage_location, condition, status, quantity } = req.body;

    try {
        switch (action) {
            case 'add':
                // First check if serial number already exists
                db.get('SELECT id FROM inventory WHERE serial_number = ?', [serial_number], (err, row) => {
                    if (err) {
                        console.error('Error checking for duplicate:', err);
                        res.json({ success: false, message: 'Error checking for duplicate item' });
                        return;
                    }
                    
                    if (row) {
                        res.json({ success: false, message: 'An item with this serial number already exists' });
                        return;
                    }

                    // If no duplicate, proceed with insert
                    db.run(`INSERT INTO inventory (name, serial_number, project, description, notes, supplier, date_received, storage_location, condition, status, quantity) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [name, serial_number, project, description, notes, supplier, date_received, storage_location || 'Data Office', condition || 'New', status || 'Available', quantity || 1],
                        function(err) {
                            if (err) {
                                console.error('Error adding inventory item:', err);
                                res.json({ success: false, message: 'Failed to add inventory item: ' + err.message });
                            } else {
                                // Record in inventory history
                                db.run(`INSERT INTO inventory_history (inventory_id, action_type, action_details, performed_by) 
                                       VALUES (?, ?, ?, ?)`,
                                    [this.lastID, 'add', `Added new item: ${name}`, req.session.adminEmail],
                                    (err) => {
                                        if (err) console.error('Error recording inventory history:', err);
                                    });
                                console.log('Successfully added inventory item with ID:', this.lastID);
                                res.json({ success: true, message: 'Inventory item added successfully' });
                            }
                        });
                });
                break;

            case 'edit':
                db.run(`UPDATE inventory 
                        SET name = ?, serial_number = ?, project = ?, description = ?, notes = ?, supplier = ?, 
                            date_received = ?, storage_location = ?, condition = ?, status = ?, quantity = ?
                        WHERE id = ?`,
                    [name, serial_number, project, description, notes, supplier, date_received, 
                     storage_location || 'Data Office', condition, status, quantity, id],
                    function(err) {
                        if (err) {
                            res.json({ success: false, message: 'Failed to update inventory item' });
                        } else if (this.changes === 0) {
                            res.json({ success: false, message: 'Inventory item not found' });
                        } else {
                            // Record in inventory history
                            db.run(`INSERT INTO inventory_history (inventory_id, action_type, action_details, performed_by) 
                                   VALUES (?, ?, ?, ?)`,
                                [id, 'edit', `Updated item: ${name}`, req.session.adminEmail],
                                (err) => {
                                    if (err) console.error('Error recording inventory history:', err);
                                });
                            res.json({ success: true, message: 'Inventory item updated successfully' });
                        }
                    });
                break;

            case 'delete':
                db.run('DELETE FROM inventory WHERE id = ?', [id], function(err) {
                    if (err) {
                        res.json({ success: false, message: 'Failed to delete inventory item' });
                    } else if (this.changes === 0) {
                        res.json({ success: false, message: 'Inventory item not found' });
                    } else {
                        // Record in inventory history
                        db.run(`INSERT INTO inventory_history (inventory_id, action_type, action_details, performed_by) 
                               VALUES (?, ?, ?, ?)`,
                            [id, 'delete', `Deleted item ID: ${id}`, req.session.adminEmail],
                            (err) => {
                                if (err) console.error('Error recording inventory history:', err);
                            });
                        res.json({ success: true, message: 'Inventory item deleted successfully' });
                    }
                });
                break;

            default:
                res.json({ success: false, message: 'Invalid action' });
        }
    } catch (error) {
        res.json({ success: false, message: 'An error occurred' });
    }
});

// Stock movement route
app.post('/admin/stock-movement', isAdmin, (req, res) => {
    const { inventory_id, movement_type, quantity, from_location, to_location, notes } = req.body;

    try {
        // Start a transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Insert stock movement record
            db.run(`INSERT INTO stock_movements (inventory_id, movement_type, quantity, from_location, to_location, notes, performed_by) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [inventory_id, movement_type, quantity, from_location, to_location, notes, req.session.adminEmail],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        res.redirect('/admin?error=Failed to record stock movement');
                        return;
                    }

                    // Update inventory item
                    db.run(`UPDATE inventory 
                            SET storage_location = ?, 
                                status = CASE 
                                    WHEN ? = 'damage' THEN 'Maintenance'
                                    WHEN ? = 'maintenance' THEN 'Maintenance'
                                    ELSE status 
                                END
                            WHERE id = ?`,
                        [to_location, movement_type, movement_type, inventory_id],
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                res.redirect('/admin?error=Failed to update inventory item');
                                return;
                            }

                            // Record in inventory history
                            db.run(`INSERT INTO inventory_history (inventory_id, action_type, action_details, performed_by) 
                                   VALUES (?, ?, ?, ?)`,
                                [inventory_id, 'move', 
                                 `Moved ${quantity} items from ${from_location} to ${to_location} (${movement_type})`, 
                                 req.session.adminEmail],
                                function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        res.redirect('/admin?error=Failed to record inventory history');
                                        return;
                                    }

                                    db.run('COMMIT');
                                    res.redirect('/admin?success=Stock movement recorded successfully');
                                });
                        });
                });
        });
    } catch (error) {
        db.run('ROLLBACK');
        res.redirect('/admin?error=An error occurred');
    }
});

// Home route
app.get('/', (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Get upcoming events for the home page
    db.all(`SELECT * FROM bookings WHERE date(eventDate) >= date(?) ORDER BY eventDate, startTime LIMIT 3`, [todayStr], (err, upcomingBookings) => {
        if (err) {
            console.error('Error fetching upcoming bookings:', err);
            upcomingBookings = [];
        }

        res.render('index', {
            showMessage: false,
            success: null,
            upcomingBookings
        });
    });
});

// Events route
app.get('/events', (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Get upcoming events
    db.all(`SELECT * FROM bookings WHERE date(eventDate) >= date(?) ORDER BY eventDate, startTime`, [todayStr], (err, upcomingEvents) => {
        if (err) {
            console.error('Error fetching upcoming events:', err);
            upcomingEvents = [];
        }

        // Get past events
        db.all(`SELECT * FROM bookings WHERE date(eventDate) < date(?) ORDER BY eventDate DESC, startTime`, [todayStr], (err, pastEvents) => {
            if (err) {
                console.error('Error fetching past events:', err);
                pastEvents = [];
            }

            res.render('events', { upcomingEvents, pastEvents });
        });
    });
});

// Booking submission route (migrated from app.js)
app.post('/submit-booking', async (req, res) => {
    console.log('Received booking data:', req.body);

    const { projectName, bookedBy, eventDate, startDate, endDate, startTime, endTime, equipment, bookingType } = req.body;

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

            const dates = [];
            const currentDate = new Date(startDate);
            const lastDate = new Date(endDate);
            while (currentDate <= lastDate) {
                dates.push(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            const insertPromises = dates.map(date => new Promise((resolve, reject) => {
                const booking = { projectName, bookedBy, eventDate: date, startTime, endTime, equipment, dateSubmitted };

                db.run(`
                    INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [projectName, bookedBy, date, startTime, endTime, equipment, dateSubmitted], (err) => {
                    if (err) {
                        console.error('Error inserting booking:', err);
                        reject(err);
                    } else {
                        console.log('Booking inserted successfully for date:', date);
                        // Send email notification
                        sendBookingNotification(booking);
                        resolve(booking);
                    }
                });
            }));

            const bookings = await Promise.all(insertPromises);
            const calendarLinks = bookings.map(booking => {
                const startDateTime = moment(`${booking.eventDate}T${booking.startTime}`).format('YYYYMMDDTHHmmss');
                const endDateTime = moment(`${booking.eventDate}T${booking.endTime}`).format('YYYYMMDDTHHmmss');
                const description = `Project: ${booking.projectName}\nBooked By: ${booking.bookedBy}\nEquipment: ${booking.equipment}`;
                const googleCalendarLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(booking.projectName)}&dates=${startDateTime}/${endDateTime}&details=${encodeURIComponent(description)}`;
                const outlookCalendarLink = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(booking.projectName)}&startdt=${startDateTime}&enddt=${endDateTime}&body=${encodeURIComponent(description)}`;
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
                return { googleCalendarLink, outlookCalendarLink, icalData };
            });

            console.log('Date range booking submitted successfully');
            res.json({ success: true, calendarLinks });
        } else {
            if (!eventDate) {
                return res.status(400).json({ error: 'Event date is required for single date bookings' });
            }

            db.run(`
                INSERT INTO bookings (projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted], (err) => {
                if (err) {
                    console.error('Error submitting booking:', err);
                    res.status(500).json({ error: 'Error submitting booking' });
                } else {
                    console.log('Single booking submitted successfully');
                    
                    // Send email notification
                    const booking = { projectName, bookedBy, eventDate, startTime, endTime, equipment, dateSubmitted };
                    sendBookingNotification(booking);
                    
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

                    res.json({ success: true, calendarLinks: [{ googleCalendarLink, outlookCalendarLink, icalData }] });
                }
            });
        }
    } catch (error) {
        console.error('Error in booking submission:', error);
        res.status(500).json({ error: 'Error submitting booking' });
    }
});

// Availability check (migrated from app.js)
app.get('/check-availability', (req, res) => {
    const { eventDate, startTime, endTime, equipment } = req.query;

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

        if (rows.length === 0) {
            res.json({ available: true });
            return;
        }

        const bookedEquipment = rows.map(row => row.equipment);
        const requestedEquipment = equipment.split(' + ');

        const hasConflict = bookedEquipment.some(booked => {
            const bookedItems = booked.split(' + ');
            return requestedEquipment.some(requested => bookedItems.some(item => item === requested));
        });

        const vehicleNames = [
            'SILVER HONDA VEZEL AFY 6842',
            'WHITE HONDA FIT AFT 5672',
            'BLACK HONDA FIT AFT 8608',
            'SILVER HONDA FIT AFB 3293',
            'TOYOTA HILUX AFX 5650',
            'BLACK HONDA FIT AFT 5131',
            'NISSAN KOMBI AFV 1122',
            'KOMBI H/RF AEY 8397',
            'WHITE HONDA VEZEL AGY 7776',
            'NISSAN NV200 AGO 8493',
            'NISSAN NV200 AGX 1145'
        ];

        const vehicleConflict = requestedEquipment.some(requested => {
            if (vehicleNames.includes(requested)) {
                return bookedEquipment.some(booked => booked.split(' + ').includes(requested));
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
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
}); 