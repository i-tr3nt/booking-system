const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const moment = require('moment');
const fs = require('fs');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

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
                console.error('Error creating table:', err);
            } else {
                console.log('Bookings table ready');
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
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
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
    const validAdmins = [
        { email: 'jchipanga@gmail.com', password: 'thruzimadmin2025' },
        { email: 'takudzwatrenttaderera@gmailcom', password: 'thruzimadmin2025' }
    ];

    const admin = validAdmins.find(a => a.email === email && a.password === password);
    if (admin) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
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

            res.render('admin-dashboard', {
                upcomingEvents,
                pastEvents,
                success: req.query.success,
                error: req.query.error
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

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
}); 