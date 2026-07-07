const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const {
  ObjectId,
  config,
  createCollectionIfNotExists,
  deleteOne,
  findMany,
  findOne,
  formatDateTime,
  getDb,
  insertOne,
  updateOne
} = require('./lib/database');
const { requireRole } = require('./lib/auth');
const r2 = require('./lib/r2');

const app = express();
app.set('trust proxy', 1);

// Enable GZIP compression to reduce network payload size (Lighthouse optimization)
app.use(compression());

// Enable CORS for cross-origin requests
app.use(cors());

// Simple request logger to aid debugging of routing and methods
app.use((req, res, next) => {
  try {
    const short = {
      contentType: req.headers['content-type'] || null,
      contentLength: req.headers['content-length'] || null,
      hasAuthorization: !!req.headers.authorization
    };
    console.log('REQ:', req.method, req.path, JSON.stringify(short));
  } catch (e) {
    console.log('REQ:', req.method, req.path);
  }
  next();
});
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const upload = multer({ storage: multer.memoryStorage() });
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }
});

const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

async function sendAdminAlertEmail(subject, htmlContent, priority = 'normal') {
  try {
    const settings = await findOne('settings', { _id: 'global' });
    if (!settings || !settings.emailNotifications) {
      console.log('Admin alert emails are disabled.');
      return;
    }
    const toEmail = settings.supportEmail || 'support@twinsure.com';
    const finalPriority = settings.notificationPriority || priority;

    const mailOptions = {
      from: process.env.SMTP_USER || 'support@twinsure.com',
      to: toEmail,
      subject: `[${finalPriority.toUpperCase()}] ${subject}`,
      html: htmlContent,
      priority: finalPriority
    };

    console.log(`Sending alert email to ${toEmail} with subject: ${subject}`);
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn('SMTP credentials not configured. Simulated email success.');
      return;
    }
    await mailTransporter.sendMail(mailOptions);
  } catch (err) {
    console.error('Error sending admin alert email:', err.message);
  }
}

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  console.error('FATAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('FATAL: Unhandled Rejection at:', promise, 'reason:', reason);
});


function sendJson(res, statusCode, payload) {
  res.status(statusCode).type('application/json').send(JSON.stringify(payload));
}

function methodNotAllowed(res, req = null, message = 'Method not allowed.') {
  if (req) {
    console.error(`[405 ERROR] Method Not Allowed. Method: ${req.method}, Path: ${req.path}, OriginalUrl: ${req.originalUrl}`);
  }
  sendJson(res, 405, { message });
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeFileName(fileName) {
  return path.basename(String(fileName || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function formatFileSize(size) {
  if (size >= 1048576) {
    return `${Math.round((size / 1048576) * 10) / 10} MB`;
  }
  return `${Math.round(size / 1024)} KB`;
}

function validateFileSignature(buffer, expectedTypes) {
  if (!buffer || buffer.length < 4) return false;
  const hex = buffer.toString('hex', 0, 4).toUpperCase();
  if (expectedTypes.includes('pdf')) {
    if (hex.startsWith('25504446')) return true; // %PDF
  }
  if (expectedTypes.includes('image')) {
    if (hex.startsWith('FFD8FF')) return true;   // JPEG
    if (hex.startsWith('89504E47')) return true; // PNG
  }
  return false;
}

function isPdfFile(file) {
  const originalName = file?.originalname || '';
  const ext = path.extname(originalName).toLowerCase();
  return ext === '.pdf' && validateFileSignature(file?.buffer, ['pdf']);
}

function isImageFile(file) {
  const originalName = file?.originalname || '';
  const ext = path.extname(originalName).toLowerCase();
  return ['.jpg', '.jpeg', '.png'].includes(ext) && validateFileSignature(file?.buffer, ['image']);
}

function collectBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function toObjectId(id) {
  return new ObjectId(String(id));
}

async function getAdminName(adminId) {
  try {
    const admin = await findOne('users', { _id: toObjectId(adminId) });
    if (admin && admin.name) {
      return admin.name;
    }
  } catch (error) {
    // Fall back to the generic label below.
  }

  return 'Admin';
}

async function enrichWithUserInfo(rows) {
  try {
    const users = await findMany('users', {});
    const userMap = new Map(users.map(u => [String(u._id), { name: u.name, email: u.email, phone: u.phone, tsid: u.tsid || '' }]));
    return rows.map(row => {
      const user = userMap.get(String(row.userId));
      return {
        ...row,
        userName: user ? user.name : 'Unknown User',
        userEmail: user ? user.email : 'N/A',
        userPhone: user ? user.phone : 'N/A',
        userTsid: user ? (user.tsid || '') : ''
      };
    });
  } catch (error) {
    console.error('Error enriching users info:', error);
    return rows.map(row => ({
      ...row,
      userName: 'Error Loading User',
      userEmail: 'N/A',
      userPhone: 'N/A',
      userTsid: ''
    }));
  }
}

function normalizeHelpRequestStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  if (normalized === 'in-progress') {
    return 'pending';
  }

  if (normalized === 'resolved') {
    return 'completed';
  }

  if (['new', 'pending', 'completed'].includes(normalized)) {
    return normalized;
  }

  return 'new';
}

async function connectAndSeed() {
  await getDb();

  const collectionsToCreate = ['users', 'services', 'partners', 'recommendation_questions', 'leads', 'form_help_requests', 'settings', 'contacts', 'claims', 'testimonials', 'user_policies', 'appointments', 'user_services', 'user_updates', 'listening'];
  for (const collectionName of collectionsToCreate) {
    await createCollectionIfNotExists(collectionName);
  }

  const existingAdmin = await findOne('users', { role: 'admin' });
  if (!existingAdmin) {
    const defaultEmail = 'admin@twinsure.com';
    const crypto = require('crypto');
    const adminPass = crypto.randomBytes(8).toString('hex');
    console.warn('\n========================================================');
    console.warn('WARNING: No administrative user found in the database.');
    console.warn(`A random password has been generated for ${defaultEmail}:`);
    console.warn(`Password: ${adminPass}`);
    console.warn('Please log in and change this password immediately.');
    console.warn('========================================================\n');

    await insertOne('users', {
      name: 'Super Admin',
      email: defaultEmail,
      password: adminPass,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  const existingSettings = await findOne('settings', { _id: 'global' });
  if (!existingSettings) {
    await insertOne('settings', {
      _id: 'global',
      supportEmail: 'support@twinsure.com',
      supportPhone: '+91 9750003600',
      whatsappGroupLink:
        'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.',
      maintenanceMode: false,
      emailNotifications: true,
      leadAlerts: true,
      partnerAlerts: true,
      claimAlerts: true,
      notificationPriority: 'high',
      sessionTimeout: '60',
      loginAttempts: '5',
      callbackSlot: true,
      partnerRegEnabled: true,
      referralTracking: true,
      publicCommissionInfo: false,
      minCommission: '5',
      maxCommission: '25',
      manualPartnerApproval: true,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    });
  }
  const settingsDefaults = {
    supportEmail: 'support@twinsure.com',
    supportPhone: '+91 9750003600',
    whatsappGroupLink:
      'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.'
  };

  const settingsPatch = {};
  for (const [key, value] of Object.entries(settingsDefaults)) {
    const currentValue = existingSettings ? existingSettings[key] : undefined;
    if (currentValue === undefined || currentValue === null || String(currentValue).trim() === '') {
      settingsPatch[key] = value;
    }
  }

  if (Object.keys(settingsPatch).length > 0) {
    await updateOne('settings', { _id: 'global' }, { $set: settingsPatch });
  }

  const existingTestimonial = await findOne('testimonials', {});
  if (!existingTestimonial) {
    console.log('Seeding initial testimonials...');
    const initialTestimonials = [
      {
        name: 'Murugan',
        from: 'from Karur',
        before: 'I am Murugan from Karur. About six months ago, I suffered a heart attack and was advised to undergo heart surgery at a hospital in Coimbatore. The surgery would cost around ₹6 lakh. Since I had a Star Health Insurance policy, I submitted a claim, but it was rejected. After being discharged and returning home, I submitted the claim again, but it was rejected once more for different reasons.',
        helped: 'At that point, a friend recommended Twins Consultancy. I immediately contacted them and shared all the necessary details. From the very beginning, their team guided me with speed and clarity. They explained exactly what needed to be done, how to submit the documents correctly, and what corrections were required. They carefully reviewed my case, corrected every mistake, and handled the entire process efficiently.',
        after: 'Thanks to the efforts of Twins Consultancy, I successfully received my insurance claim amount of ₹6 lakh this week. I am extremely happy and satisfied with the support they provided. Their guidance made a difficult process much easier, and I highly recommend Twins Consultancy to anyone seeking assistance with insurance claims.',
        avatarUrl: 'https://ui-avatars.com/api/?name=Murugan&background=random',
        displayOrder: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Lokanathan',
        from: 'Teacher from Chinnatharapuram',
        before: 'I am Lokanathan, a teacher from Chinnatharapuram. I had taken the Star Super Plus Policy through Twins Consultancy. Recently, I underwent surgical treatment at Royal Care Hospital. At that time, I was unable to receive the payment directly through the policy. Since I am a government employee, the policy was not directly applicable, and I had to seek reimbursement through the government scheme. Additionally, there were challenges in obtaining the eligible amount through my Star Health Policy.',
        helped: 'I am extremely grateful to Mr. Lakshmanan from Twins Consultancy, who personally guided and assisted me throughout the reimbursement process. He carefully handled the complexities involved in claiming benefits under the government policy and also addressed the issues related to my Star Health Policy. Even though it was a top-up policy and I initially considered leaving the matter as it was, Mr. Lakshmanan remained committed to ensuring that I received the amount I was rightfully entitled to. He continuously followed up and worked diligently until the reimbursement process was completed successfully.',
        after: 'Thanks to the dedicated efforts of Mr. Lakshmanan and the team at Twins Consultancy, I successfully received the reimbursement amount that I was eligible for. I will always remain thankful for their support, dedication, and persistence. I highly appreciate the service provided by Twins Consultancy and sincerely thank Mr. Lakshmanan for his invaluable assistance.',
        avatarUrl: 'https://ui-avatars.com/api/?name=Lokanathan&background=random',
        displayOrder: 2,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    for (const testimonial of initialTestimonials) {
      await insertOne('testimonials', testimonial);
    }
  }


}

const allowedOrigins = [
  process.env.API_BASE_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://twinsure.in',
  'https://www.twinsure.in',
  'http://twinsure.in',
  'http://www.twinsure.in'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

const getGlobalRateLimit = async () => {
  try {
    const settings = await findOne('settings', { _id: 'global' });
    return settings && settings.loginAttempts ? parseInt(settings.loginAttempts) * 200 : 1000;
  } catch (err) {
    return 1000;
  }
};

const getLoginRateLimit = async () => {
  try {
    const settings = await findOne('settings', { _id: 'global' });
    return settings && settings.loginAttempts ? parseInt(settings.loginAttempts) : 5;
  } catch (err) {
    return 5;
  }
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: async (req, res) => await getGlobalRateLimit(),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost');
  }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: async (req, res) => await getLoginRateLimit(),
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Handle JSON parse errors from body-parser and return JSON responses
app.use((err, req, res, next) => {
  if (!err) return next();

  // body-parser signals parse errors in a few ways; handle common cases
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    console.warn('Invalid JSON payload received for', req.method, req.path);
    sendJson(res, 400, { message: 'Invalid JSON payload.' });
    return;
  }

  // Not a JSON parse error — forward to default error handling
  next(err);
});

// Static upload routes removed — files are now served from Cloudflare R2
app.use(express.static(publicDir));
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function createApiRouter() {
  const router = express.Router();
  router.use(globalLimiter);

  router.post('/auth/login', strictLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.email || !data.password) {
      sendJson(res, 400, { message: 'Incomplete data.' });
      return;
    }

    try {
      const user = await findOne('users', {
        $or: [
          { email: data.email },
          { phone: data.email }
        ]
      });
      if (!user) {
        sendJson(res, 401, { message: 'User not found.' });
        return;
      }

      if (data.password !== user.password) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      const settings = await findOne('settings', { _id: 'global' });
      if (settings && settings.maintenanceMode && user.role !== 'admin') {
        sendJson(res, 503, { message: 'Maintenance mode - try after some time, or else try contacting admin' });
        return;
      }

      if (!config.jwtSecret) {
        sendJson(res, 500, { message: 'Server configuration error.' });
        return;
      }
      const timeoutMinutes = settings && settings.sessionTimeout ? parseInt(settings.sessionTimeout) : 60;
      const token = jwt.sign({ id: user._id, role: user.role }, config.jwtSecret, { expiresIn: `${timeoutMinutes}m` });
      sendJson(res, 200, {
        message: 'Login successful.',
        token,
        role: user.role,
        name: user.name
      });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/auth/register', globalLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.name || !data.email || !data.phone || !data.password) {
      sendJson(res, 400, { message: 'Incomplete registration data.' });
      return;
    }

    try {
      const existingUser = await findOne('users', {
        $or: [
          { email: data.email },
          { phone: data.phone }
        ]
      });

      if (existingUser) {
        sendJson(res, 400, { message: 'User with this email or phone number already exists.' });
        return;
      }

      // Generate sequential unique user ID: U{YEAR}{3-digit count}
      // Count ALL users ever registered (including deleted ones tracked by max tsid sequence)
      // to ensure IDs are never reused even if mid-users are deleted.
      const currentYear = new Date().getFullYear();
      const db = getDb();
      const allUserTsids = await db.collection('users')
        .find({ role: 'user', tsid: { $regex: `^U${currentYear}` } }, { projection: { tsid: 1 } })
        .toArray();

      // Find the highest sequence number used this year
      let maxSeq = 0;
      for (const u of allUserTsids) {
        const match = u.tsid && u.tsid.match(/^U\d{4}(\d+)$/);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      }
      const nextSeq = maxSeq + 1;
      const generatedTsid = `U${currentYear}${String(nextSeq).padStart(3, '0')}`;

      const userId = await insertOne('users', {
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: data.password,
        role: 'user',
        kyc: {
          status: 'Not Verified',
          aadhaar: null,
          pan: null,
          voterid: null,
          photo: null
        },
        tsid: generatedTsid,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await insertOne('user_updates', {
        userId: String(userId),
        title: 'Welcome to Twinsure!',
        message: 'Your user profile has been successfully created. Complete your KYC verification to get started.',
        category: 'Services',
        status: 'Approved',
        createdAt: new Date()
      });

      sendJson(res, 201, { message: 'Registration successful.' });
    } catch (error) {
      console.error('Database/Server Error during registration:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });
  router.post('/auth/forgot-password-otp', globalLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.email) {
      sendJson(res, 400, { message: 'Try again' });
      return;
    }

    try {
      const user = await findOne('users', { email: data.email });
      if (!user) {
        sendJson(res, 400, { message: 'Try again' });
        return;
      }

      if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.lockoutUntil) - new Date()) / 60000);
        sendJson(res, 403, { message: `Try after ${remainingMinutes} minutes. If this issue persists then contact the admin.` });
        return;
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 15 * 60000);

      await updateOne('users', { _id: toObjectId(user._id) }, {
        $set: {
          otp,
          otpExpiry,
          failedOtpAttempts: 0
        }
      });

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: user.email,
        subject: 'Password Reset OTP - Twinsure',
        html: `
<div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #001533; padding: 20px; text-align: center; border-bottom: 3px solid #fdc500;">
    <h1 style="color: #ffffff; margin: 0; font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 24px; letter-spacing: 1px;">Twinsure</h1>
  </div>
  <div style="padding: 30px; background-color: #ffffff; color: #334155;">
    <h2 style="color: #00296b; margin-top: 0; font-size: 20px;">Password Reset Request</h2>
    <p style="font-size: 15px; line-height: 1.6;">Hello,</p>
    <p style="font-size: 15px; line-height: 1.6;">A password reset was requested for your account at this time. Please use the following OTP to proceed:</p>
    <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 15px; text-align: center; margin: 25px 0;">
      <span style="font-size: 32px; font-weight: 700; color: #003f88; letter-spacing: 5px;">${otp}</span>
    </div>
    <p style="font-size: 14px; color: #ef4444; font-weight: 600; text-align: center; margin-bottom: 25px;">This OTP is valid only for 5 minutes from now.</p>
    <div style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
      <p style="font-size: 14px; line-height: 1.5; color: #64748b;"><strong>Security Alert:</strong> If you didn't request this OTP, kindly contact our team and then try changing your password immediately to secure your account.</p>
    </div>
  </div>
  <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
    <p style="margin: 0 0 5px 0;"><strong>Twinsure Admin Contact</strong></p>
    <p style="margin: 0 0 5px 0;">Email: support@twinsure.com | Phone: +91 9750003600</p>
    <p style="margin: 0;">Twinsure H.Q., Chennai, Tamil Nadu - 600xxx</p>
  </div>
</div>
        `
      };

      mailTransporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('Email error:', error);
        }
      });

      sendJson(res, 200, { message: 'OTP sent' });
    } catch (error) {
      console.error('Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/auth/verify-otp', globalLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.email || !data.otp) {
      sendJson(res, 400, { message: 'Incomplete data.' });
      return;
    }
    try {
      const user = await findOne('users', { email: data.email });
      if (!user) {
        sendJson(res, 400, { message: 'Invalid request.' });
        return;
      }

      if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.lockoutUntil) - new Date()) / 60000);
        sendJson(res, 403, { message: `Try after ${remainingMinutes} minutes. If this issue persists then contact the admin.` });
        return;
      }

      if (!user.otp || user.otp !== data.otp || new Date(user.otpExpiry) < new Date()) {
        let attempts = (user.failedOtpAttempts || 0) + 1;
        let updateData = { failedOtpAttempts: attempts };
        let message = 'Invalid or expired OTP.';

        if (attempts >= 5) {
          updateData.lockoutUntil = new Date(Date.now() + 60 * 60000); // 1 hour
          message = 'You have reached the limit of attempts. Try after 60 minutes. If this issue persists then contact the admin.';
        }

        await updateOne('users', { _id: toObjectId(user._id) }, { $set: updateData });
        sendJson(res, 400, { message });
        return;
      }

      await updateOne('users', { _id: toObjectId(user._id) }, {
        $set: { otp: null, otpExpiry: null, failedOtpAttempts: 0 },
        $unset: { lockoutUntil: "" }
      });

      if (!config.jwtSecret) throw new Error('Server misconfiguration');
      const resetToken = jwt.sign({ email: user.email, intent: 'reset' }, config.jwtSecret, { expiresIn: '15m' });
      sendJson(res, 200, { message: 'OTP verified', resetToken });
    } catch (error) {
      console.error('Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/auth/reset-password', globalLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.resetToken || !data.newPassword) {
      sendJson(res, 400, { message: 'Incomplete data.' });
      return;
    }
    try {
      if (!config.jwtSecret) throw new Error('Server misconfiguration');
      const decoded = jwt.verify(data.resetToken, config.jwtSecret);
      if (decoded.intent !== 'reset') {
        throw new Error('Invalid token intent');
      }
      const user = await findOne('users', { email: decoded.email });
      if (!user) {
        sendJson(res, 400, { message: 'User not found.' });
        return;
      }

      await updateOne('users', { _id: toObjectId(user._id) }, {
        $set: { password: data.newPassword }
      });

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: user.email,
        subject: 'Password Reset Successful - Twinsure',
        html: `
<div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #001533; padding: 20px; text-align: center; border-bottom: 3px solid #fdc500;">
    <h1 style="color: #ffffff; margin: 0; font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 24px; letter-spacing: 1px;">Twinsure</h1>
  </div>
  <div style="padding: 30px; background-color: #ffffff; color: #334155;">
    <div style="text-align: center; margin-bottom: 20px;">
      <div style="display: inline-block; background-color: #dcfce7; border-radius: 50%; width: 60px; height: 60px; line-height: 60px; color: #22c55e; font-size: 30px; font-weight: bold;">✓</div>
    </div>
    <h2 style="color: #00296b; margin-top: 0; font-size: 20px; text-align: center;">Password Reset Successful</h2>
    <p style="font-size: 15px; line-height: 1.6; text-align: center;">Your password has been successfully reset. You can now log in using your new credentials.</p>
    <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 25px;">
      <p style="font-size: 14px; line-height: 1.5; color: #64748b;"><strong>Security Alert:</strong> If you did not perform this action, it means your account may be compromised. Please contact our Twinsure admin support team immediately.</p>
    </div>
  </div>
  <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
    <p style="margin: 0 0 5px 0;"><strong>Twinsure Admin Contact</strong></p>
    <p style="margin: 0 0 5px 0;">Email: support@twinsure.com | Phone: +91 9750003600</p>
    <p style="margin: 0;">Twinsure H.Q., 6, 2nd cross, Gowripuram Extension, Gowripuram, Karur, Tamil Nadu - 639002</p>
  </div>
</div>
        `
      };

      mailTransporter.sendMail(mailOptions, (error, info) => {
        if (error) console.error('Email error:', error);
      });

      sendJson(res, 200, { message: 'Password reset successfully' });
    } catch (error) {
      console.error('Error:', error.message);
      sendJson(res, 400, { message: 'Invalid or expired reset token.' });
    }
  });


  router.get('/public/claims', async (req, res) => {
    try {
      const claims = await findMany('claims', { status: 'active' }, { sort: { lastUpdated: -1 } });
      sendJson(res, 200, claims.map((claim) => ({
        ...claim,
        createdAt: claim.createdAt ? formatDateTime(claim.createdAt) : claim.createdAt,
        lastUpdated: claim.lastUpdated ? formatDateTime(claim.lastUpdated) : claim.lastUpdated
      })));
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/public/contact', strictLimiter, async (req, res) => {
    const data = collectBody(req);
    const name = normalizeString(data.name);
    const phone = normalizeString(data.phone);
    const city = normalizeString(data.city);

    if (!name || !phone || !city) {
      sendJson(res, 400, { error: 'Name, phone and city are required.' });
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      sendJson(res, 400, { error: 'Invalid phone number.' });
      return;
    }

    const email = normalizeString(data.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 400, { error: 'Invalid email address.' });
      return;
    }

    try {
      await insertOne('contacts', {
        name,
        phone,
        city,
        email,
        altPhone: normalizeString(data.altPhone),
        address: normalizeString(data.address),
        enquiryType: normalizeString(data.enquiryType),
        specify: normalizeString(data.specify).slice(0, 100),
        submittedAt: new Date(),
        status: 'new'
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.get('/public/settings', async (req, res) => {
    try {
      const settings = await findOne('settings', { _id: 'global' });
      sendJson(res, 200, {
        supportEmail: settings?.supportEmail || 'support@twinsure.com',
        supportPhone: settings?.supportPhone || '+91 9750003600',
        whatsappGroupLink:
          settings?.whatsappGroupLink ||
          'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.',
        callbackSlot: settings?.callbackSlot !== undefined ? settings.callbackSlot : true,
        maintenanceMode: !!settings?.maintenanceMode
      });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.get('/public/recommendation_flow', async (req, res) => {
    try {
      const flows = await findMany('recommendation_questions', {});
      if (flows.length > 0) {
        const flow = { ...flows[0] };
        delete flow._id;
        sendJson(res, 200, flow);
        return;
      }

      sendJson(res, 200, { greeting: '', nodes: [], edges: [] });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/public/submit_lead', strictLimiter, async (req, res) => {
    const data = collectBody(req);
    if (!data.name || !data.phone) {
      sendJson(res, 400, { error: 'Name and phone are required.' });
      return;
    }

    try {
      await insertOne('leads', {
        name: normalizeString(data.name),
        phone: normalizeString(data.phone),
        email: normalizeString(data.email),
        answers: Array.isArray(data.answers) ? data.answers : [],
        callbackSlots: Array.isArray(data.callbackSlots) ? data.callbackSlots : [],
        submittedAt: new Date(),
        status: 'new'
      });

      const settings = await findOne('settings', { _id: 'global' });
      if (settings && settings.leadAlerts) {
        const leadSubject = `New Lead Submitted: ${normalizeString(data.name)}`;
        const leadHtml = `
          <h3>New Lead Details</h3>
          <p><strong>Name:</strong> ${normalizeString(data.name)}</p>
          <p><strong>Phone:</strong> ${normalizeString(data.phone)}</p>
          <p><strong>Email:</strong> ${normalizeString(data.email || 'N/A')}</p>
          <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>
        `;
        await sendAdminAlertEmail(leadSubject, leadHtml, settings.notificationPriority || 'normal');
      }

      sendJson(res, 200, { success: true, message: 'Lead submitted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/public/form_help_requests', strictLimiter, async (req, res) => {
    const data = collectBody(req);
    const name = normalizeString(data.name);
    const phone = normalizeString(data.phone);
    const description = normalizeString(data.description);
    const claimId = normalizeString(data.claimId);
    const claimName = normalizeString(data.claimName) || 'Claim Form';
    const claimCategory = normalizeString(data.claimCategory);

    const namePattern = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
    const phonePattern = /^[0-9+\-()\s]{10,18}$/;

    if (!name || !namePattern.test(name)) {
      sendJson(res, 400, { message: 'Please enter a valid name.' });
      return;
    }

    if (!phone || !phonePattern.test(phone) || (phone.match(/\d/g) || []).length < 10) {
      sendJson(res, 400, { message: 'Please enter a valid phone number with at least 10 digits.' });
      return;
    }

    if (description.length > 500) {
      sendJson(res, 400, { message: 'Description must be 500 characters or fewer.' });
      return;
    }

    try {
      const requestId = `fhr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const timestamp = formatDateTime(new Date());

      await insertOne('form_help_requests', {
        requestId,
        name,
        phone,
        description,
        claimId,
        claimName,
        claimCategory,
        status: 'new',
        submittedAt: timestamp,
        updatedAt: timestamp,
        source: 'downloads'
      });

      sendJson(res, 201, {
        success: true,
        message: 'Your request has been submitted. Our team will contact you shortly.'
      });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/public/download_request', strictLimiter, async (req, res) => {
    const data = collectBody(req);
    const name = normalizeString(data.name);
    const method = normalizeString(data.method); // 'phone' or 'email'
    const phone = normalizeString(data.phone);
    const email = normalizeString(data.email);
    const claimId = normalizeString(data.claimId);
    const claimName = normalizeString(data.claimName) || 'Claim Form';
    const claimCategory = normalizeString(data.claimCategory);
    const additionalClaimIds = Array.isArray(data.additionalClaimIds) ? data.additionalClaimIds : [];

    const namePattern = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
    if (!name || !namePattern.test(name)) {
      sendJson(res, 400, { message: 'Please enter a valid name.' });
      return;
    }

    const hasHelpRequest = !!data.helpDescription;

    if (method === 'phone' || hasHelpRequest) {
      const phonePattern = /^[0-9+\-()\s]{10,18}$/;
      if (!phone || !phonePattern.test(phone) || (phone.match(/\d/g) || []).length < 10) {
        sendJson(res, 400, { message: 'Please enter a valid phone number with at least 10 digits.' });
        return;
      }
    }
    
    if (method === 'email') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailPattern.test(email)) {
        sendJson(res, 400, { message: 'Please enter a valid email address.' });
        return;
      }
    } else if (method !== 'phone') {
      sendJson(res, 400, { message: 'Invalid download method.' });
      return;
    }

    try {
      const claim = await findOne('claims', { _id: toObjectId(claimId) });
      if (!claim) {
        sendJson(res, 404, { message: 'Claim form not found.' });
        return;
      }

      // Fetch additional claim forms if requested
      let additionalClaims = [];
      if (method === 'email' && additionalClaimIds.length > 0) {
        const objectIds = additionalClaimIds.map(id => toObjectId(id)).filter(id => id !== null);
        additionalClaims = await findMany('claims', { _id: { $in: objectIds } });
      }

      const allRequestedClaims = [claim].concat(additionalClaims);
      const formNamesList = allRequestedClaims.map(c => c.name);

      const requestId = `fhr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const timestamp = formatDateTime(new Date());

      const helpDescription = data.helpDescription ? normalizeString(data.helpDescription) : '';
      const defaultDesc = method === 'email'
        ? `Sent Claim Form(s) to Email: ${email} (${formNamesList.join(', ')})`
        : `Downloaded Claim Form (Phone: ${phone})`;
      
      const finalDescription = helpDescription
        ? `[Help Requested] ${helpDescription} | ${defaultDesc}`
        : defaultDesc;

      await insertOne('form_help_requests', {
        requestId,
        name,
        phone: (method === 'phone' || helpDescription) ? phone : '',
        email: method === 'email' ? email : '',
        description: finalDescription,
        claimId,
        claimName: formNamesList.join(', '),
        claimCategory,
        status: 'new',
        submittedAt: timestamp,
        updatedAt: timestamp,
        source: helpDescription 
          ? 'download_help' 
          : (method === 'email' ? 'download_email' : 'download_phone')
      });

      // Increment downloads count for primary form
      await updateOne('claims', { _id: toObjectId(claimId) }, { $inc: { downloads: 1 } });
      // Increment downloads count for additional forms
      for (const addon of additionalClaims) {
        await updateOne('claims', { _id: toObjectId(addon._id) }, { $inc: { downloads: 1 } });
      }

      if (method === 'email') {
        const smtpUser = process.env.SMTP_USER || '';
        const smtpPass = process.env.SMTP_PASS || '';

        if (!smtpUser || !smtpPass) {
          console.warn('SMTP Credentials not configured in .env. Email simulated successfully.');
          sendJson(res, 200, {
            success: true,
            simulated: true,
            message: 'Email dispatch simulated (SMTP credentials not configured in environment).'
          });
          return;
        }

        // Build email attachments list and claim details HTML block
        const attachments = [];
        let claimFormsHtml = '';

        for (const c of allRequestedClaims) {
          if (!c.filePath) continue;
          try {
            // Fetch file buffer directly from R2 (no local disk involved)
            const buffer = await r2.getBufferFromR2(c.filePath);
            attachments.push({
              filename    : c.fileName || `${c.name}.pdf`,
              content     : buffer,
              contentType : 'application/pdf'
            });

            // HTML display item for each claim form
            claimFormsHtml += `
            <div style="margin-bottom: 20px; padding: 15px; border-left: 4px solid #00296b; background-color: #f8fafc; border-radius: 0 8px 8px 0;">
              <h3 style="margin: 0 0 5px 0; color: #00296b; font-size: 16px; font-family: 'Outfit', sans-serif;">${c.name}</h3>
              <span style="display: inline-block; font-size: 11px; background-color: #003f88; color: #ffffff; padding: 2px 8px; border-radius: 12px; margin-bottom: 8px; font-weight: 600;">${c.category || 'General'}</span>
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #475569; white-space: pre-line;">${c.description || 'Download this form to start your claim.'}</p>
            </div>
            `;
          } catch (fetchErr) {
            console.error(`Failed to fetch claim PDF from R2 (key: ${c.filePath}):`, fetchErr.message);
          }
        }

        if (attachments.length === 0) {
          sendJson(res, 404, { message: 'Requested PDF document files not found on server.' });
          return;
        }

        // Clean subject line logic
        let subject = `Your Requested Claim Form: ${claim.name}`;
        if (additionalClaims.length > 0) {
          subject = `Your Requested Claim Forms - Twinsure`;
        }

        const mailOptions = {
          from: `"Twinsure Claims" <${smtpUser}>`,
          to: email,
          subject: subject,
          html: `
<div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #001533; padding: 20px; text-align: center; border-bottom: 3px solid #fdc500;">
    <h1 style="color: #ffffff; margin: 0; font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 24px; letter-spacing: 1px;">Twinsure</h1>
  </div>
  <div style="padding: 30px; background-color: #ffffff; color: #334155;">
    <h2 style="color: #00296b; margin-top: 0; font-size: 20px; font-family: 'Outfit', sans-serif;">Requested Claim Documents</h2>
    <p style="font-size: 15px; line-height: 1.6;">Dear <strong>${name}</strong>,</p>
    <p style="font-size: 15px; line-height: 1.6;">Thank you for contacting Twinsure. Please find attached the claim form(s) you requested. The details of the requested documents are shown below:</p>
    
    ${claimFormsHtml}
    
    <div style="margin: 25px 0; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
      <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">
        <strong>Need professional support?</strong><br>
        Our claims experts can guide you through form-filling, document verification, and admission/discharge negotiation with the insurer.
      </p>
    </div>
  </div>
  <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
    <p style="margin: 0 0 5px 0;"><strong>Twinsure Support & Services</strong></p>
    <p style="margin: 0 0 5px 0;">Email: support@twinsure.com | Phone: +91 9750003600</p>
    <p style="margin: 0;">Twinsure H.Q., 6, 2nd cross, Gowripuram Extension, Gowripuram, Karur, Tamil Nadu - 639002</p>
  </div>
</div>
          `,
          attachments: attachments
        };

        await mailTransporter.sendMail(mailOptions);
      }

      sendJson(res, 200, {
        success: true,
        message: method === 'email'
          ? 'Claim form has been sent to your email successfully.'
          : 'Verification successful. Your download will start now.'
      });
    } catch (error) {
      console.error('Database/Mail Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal error occurred while processing your request.' });
    }
  });

  router.get('/public/download_claim', async (req, res) => {
    const id = normalizeString(req.query.id);

    if (!id) {
      res.status(400).send('Claim ID is required.');
      return;
    }

    try {
      const claim = await findOne('claims', { _id: toObjectId(id) });
      if (!claim) {
        res.status(404).send('Claim form not found.');
        return;
      }

      await updateOne('claims', { _id: toObjectId(id) }, { $inc: { downloads: 1 } });

      // Fetch file buffer directly from R2 and serve as attachment
      const buffer = await r2.getBufferFromR2(claim.filePath);
      const contentType = r2.getContentType(claim.fileName) || 'application/pdf';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${claim.fileName || 'document.pdf'}"`);
      res.send(buffer);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      res.status(500).send('An internal server error occurred.');
    }
  });

  router.get('/admin/claims', requireRole('admin'), async (req, res) => {
    try {
      const claims = await findMany('claims', {}, { sort: { lastUpdated: -1 } });
      sendJson(res, 200, claims.map((claim) => ({
        ...claim,
        createdAt: claim.createdAt ? formatDateTime(claim.createdAt) : claim.createdAt,
        lastUpdated: claim.lastUpdated ? formatDateTime(claim.lastUpdated) : claim.lastUpdated
      })));
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/admin/claims', requireRole('admin'), upload.single('pdf'), async (req, res) => {
    const body = collectBody(req);
    const id = normalizeString(body.id);
    const name = normalizeString(body.name);
    const category = normalizeString(body.category);
    const description = normalizeString(body.description);
    const status = normalizeString(body.status) || 'active';

    if (!name || !category) {
      sendJson(res, 400, { message: 'Form Name and Category are required.' });
      return;
    }

    try {
      let existingClaim = null;
      if (id) {
        existingClaim = await findOne('claims', { _id: toObjectId(id) });
        if (!existingClaim) {
          sendJson(res, 404, { message: 'Claim form not found for updating.' });
          return;
        }
      }

      let fileName = null;
      let filePath = null;
      let fileSize = null;

      if (req.file) {
        if (!isPdfFile(req.file)) {
          sendJson(res, 400, { message: 'Only PDF files are allowed.' });
          return;
        }

        const cleanName = sanitizeFileName(req.file.originalname);
        fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        const r2Key = `${r2.R2_PATHS.CLAIM_FORMS}/${fileName}`;
        await r2.uploadToR2(req.file.buffer, r2Key, 'application/pdf');
        filePath = r2Key;
        fileSize = formatFileSize(req.file.size);
      }

      if (!id && !filePath) {
        sendJson(res, 400, { message: 'PDF document upload is required for new claim forms.' });
        return;
      }

      const now = new Date();
      const adminName = await getAdminName(req.user.id);

      // Store R2 key directly (no local path)
      if (!id) {
        await insertOne('claims', {
          name,
          category,
          description,
          status,
          fileName,
          filePath,          // R2 key e.g. "public/claim-forms/xxx.pdf"
          fileSize,
          downloads  : 0,
          uploadedBy : adminName,
          createdAt  : now,
          lastUpdated: now
        });
        sendJson(res, 201, { success: true, message: 'Claim form published successfully.' });
        return;
      }

      const finalFileName = fileName !== null ? fileName : existingClaim.fileName;
      const finalFilePath = filePath !== null ? filePath : existingClaim.filePath;
      const finalFileSize = fileSize !== null ? fileSize : existingClaim.fileSize;

      // Delete the old file from R2 if a new file was uploaded
      if (filePath !== null && existingClaim.filePath) {
        try {
          await r2.deleteFromR2(existingClaim.filePath);
        } catch (r2Err) {
          console.error(`Failed to delete old file from R2 for claim ${id}:`, r2Err.message);
        }
      }

      await updateOne('claims', { _id: toObjectId(id) }, {
        $set: {
          name,
          category,
          description,
          status,
          fileName: finalFileName,
          filePath: finalFilePath,
          fileSize: finalFileSize,
          lastUpdated: now
        }
      });

      sendJson(res, 200, { success: true, message: 'Claim form updated successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      if (error.message.includes('R2 configuration') || error.message.includes('R2_')) {
        sendJson(res, 500, { message: `Storage Error: ${error.message}` });
      } else {
        sendJson(res, 500, { message: 'An internal server error occurred.' });
      }
    }
  });


  router.delete('/admin/claims', requireRole('admin'), async (req, res) => {
    const id = normalizeString(req.query.id);
    if (!id) {
      sendJson(res, 400, { message: 'Claim ID is required for deletion.' });
      return;
    }

    try {
      const claim = await findOne('claims', { _id: toObjectId(id) });
      if (claim && claim.filePath) {
        try {
          await r2.deleteFromR2(claim.filePath);
        } catch (r2Err) {
          console.error(`Failed to delete file from R2 for claim ${id}:`, r2Err.message);
        }
      }

      await deleteOne('claims', { _id: toObjectId(id) });
      sendJson(res, 200, { success: true, message: 'Claim form deleted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.get('/admin/contacts', requireRole('admin'), async (req, res) => {
    try {
      const contacts = await findMany('contacts', {}, { sort: { submittedAt: -1 } });
      sendJson(res, 200, contacts.map((contact) => ({
        ...contact,
        submittedAt: contact.submittedAt ? formatDateTime(contact.submittedAt) : contact.submittedAt
      })));
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/contacts', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.id || !data.status) {
      sendJson(res, 400, { error: 'id and status required' });
      return;
    }

    try {
      await updateOne('contacts', { _id: toObjectId(data.id) }, { $set: { status: data.status } });
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/contacts', requireRole('admin'), async (req, res) => {
    const id = normalizeString(req.query.id);
    if (!id) {
      sendJson(res, 400, { error: 'id required' });
      return;
    }

    try {
      await deleteOne('contacts', { _id: toObjectId(id) });
      sendJson(res, 200, { success: true, message: 'Contact deleted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/contacts/bulk-delete', requireRole('admin'), async (req, res) => {
    try {
      const data = collectBody(req);
      const ids = data.ids;
      if (!ids || !Array.isArray(ids)) {
        sendJson(res, 400, { error: 'Invalid or missing ids array' });
        return;
      }
      const db = await getDb();
      const collection = db.collection('contacts');
      const objectIds = ids.map(id => {
        try {
          return new ObjectId(id);
        } catch (e) {
          return id;
        }
      });
      const result = await collection.deleteMany({ _id: { $in: objectIds } });
      sendJson(res, 200, { success: true, deletedCount: result.deletedCount });
    } catch (error) {
      console.error('Bulk Delete Contacts Error:', error.message);
      sendJson(res, 500, { error: 'Failed to delete contacts' });
    }
  });

  router.get('/admin/leads', requireRole('admin'), async (req, res) => {
    try {
      const leads = await findMany('leads', {}, { sort: { submittedAt: -1 } });
      sendJson(res, 200, leads.map((lead) => ({
        ...lead,
        submittedAt: lead.submittedAt ? formatDateTime(lead.submittedAt) : lead.submittedAt
      })));
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/leads/bulk-delete', requireRole('admin'), async (req, res) => {
    try {
      const data = collectBody(req);
      const ids = data.ids;
      if (!ids || !Array.isArray(ids)) {
        sendJson(res, 400, { error: 'Invalid or missing ids array' });
        return;
      }
      const db = await getDb();
      const collection = db.collection('leads');
      const objectIds = ids.map(id => {
        try {
          return new ObjectId(id);
        } catch (e) {
          return id;
        }
      });
      const result = await collection.deleteMany({ _id: { $in: objectIds } });
      sendJson(res, 200, { success: true, deletedCount: result.deletedCount });
    } catch (error) {
      console.error('Bulk Delete Error:', error.message);
      sendJson(res, 500, { error: 'Failed to delete leads' });
    }
  });

  router.post('/admin/leads', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.id) {
      sendJson(res, 400, { error: 'id is required' });
      return;
    }

    try {
      const updateFields = {};
      if (data.status !== undefined) updateFields.status = data.status;
      if (data.notes !== undefined) updateFields.notes = data.notes;
      if (data.tags !== undefined) updateFields.tags = data.tags;
      if (data.followUpDate !== undefined) updateFields.followUpDate = data.followUpDate;

      const updateQuery = {};
      if (Object.keys(updateFields).length > 0) {
        updateQuery.$set = updateFields;
      }

      if (data.logMessage) {
        const timestamp = formatDateTime(new Date());
        updateQuery.$push = {
          activityLog: {
            message: data.logMessage,
            timestamp: timestamp
          }
        };
      }

      if (Object.keys(updateQuery).length > 0) {
        await updateOne('leads', { _id: toObjectId(data.id) }, updateQuery);
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.get('/admin/form_help_requests', requireRole('admin'), async (req, res) => {
    try {
      const requests = await findMany('form_help_requests', {}, { sort: { submittedAt: -1 } });
      sendJson(res, 200, requests);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/admin/form_help_requests', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.id || !data.status) {
      sendJson(res, 400, { message: 'id and status required' });
      return;
    }

    try {
      await updateOne('form_help_requests', { requestId: normalizeString(data.id) }, {
        $set: {
          status: normalizeHelpRequestStatus(data.status),
          updatedAt: formatDateTime(new Date())
        }
      });
      sendJson(res, 200, { success: true, message: 'Request status updated successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.delete('/admin/form_help_requests', requireRole('admin'), async (req, res) => {
    const id = normalizeString(req.query.id);
    if (!id) {
      sendJson(res, 400, { message: 'id required' });
      return;
    }

    try {
      await deleteOne('form_help_requests', { requestId: id });
      sendJson(res, 200, { success: true, message: 'Request deleted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.get('/admin/partners', requireRole('admin'), async (req, res) => {
    try {
      const filter = req.query.id ? { _id: toObjectId(req.query.id) } : {};
      const rows = await findMany('partners', filter);
      sendJson(res, 200, rows);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/public/partners', strictLimiter, upload.single('photo'), async (req, res) => {
    try {
      const name = normalizeString(req.body.name);
      const phone = normalizeString(req.body.phone);
      const email = normalizeString(req.body.email);
      const address = normalizeString(req.body.address);
      const occupation = normalizeString(req.body.occupation);
      const meta = {};

      if (occupation === 'student') {
        meta.college = normalizeString(req.body.college);
        meta.course = normalizeString(req.body.course);
      } else {
        meta.company = normalizeString(req.body.company);
        meta.designation = normalizeString(req.body.designation);
      }

      if (!name || !phone || !email) {
        sendJson(res, 400, { message: 'Missing required fields (name, phone, email).' });
        return;
      }

      let photoPath = null;
      if (req.file) {
        if (!isImageFile(req.file)) {
          sendJson(res, 400, { message: 'Invalid file type. Only JPG and PNG are allowed.' });
          return;
        }

        const originalName = sanitizeFileName(req.file.originalname);
        const ext = path.extname(originalName).toLowerCase();
        const safe = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const filename = `${safe}_${Date.now()}${ext}`;
        const r2Key = `${r2.R2_PATHS.PARTNERS}/${filename}`;
        await r2.uploadToR2(req.file.buffer, r2Key, r2.getContentType(filename));
        photoPath = r2Key;
      }

      const insertedId = await insertOne('partners', {
        name,
        phone,
        email,
        address,
        occupation,
        meta,
        photo: photoPath,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      sendJson(res, 201, { message: 'Partner created', id: String(insertedId) });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      if (error.message.includes('R2 configuration') || error.message.includes('R2_')) {
        sendJson(res, 500, { message: `Storage Error: ${error.message}` });
      } else {
        sendJson(res, 500, { message: 'An internal server error occurred.' });
      }
    }
  });


  router.put('/admin/partners', requireRole('admin'), async (req, res) => {
    const input = collectBody(req);
    const id = normalizeString(input.id);
    if (!id) {
      sendJson(res, 400, { message: 'Missing id parameter.' });
      return;
    }

    try {
      const updateData = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.address !== undefined) updateData.address = input.address;
      if (input.occupation !== undefined) updateData.occupation = input.occupation;
      if (input.status !== undefined) updateData.status = input.status;

      const meta = {};
      if (input.college !== undefined) meta.college = input.college;
      if (input.course !== undefined) meta.course = input.course;
      if (input.company !== undefined) meta.company = input.company;
      if (input.designation !== undefined) meta.designation = input.designation;
      if (Object.keys(meta).length > 0) {
        updateData.meta = meta;
      }

      updateData.updatedAt = new Date();

      await updateOne('partners', { _id: toObjectId(id) }, { $set: updateData });
      sendJson(res, 200, { message: 'Updated' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.delete('/admin/partners', requireRole('admin'), async (req, res) => {
    const input = collectBody(req);
    const id = normalizeString(input.id || req.query.id);
    if (!id) {
      sendJson(res, 400, { message: 'Missing id parameter.' });
      return;
    }

    try {
      await deleteOne('partners', { _id: toObjectId(id) });
      sendJson(res, 200, { message: 'Deleted' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.get('/admin/recommendations', requireRole('admin'), async (req, res) => {
    try {
      const flows = await findMany('recommendation_questions', {});
      if (flows.length === 0) {
        sendJson(res, 200, {
          greeting: "Welcome! Let's find the best insurance plan for you.",
          nodes: [],
          edges: []
        });
        return;
      }

      sendJson(res, 200, flows[0]);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/admin/recommendations', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);

    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      sendJson(res, 400, { message: 'Invalid flow data structure.' });
      return;
    }

    try {
      const db = await getDb();
      await db.collection('recommendation_questions').deleteMany({});
      await insertOne('recommendation_questions', {
        greeting: data.greeting || '',
        nodes: data.nodes,
        edges: data.edges,
        updatedAt: new Date()
      });

      sendJson(res, 200, { message: 'Recommendation flow saved successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.get('/admin/settings', requireRole('admin'), async (req, res) => {
    try {
      const settings = await findOne('settings', { _id: 'global' });
      if (settings) {
        sendJson(res, 200, settings);
        return;
      }

      sendJson(res, 404, { error: 'Settings not found' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/settings', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data || Object.keys(data).length === 0) {
      sendJson(res, 400, { error: 'Invalid payload' });
      return;
    }

    try {
      const updateData = { ...data };
      delete updateData._id;
      updateData.updatedAt = formatDateTime(new Date());

      await updateOne('settings', { _id: 'global' }, { $set: updateData }, { upsert: true });
      sendJson(res, 200, { success: true, message: 'Settings updated successfully' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/change-password', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.oldPassword || !data.newPassword) {
      sendJson(res, 400, { message: 'Old password and new password are required.' });
      return;
    }

    if (data.newPassword.length < 6) {
      sendJson(res, 400, { message: 'New password must be at least 6 characters long.' });
      return;
    }

    try {
      const admin = await findOne('users', { _id: toObjectId(req.user.id) });
      if (!admin) {
        sendJson(res, 404, { message: 'Admin not found.' });
        return;
      }

      if (admin.password !== data.oldPassword) {
        sendJson(res, 400, { message: 'Incorrect current password.' });
        return;
      }

      await updateOne('users', { _id: toObjectId(req.user.id) }, {
        $set: { password: data.newPassword, updatedAt: new Date() }
      });
      sendJson(res, 200, { success: true, message: 'Password changed successfully.' });
    } catch (error) {
      console.error('Change admin password error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.get('/admin/users', requireRole('admin'), async (req, res) => {
    try {
      const users = await findMany('users', {});
      sendJson(res, 200, users.map((user) => {
        const clone = { ...user };
        delete clone.password;
        return clone;
      }));
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.post('/admin/users', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.name || !data.email || !data.role || !data.password) {
      sendJson(res, 400, { message: 'Incomplete data.' });
      return;
    }

    try {
      await insertOne('users', {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      sendJson(res, 201, { message: 'User created successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  router.put('/admin/users/:id', requireRole('admin'), async (req, res) => {
    try {
      const data = collectBody(req);
      if (!data.name || !data.email || !data.role) {
        sendJson(res, 400, { error: 'Incomplete data.' });
        return;
      }

      const userId = req.params.id;
      const updateData = {
        name: data.name,
        email: data.email,
        role: data.role,
        updatedAt: new Date()
      };

      if (data.password && data.password.trim() !== "") {
        updateData.password = data.password.trim();
      }

      const updated = await updateOne('users', { _id: new ObjectId(userId) }, { $set: updateData });

      if (updated && updated.modifiedCount > 0) {
        sendJson(res, 200, { success: true, message: 'User updated successfully.' });
      } else {
        // Even if modifiedCount is 0, it might just be because no fields changed
        sendJson(res, 200, { success: true, message: 'User updated.' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/users/:id', requireRole('admin'), async (req, res) => {
    try {
      const userId = req.params.id;
      const result = await deleteOne('users', { _id: new ObjectId(userId) });
      if (result && result.deletedCount > 0) {
        sendJson(res, 200, { success: true, message: 'User deleted successfully.' });
      } else {
        sendJson(res, 404, { error: 'User not found.' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  // Testimonials endpoints
  router.get('/public/testimonials', async (req, res) => {
    try {
      const testimonials = await findMany('testimonials', { isActive: true }, { sort: { displayOrder: 1 } });
      sendJson(res, 200, testimonials || []);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 200, []); // Return empty array on error for public endpoint
    }
  });

  router.get('/admin/testimonials', requireRole('admin'), async (req, res) => {
    try {
      const testimonials = await findMany('testimonials', {}, { sort: { displayOrder: 1 } });
      sendJson(res, 200, testimonials || []);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/testimonials', requireRole('admin'), upload.single('avatarFile'), async (req, res) => {
    const body = collectBody(req);
    const name = normalizeString(body.name);
    const from = normalizeString(body.from);
    const before = normalizeString(body.before);
    const helped = normalizeString(body.helped);
    const after = normalizeString(body.after);
    const heading = normalizeString(body.heading);
    const isActive = body.isActive === 'true' || body.isActive === true;

    if (!name || !from || !before || !helped || !after) {
      sendJson(res, 400, { error: 'Missing required fields: name, from, before, helped, after' });
      return;
    }

    if (heading && heading.length > 50) {
      sendJson(res, 400, { error: 'Heading cannot exceed 50 characters' });
      return;
    }
    if (before.length > 600) {
      sendJson(res, 400, { error: 'Before field cannot exceed 600 characters' });
      return;
    }
    if (helped.length > 600) {
      sendJson(res, 400, { error: 'How Twins Consultancy Helped field cannot exceed 600 characters' });
      return;
    }
    if (after.length > 400) {
      sendJson(res, 400, { error: 'Result field cannot exceed 400 characters' });
      return;
    }

    try {
      let avatarUrl = body.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
      let avatarPath = null;

      if (req.file) {
        const cleanName = sanitizeFileName(req.file.originalname);
        const fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        avatarPath = `public/testimonials/${fileName}`;
        await r2.uploadToR2(req.file.buffer, avatarPath, req.file.mimetype || 'image/jpeg');
        avatarUrl = await r2.getFileUrl(avatarPath);
      }

      const maxOrder = await findOne('testimonials', {}, { sort: { displayOrder: -1 } });
      const nextOrder = (maxOrder && maxOrder.displayOrder) ? maxOrder.displayOrder + 1 : 1;

      const testimonial = {
        name,
        from,
        before,
        helped,
        after,
        heading: heading || '',
        avatarUrl,
        avatarPath,
        displayOrder: nextOrder,
        isActive,
        createdAt: formatDateTime(new Date()),
        updatedAt: formatDateTime(new Date())
      };

      await insertOne('testimonials', testimonial);
      sendJson(res, 201, { success: true, message: 'Testimonial added successfully' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.put('/admin/testimonials/:id', requireRole('admin'), upload.single('avatarFile'), async (req, res) => {
    const testimonialId = req.params.id;
    const body = collectBody(req);
    const name = normalizeString(body.name);
    const from = normalizeString(body.from);
    const before = normalizeString(body.before);
    const helped = normalizeString(body.helped);
    const after = normalizeString(body.after);
    const heading = normalizeString(body.heading);
    const isActive = body.isActive === 'true' || body.isActive === true;

    if (!name || !from || !before || !helped || !after) {
      sendJson(res, 400, { error: 'Missing required fields: name, from, before, helped, after' });
      return;
    }

    if (heading && heading.length > 50) {
      sendJson(res, 400, { error: 'Heading cannot exceed 50 characters' });
      return;
    }
    if (before.length > 600) {
      sendJson(res, 400, { error: 'Before field cannot exceed 600 characters' });
      return;
    }
    if (helped.length > 600) {
      sendJson(res, 400, { error: 'How Twins Consultancy Helped field cannot exceed 600 characters' });
      return;
    }
    if (after.length > 400) {
      sendJson(res, 400, { error: 'Result field cannot exceed 400 characters' });
      return;
    }

    try {
      const existing = await findOne('testimonials', { _id: new ObjectId(testimonialId) });
      if (!existing) {
        sendJson(res, 404, { error: 'Testimonial not found' });
        return;
      }

      let avatarUrl = body.avatarUrl || existing.avatarUrl;
      let avatarPath = existing.avatarPath || null;

      if (req.file) {
        const cleanName = sanitizeFileName(req.file.originalname);
        const fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        const newAvatarPath = `public/testimonials/${fileName}`;
        await r2.uploadToR2(req.file.buffer, newAvatarPath, req.file.mimetype || 'image/jpeg');
        
        // Delete old R2 file if it exists
        if (existing.avatarPath) {
          try {
            await r2.deleteFromR2(existing.avatarPath);
          } catch (r2Err) {
            console.error('Failed to delete old testimonial photo from R2:', r2Err.message);
          }
        }

        avatarPath = newAvatarPath;
        avatarUrl = await r2.getFileUrl(avatarPath);
      }

      const updateData = {
        name,
        from,
        before,
        helped,
        after,
        heading: heading || '',
        avatarUrl,
        avatarPath,
        isActive,
        updatedAt: formatDateTime(new Date())
      };

      if (body.displayOrder !== undefined) {
        updateData.displayOrder = parseInt(body.displayOrder, 10);
      }

      await updateOne('testimonials', { _id: new ObjectId(testimonialId) }, { $set: updateData });
      sendJson(res, 200, { success: true, message: 'Testimonial updated successfully' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/testimonials/:id', requireRole('admin'), async (req, res) => {
    const testimonialId = req.params.id;

    try {
      const existing = await findOne('testimonials', { _id: new ObjectId(testimonialId) });
      if (existing && existing.avatarPath) {
        try {
          await r2.deleteFromR2(existing.avatarPath);
        } catch (r2Err) {
          console.error('Failed to delete testimonial photo from R2:', r2Err.message);
        }
      }

      const result = await deleteOne('testimonials', { _id: new ObjectId(testimonialId) });

      if (result && result.deletedCount > 0) {
        sendJson(res, 200, { success: true, message: 'Testimonial deleted successfully' });
      } else {
        sendJson(res, 404, { error: 'Testimonial not found' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  // Blogs endpoints
  router.get('/public/blogs', async (req, res) => {
    try {
      const blogs = await findMany('blogs', { isActive: true }, { sort: { displayOrder: 1 } });
      sendJson(res, 200, blogs);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.get('/admin/blogs', requireRole('admin'), async (req, res) => {
    try {
      const blogs = await findMany('blogs', {}, { sort: { displayOrder: 1 } });
      sendJson(res, 200, blogs);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/blogs', requireRole('admin'), upload.single('coverFile'), async (req, res) => {
    const body = collectBody(req);
    const title = normalizeString(body.title);
    const author = normalizeString(body.author);
    const content = normalizeString(body.content);
    const link = normalizeString(body.link);
    const isActive = body.isActive === 'true' || body.isActive === true;

    if (!title || !author || !content) {
      sendJson(res, 400, { error: 'Missing required fields: title, author (from whom), content' });
      return;
    }

    if (title.length > 200) {
      sendJson(res, 400, { error: 'Title cannot exceed 200 characters' });
      return;
    }
    if (author.length > 100) {
      sendJson(res, 400, { error: 'Author/From Whom cannot exceed 100 characters' });
      return;
    }
    if (content.length > 1000) {
      sendJson(res, 400, { error: 'Content cannot exceed 1000 characters' });
      return;
    }
    if (link && link.length > 250) {
      sendJson(res, 400, { error: 'Link cannot exceed 250 characters' });
      return;
    }

    try {
      let coverUrl = '';
      let coverPath = null;

      if (req.file) {
        const cleanName = sanitizeFileName(req.file.originalname);
        const fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        coverPath = `public/blogs/covers/${fileName}`;
        await r2.uploadToR2(req.file.buffer, coverPath, req.file.mimetype || 'image/jpeg');
        coverUrl = await r2.getFileUrl(coverPath);
      }

      const maxOrder = await findOne('blogs', {}, { sort: { displayOrder: -1 } });
      const nextOrder = (maxOrder && maxOrder.displayOrder) ? maxOrder.displayOrder + 1 : 1;

      const blog = {
        title,
        author,
        content,
        link: link || '',
        coverUrl,
        coverPath,
        displayOrder: nextOrder,
        isActive,
        createdAt: formatDateTime(new Date()),
        updatedAt: formatDateTime(new Date())
      };

      await insertOne('blogs', blog);
      sendJson(res, 201, { success: true, message: 'Blog created successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.put('/admin/blogs/:id', requireRole('admin'), upload.single('coverFile'), async (req, res) => {
    const blogId = req.params.id;
    const body = collectBody(req);
    const title = normalizeString(body.title);
    const author = normalizeString(body.author);
    const content = normalizeString(body.content);
    const link = normalizeString(body.link);
    const isActive = body.isActive === 'true' || body.isActive === true;

    if (!title || !author || !content) {
      sendJson(res, 400, { error: 'Missing required fields: title, author (from whom), content' });
      return;
    }

    if (title.length > 200) {
      sendJson(res, 400, { error: 'Title cannot exceed 200 characters' });
      return;
    }
    if (author.length > 100) {
      sendJson(res, 400, { error: 'Author/From Whom cannot exceed 100 characters' });
      return;
    }
    if (content.length > 1000) {
      sendJson(res, 400, { error: 'Content cannot exceed 1000 characters' });
      return;
    }
    if (link && link.length > 250) {
      sendJson(res, 400, { error: 'Link cannot exceed 250 characters' });
      return;
    }

    try {
      const existing = await findOne('blogs', { _id: new ObjectId(blogId) });
      if (!existing) {
        sendJson(res, 404, { error: 'Blog not found' });
        return;
      }

      let coverUrl = existing.coverUrl || '';
      let coverPath = existing.coverPath || null;

      if (req.file) {
        // Delete old cover from R2 if present
        if (existing.coverPath) {
          try { await r2.deleteFromR2(existing.coverPath); } catch (_) {}
        }
        const cleanName = sanitizeFileName(req.file.originalname);
        const fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        coverPath = `public/blogs/covers/${fileName}`;
        await r2.uploadToR2(req.file.buffer, coverPath, req.file.mimetype || 'image/jpeg');
        coverUrl = await r2.getFileUrl(coverPath);
      }

      await updateOne('blogs', { _id: new ObjectId(blogId) }, {
        $set: {
          title,
          author,
          content,
          link: link || '',
          coverUrl,
          coverPath,
          isActive,
          updatedAt: formatDateTime(new Date())
        }
      });

      sendJson(res, 200, { success: true, message: 'Blog updated successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/blogs/:id', requireRole('admin'), async (req, res) => {
    const blogId = req.params.id;
    try {
      const result = await deleteOne('blogs', { _id: new ObjectId(blogId) });
      if (result.deletedCount === 0) {
        sendJson(res, 404, { error: 'Blog not found' });
        return;
      }
      sendJson(res, 200, { success: true, message: 'Blog deleted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/blogs/reorder', requireRole('admin'), async (req, res) => {
    const body = collectBody(req);
    const orders = body.orders;
    if (!Array.isArray(orders)) {
      sendJson(res, 400, { error: 'Invalid orders array' });
      return;
    }

    try {
      for (const item of orders) {
        if (item.id && typeof item.displayOrder === 'number') {
          await updateOne('blogs', { _id: new ObjectId(item.id) }, {
            $set: { displayOrder: item.displayOrder }
          });
        }
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  // Listening (Video) endpoints
  router.get('/public/listening', async (req, res) => {
    try {
      const videos = await findMany('listening', { isActive: true }, { sort: { displayOrder: 1 } });
      sendJson(res, 200, videos || []);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 200, []);
    }
  });

  router.get('/admin/listening', requireRole('admin'), async (req, res) => {
    try {
      const videos = await findMany('listening', {}, { sort: { displayOrder: 1 } });
      sendJson(res, 200, videos || []);
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/listening', requireRole('admin'), (req, res, next) => {
    uploadVideo.single('video')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return sendJson(res, 400, { error: 'Video file size exceeds the 250MB limit.' });
      } else if (err) {
        return sendJson(res, 400, { error: err.message || 'File upload error.' });
      }
      next();
    });
  }, async (req, res) => {
    const body = collectBody(req);
    const id = normalizeString(body.id);
    const title = normalizeString(body.title);
    const description = normalizeString(body.description);
    const displayOrderStr = normalizeString(body.displayOrder);
    const isActive = body.isActive === 'true' || body.isActive === true;

    if (!title) {
      sendJson(res, 400, { error: 'Video Title is required.' });
      return;
    }

    if (title.length > 200) {
      sendJson(res, 400, { error: 'Video Title cannot exceed 200 characters.' });
      return;
    }

    if (description && description.length > 250) {
      sendJson(res, 400, { error: 'Description cannot exceed 250 characters.' });
      return;
    }

    try {
      let existingVideo = null;
      if (id) {
        existingVideo = await findOne('listening', { _id: toObjectId(id) });
        if (!existingVideo) {
          sendJson(res, 404, { error: 'Video record not found for updating.' });
          return;
        }
      }

      let fileName = existingVideo ? existingVideo.fileName : null;
      let filePath = existingVideo ? existingVideo.filePath : null;
      let fileSize = existingVideo ? existingVideo.fileSize : null;
      let videoUrl = existingVideo ? existingVideo.videoUrl : null;

      if (req.file) {
        const originalName = req.file.originalname || '';
        const ext = path.extname(originalName).toLowerCase();
        if (!['.mp4', '.webm'].includes(ext)) {
          sendJson(res, 400, { error: 'Only MP4 and WebM video formats are allowed.' });
          return;
        }

        const cleanName = sanitizeFileName(req.file.originalname);
        fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        const r2Key = `public/listening/${fileName}`;
        await r2.uploadToR2(req.file.buffer, r2Key, req.file.mimetype || 'video/mp4');

        if (existingVideo && existingVideo.filePath) {
          try {
            await r2.deleteFromR2(existingVideo.filePath);
          } catch (r2Err) {
            console.error(`Failed to delete old video from R2:`, r2Err.message);
          }
        }

        filePath = r2Key;
        fileSize = formatFileSize(req.file.size);
        videoUrl = await r2.getFileUrl(r2Key);
      }

      if (!id && !filePath) {
        sendJson(res, 400, { error: 'Video file upload is required for new entries.' });
        return;
      }

      const displayOrder = displayOrderStr ? parseInt(displayOrderStr, 10) : undefined;
      const now = formatDateTime(new Date());

      if (id) {
        const updateDoc = {
          title,
          description,
          fileName,
          filePath,
          fileSize,
          videoUrl,
          isActive,
          updatedAt: now
        };
        if (displayOrder !== undefined) {
          updateDoc.displayOrder = displayOrder;
        }
        await updateOne('listening', { _id: toObjectId(id) }, { $set: updateDoc });
        sendJson(res, 200, { success: true, message: 'Video updated successfully.' });
      } else {
        let finalOrder = displayOrder;
        if (finalOrder === undefined) {
          const maxOrder = await findOne('listening', {}, { sort: { displayOrder: -1 } });
          finalOrder = (maxOrder && maxOrder.displayOrder) ? maxOrder.displayOrder + 1 : 1;
        }

        await insertOne('listening', {
          title,
          description,
          fileName,
          filePath,
          fileSize,
          videoUrl,
          displayOrder: finalOrder,
          isActive,
          createdAt: now,
          updatedAt: now
        });
        sendJson(res, 201, { success: true, message: 'Video added successfully.' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/listening/:id', requireRole('admin'), async (req, res) => {
    const id = req.params.id;
    try {
      const video = await findOne('listening', { _id: toObjectId(id) });
      if (video && video.filePath) {
        try {
          await r2.deleteFromR2(video.filePath);
        } catch (r2Err) {
          console.error(`Failed to delete video from R2:`, r2Err.message);
        }
      }

      const result = await deleteOne('listening', { _id: toObjectId(id) });
      if (result && result.deletedCount > 0) {
        sendJson(res, 200, { success: true, message: 'Video deleted successfully.' });
      } else {
        sendJson(res, 404, { error: 'Video not found.' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/listening/reorder', requireRole('admin'), async (req, res) => {
    const body = collectBody(req);
    const orders = body.orders;

    if (!Array.isArray(orders)) {
      sendJson(res, 400, { error: 'Orders array is required.' });
      return;
    }

    try {
      for (const item of orders) {
        if (item.id && item.displayOrder !== undefined) {
          await updateOne(
            'listening',
            { _id: toObjectId(item.id) },
            { $set: { displayOrder: parseInt(item.displayOrder, 10), updatedAt: formatDateTime(new Date()) } }
          );
        }
      }
      sendJson(res, 200, { success: true, message: 'Video order updated successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });


  // --- NEW ADMIN PORTAL ENDPOINTS ---

  // KYC Verification Panel endpoints
  router.get('/admin/kyc', requireRole('admin'), async (req, res) => {
    try {
      const users = await findMany('users', {
        $or: [
          { 'kyc.aadhaar': { $ne: null } },
          { 'kyc.pan': { $ne: null } },
          { 'kyc.voterid': { $ne: null } },
          { 'kyc.photo': { $ne: null } }
        ]
      });

      sendJson(res, 200, users.map(user => {
        const clone = { ...user };
        delete clone.password;
        return clone;
      }));
    } catch (error) {
      console.error('Error fetching KYC users:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/kyc/status', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    const userId = normalizeString(data.id);
    const status = normalizeString(data.status); // 'Approved' or 'Rejected'
    const remarks = normalizeString(data.remarks);

    if (!userId || !['Approved', 'Rejected'].includes(status)) {
      sendJson(res, 400, { message: 'User ID and valid status are required.' });
      return;
    }

    try {
      const user = await findOne('users', { _id: toObjectId(userId) });
      if (!user) {
        sendJson(res, 404, { message: 'User not found.' });
        return;
      }

      const kyc = user.kyc || {};
      kyc.status = status;
      kyc.remarks = remarks || '';
      kyc.verifiedAt = new Date();

      await updateOne('users', { _id: toObjectId(userId) }, { $set: { kyc, updatedAt: new Date() } });

      await insertOne('user_updates', {
        userId,
        title: status === 'Approved' ? 'KYC Approved' : 'KYC Rejected',
        message: status === 'Approved'
          ? 'Congratulations! Your KYC verification has been approved.'
          : `KYC verification was rejected. Reason: ${remarks || 'Invalid documents.'}`,
        category: 'KYC',
        status: status === 'Approved' ? 'Approved' : 'Rejected',
        createdAt: new Date()
      });

      sendJson(res, 200, { success: true, message: `KYC status updated to ${status}.` });
    } catch (error) {
      console.error('Error updating KYC status:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  // User Policies Panel endpoints
  router.get('/admin/policies', requireRole('admin'), async (req, res) => {
    try {
      const policies = await findMany('user_policies', {});
      const enriched = await enrichWithUserInfo(policies);
      sendJson(res, 200, enriched);
    } catch (error) {
      console.error('Error fetching admin policies:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/policies/status', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    const policyId = normalizeString(data.id);
    const status = normalizeString(data.status); // 'Verified' or 'Rejected'
    const remarks = normalizeString(data.remarks);

    if (!policyId || !['Verified', 'Rejected'].includes(status)) {
      sendJson(res, 400, { message: 'Policy ID and valid status are required.' });
      return;
    }

    try {
      const policy = await findOne('user_policies', { _id: toObjectId(policyId) });
      if (!policy) {
        sendJson(res, 404, { message: 'Policy not found.' });
        return;
      }

      await updateOne('user_policies', { _id: toObjectId(policyId) }, {
        $set: { status, remarks: remarks || '', updatedAt: new Date() }
      });

      await insertOne('user_updates', {
        userId: policy.userId,
        title: status === 'Verified' ? 'Policy Verified' : 'Policy Rejected',
        message: status === 'Verified'
          ? `Your ${policy.provider} policy (${policy.policyNumber}) has been verified successfully.`
          : `Your ${policy.provider} policy (${policy.policyNumber}) verification was rejected. Reason: ${remarks || 'Please check policy details.'}`,
        category: 'Policies',
        status: status === 'Verified' ? 'Approved' : 'Rejected',
        createdAt: new Date()
      });

      sendJson(res, 200, { success: true, message: `Policy status updated to ${status}.` });
    } catch (error) {
      console.error('Error updating policy status:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  // Appointment Management endpoints
  router.get('/admin/appointments', requireRole('admin'), async (req, res) => {
    try {
      const appts = await findMany('appointments', {});
      const enriched = await enrichWithUserInfo(appts);
      sendJson(res, 200, enriched);
    } catch (error) {
      console.error('Error fetching admin appointments:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/appointments/status', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    const appointmentId = normalizeString(data.id);
    const status = normalizeString(data.status); // 'Confirmed', 'Completed', or 'Cancelled'
    const remarks = normalizeString(data.remarks);
    const assignedAgent = normalizeString(data.assignedAgent);

    if (!appointmentId || !['Confirmed', 'Completed', 'Cancelled'].includes(status)) {
      sendJson(res, 400, { message: 'Appointment ID and valid status are required.' });
      return;
    }

    try {
      const appt = await findOne('appointments', { _id: toObjectId(appointmentId) });
      if (!appt) {
        sendJson(res, 404, { message: 'Appointment not found.' });
        return;
      }

      const updateData = { status, remarks: remarks || '', updatedAt: new Date() };
      if (assignedAgent) {
        updateData.assignedAgent = assignedAgent;
      }

      await updateOne('appointments', { _id: toObjectId(appointmentId) }, { $set: updateData });

      await insertOne('user_updates', {
        userId: appt.userId,
        title: `Appointment ${status}`,
        message: status === 'Confirmed'
          ? `Your appointment request for ${appt.purpose} is confirmed for ${appt.date} at ${appt.timeSlot}.${assignedAgent ? ' Agent: ' + assignedAgent : ''}`
          : `Your appointment request has been marked as ${status.toLowerCase()}.${remarks ? ' Notes: ' + remarks : ''}`,
        category: 'Appointments',
        status: status === 'Confirmed' ? 'Confirmed' : (status === 'Completed' ? 'Completed' : 'Rejected'),
        createdAt: new Date()
      });

      sendJson(res, 200, { success: true, message: `Appointment status updated to ${status}.` });
    } catch (error) {
      console.error('Error updating appointment status:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  // Service Operations endpoints
  router.get('/admin/services', requireRole('admin'), async (req, res) => {
    try {
      const svcs = await findMany('user_services', {});
      const enriched = await enrichWithUserInfo(svcs);
      sendJson(res, 200, enriched);
    } catch (error) {
      console.error('Error fetching admin services:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/admin/services/status', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    const serviceId = normalizeString(data.id);
    const status = normalizeString(data.status); // 'Submitted', 'Assigned', 'In Progress', 'Completed'
    const assignedAgent = normalizeString(data.assignedAgent);
    const remarks = normalizeString(data.remarks);

    if (!serviceId || !['Submitted', 'Assigned', 'In Progress', 'Completed'].includes(status)) {
      sendJson(res, 400, { message: 'Service ID and valid status are required.' });
      return;
    }

    try {
      const svc = await findOne('user_services', { _id: toObjectId(serviceId) });
      if (!svc) {
        sendJson(res, 404, { message: 'Service request not found.' });
        return;
      }

      const updateData = { status, remarks: remarks || '', updatedAt: new Date() };
      if (assignedAgent) {
        updateData.assignedAgent = assignedAgent;
      }

      await updateOne('user_services', { _id: toObjectId(serviceId) }, { $set: updateData });

      await insertOne('user_updates', {
        userId: svc.userId,
        title: `Service request status update`,
        message: `Your service request for ${svc.category} is now: ${status}.${assignedAgent ? ' Assigned to ' + assignedAgent + '.' : ''}`,
        category: 'Services',
        status: status === 'Completed' ? 'Completed' : 'Pending',
        createdAt: new Date()
      });

      sendJson(res, 200, { success: true, message: `Service request updated to ${status}.` });
    } catch (error) {
      console.error('Error updating service status:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });


  // --- USER DASHBOARD ENDPOINTS ---

  router.get('/users/profile', requireRole('user'), async (req, res) => {
    try {
      const user = await findOne('users', { _id: toObjectId(req.user.id) });
      if (!user) {
        sendJson(res, 404, { message: 'User not found.' });
        return;
      }
      const clone = { ...user };
      delete clone.password;
      sendJson(res, 200, clone);
    } catch (error) {
      console.error('Error fetching profile:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.put('/users/profile', requireRole('user'), async (req, res) => {
    const data = collectBody(req);
    try {
      const updateData = {};
      if (data.email !== undefined) updateData.email = normalizeString(data.email);
      if (data.phone !== undefined) updateData.phone = normalizeString(data.phone);
      if (data.name !== undefined) updateData.name = normalizeString(data.name);
      if (data.address !== undefined) updateData.address = normalizeString(data.address);
      if (data.pincode !== undefined) updateData.pincode = normalizeString(data.pincode);
      if (data.emergencyContact !== undefined) updateData.emergencyContact = normalizeString(data.emergencyContact);

      updateData.updatedAt = new Date();

      await updateOne('users', { _id: toObjectId(req.user.id) }, { $set: updateData });
      sendJson(res, 200, { message: 'Profile updated successfully.' });
    } catch (error) {
      console.error('Error updating profile:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.put('/users/password', requireRole('user'), async (req, res) => {
    const data = collectBody(req);
    if (!data.oldPassword || !data.newPassword) {
      sendJson(res, 400, { message: 'Missing password parameters.' });
      return;
    }

    try {
      const user = await findOne('users', { _id: toObjectId(req.user.id) });
      if (!user) {
        sendJson(res, 404, { message: 'User not found.' });
        return;
      }

      if (user.password !== data.oldPassword) {
        sendJson(res, 400, { message: 'Incorrect old password.' });
        return;
      }

      await updateOne('users', { _id: toObjectId(req.user.id) }, { $set: { password: data.newPassword, updatedAt: new Date() } });
      sendJson(res, 200, { message: 'Password updated successfully.' });
    } catch (error) {
      console.error('Error updating password:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.get('/users/policies', requireRole('user'), async (req, res) => {
    try {
      const policies = await findMany('user_policies', { userId: req.user.id });
      sendJson(res, 200, policies);
    } catch (error) {
      console.error('Error fetching policies:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/users/policies', requireRole('user'), upload.single('file'), async (req, res) => {
    const body = collectBody(req);
    const provider = normalizeString(body.provider);
    const policyNumber = normalizeString(body.policyNumber);
    const type = normalizeString(body.type);
    const notes = normalizeString(body.notes);

    if (!provider || !policyNumber || !type) {
      sendJson(res, 400, { message: 'Provider, Policy Number, and Type are required.' });
      return;
    }

    try {
      let fileName = null;
      let filePath = null;
      let fileSize = null;

      if (req.file) {
        if (!isPdfFile(req.file)) {
          sendJson(res, 400, { message: 'Only PDF files are allowed.' });
          return;
        }

        const cleanName = sanitizeFileName(req.file.originalname);
        fileName = `${Math.floor(Date.now() / 1000)}_${cleanName}`;
        const r2Key = `${r2.R2_PATHS.POLICIES}/${fileName}`;
        await r2.uploadToR2(req.file.buffer, r2Key, 'application/pdf');
        filePath = r2Key;
        fileSize = formatFileSize(req.file.size);
      }

      await insertOne('user_policies', {
        userId       : req.user.id,
        policyNumber,
        provider,
        type,
        notes,
        fileName,
        filePath,          // R2 key e.g. "private/policies/xxx.pdf" (or null)
        fileSize,
        status     : 'Pending Verification',
        createdAt  : new Date(),
        updatedAt  : new Date()
      });

      await insertOne('user_updates', {
        userId: req.user.id,
        title: 'Policy Added',
        message: `${provider} Policy (${policyNumber}) added and pending verification.`,
        category: 'Policies',
        status: 'Pending',
        createdAt: new Date()
      });

      const settings = await findOne('settings', { _id: 'global' });
      if (settings && settings.claimAlerts) {
        const claimSubject = `New Policy/Claim Uploaded: ${provider}`;
        const claimHtml = `
          <h3>New Policy Uploaded</h3>
          <p><strong>User ID:</strong> ${req.user.id}</p>
          <p><strong>Provider:</strong> ${provider}</p>
          <p><strong>Policy Number:</strong> ${policyNumber}</p>
          <p><strong>Type:</strong> ${type}</p>
          <p><strong>Notes:</strong> ${notes || 'None'}</p>
          <p><strong>Uploaded At:</strong> ${new Date().toLocaleString()}</p>
        `;
        await sendAdminAlertEmail(claimSubject, claimHtml, settings.notificationPriority || 'normal');
      }

      sendJson(res, 201, { message: 'Policy added successfully.' });
    } catch (error) {
      console.error('Error adding policy:', error.message);
      if (error.message.includes('R2 configuration') || error.message.includes('R2_')) {
        sendJson(res, 500, { message: `Storage Error: ${error.message}` });
      } else {
        sendJson(res, 500, { message: 'An internal server error occurred.' });
      }
    }
  });

  router.get('/users/appointments', requireRole('user'), async (req, res) => {
    try {
      const appointments = await findMany('appointments', { userId: req.user.id });
      sendJson(res, 200, appointments);
    } catch (error) {
      console.error('Error fetching appointments:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/users/appointments', requireRole('user'), async (req, res) => {
    const data = collectBody(req);
    const type = normalizeString(data.type);
    const primaryPhone = normalizeString(data.primaryPhone);
    const alternativePhone = normalizeString(data.alternativePhone);
    const date = normalizeString(data.date);
    const timeSlot = normalizeString(data.timeSlot);
    const alternativeTimeSlot = normalizeString(data.alternativeTimeSlot);
    const purpose = normalizeString(data.purpose);

    if (!type || !primaryPhone || !date || !timeSlot || !purpose) {
      sendJson(res, 400, { message: 'Incomplete appointment details.' });
      return;
    }

    try {
      await insertOne('appointments', {
        userId: req.user.id,
        type,
        primaryPhone,
        alternativePhone,
        date,
        timeSlot,
        alternativeTimeSlot,
        purpose,
        status: 'Booked',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await insertOne('user_updates', {
        userId: req.user.id,
        title: 'Appointment Booked',
        message: `Your appointment request for ${purpose} is scheduled for ${date} at ${timeSlot}.`,
        category: 'Appointments',
        status: 'Confirmed',
        createdAt: new Date()
      });

      sendJson(res, 201, { message: 'Appointment booked successfully.' });
    } catch (error) {
      console.error('Error booking appointment:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.get('/users/services', requireRole('user'), async (req, res) => {
    try {
      const services = await findMany('user_services', { userId: req.user.id });
      sendJson(res, 200, services);
    } catch (error) {
      console.error('Error fetching services:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/users/services', requireRole('user'), async (req, res) => {
    const data = collectBody(req);
    const category = normalizeString(data.category);
    const description = normalizeString(data.description);
    const preferredTime = normalizeString(data.preferredTime);
    const notes = normalizeString(data.notes);

    if (!category) {
      sendJson(res, 400, { message: 'Service category is required.' });
      return;
    }

    try {
      await insertOne('user_services', {
        userId: req.user.id,
        category,
        description,
        preferredTime,
        notes,
        status: 'pending',
        createdAt: new Date()
      });

      await insertOne('user_updates', {
        userId: req.user.id,
        title: 'Service Requested',
        message: `Service request for ${category} has been submitted.`,
        category: 'Services',
        status: 'Pending',
        createdAt: new Date()
      });

      sendJson(res, 201, { message: 'Service requested successfully.' });
    } catch (error) {
      console.error('Error requesting service:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.get('/users/updates', requireRole('user'), async (req, res) => {
    try {
      const updates = await findMany('user_updates', { userId: req.user.id }, { sort: { createdAt: -1 } });
      sendJson(res, 200, updates);
    } catch (error) {
      console.error('Error fetching updates:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.post('/users/kyc', requireRole('user'), upload.single('file'), async (req, res) => {
    const body = collectBody(req);
    const documentType = normalizeString(body.documentType);

    if (!documentType || !['aadhaar', 'pan', 'voterid', 'photo'].includes(documentType)) {
      sendJson(res, 400, { message: 'Valid documentType is required.' });
      return;
    }

    if (!req.file) {
      sendJson(res, 400, { message: 'Document file is required.' });
      return;
    }

    try {
      if (!isImageFile(req.file) && !isPdfFile(req.file)) {
        sendJson(res, 400, { message: 'Only PDF or Image files (PNG, JPG, JPEG) are allowed.' });
        return;
      }

      const cleanName   = sanitizeFileName(req.file.originalname);
      const fileName     = `${Math.floor(Date.now() / 1000)}_${cleanName}`;

      // Route to the correct R2 private folder based on document type
      const folder = r2.KYC_FOLDER_MAP[documentType];
      const r2Key  = `${folder}/${fileName}`;
      await r2.uploadToR2(req.file.buffer, r2Key, r2.getContentType(fileName));

      const db = await getDb();
      const user = await findOne('users', { _id: toObjectId(req.user.id) });
      if (!user) {
        sendJson(res, 404, { message: 'User not found.' });
        return;
      }

      const kycData = user.kyc || { status: 'Not Verified', aadhaar: null, pan: null, voterid: null, photo: null };
      kycData[documentType] = {
        fileName,
        filePath  : r2Key,   // R2 key e.g. "private/aadhaar/xxx.pdf"
        uploadedAt: new Date()
      };
      kycData.status = 'Pending Verification';

      await updateOne('users', { _id: toObjectId(req.user.id) }, { $set: { kyc: kycData, updatedAt: new Date() } });

      await insertOne('user_updates', {
        userId: req.user.id,
        title: 'KYC Uploaded',
        message: `${documentType.toUpperCase()} document uploaded for verification.`,
        category: 'Services',
        status: 'Pending',
        createdAt: new Date()
      });

      sendJson(res, 200, { message: `${documentType.toUpperCase()} uploaded successfully. Status set to Pending Verification.` });
    } catch (error) {
      console.error('Error uploading KYC:', error.message);
      if (error.message.includes('R2 configuration') || error.message.includes('R2_')) {
        sendJson(res, 500, { message: `Storage Error: ${error.message}` });
      } else {
        sendJson(res, 500, { message: 'An internal server error occurred.' });
      }
    }
  });

  // ── Signed URL endpoint ────────────────────────────────────────────────────
  // GET /backend/api/file/signed?key=private/aadhaar/xxx.pdf
  // Returns a short-lived pre-signed URL for any private/ R2 object.
  // Security:
  //   - Authenticated users (JWT) only.
  //   - Users may only request URLs for files that belong to them.
  //   - Admins may request any private/ file.
  //   - Public/ keys are rejected here — they already have permanent public URLs.
  router.get('/file/signed', async (req, res) => {
    // Verify JWT manually to support both user and admin roles
    const authHeader = (req.get('Authorization') || req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!authHeader) {
      sendJson(res, 401, { message: 'Unauthorized.' });
      return;
    }

    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(authHeader, config.jwtSecret);
    } catch {
      sendJson(res, 401, { message: 'Invalid or expired token.' });
      return;
    }

    const key = normalizeString(req.query.key);

    if (!key) {
      sendJson(res, 400, { message: 'File key is required.' });
      return;
    }

    // Only private/ keys are served through this endpoint
    if (!key.startsWith('private/')) {
      sendJson(res, 403, { message: 'Access denied. Use the public URL for public files.' });
      return;
    }

    try {
      if (decoded.role !== 'admin') {
        // Verify the requesting user owns this file
        const user = await findOne('users', { _id: toObjectId(decoded.id) });
        if (!user) {
          sendJson(res, 404, { message: 'User not found.' });
          return;
        }

        const ownedKeys = [];

        // Collect KYC file keys
        const kyc = user.kyc || {};
        for (const doc of ['aadhaar', 'pan', 'voterid', 'photo']) {
          if (kyc[doc]?.filePath) ownedKeys.push(kyc[doc].filePath);
        }

        // Collect policy file keys
        const policies = await findMany('user_policies', { userId: decoded.id });
        for (const p of policies) {
          if (p.filePath) ownedKeys.push(p.filePath);
        }

        if (!ownedKeys.includes(key)) {
          sendJson(res, 403, { message: 'Access denied. You do not own this file.' });
          return;
        }
      }

      // Generate a 15-minute pre-signed GET URL
      const url = await r2.getSignedUrl(key, 900);
      sendJson(res, 200, { url });
    } catch (error) {
      console.error('Error generating signed URL:', error.message);
      sendJson(res, 500, { message: 'Could not generate file access URL.' });
    }
  });

  router.all('*', (req, res) => {
    methodNotAllowed(res, req);
  });

  return router;
}

app.use('/backend/api', createApiRouter());

// ── Public files proxy/redirect route ────────────────────────────────────────
// Catch requests to /public/* (e.g. /public/claim-forms/xxx.pdf, /public/partners/xxx.jpg)
// and redirect them to the Cloudflare R2 public URL.
app.get('/public/*', async (req, res) => {
  const key = req.path.replace(/^\//, ''); // removes leading slash to get the R2 key
  try {
    const rangeHeader = req.headers.range;
    const { stream, headers, statusCode } = await r2.getStreamFromR2(key, rangeHeader);
    
    res.status(statusCode);
    Object.keys(headers).forEach(h => {
      if (headers[h] !== undefined) {
        res.setHeader(h, headers[h]);
      }
    });
    
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving public file from R2:', key, error.message);
    res.status(404).sendFile(path.join(publicDir, '404.html'));
  }
});

// ── Private files secure access route ────────────────────────────────────────
// Catch requests to /private/* (e.g. /private/policies/xxx.pdf)
// Decodes and validates the JWT passed in the query parameter '?token=...'
// and streams the file directly from Cloudflare R2 bucket.
app.get('/private/*', async (req, res) => {
  const key = req.path.replace(/^\//, ''); // removes leading slash to get the R2 key
  const token = req.query.token;

  if (!token) {
    console.warn('[PRIVATE ACCESS ERROR] Missing token query parameter for key:', key);
    res.status(401).send('Unauthorized. Token is required to access private documents.');
    return;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (jwtErr) {
    console.error('[PRIVATE ACCESS ERROR] JWT verification failed for key:', key, 'Error:', jwtErr.message, 'Token:', token);
    res.status(401).send('Invalid or expired token.');
    return;
  }

  try {
    // Authorization logic:
    // 1. Admins can access any file.
    // 2. Regular users can only access files they own (KYC or policies).
    if (decoded.role !== 'admin') {
      const user = await findOne('users', { _id: toObjectId(decoded.id) });
      if (!user) {
        console.warn('[PRIVATE ACCESS ERROR] User not found for ID:', decoded.id);
        res.status(404).send('User not found.');
        return;
      }

      const ownedKeys = [];

      // Collect user's KYC files
      const kyc = user.kyc || {};
      for (const doc of ['aadhaar', 'pan', 'voterid', 'photo']) {
        if (kyc[doc]?.filePath) {
          ownedKeys.push(kyc[doc].filePath);
        }
      }

      // Collect user's policy files
      const policies = await findMany('user_policies', { userId: decoded.id });
      for (const p of policies) {
        if (p.filePath) {
          ownedKeys.push(p.filePath);
        }
      }

      if (!ownedKeys.includes(key)) {
        console.warn('[PRIVATE ACCESS ERROR] User', decoded.id, 'attempted unauthorized access to key:', key);
        res.status(403).send('Forbidden. Access denied.');
        return;
      }
    }

    // Stream the private file directly from R2
    const rangeHeader = req.headers.range;
    const { stream, headers, statusCode } = await r2.getStreamFromR2(key, rangeHeader);
    
    res.status(statusCode);
    Object.keys(headers).forEach(h => {
      if (headers[h] !== undefined) {
        res.setHeader(h, headers[h]);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('Error serving private file from R2:', key, error.message);
    if (error.message.includes('R2 configuration') || error.message.includes('R2_')) {
      res.status(500).send(`Storage Error: ${error.message}`);
    } else {
      res.status(500).send('An internal server error occurred.');
    }
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/backend/api') || req.path.endsWith('.php')) {
    sendJson(res, 404, { message: 'Not found.' });
    return;
  }

  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

if (require.main === module) {
  connectAndSeed()
    .then(() => {
      const port = process.env.PORT || Number(config.backendPort) || 8000;
      app.listen(port, () => {
        console.log(`Twinsure Node server running on port ${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to start Twinsure server:', error);
      process.exit(1);
    });
}

module.exports = {
  app,
  connectAndSeed,
  createApiRouter,
  config
};