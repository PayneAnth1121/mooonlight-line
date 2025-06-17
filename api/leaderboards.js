// api/leaderboards.js - CORREGIDO PARA FUNCIONAR CON NUEVA ESTRUCTURA
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
    const { jornada_id } = req.query;

    console.log('🔍 Leaderboards request for jornada_id:', jornada_id);

    // Get current jornada if not specified
    let targetJornada = jornada_id;
    if (!targetJornada) {
      console.log('📅 No jornada specified, finding current...');
      const currentJornada = await pool.query('SELECT id FROM jornadas WHERE is_current = true LIMIT 1');
      if (currentJornada.rows.length === 0) {
        console.log('❌ No current jornada found, getting latest...');
        const latestJornada = await pool.query('SELECT id FROM jornadas ORDER BY week_number DESC LIMIT 1');
        if (latestJornada.rows.length === 0) {
          return res.status(404).json({ message: 'No game weeks found' });
        }
        targetJornada = latestJornada.rows[0].id;
      } else {
        targetJornada = currentJornada.rows[0].id;
      }
    }

    console.log('🎯 Using jornada_id:', targetJornada);

    // Try using the stored function first
    try {
      console.log('🔧 Trying stored function get_leaderboard...');
      const result = await pool.query('SELECT * FROM get_leaderboard($1)', [targetJornada]);
      
      if (result.rows.length > 0) {
        console.log('✅ Leaderboard loaded via stored function:', result.rows.length, 'entries');
        return res.json(result.rows);
      }
    } catch (functionError) {
      console.log('⚠️ Stored function failed, trying direct query:', functionError.message);
    }

    // Fallback: Direct query if stored function fails
    console.log('🔄 Using direct query fallback...');
    const directResult = await pool.query(`
      SELECT 
        ROW_NUMBER() OVER (ORDER BY ut.total_points DESC, u.username ASC) as rank,
        u.id as user_id,
        u.username as manager,
        u.team_name as team,
        COALESCE(ut.total_points, 0) as points
      FROM users u
      LEFT JOIN user_teams ut ON u.id = ut.user_id AND ut.jornada_id = $1
      WHERE u.is_admin = FALSE
      ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC
    `, [targetJornada]);

    console.log('✅ Direct query result:', directResult.rows.length, 'entries');

    // If still no results, return empty leaderboard with sample structure
    if (directResult.rows.length === 0) {
      console.log('📋 No teams found, returning empty leaderboard');
      return res.json([]);
    }

    res.json(directResult.rows);

  } catch (error) {
    console.error('❌ Error in leaderboards API:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        sqlState: error.sqlState
      } : undefined
    });
  }
};