// api/user-teams.js - MEJORADO con bloqueo de edición
const jwt = require('jsonwebtoken');
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

function authenticateUser(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    throw new Error('Access denied. No token provided.');
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    return verified;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

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

  try {
    const user = authenticateUser(req);

    if (req.method === 'GET') {
      const { user_id, jornada_id } = req.query;
      
      if (!user.is_admin && parseInt(user_id) !== parseInt(user.id)) {
        return res.status(403).json({ message: 'Access denied. You can only view your own team.' });
      }
      
      if (!user_id || !jornada_id) {
        return res.status(400).json({ message: 'User ID and Jornada ID are required' });
      }

      const teamResult = await pool.query(`
        SELECT ut.*, u.username, u.team_name, j.lineup_locked
        FROM user_teams ut
        JOIN users u ON ut.user_id = u.id
        JOIN jornadas j ON ut.jornada_id = j.id
        WHERE ut.user_id = $1 AND ut.jornada_id = $2
      `, [user_id, jornada_id]);

      if (teamResult.rows.length === 0) {
        return res.json({ team: null, players: [], lineup_locked: false });
      }

      const team = teamResult.rows[0];

      const playersResult = await pool.query(`
        SELECT 
          utp.*,
          p.name as player_name,
          p.image_url
        FROM user_team_players utp
        JOIN players p ON utp.player_id = p.id
        WHERE utp.user_team_id = $1
        ORDER BY utp.position_type DESC, utp.position_number ASC
      `, [team.id]);

      return res.json({
        team: team,
        players: playersResult.rows,
        lineup_locked: team.lineup_locked
      });
    }

    if (req.method === 'POST') {
      const { user_id, jornada_id, players } = req.body;
      
      if (!user.is_admin && parseInt(user_id) !== parseInt(user.id)) {
        return res.status(403).json({ message: 'Access denied. You can only save your own team.' });
      }
      
      if (!user_id || !jornada_id || !Array.isArray(players)) {
        return res.status(400).json({ 
          message: 'User ID, Jornada ID, and players array are required' 
        });
      }

      // 🔒 VERIFICAR SI LA JORNADA ESTÁ BLOQUEADA
      const jornadaCheck = await pool.query(
        'SELECT id, lineup_locked, week_number FROM jornadas WHERE id = $1',
        [jornada_id]
      );
      
      if (jornadaCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Game week not found' });
      }

      const jornada = jornadaCheck.rows[0];
      
      if (jornada.lineup_locked && !user.is_admin) {
        return res.status(403).json({ 
          message: `Lineups are locked for Week ${jornada.week_number}. You cannot modify your team after stats have been uploaded.` 
        });
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Eliminar equipo existente si existe
        const existingTeam = await client.query(
          'SELECT id FROM user_teams WHERE user_id = $1 AND jornada_id = $2',
          [user_id, jornada_id]
        );
        
        if (existingTeam.rows.length > 0) {
          const teamId = existingTeam.rows[0].id;
          await client.query('DELETE FROM user_team_players WHERE user_team_id = $1', [teamId]);
          await client.query('DELETE FROM user_teams WHERE id = $1', [teamId]);
        }
        
        // Crear nuevo equipo
        const teamResult = await client.query(`
          INSERT INTO user_teams (user_id, jornada_id, total_points, created_at, updated_at)
          VALUES ($1, $2, 0, NOW(), NOW())
          RETURNING id
        `, [user_id, jornada_id]);
        
        const teamId = teamResult.rows[0].id;
        
        // Agregar jugadores al equipo
        for (const player of players) {
          const { player_id, position_type, position_number } = player;
          
          if (!player_id || !position_type || !position_number) {
            throw new Error('Player ID, position type, and position number are required');
          }
          
          const playerCheck = await pool.query(
            'SELECT id FROM players WHERE id = $1 AND is_active = TRUE',
            [player_id]
          );
          
          if (playerCheck.rows.length === 0) {
            throw new Error(`Player with ID ${player_id} not found or inactive`);
          }
          
          await client.query(`
            INSERT INTO user_team_players (
              user_team_id, 
              player_id, 
              position_type, 
              position_number,
              points_earned
            ) VALUES ($1, $2, $3, $4, 0)
          `, [teamId, player_id, position_type, position_number]);
        }
        
        // Si ya hay estadísticas para esta jornada, recalcular puntos
        const statsExist = await client.query(
          'SELECT COUNT(*) as count FROM player_stats WHERE jornada_id = $1',
          [jornada_id]
        );
        
        if (parseInt(statsExist.rows[0].count) > 0) {
          console.log(`📊 Stats exist for jornada ${jornada_id}, calculating points for new team...`);
          
          // Actualizar puntos de jugadores titulares
          await client.query(`
            UPDATE user_team_players utp
            SET points_earned = COALESCE(ps.total_points, 0)
            FROM player_stats ps
            WHERE utp.player_id = ps.player_id
            AND ps.jornada_id = $1
            AND utp.user_team_id = $2
            AND utp.position_type = 'starter'
          `, [jornada_id, teamId]);
          
          // Calcular puntos totales
          await client.query(`
            UPDATE user_teams 
            SET total_points = (
              SELECT COALESCE(SUM(points_earned), 0)
              FROM user_team_players
              WHERE user_team_id = $1
              AND position_type = 'starter'
            )
            WHERE id = $1
          `, [teamId]);
        }
        
        await client.query('COMMIT');
        
        return res.status(201).json({
          message: 'Team saved successfully',
          team_id: teamId,
          players_count: players.length,
          lineup_locked: jornada.lineup_locked
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
    console.error('Error in user teams:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};