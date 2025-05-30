// api/admin/jornadas.js - CONSOLIDATED (handles both general and specific jornada operations)
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
        // Get specific jornada
        if (isNaN(parseInt(id))) {
          return res.status(400).json({ message: 'Invalid jornada ID' });
        }

        const result = await pool.query(`
          SELECT 
            id,
            week_number,
            start_date,
            end_date,
            is_current,
            is_completed,
            created_at,
            updated_at
          FROM jornadas 
          WHERE id = $1
        `, [parseInt(id)]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Jornada not found' });
        }
        
        return res.json(result.rows[0]);
      } else {
        // Get all jornadas
        const result = await pool.query(`
          SELECT * FROM jornadas 
          ORDER BY week_number DESC
        `);
        return res.json(result.rows);
      }
    }

    if (req.method === 'POST') {
      // Create new jornada
      const { week_number, start_date, end_date, is_current } = req.body;
      
      if (!week_number || !start_date || !end_date) {
        return res.status(400).json({ message: 'Week number, start date and end date are required' });
      }
      
      // If setting this jornada as current, unset any other current jornadas
      if (is_current) {
        await pool.query('UPDATE jornadas SET is_current = false WHERE is_current = true');
      }
      
      const result = await pool.query(
        'INSERT INTO jornadas (week_number, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING *',
        [week_number, start_date, end_date, is_current]
      );
      
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      // Update jornada (requires ID in query)
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Valid jornada ID is required for updates' });
      }

      const { week_number, start_date, end_date, is_current, is_completed } = req.body;
      
      if (!week_number || !start_date || !end_date) {
        return res.status(400).json({ 
          message: 'Week number, start date and end date are required' 
        });
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // If setting this jornada as current, unset any other current jornadas
        if (is_current) {
          await client.query(
            'UPDATE jornadas SET is_current = false WHERE is_current = true AND id != $1',
            [parseInt(id)]
          );
        }
        
        // Update the jornada
        const result = await client.query(`
          UPDATE jornadas 
          SET 
            week_number = $1,
            start_date = $2,
            end_date = $3,
            is_current = $4,
            is_completed = $5,
            updated_at = NOW()
          WHERE id = $6
          RETURNING *
        `, [week_number, start_date, end_date, is_current, is_completed, parseInt(id)]);
        
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'Jornada not found' });
        }
        
        await client.query('COMMIT');
        
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
      // Delete jornada (requires ID in query)
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ message: 'Valid jornada ID is required for deletion' });
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
        
        // Check if jornada has associated data
        const statsCount = await client.query(
          'SELECT COUNT(*) as count FROM player_stats WHERE jornada_id = $1',
          [parseInt(id)]
        );
        
        const teamsCount = await client.query(
          'SELECT COUNT(*) as count FROM user_teams WHERE jornada_id = $1',
          [parseInt(id)]
        );
        
        const hasData = parseInt(statsCount.rows[0].count) > 0 || parseInt(teamsCount.rows[0].count) > 0;
        
        if (hasData) {
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            message: 'Cannot delete jornada with associated player stats or teams',
            details: {
              playerStats: parseInt(statsCount.rows[0].count),
              userTeams: parseInt(teamsCount.rows[0].count)
            }
          });
        }
        
        // Delete the jornada
        await client.query('DELETE FROM jornadas WHERE id = $1', [parseInt(id)]);
        
        await client.query('COMMIT');
        
        return res.json({
          message: 'Jornada deleted successfully',
          deletedId: parseInt(id)
        });
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ message: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin jornadas:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};