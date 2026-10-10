// Minimal role-based auth using Node's built-in crypto (no extra dependencies).
const crypto = require('crypto');
const { db } = require('./db');
const { HttpError } = require('./logic');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function requireAuth(role) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const user = token && (await db.prepare(`
        SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token));
      if (!user) return next(new HttpError(401, 'Please sign in'));
      if (role && user.role !== role) return next(new HttpError(403, `This action is for ${role}s only`));
      req.user = user;
      req.token = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { hashPassword, verifyPassword, createSession, requireAuth };
