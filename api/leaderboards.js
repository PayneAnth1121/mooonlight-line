// api/leaderboards.js - FIXED: Sistema de puntuación corregido + debugging mejorado
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
    const { jornada_id, force_refresh } = req.query;

    console.log('🔍 Leaderboards request - jornada_id:', jornada_id, 'force_refresh:', force_refresh);

    // 🆕 LÓGICA MEJORADA PARA DETECTAR JORNADA ACTIVA
    let targetJornada = jornada_id;
    let jornadaInfo = null;

    if (!targetJornada) {
      console.log('📅 Auto-detecting best jornada...');
      
      // Buscar jornada activa primero
      const currentJornada = await pool.query(`
        SELECT id, week_number, is_current, is_completed, lineup_locked
        FROM jornadas 
        WHERE is_current = true 
        LIMIT 1
      `);
      
      if (currentJornada.rows.length > 0) {
        targetJornada = currentJornada.rows[0].id;
        jornadaInfo = currentJornada.rows[0];
        console.log('✅ Using current jornada:', jornadaInfo.week_number);
      } else {
        // Buscar la jornada más reciente con estadísticas
        const latestWithStats = await pool.query(`
          SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                 COUNT(ps.id) as stats_count
          FROM jornadas j
          LEFT JOIN player_stats ps ON j.id = ps.jornada_id
          GROUP BY j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked
          HAVING COUNT(ps.id) > 0
          ORDER BY j.week_number DESC 
          LIMIT 1
        `);
        
        if (latestWithStats.rows.length > 0) {
          targetJornada = latestWithStats.rows[0].id;
          jornadaInfo = latestWithStats.rows[0];
          console.log('✅ Using latest jornada with stats:', jornadaInfo.week_number);
        } else {
          // Usar la jornada más reciente (aunque no tenga stats)
          const latestJornada = await pool.query(`
            SELECT id, week_number, is_current, is_completed, lineup_locked
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
        SELECT id, week_number, is_current, is_completed, lineup_locked
        FROM jornadas 
        WHERE id = $1
      `, [targetJornada]);
      
      if (specifiedJornada.rows.length > 0) {
        jornadaInfo = specifiedJornada.rows[0];
        console.log('✅ Using specified jornada:', jornadaInfo.week_number);
      } else {
        return res.status(404).json({ message: 'Specified game week not found' });
      }
    }

    console.log('🎯 Final jornada_id:', targetJornada);

    // 🆕 VERIFICAR SI HAY DATOS Y FORZAR RECÁLCULO SI ES NECESARIO
    const dataCheck = await pool.query(`
      SELECT 
        COUNT(DISTINCT ps.id) as stats_count,
        COUNT(DISTINCT ut.id) as teams_count,
        COUNT(DISTINCT u.id) as users_count,
        COALESCE(SUM(ut.total_points), 0) as total_team_points
      FROM jornadas j
      LEFT JOIN player_stats ps ON j.id = ps.jornada_id
      LEFT JOIN user_teams ut ON j.id = ut.jornada_id
      LEFT JOIN users u ON u.is_admin = FALSE
      WHERE j.id = $1
    `, [targetJornada]);
    
    const dataInfo = dataCheck.rows[0];
    console.log('📊 Data check:', {
      stats_count: dataInfo.stats_count,
      teams_count: dataInfo.teams_count,
      total_team_points: dataInfo.total_team_points
    });

    // 🔧 FUNCIÓN MEJORADA PARA RECÁLCULO AUTOMÁTICO
    const shouldRecalculate = force_refresh === 'true' || 
                             (parseInt(dataInfo.stats_count) > 0 && 
                              parseInt(dataInfo.teams_count) > 0 && 
                              parseInt(dataInfo.total_team_points) === 0);

    if (shouldRecalculate) {
      console.log('🔄 Executing recalculation...');
      try {
        const recalcResult = await pool.query(
          'SELECT * FROM recalculate_all_team_points($1)',
          [targetJornada]
        );
        console.log('✅ Recalculation completed:', recalcResult.rows[0]);
      } catch (recalcError) {
        console.error('❌ Recalculation failed:', recalcError);
        // Continuar de todos modos
      }
    }

    // 🆕 CONSULTA MEJORADA PARA LEADERBOARD CON DEBUGGING
    let leaderboardData = [];
    
    try {
      console.log('🔧 Trying enhanced stored function...');
      const result = await pool.query('SELECT * FROM get_leaderboard($1)', [targetJornada]);
      
      if (result.rows.length > 0) {
        leaderboardData = result.rows.map(row => ({
          rank: parseInt(row.rank),
          user_id: parseInt(row.user_id),
          manager: row.manager,
          team: row.team,
          points: parseInt(row.points)
        }));
        console.log('✅ Leaderboard loaded via stored function:', result.rows.length, 'entries');
      } else {
        console.log('⚠️ Stored function returned empty results');
      }
    } catch (functionError) {
      console.log('⚠️ Stored function failed:', functionError.message);
    }

    // 🆕 FALLBACK DIRECTO MEJORADO
    if (leaderboardData.length === 0) {
      console.log('🔄 Using enhanced direct query fallback...');
      const directResult = await pool.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC) as rank,
          u.id as user_id,
          u.username as manager,
          u.team_name as team,
          COALESCE(ut.total_points, 0) as points,
          CASE 
            WHEN ut.id IS NOT NULL THEN 'has_team'
            ELSE 'no_team'
          END as team_status
        FROM users u
        LEFT JOIN user_teams ut ON u.id = ut.user_id AND ut.jornada_id = $1
        WHERE u.is_admin = FALSE
        ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC
      `, [targetJornada]);

      leaderboardData = directResult.rows.map(row => ({
        rank: parseInt(row.rank),
        user_id: parseInt(row.user_id),
        manager: row.manager,
        team: row.team,
        points: parseInt(row.points)
      }));
      
      console.log('✅ Direct query result:', directResult.rows.length, 'entries');
      console.log('📊 Points distribution:', {
        total_points: leaderboardData.reduce((sum, entry) => sum + entry.points, 0),
        users_with_points: leaderboardData.filter(entry => entry.points > 0).length,
        users_with_zero: leaderboardData.filter(entry => entry.points === 0).length
      });
    }

    // 🆕 VALIDACIÓN ADICIONAL: Si no hay puntos pero hay stats, intentar recálculo manual
    const totalPointsInLeaderboard = leaderboardData.reduce((sum, entry) => sum + entry.points, 0);
    
    if (totalPointsInLeaderboard === 0 && parseInt(dataInfo.stats_count) > 0 && parseInt(dataInfo.teams_count) > 0) {
      console.log('🚨 Zero points detected but stats and teams exist - forcing manual recalculation...');
      
      try {
        // Ejecutar recálculo paso a paso
        console.log('Step 1: Updating user_team_players points...');
        await pool.query(`
          UPDATE user_team_players utp
          SET points_earned = CASE 
            WHEN utp.position_type = 'starter' THEN COALESCE(ps.total_points, 0)
            ELSE 0
          END
          FROM player_stats ps, user_teams ut
          WHERE utp.player_id = ps.player_id
          AND utp.user_team_id = ut.id
          AND ps.jornada_id = $1
          AND ut.jornada_id = $1
        `, [targetJornada]);
        
        console.log('Step 2: Updating user_teams total_points...');
        await pool.query(`
          UPDATE user_teams ut
          SET total_points = (
            SELECT COALESCE(SUM(utp.points_earned), 0)
            FROM user_team_players utp
            WHERE utp.user_team_id = ut.id
            AND utp.position_type = 'starter'
          ),
          updated_at = NOW()
          WHERE ut.jornada_id = $1
        `, [targetJornada]);
        
        console.log('✅ Manual recalculation completed');
        
        // Volver a consultar después del recálculo
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
        
        leaderboardData = recalcResult.rows.map(row => ({
          rank: parseInt(row.rank),
          user_id: parseInt(row.user_id),
          manager: row.manager,
          team: row.team,
          points: parseInt(row.points)
        }));
        
        console.log('✅ After manual recalculation:', {
          entries: leaderboardData.length,
          total_points: leaderboardData.reduce((sum, entry) => sum + entry.points, 0)
        });
        
      } catch (recalcError) {
        console.error('❌ Manual recalculation failed:', recalcError);
      }
    }

    // 🆕 INFORMACIÓN DE DEBUG DETALLADA
    const debugInfo = {
      jornada_id: targetJornada,
      jornada_info: jornadaInfo,
      stats_count: parseInt(dataInfo.stats_count),
      teams_count: parseInt(dataInfo.teams_count),
      users_count: parseInt(dataInfo.users_count),
      total_points_calculated: leaderboardData.reduce((sum, entry) => sum + entry.points, 0),
      users_with_points: leaderboardData.filter(entry => entry.points > 0).length,
      timestamp: new Date().toISOString(),
      recalculated: shouldRecalculate
    };

    // En desarrollo, mostrar debug info
    if (process.env.NODE_ENV === 'development') {
      console.log('📋 Debug info:', debugInfo);
    }

    // 🆕 SI AÚN NO HAY PUNTOS, AGREGAR INFORMACIÓN ÚTIL
    if (debugInfo.total_points_calculated === 0 && debugInfo.teams_count > 0) {
      console.log('⚠️ Warning: Teams exist but no points calculated');
      
      // Verificar si hay jugadores en posición starter
      const starterCheck = await pool.query(`
        SELECT COUNT(*) as starter_count
        FROM user_team_players utp
        JOIN user_teams ut ON utp.user_team_id = ut.id
        WHERE ut.jornada_id = $1 AND utp.position_type = 'starter'
      `, [targetJornada]);
      
      debugInfo.starter_players_count = parseInt(starterCheck.rows[0].starter_count);
      console.log('👥 Starter players found:', debugInfo.starter_players_count);
    }

    // Devolver el leaderboard
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