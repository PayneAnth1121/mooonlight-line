// api/admin/jornadas.js - COMPLETE VERSION: Sin dependencia de fechas
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

  try {
    // Authenticate admin
    authenticateAdmin(req);

    const { id } = req.query; // For specific jornada operations

    if (req.method === 'GET') {
      if (id) {
        // Get specific jornada with extended information
        if (isNaN(parseInt(id))) {
          return res.status(400).json({ message: 'Invalid jornada ID' });
        }

        const result = await pool.query(`
          SELECT 
            j.id,
            j.week_number,
            j.start_date,
            j.end_date,
            j.is_current,
            j.is_completed,
            j.created_at,
            j.updated_at,
            COUNT(DISTINCT ps.id) as stats_count,
            COUNT(DISTINCT ut.id) as teams_count,
            MAX(ps.updated_at) as last_stats_update
          FROM jornadas j
          LEFT JOIN player_stats ps ON j.id = ps.jornada_id
          LEFT JOIN user_teams ut ON j.id = ut.jornada_id
          WHERE j.id = $1
          GROUP BY j.id, j.week_number, j.start_date, j.end_date, j.is_current, j.is_completed, j.created_at, j.updated_at
        `, [parseInt(id)]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Jornada not found' });
        }
        
        return res.json(result.rows[0]);
      } else {
        // Get all jornadas with extended information
        const result = await pool.query(`
          SELECT 
            j.id,
            j.week_number,
            j.start_date,
            j.end_date,
            j.is_current,
            j.is_completed,
            j.created_at,
            j.updated_at,
            COUNT(DISTINCT ps.id) as stats_count,
            COUNT(DISTINCT ut.id) as teams_count,
            MAX(ps.updated_at) as last_stats_update
          FROM jornadas j
          LEFT JOIN player_stats ps ON j.id = ps.jornada_id
          LEFT JOIN user_teams ut ON j.id = ut.jornada_id
          GROUP BY j.id, j.week_number, j.start_date, j.end_date, j.is_current, j.is_completed, j.created_at, j.updated_at
          ORDER BY j.week_number DESC
        `);
        return res.json(result.rows);
      }
    }

    if (req.method === 'POST') {
      // 🆕 CREATE JORNADA WITHOUT MANDATORY DATES
      const { week_number, start_date, end_date, is_current, lineup_locked } = req.body;
      
      if (!week_number) {
        return res.status(400).json({ message: 'Week number is required' });
      }

      // Validate week number
      if (week_number < 1 || week_number > 52) {
        return res.status(400).json({ message: 'Week number must be between 1 and 52' });
      }
      
      // Check if week already exists
      const existingWeek = await pool.query(
        'SELECT id, week_number FROM jornadas WHERE week_number = $1',
        [week_number]
      );
      
      if (existingWeek.rows.length > 0) {
        return res.status(400).json({ 
          message: `Week ${week_number} already exists`,
          existing_id: existingWeek.rows[0].id
        });
      }
      
      // If setting this jornada as current, unset any other current jornadas
      if (is_current) {
        await pool.query('UPDATE jornadas SET is_current = false WHERE is_current = true');
      }
      
      // Create new jornada (dates are optional now)
      const result = await pool.query(
        `INSERT INTO jornadas (week_number, start_date, end_date, is_current) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [week_number, start_date || null, end_date || null, is_current || false]
      );
      
      console.log(`✅ Created Week ${week_number} - Auto-activation enabled`);
      
      return res.status(201).json({
        ...result.rows[0],
        message: `Week ${week_number} created successfully! Upload player stats to activate it automatically.`,
        next_step: 'Go to Stats Manager to upload player results',
        auto_activation: true
      });
    }

    if (req.method === 'PUT') {
      // Update jornada (requires ID in query)
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Valid jornada ID is required for updates' });
      }

      const { week_number, start_date, end_date, is_current, is_completed, lineup_locked } = req.body;
      
      if (!week_number) {
        return res.status(400).json({ 
          message: 'Week number is required' 
        });
      }

      // Validate week number
      if (week_number < 1 || week_number > 52) {
        return res.status(400).json({ message: 'Week number must be between 1 and 52' });
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Check if another jornada already has this week number
        const existingWeek = await client.query(
          'SELECT id FROM jornadas WHERE week_number = $1 AND id != $2',
          [week_number, parseInt(id)]
        );
        
        if (existingWeek.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            message: `Week ${week_number} already exists in another record` 
          });
        }
        
        // If setting this jornada as current, unset any other current jornadas
        if (is_current) {
          await client.query(
            'UPDATE jornadas SET is_current = false WHERE is_current = true AND id != $1',
            [parseInt(id)]
          );
        }
        
        // Update the jornada (dates are optional)
        const result = await client.query(`
        UPDATE jornadas 
        SET 
          week_number = $1,
          start_date = $2,
          end_date = $3,
          is_current = $4,
          is_completed = $5,
          lineup_locked = $6,
          updated_at = NOW()
        WHERE id = $7
        RETURNING *
      `, [week_number, start_date || null, end_date || null, is_current, is_completed, lineup_locked || false, parseInt(id)]);
        
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'Jornada not found' });
        }
        
        await client.query('COMMIT');
        
        console.log(`✅ Updated Week ${week_number} (ID: ${id})`);
        
        return res.json({
          message: 'Jornada updated successfully',
          jornada: result.rows[0]
        });
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === 'DELETE') {
      // Reset jornada points (requires ID in query) - RESET POINTS VERSION
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Valid jornada ID is required for reset' });
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Check if jornada exists
        const checkResult = await client.query(
          'SELECT id, week_number FROM jornadas WHERE id = $1',
          [parseInt(id)]
        );
        
        if (checkResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'Jornada not found' });
        }
        
        const jornadaInfo = checkResult.rows[0];
        
        // 🔄 RESET VERSION: Solo resetear puntos, mantener estructura
        console.log(`🔄 Resetting all points for Week ${jornadaInfo.week_number}...`);
        
        // Paso 1: Resetear estadísticas de jugadores a 0
        const resetPlayerStatsResult = await client.query(
          `UPDATE player_stats SET 
             rebounds = 0, 
             two_points = 0, 
             three_points = 0, 
             free_throws = 0, 
             assists = 0, 
             blocks = 0, 
             victories = false, 
             total_points = 0, 
             updated_at = NOW()
           WHERE jornada_id = $1`,
          [parseInt(id)]
        );
        
        // Paso 2: Resetear puntos de selecciones de jugadores a 0
        const resetPlayerSelectionsResult = await client.query(
          `UPDATE user_team_players 
           SET points_earned = 0
           WHERE user_team_id IN (
             SELECT id FROM user_teams WHERE jornada_id = $1
           )`,
          [parseInt(id)]
        );
        
        // Paso 3: Resetear puntos totales de equipos a 0
        const resetUserTeamsResult = await client.query(
          `UPDATE user_teams 
           SET total_points = 0, updated_at = NOW()
           WHERE jornada_id = $1`,
          [parseInt(id)]
        );
        
        // Paso 4: Desactivar la jornada y desbloquear lineups para permitir cambios
        const resetJornadaResult = await client.query(
          `UPDATE jornadas 
           SET is_current = false, 
               is_completed = false, 
               lineup_locked = false, 
               updated_at = NOW()
           WHERE id = $1`,
          [parseInt(id)]
        );
        
        await client.query('COMMIT');
        
        console.log(`✅ Week ${jornadaInfo.week_number} points reset successfully:`, {
          player_stats_reset: resetPlayerStatsResult.rowCount,
          player_selections_reset: resetPlayerSelectionsResult.rowCount,
          user_teams_reset: resetUserTeamsResult.rowCount,
          jornada_reset: resetJornadaResult.rowCount
        });
        
        return res.json({
          message: `Week ${jornadaInfo.week_number} points reset successfully`,
          resetId: parseInt(id),
          resetWeek: jornadaInfo.week_number,
          resetData: {
            player_stats: resetPlayerStatsResult.rowCount,
            player_selections: resetPlayerSelectionsResult.rowCount,
            user_teams: resetUserTeamsResult.rowCount
          },
          info: 'All points reset to 0. User lineups preserved. Week unlocked for new stats.',
          status: 'Week is now ready for new statistics input'
        });
        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error during points reset:', error);
        throw error;
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ message: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin jornadas:', error);
    
    // Handle specific error types
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(400).json({ 
        message: 'Week number already exists',
        error: 'Duplicate week number'
      });
    }
    
    if (error.code === '23503') { // PostgreSQL foreign key violation
      return res.status(400).json({ 
        message: 'Cannot perform operation due to data dependencies',
        error: 'Foreign key constraint'
      });
    }
    
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};