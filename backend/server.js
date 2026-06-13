const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const fs = require('fs');
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

const app = express();
app.set('trust proxy', 1);

// Enable GZIP compression to reduce network payload size (Lighthouse optimization)
app.use(compression());

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
const claimsUploadDir = path.join(publicDir, 'uploads', 'claims');
const partnersUploadDir = path.join(publicDir, 'uploads', 'partners');
const upload = multer({ storage: multer.memoryStorage() });

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

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  console.error('FATAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('FATAL: Unhandled Rejection at:', promise, 'reason:', reason);
});


function ensureDirectory(directoryPath) {
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      // Already exists — ignore
      return;
    }
    throw err;
  }
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).type('application/json').send(JSON.stringify(payload));
}

function methodNotAllowed(res, message = 'Method not allowed.') {
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
    if (hex.startsWith('FFD8FF')) return true; // JPEG
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

function fileBufferToPath(filePath, buffer) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

function deleteFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.unlinkSync(filePath);
  }
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
  ensureDirectory(claimsUploadDir);
  ensureDirectory(partnersUploadDir);

  const collectionsToCreate = ['users', 'services', 'partners', 'recommendation_questions', 'leads', 'form_help_requests', 'settings', 'contacts', 'claims', 'testimonials'];
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
      officeAddress: 'Twinsure H.Q., Chennai, Tamil Nadu - 600xxx',
      workingHours: 'Mon-Fri: 9AM - 6PM',
      timeZone: 'IST',
      defaultLanguage: 'English',
      maintenanceMode: false,
      whatsappButton: true,
      emailNotifications: true,
      whatsappNotifications: true,
      leadAlerts: true,
      partnerAlerts: true,
      claimAlerts: true,
      notificationPriority: 'high',
      sessionTimeout: '60',
      loginAttempts: '5',
      recEngineEnabled: true,
      leadPopup: true,
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
          'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.',
        officeAddress: 'Twinsure H.Q., Chennai, Tamil Nadu - 600xxx',
        workingHours: 'Mon-Fri: 9AM - 6PM',
        timeZone: 'IST',
        defaultLanguage: 'English'
      };

      const settingsPatch = {};
      for (const [key, value] of Object.entries(settingsDefaults)) {
        const currentValue = existingSettings[key];
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

      const existingClaim = await findOne('claims', {});
      if (!existingClaim) {
        console.log('Seeding initial claims...');
        const initialClaims = [
          {
            _id: toObjectId("6a2849c79c64d9a23efcd2fe"),
            name: "Care Health: Claim Form (Reimbursement)",
            category: "Health",
            description: "Standard Care Health claim form for reimbursement. Part A to be filled by the insured, Part B by the hospital.",
            status: "active",
            fileName: "1781025223_CARE_HEALTH_CLAIM_FORM.pdf",
            filePath: "uploads/claims/1781025223_CARE_HEALTH_CLAIM_FORM.pdf",
            fileSize: "1.5 MB",
            downloads: 2,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276d18e8bb34d38376685d"),
            name: "Care Health: Pre-Authorization Form",
            category: "Health",
            description: "FAX/SCAN Page 1 & 2 only to Care Health for cashless approval. Page 3 (Declaration) should NOT be faxed.\n\nPage 1 & 2 மட்டும் FAX/SCAN செய்யுங்கள். Page 3 (Declaration) fax செய்யாதீர்கள்.",
            status: "active",
            fileName: "1780968728_care-pre-authorization-form.pdf",
            filePath: "uploads/claims/1780968728_care-pre-authorization-form.pdf",
            fileSize: "100 KB",
            downloads: 1,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276cece8bb34d38376685c"),
            name: "Chola MS: Health Claim Form (Reimbursement)",
            category: "Health",
            description: "Submit claim documents within 30 days of discharge. NEFT cannot be done without a cancelled cheque — always attach one.\n\nDischarge-ஆன 30 நாட்களில் submit செய்யுங்கள். Cancelled cheque இல்லாமல் NEFT முடியாது — எப்போதும் attach செய்யுங்கள்.",
            status: "active",
            fileName: "1780968684_CHOLA_Health-Claim-Form.pdf",
            filePath: "uploads/claims/1780968684_CHOLA_Health-Claim-Form.pdf",
            fileSize: "3.1 MB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276cbde8bb34d38376685b"),
            name: "Chola MS: Pre-Authorization Form for Cashless",
            category: "Others",
            description: "FAX/SCAN PAGE 1 ONLY to Chola MS for cashless approval before or during hospital admission.\n\nCashless approval-க்கு PAGE 1 மட்டும் FAX/SCAN செய்யுங்கள் — hospitalization-க்கு முன்பு அல்லது நேரத்தில்.",
            status: "active",
            fileName: "1780968637_Chola-MS-Pre-Authorisation-Form.pdf",
            filePath: "uploads/claims/1780968637_Chola-MS-Pre-Authorisation-Form.pdf",
            fileSize: "926 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276c8ee8bb34d38376685a"),
            name: "ICICI Lombard: Hospitalization Claim Form",
            category: "Health",
            description: "Full reimbursement claim form with 4 parts. Submit with all original bills within 30 days of discharge.\n\n4 parts உள்ள complete reimbursement claim form. Discharge-ஆன 30 நாட்களில் original bills-உடன் submit செய்யவும்.",
            status: "active",
            fileName: "1780968590_icici_claim_form.pdf",
            filePath: "uploads/claims/1780968590_icici_claim_form.pdf",
            fileSize: "367 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276c49e8bb34d383766859"),
            name: "ICICI Lombard: Cashless Authorization Request Form",
            category: "Others",
            description: "Used to request cashless treatment before or during hospitalization. Send by fax or email to ICICI Lombard's cashless team.\n\nHospitalization-க்கு முன்பு அல்லது நேரத்தில் cashless கோர பயன்படும். Fax / email மூலம் ICICI-க்கு அனுப்பவும்.",
            status: "active",
            fileName: "1780968521_ICICI_LOMBOARD-pre-authorisation-form.pdf",
            filePath: "uploads/claims/1780968521_ICICI_LOMBOARD-pre-authorisation-form.pdf",
            fileSize: "55 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276c16e8bb34d383766858"),
            name: "Niva Bupa: Health Insurance Claim Form",
            category: "Health",
            description: "Standard health claim form. Part A filled by insured. Part B filled by hospital. Submit within 30 days of discharge.\n\nStandard health claim form. Part A-வை insured, Part B-வை hospital fill செய்யும். Discharge-ஆன 30 நாட்களில் submit செய்யுங்கள்.",
            status: "active",
            fileName: "1780968470_NIVA_BUPA_claim-form.pdf",
            filePath: "uploads/claims/1780968470_NIVA_BUPA_claim-form.pdf",
            fileSize: "453 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276b7fe8bb34d383766857"),
            name: "Star Health: Accident Care Insurance Claim Form",
            category: "Health",
            description: "Used for accident-related insurance claims. Submit after accident to claim compensation for injury, disability, or death.\n\nவிபத்து காரணமாக ஏற்பட்ட காயம், மரணம் அல்லது disability-க்கு பணம் கோர பயன்படும்.",
            status: "active",
            fileName: "1780968319_STAR_accident_claim_form.pdf",
            filePath: "uploads/claims/1780968319_STAR_accident_claim_form.pdf",
            fileSize: "327 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          },
          {
            _id: toObjectId("6a276b30e8bb34d383766856"),
            name: "Star Health: Pre-Authorization Form for Cashless",
            category: "Health",
            description: "This form is sent to Star Health BEFORE admission for cashless treatment. Hospital fills most of it. Patient fills personal details.\n\nஇந்த form hospitalization-க்கு முன்பே cashless-க்கு அனுமதி கேட்க பயன்படுகிறது. Hospital பெரும்பாலும் fill செய்யும்.",
            status: "active",
            fileName: "1780968240_StarHealthPreAuthForm.pdf",
            filePath: "uploads/claims/1780968240_StarHealthPreAuthForm.pdf",
            fileSize: "642 KB",
            downloads: 0,
            uploadedBy: "Naresh",
            createdAt: new Date(),
            lastUpdated: new Date()
          }
        ];
        for (const claim of initialClaims) {
          await insertOne('claims', claim);
        }
      } else {
        const testClaim = await findOne('claims', { fileName: "1781025223_CARE_HEALTH_CLAIM_FORM.pdf" });
        if (testClaim && (testClaim.name === 'test' || testClaim.category === 'Life')) {
          await updateOne('claims', { _id: toObjectId(testClaim._id) }, {
            $set: {
              name: "Care Health: Claim Form (Reimbursement)",
              category: "Health",
              description: "Standard Care Health claim form for reimbursement. Part A to be filled by the insured, Part B by the hospital.",
              lastUpdated: new Date()
            }
          });
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

app.use('/uploads/claims', express.static(claimsUploadDir));
app.use('/uploads/partners', express.static(partnersUploadDir));
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
      const user = await findOne('users', { email: data.email });
      if (!user) {
        sendJson(res, 401, { message: 'User not found.' });
        return;
      }

      if (data.password !== user.password) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      if (!config.jwtSecret) {
        sendJson(res, 500, { message: 'Server configuration error.' });
        return;
      }
      const token = jwt.sign({ id: user._id, role: user.role }, config.jwtSecret, { expiresIn: '1h' });
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
        supportPhone: settings?.supportPhone || '+91 9750003600',
        whatsappGroupLink:
          settings?.whatsappGroupLink ||
          'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.'
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

    const namePattern = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;
    if (!name || !namePattern.test(name)) {
      sendJson(res, 400, { message: 'Please enter a valid name.' });
      return;
    }

    if (method === 'phone') {
      const phonePattern = /^[0-9+\-()\s]{10,18}$/;
      if (!phone || !phonePattern.test(phone) || (phone.match(/\d/g) || []).length < 10) {
        sendJson(res, 400, { message: 'Please enter a valid phone number with at least 10 digits.' });
        return;
      }
    } else if (method === 'email') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailPattern.test(email)) {
        sendJson(res, 400, { message: 'Please enter a valid email address.' });
        return;
      }
    } else {
      sendJson(res, 400, { message: 'Invalid download method.' });
      return;
    }

    try {
      const claim = await findOne('claims', { _id: toObjectId(claimId) });
      if (!claim) {
        sendJson(res, 404, { message: 'Claim form not found.' });
        return;
      }

      const requestId = `fhr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const timestamp = formatDateTime(new Date());

      const description = method === 'email' 
        ? `Sent Claim Form to Email: ${email}` 
        : `Downloaded Claim Form to Web (Phone: ${phone})`;

      await insertOne('form_help_requests', {
        requestId,
        name,
        phone: method === 'phone' ? phone : '',
        email: method === 'email' ? email : '',
        description,
        claimId,
        claimName,
        claimCategory,
        status: 'new',
        submittedAt: timestamp,
        updatedAt: timestamp,
        source: method === 'email' ? 'download_email' : 'download_phone'
      });

      await updateOne('claims', { _id: toObjectId(claimId) }, { $inc: { downloads: 1 } });

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

        const absoluteFilePath = path.join(publicDir, claim.filePath);
        if (!fs.existsSync(absoluteFilePath)) {
          console.error(`PDF file not found at path: ${absoluteFilePath}`);
          sendJson(res, 404, { message: 'PDF file not found on server.' });
          return;
        }

        const mailOptions = {
          from: `"Twinsure Claims" <${smtpUser}>`,
          to: email,
          subject: `Your Requested Claim Form: ${claimName}`,
          text: `Dear ${name},\n\nPlease find attached the claim form "${claimName}" you requested from Twinsure.\n\nBest regards,\nTwinsure Team`,
          html: `<p>Dear <strong>${name}</strong>,</p><p>Please find attached the claim form <strong>"${claimName}"</strong> you requested from Twinsure.</p><br><p>Best regards,<br>Twinsure Team</p>`,
          attachments: [
            {
              filename: claim.fileName || `${claimName}.pdf`,
              path: absoluteFilePath
            }
          ]
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
      res.redirect(`/${claim.filePath}`);
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
        filePath = path.join(claimsUploadDir, fileName);
        fileBufferToPath(filePath, req.file.buffer);
        fileSize = formatFileSize(req.file.size);
      }

      if (!id && !filePath) {
        sendJson(res, 400, { message: 'PDF document upload is required for new claim forms.' });
        return;
      }

      const now = new Date();
      const adminName = await getAdminName(req.user.id);

      if (!id) {
        await insertOne('claims', {
          name,
          category,
          description,
          status,
          fileName,
          filePath: `uploads/claims/${fileName}`,
          fileSize,
          downloads: 0,
          uploadedBy: adminName,
          createdAt: now,
          lastUpdated: now
        });
        sendJson(res, 201, { success: true, message: 'Claim form published successfully.' });
        return;
      }

      const finalFileName = fileName !== null ? fileName : existingClaim.fileName;
      const finalFilePath = filePath !== null ? `uploads/claims/${fileName}` : existingClaim.filePath;
      const finalFileSize = fileSize !== null ? fileSize : existingClaim.fileSize;

      if (filePath !== null && existingClaim.filePath) {
        deleteFileIfExists(path.join(publicDir, existingClaim.filePath));
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
      sendJson(res, 500, { message: 'An internal server error occurred.' });
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
        deleteFileIfExists(path.join(publicDir, claim.filePath));
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
        } catch(e) {
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
    if (!data.id || !data.status) {
      sendJson(res, 400, { error: 'id and status required' });
      return;
    }

    try {
      await updateOne('leads', { _id: toObjectId(data.id) }, { $set: { status: data.status } });
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
        const destination = path.join(partnersUploadDir, filename);
        ensureDirectory(path.dirname(destination));
        fs.writeFileSync(destination, req.file.buffer);
        photoPath = `uploads/partners/${filename}`;
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
      sendJson(res, 500, { message: 'An internal server error occurred.' });
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

  router.post('/admin/testimonials', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.name || !data.from || !data.before || !data.helped || !data.after) {
      sendJson(res, 400, { error: 'Missing required fields: name, from, before, helped, after' });
      return;
    }

    // Validate character limits: before (500), helped (500), after (400)
    if (data.before.length > 500) {
      sendJson(res, 400, { error: 'Before field cannot exceed 500 characters' });
      return;
    }
    if (data.helped.length > 500) {
      sendJson(res, 400, { error: 'How Twins Consultancy Helped field cannot exceed 500 characters' });
      return;
    }
    if (data.after.length > 400) {
      sendJson(res, 400, { error: 'Result field cannot exceed 400 characters' });
      return;
    }

    try {
      const maxOrder = await findOne('testimonials', {}, { sort: { displayOrder: -1 } });
      const nextOrder = (maxOrder && maxOrder.displayOrder) ? maxOrder.displayOrder + 1 : 1;

      const testimonial = {
        name: data.name,
        from: data.from,
        before: data.before,
        helped: data.helped,
        after: data.after,
        avatarUrl: data.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=random`,
        displayOrder: nextOrder,
        isActive: data.isActive !== undefined ? data.isActive : true,
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

  router.put('/admin/testimonials/:id', requireRole('admin'), async (req, res) => {
    const testimonialId = req.params.id;
    const data = collectBody(req);

    if (!data.name || !data.from || !data.before || !data.helped || !data.after) {
      sendJson(res, 400, { error: 'Missing required fields: name, from, before, helped, after' });
      return;
    }

    // Validate character limits
    if (data.before.length > 500) {
      sendJson(res, 400, { error: 'Before field cannot exceed 500 characters' });
      return;
    }
    if (data.helped.length > 500) {
      sendJson(res, 400, { error: 'How Twins Consultancy Helped field cannot exceed 500 characters' });
      return;
    }
    if (data.after.length > 400) {
      sendJson(res, 400, { error: 'Result field cannot exceed 400 characters' });
      return;
    }

    try {
      const updateData = {
        name: data.name,
        from: data.from,
        before: data.before,
        helped: data.helped,
        after: data.after,
        avatarUrl: data.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=random`,
        isActive: data.isActive !== undefined ? data.isActive : true,
        updatedAt: formatDateTime(new Date())
      };

      if (data.displayOrder !== undefined) {
        updateData.displayOrder = data.displayOrder;
      }

      const result = await updateOne('testimonials', { _id: new ObjectId(testimonialId) }, { $set: updateData });

      if (result && result.modifiedCount > 0) {
        sendJson(res, 200, { success: true, message: 'Testimonial updated successfully' });
      } else {
        sendJson(res, 200, { success: true, message: 'Testimonial updated' });
      }
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { error: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/testimonials/:id', requireRole('admin'), async (req, res) => {
    const testimonialId = req.params.id;

    try {
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

  router.all('*', (req, res) => {
    methodNotAllowed(res);
  });

  return router;
}

app.use('/backend/api', createApiRouter());

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