// api/user-stats.js
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Middleware to verify JWT token
function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    throw new Error('Access denied. No token provided.');
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    return verified;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Authenticate user
    const user = authenticateToken(req);
    const user_id = user.id;
    const { jornada_id } = req.query;

    // Get current jornada if not specified
    let targetJornada = jornada_id;
    if (!targetJornada) {
      const currentJornada = await pool.query('SELECT id FROM jornadas WHERE is_current = true LIMIT 1');
      if (currentJornada.rows.length === 0) {
        return res.status(404).json({ message: 'No active game week found' });
      }
      targetJornada = currentJornada.rows[0].id;
    }

    // Get user's position in leaderboard
    const leaderboard = await pool.query('SELECT * FROM get_leaderboard($1)', [targetJornada]);
    const userPosition = leaderboard.rows.find(row => parseInt(row.user_id) === parseInt(user_id));

    // Get user's team name
    const userResult = await pool.query(
      'SELECT team_name FROM users WHERE id = $1', 
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      rank: userPosition ? userPosition.rank : null,
      points: userPosition ? userPosition.points : 0,
      team: userResult.rows[0].team_name
    });

  } catch (error) {
    console.error('Error fetching user stats:', error);
    if (error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
}