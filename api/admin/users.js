// api/admin/users.js - Manage users
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
      // Get all users with statistics
      const { include_stats } = req.query;

      let baseQuery = `
        SELECT 
          u.id,
          u.username,
          u.email,
          u.team_name,
          u.is_admin,
          u.created_at,
          u.updated_at
        FROM users u
        ORDER BY u.created_at DESC
      `;

      if (include_stats === 'true') {
        // Include user statistics
        baseQuery = `
          SELECT 
            u.id,
            u.username,
            u.email,
            u.team_name,
            u.is_admin,
            u.created_at,
            u.updated_at,
            (
              SELECT COUNT(*) 
              FROM user_teams ut 
              WHERE ut.user_id = u.id
            ) as total_teams_created,
            (
              SELECT COUNT(*) 
              FROM user_teams ut 
              WHERE ut.user_id = u.id 
              AND ut.total_points > 0
            ) as teams_with_points,
            (
              SELECT AVG(ut.total_points) 
              FROM user_teams ut 
              WHERE ut.user_id = u.id
            ) as avg_points_per_week,
            (
              SELECT MAX(ut.total_points) 
              FROM user_teams ut 
              WHERE ut.user_id = u.id
            ) as best_week_points,
            (
              SELECT COUNT(DISTINCT utp.player_id)
              FROM user_teams ut
              JOIN user_team_players utp ON ut.id = utp.user_team_id
              WHERE ut.user_id = u.id
            ) as unique_players_drafted
          FROM users u
          ORDER BY u.created_at DESC
        `;
      }

      const result = await pool.query(baseQuery);
      
      // Get summary statistics
      const summaryResult = await pool.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_admin = true THEN 1 END) as total_admins,
          COUNT(CASE WHEN is_admin = false THEN 1 END) as total_regular_users,
          (
            SELECT COUNT(*) 
            FROM user_teams 
            WHERE total_points > 0
          ) as total_active_teams,
          (
            SELECT AVG(player_count)
            FROM (
              SELECT COUNT(*) as player_count
              FROM user_team_players utp
              JOIN user_teams ut ON utp.user_team_id = ut.id
              GROUP BY ut.id
            ) team_sizes
          ) as avg_team_size
        FROM users
      `);

      const summary = summaryResult.rows[0];

      return res.json({
        users: result.rows,
        summary: {
          total_users: parseInt(summary.total_users) || 0,
          total_admins: parseInt(summary.total_admins) || 0,
          total_regular_users: parseInt(summary.total_regular_users) || 0,
          total_active_teams: parseInt(summary.total_active_teams) || 0,
          avg_team_size: parseFloat(summary.avg_team_size) || 0
        }
      });
    }

    if (req.method === 'PUT') {
      // Update user (admin can modify user roles, etc.)
      const { user_id, is_admin, team_name } = req.body;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID is required' });
      }

      // Check if user exists
      const userCheck = await pool.query(
        'SELECT id, username FROM users WHERE id = $1',
        [user_id]
      );
      
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      if (typeof is_admin === 'boolean') {
        updateFields.push(`is_admin = $${paramIndex}`);
        updateValues.push(is_admin);
        paramIndex++;
      }

      if (team_name && team_name.trim()) {
        updateFields.push(`team_name = $${paramIndex}`);
        updateValues.push(team_name.trim());
        paramIndex++;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ message: 'No valid fields to update' });
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(user_id);

      const updateQuery = `
        UPDATE users 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, username, email, team_name, is_admin, updated_at
      `;

      const result = await pool.query(updateQuery, updateValues);
      
      return res.json({
        message: 'User updated successfully',
        user: result.rows[0]
      });
    }

    if (req.method === 'DELETE') {
      // Delete user (careful operation)
      const { user_id } = req.body;
      
      if (!user_id) {
        return res.status(400).json({ message: 'User ID is required' });
      }

      // Check if user exists and is not the only admin
      const userCheck = await pool.query(
        'SELECT id, username, is_admin FROM users WHERE id = $1',
        [user_id]
      );
      
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      const user = userCheck.rows[0];

      // Prevent deletion of the last admin
      if (user.is_admin) {
        const adminCount = await pool.query(
          'SELECT COUNT(*) as count FROM users WHERE is_admin = true'
        );
        
        if (parseInt(adminCount.rows[0].count) <= 1) {
          return res.status(400).json({ 
            message: 'Cannot delete the last administrator' 
          });
        }
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Delete related data first (cascade should handle this, but let's be explicit)
        await client.query(
          'DELETE FROM user_team_players WHERE user_team_id IN (SELECT id FROM user_teams WHERE user_id = $1)',
          [user_id]
        );
        
        await client.query('DELETE FROM user_teams WHERE user_id = $1', [user_id]);
        
        // Delete the user
        await client.query('DELETE FROM users WHERE id = $1', [user_id]);
        
        await client.query('COMMIT');
        
        return res.json({
          message: 'User deleted successfully',
          deleted_user: {
            id: user.id,
            username: user.username
          }
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
    console.error('Error in admin users:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}