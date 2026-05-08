export function requireApiKey(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || token !== process.env.MC_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
