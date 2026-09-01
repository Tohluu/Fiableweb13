const fs = require('fs');
const crypto = require('crypto');
const filePath = 'data/riders.json';
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const password = 'Test@1234';
const salt = 'salt-rider-0001-fiable';
const rider = data.find((entry) => entry.email === 'testrider@example.com');
if (!rider) {
  throw new Error('testrider@example.com not found');
}
rider.passwordHash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
rider.salt = salt;
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log('updated', rider.email, rider.passwordHash);
