// api/admin/player-stats.js - Manage player statistics
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

    if (req.method === 'GET') {
      // Get player stats for a specific jornada
      const { jornada_id } = req.query;
      
      if (!jornada_id) {
        return res.status(400).json({ message: 'Jornada ID is required' });
      }

      // Get all active players with their stats for this jornada (if any)
      const result = await pool.query(`
        SELECT 
          p.id as player_id,
          p.name as player_name,
          p.image_url,
          ps.rebounds,
          ps.two_points,
          ps.three_points,
          ps.free_throws,
          ps.assists,
          ps.blocks,
          ps.victories,
          ps.total_points,
          ps.created_at as stats_created_at,
          ps.updated_at as stats_updated_at
        FROM players p
        LEFT JOIN player_stats ps ON p.id = ps.player_id AND ps.jornada_id = $1
        WHERE p.is_active = TRUE
        ORDER BY p.name ASC
      `, [jornada_id]);
      
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      // Save/update player stats for a jornada
      const { jornada_id, stats } = req.body;
      
      if (!jornada_id || !stats || !Array.isArray(stats)) {
        return res.status(400).json({ 
          message: 'Jornada ID and stats array are required' 
        });
      }

      // Validate jornada exists
      const jornadaCheck = await pool.query(
        'SELECT id FROM jornadas WHERE id = $1',
        [jornada_id]
      );
      
      if (jornadaCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Jornada not found' });
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const results = [];
        
        for (const stat of stats) {
          const { 
            player_id, 
            rebounds = 0, 
            two_points = 0, 
            three_points = 0, 
            free_throws = 0, 
            assists = 0, 
            blocks = 0, 
            victories = false 
          } = stat;
          
          if (!player_id) {
            throw new Error('Player ID is required for each stat entry');
          }
          
          // Validate player exists
          const playerCheck = await client.query(
            'SELECT id FROM players WHERE id = $1 AND is_active = TRUE',
            [player_id]
          );
          
          if (playerCheck.rows.length === 0) {
            throw new Error(`Player with ID ${player_id} not found or inactive`);
          }
          
          // Validate stat values
          if (rebounds < 0 || two_points < 0 || three_points < 0 || 
              free_throws < 0 || assists < 0 || blocks < 0) {
            throw new Error('Statistics cannot be negative');
          }
          
          // Upsert player stats (insert or update if exists)
          const upsertResult = await client.query(`
            INSERT INTO player_stats (
              player_id, 
              jornada_id, 
              rebounds, 
              two_points, 
              three_points, 
              free_throws, 
              assists, 
              blocks, 
              victories
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (player_id, jornada_id) 
            DO UPDATE SET
              rebounds = EXCLUDED.rebounds,
              two_points = EXCLUDED.two_points,
              three_points = EXCLUDED.three_points,
              free_throws = EXCLUDED.free_throws,
              assists = EXCLUDED.assists,
              blocks = EXCLUDED.blocks,
              victories = EXCLUDED.victories,
              updated_at = NOW()
            RETURNING *
          `, [
            player_id, 
            jornada_id, 
            rebounds, 
            two_points, 
            three_points, 
            free_throws, 
            assists, 
            blocks, 
            victories
          ]);
          
          results.push(upsertResult.rows[0]);
        }
        
        await client.query('COMMIT');
        
        return res.json({
          message: 'Player stats saved successfully',
          updated_count: results.length,
          stats: results
        });
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === 'DELETE') {
      // Delete all stats for a specific jornada
      const { jornada_id } = req.body;
      
      if (!jornada_id) {
        return res.status(400).json({ message: 'Jornada ID is required' });
      }

      const result = await pool.query(
        'DELETE FROM player_stats WHERE jornada_id = $1 RETURNING *',
        [jornada_id]
      );
      
      return res.json({
        message: 'Player stats deleted successfully',
        deleted_count: result.rows.length
      });
    }

    return res.status(405).json({ message: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin player stats:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}