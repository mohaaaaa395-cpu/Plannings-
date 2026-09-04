import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_NAME = 'cedif_token';

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, {
    expiresIn: '30d',
  });
}

export function setAuthCookie(res, token) {
  res.cookie(TOKEN_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(TOKEN_NAME);
}

export function getUserFromRequest(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.[TOKEN_NAME] || bearer;
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  req.user = user;
  next();
}
