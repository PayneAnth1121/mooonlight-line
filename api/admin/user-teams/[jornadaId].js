// api/admin/user-teams/[jornadaId].js - Get user teams for specific jornada
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

// Middleware to verify JWT token and admin status
function authenticateAdmin(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    throw new Error('Access denied. No token provided.');
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    if (!verified.is_admin) {
      throw new Error('Access denied. Admin privileges required.');
    }
    return verified;
  } catch (error) {
    throw new Error(error.message || 'Invalid or expired token');
  }
}

export default async function handler(req, res) {
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

  try {
    // Authenticate admin
    authenticateAdmin(req);

    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    // Get jornada ID from query params
    const { jornadaId } = req.query;
    
    if (!jornadaId || isNaN(parseInt(jornadaId))) {
      return res.status(400).json({ message: 'Invalid jornada ID' });
    }

    const jornada_id = parseInt(jornadaId);

    // Validate jornada exists
    const jornadaCheck = await pool.query(
      'SELECT id, week_number, is_current, is_completed FROM jornadas WHERE id = $1',
      [jornada_id]
    );
    
    if (jornadaCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Jornada not found' });
    }

    // Get all user teams for this jornada with detailed information
    const teamsResult = await pool.query(`
      SELECT 
        ut.id as team_id,
        ut.user_id,
        u.username,
        u.email,
        u.team_name,
        ut.total_points,
        ut.created_at as team_created_at,
        ut.updated_at as team_updated_at,
        (
          SELECT COUNT(*) 
          FROM user_team_players utp 
          WHERE utp.user_team_id = ut.id
        ) as players_count,
        (
          SELECT COUNT(*) 
          FROM user_team_players utp 
          WHERE utp.user_team_id = ut.id 
          AND utp.position_type = 'starter'
        ) as starters_count,
        (
          SELECT COUNT(*) 
          FROM user_team_players utp 
          WHERE utp.user_team_id = ut.id 
          AND utp.position_type = 'bench'
        ) as bench_count
      FROM user_teams ut
      JOIN users u ON ut.user_id = u.id
      WHERE ut.jornada_id = $1
      ORDER BY ut.total_points DESC, u.username ASC
    `, [jornada_id]);

    // Get detailed team compositions for each team
    const teamsWithPlayers = await Promise.all(
      teamsResult.rows.map(async (team) => {
        const playersResult = await pool.query(`
          SELECT 
            utp.id as selection_id,
            utp.player_id,
            p.name as player_name,
            p.image_url,
            utp.position_type,
            utp.position_number,
            utp.points_earned,
            ps.total_points as current_points
          FROM user_team_players utp
          JOIN players p ON utp.player_id = p.id
          LEFT JOIN player_stats ps ON p.id = ps.player_id AND ps.jornada_id = $1
          WHERE utp.user_team_id = $2
          ORDER BY 
            utp.position_type DESC, -- 'starter' comes before 'bench'
            utp.position_number ASC
        `, [jornada_id, team.team_id]);

        return {
          ...team,
          players: playersResult.rows,
          starters: playersResult.rows.filter(p => p.position_type === 'starter'),
          bench: playersResult.rows.filter(p => p.position_type === 'bench')
        };
      })
    );

    // Get summary statistics
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(*) as total_teams,
        AVG(ut.total_points) as avg_team_points,
        MAX(ut.total_points) as max_team_points,
        MIN(ut.total_points) as min_team_points,
        COUNT(CASE WHEN ut.total_points > 0 THEN 1 END) as teams_with_points
      FROM user_teams ut
      WHERE ut.jornada_id = $1
    `, [jornada_id]);
    
    const summary = summaryResult.rows[0];

    // Get jornada info for context
    const jornadaInfo = jornadaCheck.rows[0];
    
    return res.json({
      jornada: {
        id: jornadaInfo.id,
        week_number: jornadaInfo.week_number,
        is_current: jornadaInfo.is_current,
        is_completed: jornadaInfo.is_completed
      },
      summary: {
        total_teams: parseInt(summary.total_teams) || 0,
        avg_team_points: parseFloat(summary.avg_team_points) || 0,
        max_team_points: parseInt(summary.max_team_points) || 0,
        min_team_points: parseInt(summary.min_team_points) || 0,
        teams_with_points: parseInt(summary.teams_with_points) || 0
      },
      teams: teamsWithPlayers
    });

  } catch (error) {
    console.error('Error in admin user teams by jornada:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}