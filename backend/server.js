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

  const collectionsToCreate = ['users', 'services', 'partners', 'recommendation_questions', 'leads', 'form_help_requests', 'settings', 'contacts', 'claims'];
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
      supportPhone: '+91 9999988888',
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
}

const allowedOrigins = [
  process.env.API_BASE_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
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
    return settings && settings.loginAttempts ? parseInt(settings.loginAttempts) * 20 : 100;
  } catch (err) {
    return 100;
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
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: async (req, res) => await getLoginRateLimit(),
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

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

  router.all('*', (req, res) => {
    methodNotAllowed(res);
  });

  return router;
}

app.use('/backend/api', createApiRouter());
app.use(createApiRouter());

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