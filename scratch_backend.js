
const fs = require('fs');

let serverCode = fs.readFileSync('backend/server.js', 'utf8');

// 1. Update /public/request_claims to accept needsHelp
serverCode = serverCode.replace(
  "const hasEmail = Boolean(data.hasEmail);",
  "const hasEmail = Boolean(data.hasEmail);\n    const needsHelp = Boolean(data.needsHelp);"
);
serverCode = serverCode.replace(
  "hasEmail\n      });",
  "hasEmail,\n        needsHelp,\n        status: 'new'\n      });"
);

// 2. Delete /public/form_help_requests
serverCode = serverCode.replace(/router\.post\('\/public\/form_help_requests', strictLimiter, async \(req, res\) => \{[\s\S]*?\}\);/, "");

// 3. Update /admin/download_requests to allow DELETE and PUT operations
const adminDownloadRequestsAdditions = `

  router.put('/admin/download_requests', requireRole('admin'), async (req, res) => {
    const data = collectBody(req);
    if (!data.id || !data.status) {
      sendJson(res, 400, { message: 'id and status required' });
      return;
    }

    try {
      await updateOne('downloadRequests', { requestId: normalizeString(data.id) }, {
        $set: {
          status: normalizeString(data.status),
          updatedAt: formatDateTime(new Date())
        }
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });

  router.delete('/admin/download_requests', requireRole('admin'), async (req, res) => {
    const id = normalizeString(req.query.id);
    if (!id) {
      sendJson(res, 400, { message: 'id required' });
      return;
    }

    try {
      await deleteOne('downloadRequests', { requestId: id });
      sendJson(res, 200, { success: true, message: 'Request deleted successfully.' });
    } catch (error) {
      console.error('Database/Server Error:', error.message);
      sendJson(res, 500, { message: 'An internal server error occurred.' });
    }
  });
`;
serverCode = serverCode.replace(/router\.get\('\/admin\/download_requests', requireRole\('admin'\), async \(req, res\) => \{[\s\S]*?\}\);/, match => match + adminDownloadRequestsAdditions);

// 4. Delete /admin/form_help_requests APIs (GET, POST, DELETE)
serverCode = serverCode.replace(/router\.get\('\/admin\/form_help_requests', requireRole\('admin'\), async \(req, res\) => \{[\s\S]*?\}\);/, "");
// wait, the old one is router.post('/admin/form_help_requests' for status updates!
serverCode = serverCode.replace(/router\.post\('\/admin\/form_help_requests', requireRole\('admin'\), async \(req, res\) => \{[\s\S]*?\}\);/, "");
serverCode = serverCode.replace(/router\.delete\('\/admin\/form_help_requests', requireRole\('admin'\), async \(req, res\) => \{[\s\S]*?\}\);/, "");


fs.writeFileSync('backend/server.js', serverCode);
console.log('server.js updated successfully!');
