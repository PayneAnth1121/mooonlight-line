// api/admin/users.js - CONSOLIDADO: Manage users + individual user details
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

    // Check if this is a specific user request (former [id].js functionality)
    if (req.query.id) {
      return await handleSpecificUser(req, res);
    }

    // Check if this is a user teams request for jornada
    if (req.query.jornadaId && req.query.userTeams === 'true') {
      return await handleUserTeamsByJornada(req, res);
    }

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
};

// Handle specific user request (former [id].js functionality)
async function handleSpecificUser(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Get user ID from query params
  const { id } = req.query;
  
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const userId = parseInt(id);

  // Get user basic information
  const userResult = await pool.query(`
    SELECT 
      id,
      username,
      email,
      team_name,
      is_admin,
      created_at,
      updated_at
    FROM users 
    WHERE id = $1
  `, [userId]);
  
  if (userResult.rows.length === 0) {
    return res.status(404).json({ message: 'User not found' });
  }

  const user = userResult.rows[0];

  // Get user's team history with performance
  const teamsResult = await pool.query(`
    SELECT 
      ut.id as team_id,
      j.week_number,
      j.start_date,
      j.end_date,
      j.is_current,
      j.is_completed,
      ut.total_points,
      ut.created_at as team_created_at,
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
      -- Calculate rank for this week
      (
        SELECT COUNT(*) + 1
        FROM user_teams ut2
        WHERE ut2.jornada_id = ut.jornada_id
        AND ut2.total_points > ut.total_points
      ) as weekly_rank
    FROM user_teams ut
    JOIN jornadas j ON ut.jornada_id = j.id
    WHERE ut.user_id = $1
    ORDER BY j.week_number DESC
  `, [userId]);

  // Get user's most used players
  const playersResult = await pool.query(`
    SELECT 
      p.id,
      p.name as player_name,
      COUNT(*) as times_selected,
      AVG(utp.points_earned) as avg_points_earned,
      MAX(utp.points_earned) as best_performance,
      COUNT(CASE WHEN utp.position_type = 'starter' THEN 1 END) as times_as_starter
    FROM user_team_players utp
    JOIN user_teams ut ON utp.user_team_id = ut.id
    JOIN players p ON utp.player_id = p.id
    WHERE ut.user_id = $1
    GROUP BY p.id, p.name
    ORDER BY times_selected DESC, avg_points_earned DESC
    LIMIT 10
  `, [userId]);

  // Get performance statistics
  const statsResult = await pool.query(`
    SELECT 
      COUNT(*) as total_weeks_participated,
      AVG(ut.total_points) as avg_points_per_week,
      MAX(ut.total_points) as best_week_points,
      MIN(ut.total_points) as worst_week_points,
      STDDEV(ut.total_points) as points_consistency,
      COUNT(CASE WHEN ut.total_points > 0 THEN 1 END) as weeks_with_points,
      -- Calculate average rank
      AVG(
        (
          SELECT COUNT(*) + 1
          FROM user_teams ut2
          WHERE ut2.jornada_id = ut.jornada_id
          AND ut2.total_points > ut.total_points
        )
      ) as avg_rank
    FROM user_teams ut
    WHERE ut.user_id = $1
  `, [userId]);

  const stats = statsResult.rows[0];

  // Get recent activity (last 5 team changes)
  const activityResult = await pool.query(`
    SELECT 
      ut.id as team_id,
      j.week_number,
      ut.total_points,
      ut.updated_at,
      'team_updated' as activity_type
    FROM user_teams ut
    JOIN jornadas j ON ut.jornada_id = j.id
    WHERE ut.user_id = $1
    AND ut.updated_at > ut.created_at
    ORDER BY ut.updated_at DESC
    LIMIT 5
  `, [userId]);

  return res.json({
    user: {
      ...user,
      member_since: user.created_at,
      last_activity: user.updated_at
    },
    teams: teamsResult.rows,
    favorite_players: playersResult.rows,
    statistics: {
      total_weeks_participated: parseInt(stats.total_weeks_participated) || 0,
      avg_points_per_week: parseFloat(stats.avg_points_per_week) || 0,
      best_week_points: parseInt(stats.best_week_points) || 0,
      worst_week_points: parseInt(stats.worst_week_points) || 0,
      points_consistency: parseFloat(stats.points_consistency) || 0,
      weeks_with_points: parseInt(stats.weeks_with_points) || 0,
      avg_rank: parseFloat(stats.avg_rank) || 0,
      participation_rate: stats.total_weeks_participated > 0 ? 
        (parseFloat(stats.weeks_with_points) / parseFloat(stats.total_weeks_participated) * 100) : 0
    },
    recent_activity: activityResult.rows
  });
}

// Handle user teams by jornada (former user-teams/[jornadaId].js functionality)
async function handleUserTeamsByJornada(req, res) {
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
}