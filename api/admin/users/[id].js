// api/admin/users/[id].js - Get specific user details
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

  } catch (error) {
    console.error('Error in admin user details:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}