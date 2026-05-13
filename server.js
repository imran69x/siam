require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');
const USERS_PATH = path.join(__dirname, 'data', 'users.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Make sure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'hero_' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) &&
               allowed.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only image files allowed!'));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 2 } // 2 hours
}));

// --- Helpers ---
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return { redirectLink: '#', heroImage: '', siteName: 'Welcome', heroTitle: 'Join Us Today', heroSubtitle: 'Click below to get started', buttonText: 'Sign Up Now' };
  }
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || req.ip;
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

function isAdmin(req) {
  return req.session && req.session.isAdmin === true;
}

// --- Routes ---

// Home page - serve settings as JSON for frontend
app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

// Check if current IP has registered before
app.get('/api/check-user', (req, res) => {
  const ip = getClientIP(req);
  const users = readUsers();
  const user = users.find(u => u.ip === ip);
  if (user) {
    res.json({ registered: true, name: user.name });
  } else {
    res.json({ registered: false });
  }
});

// Register a new user with their name and IP
app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.json({ success: false, message: 'নাম দিন' });
  }
  const ip = getClientIP(req);
  const users = readUsers();
  const existing = users.findIndex(u => u.ip === ip);
  const userEntry = { ip, name: name.trim(), registeredAt: new Date().toISOString() };
  if (existing !== -1) {
    users[existing] = userEntry; // update if already exists
  } else {
    users.push(userEntry);
  }
  saveUsers(users);
  res.json({ success: true, name: name.trim() });
});

// Admin login page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin login POST
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Wrong password!' });
  }
});

// Admin logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check admin auth status
app.get('/admin/check', (req, res) => {
  res.json({ isAdmin: isAdmin(req) });
});

// Admin: Update settings (link, title, subtitle, button text)
app.post('/admin/update-settings', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const settings = readSettings();
  const { redirectLink, siteName, heroTitle, heroSubtitle, buttonText, loginLink, loginButtonText } = req.body;
  if (redirectLink) settings.redirectLink = redirectLink;
  if (siteName) settings.siteName = siteName;
  if (heroTitle) settings.heroTitle = heroTitle;
  if (heroSubtitle) settings.heroSubtitle = heroSubtitle;
  if (buttonText) settings.buttonText = buttonText;
  if (loginLink !== undefined) settings.loginLink = loginLink;
  if (loginButtonText) settings.loginButtonText = loginButtonText;
  saveSettings(settings);
  res.json({ success: true, settings });
});

// Admin: Upload hero image
app.post('/admin/upload-image', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  upload.single('heroImage')(req, res, (err) => {
    if (err) return res.json({ success: false, message: err.message });
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });

    const settings = readSettings();
    // Delete old image if exists
    if (settings.heroImage) {
      const oldPath = path.join(__dirname, 'public', settings.heroImage);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const imagePath = '/uploads/' + req.file.filename;
    settings.heroImage = imagePath;
    saveSettings(settings);
    res.json({ success: true, imagePath });
  });
});

// Admin: Remove hero image
app.post('/admin/remove-image', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const settings = readSettings();
  if (settings.heroImage) {
    const oldPath = path.join(__dirname, 'public', settings.heroImage);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    settings.heroImage = '';
    saveSettings(settings);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}\n`);
});
