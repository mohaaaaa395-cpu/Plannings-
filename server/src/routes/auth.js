import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth, getUserFromRequest } from '../auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiants requis' });
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: { id: user.id, username: user.username, role: user.role }, token });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  res.json({ user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 4) return res.status(400).json({ error: 'Nouveau mot de passe trop court' });
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  const ok = await bcrypt.compare(current || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  const hash = await bcrypt.hash(next, 10);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  res.json({ ok: true });
});

export default router;
