const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

/**
 * Loads environment variables from a given .env file path into process.env.
 * @param {string} envPath - Absolute path to the .env file.
 */
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

/**
 * Centralized configuration object populated from environment variables.
 */
const config = {
  mongodbUri: process.env.MONGODB_URI,
  mongodbDatabase: process.env.MONGODB_DATABASE || 'twinsdb',
  host: process.env.HOST,
  backendPort: process.env.BACKEND_PORT,
  frontendPort: process.env.FRONTEND_PORT,
  jwtSecret: process.env.JWT_SECRET
};

let clientPromise = null;

/**
 * Establishes and caches a connection to the MongoDB server.
 * @returns {Promise<MongoClient>} The connected MongoDB client.
 */
async function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(config.mongodbUri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

/**
 * Retrieves the active MongoDB database instance based on the configuration.
 * @returns {Promise<Db>} The MongoDB database instance.
 */
async function getDb() {
  const client = await getClient();
  return client.db(config.mongodbDatabase);
}

/**
 * Formats a Date object or string into a standard SQL-like datetime string (YYYY-MM-DD HH:mm:ss).
 * @param {Date|string} value - The date to format.
 * @returns {string} The formatted date string.
 */
function formatDateTime(value) {
  if (!value) {
    return value;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Recursively serializes a value for safe transmission or storage.
 * Converts Dates to strings and ObjectIds to strings.
 * @param {*} value - The value to serialize.
 * @returns {*} The serialized value.
 */
function serializeValue(value) {
  if (value instanceof Date) {
    return formatDateTime(value);
  }

  if (value instanceof ObjectId) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = serializeValue(nestedValue);
    }
    return result;
  }

  return value;
}

function serializeDocument(document) {
  return serializeValue(document);
}

/**
 * Retrieves multiple documents from a collection.
 * @param {string} collectionName - Name of the MongoDB collection.
 * @param {Object} filter - Query filter.
 * @param {Object} options - Query options (sort, limit, etc.).
 * @returns {Promise<Array>} Array of serialized documents.
 */
async function findMany(collectionName, filter = {}, options = {}) {
  const db = await getDb();
  const documents = await db.collection(collectionName).find(filter, options).toArray();
  return documents.map((document) => serializeDocument(document));
}

/**
 * Retrieves a single document from a collection.
 * @param {string} collectionName - Name of the MongoDB collection.
 * @param {Object} filter - Query filter.
 * @param {Object} options - Query options.
 * @returns {Promise<Object|null>} The serialized document or null.
 */
async function findOne(collectionName, filter = {}, options = {}) {
  const documents = await findMany(collectionName, filter, options);
  return documents.length > 0 ? documents[0] : null;
}

/**
 * Inserts a single document into a collection.
 * @param {string} collectionName - Name of the MongoDB collection.
 * @param {Object} document - The document to insert.
 * @returns {Promise<ObjectId>} The ID of the inserted document.
 */
async function insertOne(collectionName, document) {
  const db = await getDb();
  const result = await db.collection(collectionName).insertOne(document);
  return result.insertedId;
}

/**
 * Updates a single document in a collection.
 * @param {string} collectionName - Name of the MongoDB collection.
 * @param {Object} filter - Query filter to find the document.
 * @param {Object} update - Update operations to apply.
 * @param {Object} options - Update options (e.g., upsert).
 * @returns {Promise<Object>} Update result object.
 */
async function updateOne(collectionName, filter, update, options = {}) {
  const db = await getDb();
  return db.collection(collectionName).updateOne(filter, update, options);
}

/**
 * Deletes a single document from a collection.
 * @param {string} collectionName - Name of the MongoDB collection.
 * @param {Object} filter - Query filter to find the document.
 * @param {Object} options - Delete options.
 * @returns {Promise<Object>} Delete result object.
 */
async function deleteOne(collectionName, filter, options = {}) {
  const db = await getDb();
  return db.collection(collectionName).deleteOne(filter, options);
}

/**
 * Creates a MongoDB collection if it does not already exist.
 * @param {string} collectionName - Name of the collection to create.
 * @returns {Promise<boolean>} True if created, false if it already existed.
 */
async function createCollectionIfNotExists(collectionName) {
  const db = await getDb();
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    await db.createCollection(collectionName);
    return true;
  }

  return false;
}

module.exports = {
  ObjectId,
  config,
  createCollectionIfNotExists,
  deleteOne,
  findMany,
  findOne,
  formatDateTime,
  getDb,
  insertOne,
  serializeDocument,
  updateOne
};