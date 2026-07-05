const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');

async function main() {
  // Read .env manually
  let jwtSecret = 'secret';
  try {
    const env = fs.readFileSync('backend/.env', 'utf8');
    const match = env.match(/JWT_SECRET\s*=\s*(.*)/);
    if (match && match[1]) {
      jwtSecret = match[1].trim();
    }
  } catch (e) {
    console.warn('Could not read JWT_SECRET from .env, using default', e.message);
  }

  console.log('Using Secret:', jwtSecret);
  
  // Create an admin token
  const token = jwt.sign({
    userId: '6a252598d7c00a675f4af282',
    role: 'admin',
    email: 'admin@twinsure.in'
  }, jwtSecret, { expiresIn: '1h' });

  console.log('Using Admin Token:', token);

  const boundary = '----TestBoundary';
  const bodyParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nTest User\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\nTest City\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="before"\r\n\r\nBefore Text\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="helped"\r\n\r\nHelped Text\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="after"\r\n\r\nAfter Text\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="heading"\r\n\r\nTest Heading\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="isActive"\r\n\r\ntrue\r\n`,
    `--${boundary}--\r\n`
  ];
  const payload = bodyParts.join('');

  const req = http.request({
    host: '127.0.0.1',
    port: 8000,
    path: '/backend/api/admin/testimonials/6a252598d7c00a675f4af282',
    method: 'PUT',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${token}`
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('RESPONSE:', data);
      process.exit(0);
    });
  });

  req.on('error', (err) => {
    console.error('Request Error:', err);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

main().catch(console.error);
