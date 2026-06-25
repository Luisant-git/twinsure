const jwt = require('jsonwebtoken');
const { config, findOne } = require('./database');

/**
 * Extracts the authorization header from the incoming request.
 * Handles multiple common casing variations for the header name.
 * @param {Object} req - Express request object.
 * @returns {string} The authorization header value or an empty string if not found.
 */
function getAuthorizationHeader(req) {
  return req.get('Authorization') || req.get('authorization') || req.headers.authorization || req.headers.Authorization || '';
}

/**
 * Authenticates a request by verifying the signed JWT token.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Object|null} The decoded user object if authenticated, null otherwise.
 */
function authenticate(req, res) {
  let authHeader = getAuthorizationHeader(req);

  if (authHeader) {
    authHeader = authHeader.replace(/^Bearer\s+/i, '');
    try {
      if (!config.jwtSecret) {
        console.error('FATAL: JWT_SECRET is not set.');
        res.status(500).json({ message: 'Server configuration error.' });
        return null;
      }
      
      const decoded = jwt.verify(authHeader, config.jwtSecret);
      if (decoded && decoded.role) {
        return decoded;
      }
    } catch (error) {
      // Fall through to unauthorized response.
    }
  }

  res.status(401).json({ message: 'Unauthorized access.' });
  return null;
}

/**
 * Middleware factory that enforces role-based access control.
 * @param {string} role - The required role (e.g., "admin").
 * @returns {Function} Express middleware function.
 */
function requireRole(role) {
  return async (req, res, next) => {
    const user = authenticate(req, res);
    if (!user) {
      return;
    }

    if (user.role !== 'admin') {
      try {
        const settings = await findOne('settings', { _id: 'global' });
        if (settings && settings.maintenanceMode) {
          res.status(503).json({ message: 'Maintenance mode - try after some time, or else try contacting admin' });
          return;
        }
      } catch (error) {
        console.error('Error checking maintenance mode in auth middleware:', error);
      }
    }

    if (user.role !== role) {
      res.status(403).json({ message: `Forbidden. Requires ${role} role.` });
      return;
    }

    req.user = user;
    next();
  };
}

module.exports = {
  authenticate,
  requireRole
};