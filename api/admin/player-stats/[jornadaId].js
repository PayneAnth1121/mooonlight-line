// api/admin/player-stats/[jornadaId].js - Get player stats for specific jornada
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

    // Get all active players with their stats for this jornada (if any)
    const result = await pool.query(`
      SELECT 
        p.id as player_id,
        p.name as player_name,
        p.image_url,
        COALESCE(ps.rebounds, 0) as rebounds,
        COALESCE(ps.two_points, 0) as two_points,
        COALESCE(ps.three_points, 0) as three_points,
        COALESCE(ps.free_throws, 0) as free_throws,
        COALESCE(ps.assists, 0) as assists,
        COALESCE(ps.blocks, 0) as blocks,
        COALESCE(ps.victories, false) as victories,
        COALESCE(ps.total_points, 0) as total_points,
        ps.created_at as stats_created_at,
        ps.updated_at as stats_updated_at,
        CASE 
          WHEN ps.player_id IS NOT NULL THEN true 
          ELSE false 
        END as has_stats
      FROM players p
      LEFT JOIN player_stats ps ON p.id = ps.player_id AND ps.jornada_id = $1
      WHERE p.is_active = TRUE
      ORDER BY 
        ps.total_points DESC NULLS LAST,
        p.name ASC
    `, [jornada_id]);
    
    // Get jornada info for context
    const jornadaInfo = jornadaCheck.rows[0];
    
    // Get summary statistics
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(*) as total_players_with_stats,
        AVG(ps.total_points) as avg_points,
        MAX(ps.total_points) as max_points,
        MIN(ps.total_points) as min_points,
        SUM(ps.total_points) as total_points_all_players
      FROM player_stats ps
      JOIN players p ON ps.player_id = p.id
      WHERE ps.jornada_id = $1 AND p.is_active = TRUE
    `, [jornada_id]);
    
    const summary = summaryResult.rows[0];
    
    return res.json({
      jornada: {
        id: jornadaInfo.id,
        week_number: jornadaInfo.week_number,
        is_current: jornadaInfo.is_current,
        is_completed: jornadaInfo.is_completed
      },
      summary: {
        total_players_with_stats: parseInt(summary.total_players_with_stats) || 0,
        avg_points: parseFloat(summary.avg_points) || 0,
        max_points: parseInt(summary.max_points) || 0,
        min_points: parseInt(summary.min_points) || 0,
        total_points_all_players: parseInt(summary.total_points_all_players) || 0
      },
      players: result.rows,
      total_players: result.rows.length
    });

  } catch (error) {
    console.error('Error in admin player stats by jornada:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}