// api/user-stats.js - CORREGIDO para usar el mismo sistema que leaderboards
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    Object.keys(corsHeaders).forEach(key => {
      res.setHeader(key, corsHeaders[key]);
    });
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

    console.log('📈 Getting user stats for user ID:', user_id);

    // 🔥 NUEVA LÓGICA: Usar el mismo sistema que leaderboards para obtener el ranking correcto
    // Obtener TODOS los usuarios con sus puntos totales acumulados (igual que leaderboards)
    const leaderboardQuery = `
      WITH user_total_points AS (
        SELECT 
          u.id as user_id,
          u.username as manager,
          u.team_name as team,
          COALESCE(SUM(ut.total_points), 0) as total_points
        FROM users u
        LEFT JOIN user_teams ut ON u.id = ut.user_id
        WHERE u.is_admin = FALSE
        GROUP BY u.id, u.username, u.team_name
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY total_points DESC, manager ASC) as rank,
        user_id,
        manager,
        team,
        total_points as points
      FROM user_total_points
      ORDER BY total_points DESC, manager ASC
    `;

    const leaderboardResult = await pool.query(leaderboardQuery);
    
    // Buscar al usuario específico en el leaderboard
    const userPosition = leaderboardResult.rows.find(row => parseInt(row.user_id) === parseInt(user_id));
    
    // Obtener información del usuario
    const userResult = await pool.query(
      'SELECT team_name, username FROM users WHERE id = $1', 
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userResult.rows[0];

    // Preparar respuesta
    const response = {
      rank: userPosition ? parseInt(userPosition.rank) : null,
      points: userPosition ? parseInt(userPosition.points) : 0,
      team: userData.team_name || 'No Team',
      username: userData.username || 'Unknown'
    };

    console.log('✅ User stats calculated:', {
      user_id,
      rank: response.rank,
      points: response.points,
      found_in_leaderboard: !!userPosition
    });

    res.json(response);

  } catch (error) {
    console.error('❌ Error fetching user stats:', error);
    if (error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};