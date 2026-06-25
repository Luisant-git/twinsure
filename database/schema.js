/*
  Twinsure MongoDB backup schema.

  Purpose:
  - Rebuild a fresh MongoDB database with the same collections used by the app.
  - Enforce the document shape with JSON Schema validators so the structure is explicit.
  - Keep the script readable and safe to rerun after a database reset.

  Run it with mongosh, for example:
  mongosh "mongodb://127.0.0.1:27017/twinsdb" database/schema.js
*/

const dbName = (typeof process !== 'undefined' && process.env && process.env.MONGODB_DATABASE)
  ? process.env.MONGODB_DATABASE
  : 'twinsdb';

const targetDb = db.getSiblingDB(dbName);

function createCollectionWithSchema(name, schema, indexes = []) {
  print(`Creating collection: ${name}`);

  targetDb.createCollection(name, {
    validator: {
      $jsonSchema: schema
    },
    validationLevel: 'strict',
    validationAction: 'error'
  });

  for (const indexSpec of indexes) {
    targetDb.collection(name).createIndex(indexSpec.keys, indexSpec.options || {});
  }
}

print(`Resetting database: ${dbName}`);
targetDb.dropDatabase();

// 1. users
// User accounts for admin, partner, employee, and any future portal roles.
createCollectionWithSchema(
  'users',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Display name.' },
      email: { bsonType: 'string', description: 'Unique login email.' },
      phone: { bsonType: 'string', description: 'Unique login phone.' },
      password: { bsonType: 'string', description: 'Stored password string used by the current auth flow.' },
      role: { bsonType: 'string', description: 'User role such as admin, user, partner, or employee.' },
      kyc: { bsonType: 'object', description: 'KYC status and files.' },
      tsid: { bsonType: 'string', description: 'Sequential unique user ID in format U{YEAR}{3-digit-sequence}, e.g. U2026001. Sequence is based on max existing, never reused if deleted.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { email: 1 }, options: { unique: true } },
    { keys: { phone: 1 }, options: { unique: true, sparse: true } },
    { keys: { role: 1 }, options: {} }
  ]
);

// 2. services
// Reserved collection for insurance service catalog records.
// The live app does not currently write to this collection, so the validator stays permissive.
createCollectionWithSchema(
  'services',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Service name.' },
      title: { bsonType: 'string', description: 'Optional display title.' },
      category: { bsonType: 'string', description: 'Service category.' },
      description: { bsonType: 'string', description: 'Service description.' },
      icon: { bsonType: 'string', description: 'Icon identifier or class name.' },
      image: { bsonType: 'string', description: 'Image path or URL.' },
      features: { bsonType: 'array', description: 'Feature list.' },
      status: { bsonType: 'string', description: 'Publication status.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { category: 1 }, options: {} }
  ]
);

// 3. partners
// Partner onboarding records, including the optional media upload and role-specific meta object.
createCollectionWithSchema(
  'partners',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Partner name.' },
      phone: { bsonType: 'string', description: 'Partner phone number.' },
      email: { bsonType: 'string', description: 'Partner email address.' },
      address: { bsonType: 'string', description: 'Mailing or contact address.' },
      occupation: { bsonType: 'string', description: 'Occupation category supplied by the form.' },
      meta: {
        bsonType: 'object',
        additionalProperties: true,
        description: 'Occupation-specific details such as college/course or company/designation.'
      },
      photo: { bsonType: ['string', 'null'], description: 'Stored profile photo path.' },
      status: { bsonType: 'string', description: 'Review status.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { email: 1 }, options: {} },
    { keys: { status: 1 }, options: {} },
    { keys: { createdAt: -1 }, options: {} }
  ]
);

// 4. recommendation_questions
// Stores the full recommendation flow graph used by the public recommendation builder.
createCollectionWithSchema(
  'recommendation_questions',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      greeting: { bsonType: 'string', description: 'Greeting text shown at the start of the flow.' },
      nodes: { bsonType: 'array', description: 'Flow node list.' },
      edges: { bsonType: 'array', description: 'Flow edge list.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  }
);

// 5. leads
// Lead submissions generated from the recommendation journey.
createCollectionWithSchema(
  'leads',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Lead name.' },
      phone: { bsonType: 'string', description: 'Lead phone number.' },
      email: { bsonType: 'string', description: 'Lead email address.' },
      answers: { bsonType: 'array', description: 'Answered recommendation flow data.' },
      callbackSlots: { bsonType: 'array', description: 'Preferred callback slots.' },
      submittedAt: { bsonType: ['date', 'string'], description: 'Submission timestamp.' },
      status: { bsonType: 'string', description: 'Lead workflow status.' }
    }
  },
  [
    { keys: { status: 1 }, options: {} },
    { keys: { submittedAt: -1 }, options: {} }
  ]
);

// 6. form_help_requests
// Support requests raised from the claims/download experience.
createCollectionWithSchema(
  'form_help_requests',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      requestId: { bsonType: 'string', description: 'Unique external request identifier.' },
      name: { bsonType: 'string', description: 'Requester name.' },
      phone: { bsonType: 'string', description: 'Requester phone number.' },
      description: { bsonType: 'string', description: 'Problem description.' },
      claimId: { bsonType: ['string', 'null'], description: 'Claim identifier if applicable.' },
      claimName: { bsonType: 'string', description: 'Claim form title.' },
      claimCategory: { bsonType: 'string', description: 'Claim category.' },
      status: { bsonType: 'string', description: 'Request status.' },
      submittedAt: { bsonType: ['date', 'string'], description: 'Submission timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' },
      source: { bsonType: 'string', description: 'Source page or module.' }
    }
  },
  [
    { keys: { requestId: 1 }, options: { unique: true } },
    { keys: { status: 1 }, options: {} },
    { keys: { submittedAt: -1 }, options: {} }
  ]
);

// 7. settings
// Single global configuration document used across the app.
createCollectionWithSchema(
  'settings',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      _id: { bsonType: 'string', description: 'Document ID, usually global.' },
      supportEmail: { bsonType: 'string', description: 'Support contact email.' },
      supportPhone: { bsonType: 'string', description: 'Support contact phone.' },
      whatsappGroupLink: { bsonType: 'string', description: 'Public WhatsApp group or chat link.' },
      maintenanceMode: { bsonType: 'bool', description: 'Maintenance flag.' },
      emailNotifications: { bsonType: 'bool', description: 'Email notification toggle.' },
      leadAlerts: { bsonType: 'bool', description: 'Lead alert toggle.' },
      partnerAlerts: { bsonType: 'bool', description: 'Partner alert toggle.' },
      claimAlerts: { bsonType: 'bool', description: 'Claim alert toggle.' },
      notificationPriority: { bsonType: 'string', description: 'Notification priority level.' },
      sessionTimeout: { bsonType: 'string', description: 'Session timeout in minutes.' },
      loginAttempts: { bsonType: 'string', description: 'Maximum login attempts.' },
      callbackSlot: { bsonType: 'bool', description: 'Callback slot toggle.' },
      partnerRegEnabled: { bsonType: 'bool', description: 'Partner registration toggle.' },
      referralTracking: { bsonType: 'bool', description: 'Referral tracking toggle.' },
      publicCommissionInfo: { bsonType: 'bool', description: 'Commission info visibility toggle.' },
      minCommission: { bsonType: 'string', description: 'Minimum commission text.' },
      maxCommission: { bsonType: 'string', description: 'Maximum commission text.' },
      manualPartnerApproval: { bsonType: 'bool', description: 'Manual partner approval toggle.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { _id: 1 }, options: { unique: true } }
  ]
);

// 8. contacts
// Contact requests submitted from the public contact form.
createCollectionWithSchema(
  'contacts',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Contact name.' },
      phone: { bsonType: 'string', description: 'Contact phone number.' },
      city: { bsonType: 'string', description: 'Contact city.' },
      email: { bsonType: 'string', description: 'Optional email address.' },
      altPhone: { bsonType: 'string', description: 'Optional alternate phone number.' },
      address: { bsonType: 'string', description: 'Optional address.' },
      enquiryType: { bsonType: 'string', description: 'Enquiry category.' },
      specify: { bsonType: 'string', description: 'Optional free-text note.' },
      submittedAt: { bsonType: ['date', 'string'], description: 'Submission timestamp.' },
      status: { bsonType: 'string', description: 'Contact workflow status.' }
    }
  },
  [
    { keys: { status: 1 }, options: {} },
    { keys: { submittedAt: -1 }, options: {} }
  ]
);

// 9. claims
// Downloadable claim form records with PDF metadata and counters.
createCollectionWithSchema(
  'claims',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Claim form title.' },
      category: { bsonType: 'string', description: 'Claim category.' },
      description: { bsonType: 'string', description: 'Claim description.' },
      status: { bsonType: 'string', description: 'Publication status.' },
      fileName: { bsonType: 'string', description: 'Stored PDF file name.' },
      filePath: { bsonType: 'string', description: 'Static file path under uploads.' },
      fileSize: { bsonType: 'string', description: 'Human-readable file size.' },
      downloads: { bsonType: ['int', 'long', 'double'], description: 'Download count.' },
      uploadedBy: { bsonType: 'string', description: 'Admin name who uploaded the file.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      lastUpdated: { bsonType: ['date', 'string'], description: 'Last updated timestamp.' }
    }
  },
  [
    { keys: { status: 1 }, options: {} },
    { keys: { lastUpdated: -1 }, options: {} }
  ]
);

// 10. testimonials
// Client testimonials with before/after scenarios and how Twins Consultancy helped.
createCollectionWithSchema(
  'testimonials',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      name: { bsonType: 'string', description: 'Client name.' },
      from: { bsonType: 'string', description: 'Client location or designation.' },
      before: { bsonType: 'string', description: 'Situation before Twins Consultancy helped (max 500 chars).' },
      helped: { bsonType: 'string', description: 'How Twins Consultancy helped (max 500 chars).' },
      after: { bsonType: 'string', description: 'Result/outcome after help (max 400 chars).' },
      avatarUrl: { bsonType: 'string', description: 'Avatar image URL.' },
      displayOrder: { bsonType: 'int', description: 'Display order in testimonials section.' },
      isActive: { bsonType: 'bool', description: 'Whether to display on public pages.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { displayOrder: 1 }, options: {} },
    { keys: { isActive: 1 }, options: {} }
  ]
);

// 11. user_policies
createCollectionWithSchema(
  'user_policies',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      userId: { bsonType: 'string', description: 'Associated User ID.' },
      policyNumber: { bsonType: 'string', description: 'Insurance Policy Number.' },
      provider: { bsonType: 'string', description: 'Insurance Provider Name.' },
      type: { bsonType: 'string', description: 'Policy Type (Health, Motor, Life, etc.).' },
      notes: { bsonType: 'string', description: 'Remarks or notes.' },
      fileName: { bsonType: ['string', 'null'], description: 'Stored PDF file name.' },
      filePath: { bsonType: ['string', 'null'], description: 'Path to policy file.' },
      fileSize: { bsonType: ['string', 'null'], description: 'Human-readable file size.' },
      status: { bsonType: 'string', description: 'Policy verification status.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { userId: 1 }, options: {} },
    { keys: { policyNumber: 1 }, options: {} }
  ]
);

// 12. appointments
createCollectionWithSchema(
  'appointments',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      userId: { bsonType: 'string', description: 'Associated User ID.' },
      type: { bsonType: 'string', description: 'Appointment type (call/office).' },
      primaryPhone: { bsonType: 'string', description: 'Primary contact phone.' },
      alternativePhone: { bsonType: 'string', description: 'Secondary contact phone.' },
      date: { bsonType: 'string', description: 'Preferred date string.' },
      timeSlot: { bsonType: 'string', description: 'Preferred time slot.' },
      alternativeTimeSlot: { bsonType: 'string', description: 'Alternative time slot.' },
      purpose: { bsonType: 'string', description: 'Purpose of consultation.' },
      status: { bsonType: 'string', description: 'Status of booking.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' },
      updatedAt: { bsonType: ['date', 'string'], description: 'Last update timestamp.' }
    }
  },
  [
    { keys: { userId: 1 }, options: {} },
    { keys: { date: 1 }, options: {} }
  ]
);

// 13. user_services
createCollectionWithSchema(
  'user_services',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      userId: { bsonType: 'string', description: 'Associated User ID.' },
      category: { bsonType: 'string', description: 'Service category (Icare, HosPos, etc.).' },
      description: { bsonType: 'string', description: 'Details of service request.' },
      preferredTime: { bsonType: 'string', description: 'Preferred time to contact.' },
      notes: { bsonType: 'string', description: 'Additional notes.' },
      status: { bsonType: 'string', description: 'Workflow status.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' }
    }
  },
  [
    { keys: { userId: 1 }, options: {} }
  ]
);

// 14. user_updates
createCollectionWithSchema(
  'user_updates',
  {
    bsonType: 'object',
    additionalProperties: true,
    properties: {
      userId: { bsonType: 'string', description: 'Associated User ID.' },
      title: { bsonType: 'string', description: 'Notification title.' },
      message: { bsonType: 'string', description: 'Detailed update message.' },
      category: { bsonType: 'string', description: 'Category (Policies, Appointments, Services, etc.).' },
      status: { bsonType: 'string', description: 'Display status.' },
      createdAt: { bsonType: ['date', 'string'], description: 'Creation timestamp.' }
    }
  },
  [
    { keys: { userId: 1 }, options: {} },
    { keys: { createdAt: -1 }, options: {} }
  ]
);

print('\nDatabase schema creation complete.');
print('Collections created: users, services, partners, recommendation_questions, leads, form_help_requests, settings, contacts, claims, testimonials, user_policies, appointments, user_services, user_updates');
