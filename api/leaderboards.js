// api/leaderboards.js - FIXED: Mejor detección de jornada activa
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.keys(corsHeaders).forEach(key => {
      res.setHeader(key, corsHeaders[key]);
    });
    return res.status(200).json({});
  }

  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { jornada_id } = req.query;

    console.log('🔍 Leaderboards request for jornada_id:', jornada_id);

    // 🆕 LÓGICA MEJORADA PARA DETECTAR JORNADA
    let targetJornada = jornada_id;
    let jornadaInfo = null;

    if (!targetJornada) {
      console.log('📅 No jornada specified, finding best candidate...');
      
      // Primero: buscar jornada actual
      const currentJornada = await pool.query(`
        SELECT id, week_number, is_current, is_completed 
        FROM jornadas 
        WHERE is_current = true 
        LIMIT 1
      `);
      
      if (currentJornada.rows.length > 0) {
        targetJornada = currentJornada.rows[0].id;
        jornadaInfo = currentJornada.rows[0];
        console.log('✅ Using current jornada:', jornadaInfo.week_number);
      } else {
        // Segundo: buscar la jornada más reciente con estadísticas
        const latestWithStats = await pool.query(`
          SELECT j.id, j.week_number, j.is_current, j.is_completed,
                 COUNT(ps.id) as stats_count
          FROM jornadas j
          LEFT JOIN player_stats ps ON j.id = ps.jornada_id
          GROUP BY j.id, j.week_number, j.is_current, j.is_completed
          HAVING COUNT(ps.id) > 0
          ORDER BY j.week_number DESC 
          LIMIT 1
        `);
        
        if (latestWithStats.rows.length > 0) {
          targetJornada = latestWithStats.rows[0].id;
          jornadaInfo = latestWithStats.rows[0];
          console.log('✅ Using latest jornada with stats:', jornadaInfo.week_number);
        } else {
          // Tercero: usar la jornada más reciente (aunque no tenga stats)
          const latestJornada = await pool.query(`
            SELECT id, week_number, is_current, is_completed 
            FROM jornadas 
            ORDER BY week_number DESC 
            LIMIT 1
          `);
          
          if (latestJornada.rows.length > 0) {
            targetJornada = latestJornada.rows[0].id;
            jornadaInfo = latestJornada.rows[0];
            console.log('⚠️ Using latest jornada (no stats yet):', jornadaInfo.week_number);
          } else {
            return res.status(404).json({ 
              message: 'No game weeks found',
              suggestion: 'Create a game week first in Admin Panel'
            });
          }
        }
      }
    } else {
      // Si se especificó una jornada, obtener su info
      const specifiedJornada = await pool.query(`
        SELECT id, week_number, is_current, is_completed 
        FROM jornadas 
        WHERE id = $1
      `, [targetJornada]);
      
      if (specifiedJornada.rows.length > 0) {
        jornadaInfo = specifiedJornada.rows[0];
        console.log('✅ Using specified jornada:', jornadaInfo.week_number);
      }
    }

    console.log('🎯 Final jornada_id:', targetJornada);

    // 🆕 VERIFICAR SI HAY DATOS PARA ESTA JORNADA
    const dataCheck = await pool.query(`
      SELECT 
        COUNT(DISTINCT ps.id) as stats_count,
        COUNT(DISTINCT ut.id) as teams_count,
        COUNT(DISTINCT u.id) as users_count
      FROM jornadas j
      LEFT JOIN player_stats ps ON j.id = ps.jornada_id
      LEFT JOIN user_teams ut ON j.id = ut.jornada_id
      LEFT JOIN users u ON u.is_admin = FALSE
      WHERE j.id = $1
    `, [targetJornada]);
    
    const dataInfo = dataCheck.rows[0];
    console.log('📊 Data check:', dataInfo);

    // 🆕 USAR FUNCIÓN get_leaderboard MEJORADA
    let leaderboardData = [];
    
    try {
      console.log('🔧 Trying stored function get_leaderboard...');
      const result = await pool.query('SELECT * FROM get_leaderboard($1)', [targetJornada]);
      
      if (result.rows.length > 0) {
        leaderboardData = result.rows;
        console.log('✅ Leaderboard loaded via stored function:', result.rows.length, 'entries');
      } else {
        console.log('⚠️ Stored function returned empty results');
      }
    } catch (functionError) {
      console.log('⚠️ Stored function failed:', functionError.message);
    }

    // 🆕 FALLBACK DIRECTO SI LA FUNCIÓN FALLA
    if (leaderboardData.length === 0) {
      console.log('🔄 Using direct query fallback...');
      const directResult = await pool.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC) as rank,
          u.id as user_id,
          u.username as manager,
          u.team_name as team,
          COALESCE(ut.total_points, 0) as points
        FROM users u
        LEFT JOIN user_teams ut ON u.id = ut.user_id AND ut.jornada_id = $1
        WHERE u.is_admin = FALSE
        ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC
      `, [targetJornada]);

      leaderboardData = directResult.rows;
      console.log('✅ Direct query result:', directResult.rows.length, 'entries');
    }

    // 🆕 FORZAR RECÁLCULO SI NO HAY PUNTOS
    const totalPointsInLeaderboard = leaderboardData.reduce((sum, entry) => sum + parseInt(entry.points), 0);
    
    if (totalPointsInLeaderboard === 0 && parseInt(dataInfo.stats_count) > 0) {
      console.log('🔄 Zero points detected but stats exist - forcing recalculation...');
      
      try {
        // Ejecutar recálculo manual
        await pool.query('SELECT recalculate_all_team_points($1)', [targetJornada]);
        console.log('✅ Recalculation completed');
        
        // Volver a consultar
        const recalcResult = await pool.query(`
          SELECT 
            ROW_NUMBER() OVER (ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC) as rank,
            u.id as user_id,
            u.username as manager,
            u.team_name as team,
            COALESCE(ut.total_points, 0) as points
          FROM users u
          LEFT JOIN user_teams ut ON u.id = ut.user_id AND ut.jornada_id = $1
          WHERE u.is_admin = FALSE
          ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC
        `, [targetJornada]);
        
        leaderboardData = recalcResult.rows;
        console.log('✅ After recalculation:', recalcResult.rows.length, 'entries');
      } catch (recalcError) {
        console.error('❌ Recalculation failed:', recalcError.message);
      }
    }

    // 🆕 RESPUESTA ENRIQUECIDA CON DEBUG INFO
    const response = {
      leaderboard: leaderboardData,
      debug_info: {
        jornada_id: targetJornada,
        jornada_info: jornadaInfo,
        stats_count: parseInt(dataInfo.stats_count),
        teams_count: parseInt(dataInfo.teams_count),
        users_count: parseInt(dataInfo.users_count),
        total_points_shown: leaderboardData.reduce((sum, entry) => sum + parseInt(entry.points), 0),
        timestamp: new Date().toISOString()
      }
    };

    // En development, incluir debug info
    if (process.env.NODE_ENV === 'development') {
      console.log('📋 Full response:', JSON.stringify(response, null, 2));
    }

    // Devolver solo el leaderboard para el frontend
    res.json(leaderboardData);

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