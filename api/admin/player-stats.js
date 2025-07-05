// api/admin/player-stats.js - MEJORADO con recálculo automático
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
    authenticateAdmin(req);

    if (req.query.jornadaId) {
      return await handleSpecificJornada(req, res);
    }

    if (req.method === 'GET') {
      const { jornada_id } = req.query;
      
      if (!jornada_id) {
        return res.status(400).json({ message: 'Jornada ID is required' });
      }

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
        const { jornada_id, stats } = req.body;
        
        if (!jornada_id || !stats || !Array.isArray(stats)) {
            return res.status(400).json({ 
                message: 'Jornada ID and stats array are required' 
            });
        }

        // Validar que la jornada existe
        const jornadaCheck = await pool.query(
            'SELECT id, week_number, is_current, lineup_locked FROM jornadas WHERE id = $1',
            [jornada_id]
        );
        
        if (jornadaCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Game week not found' });
        }

        const jornadaInfo = jornadaCheck.rows[0];
        console.log(`📊 Processing stats for Week ${jornadaInfo.week_number} (ID: ${jornada_id})`);

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            console.log(`💾 Saving stats for ${stats.length} players`);
            const results = [];
            let updatedCount = 0;
            let newCount = 0;
            
            // Procesar cada jugador
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
                
                // Validar que el jugador existe y está activo
                const playerCheck = await client.query(
                    'SELECT id, name FROM players WHERE id = $1 AND is_active = TRUE',
                    [player_id]
                );
                
                if (playerCheck.rows.length === 0) {
                    throw new Error(`Player with ID ${player_id} not found or inactive`);
                }
                
                // Validar que las estadísticas son válidas
                if (rebounds < 0 || two_points < 0 || three_points < 0 || 
                    free_throws < 0 || assists < 0 || blocks < 0) {
                    throw new Error(`Invalid statistics for player ${playerCheck.rows[0].name}: negative values not allowed`);
                }
                
                // Calcular puntos totales usando la fórmula oficial
                const total_points = 
                    (rebounds * 1) +
                    (two_points * 2) +
                    (three_points * 3) +
                    (free_throws * 1) +
                    (assists * 1) +
                    (blocks * 2) +
                    (victories ? 5 : 0);
                
                console.log(`👤 ${playerCheck.rows[0].name}: ${total_points} points`);
                
                // Insertar o actualizar estadísticas
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
                        victories,
                        total_points,
                        created_at,
                        updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
                    ON CONFLICT (player_id, jornada_id) 
                    DO UPDATE SET
                        rebounds = EXCLUDED.rebounds,
                        two_points = EXCLUDED.two_points,
                        three_points = EXCLUDED.three_points,
                        free_throws = EXCLUDED.free_throws,
                        assists = EXCLUDED.assists,
                        blocks = EXCLUDED.blocks,
                        victories = EXCLUDED.victories,
                        total_points = EXCLUDED.total_points,
                        updated_at = NOW()
                    RETURNING *, 
                        CASE WHEN created_at = updated_at THEN 'inserted' ELSE 'updated' END as action
                `, [
                    player_id, 
                    jornada_id, 
                    rebounds, 
                    two_points, 
                    three_points, 
                    free_throws, 
                    assists, 
                    blocks, 
                    victories,
                    total_points
                ]);
                
                const result = upsertResult.rows[0];
                results.push(result);
                
                if (result.action === 'inserted') {
                    newCount++;
                } else {
                    updatedCount++;
                }
            }
            
            console.log(`✅ Stats processed: ${newCount} new, ${updatedCount} updated`);
            
            // 🔥 ACTIVAR JORNADA Y BLOQUEAR LINEUPS AUTOMÁTICAMENTE
            console.log(`⚡ Auto-activating Week ${jornadaInfo.week_number}...`);
            await client.query(`
                UPDATE jornadas 
                SET 
                    is_current = FALSE,
                    updated_at = NOW()
                WHERE is_current = TRUE AND id != $1
            `, [jornada_id]);
            
            await client.query(`
                UPDATE jornadas 
                SET 
                    is_current = TRUE,
                    lineup_locked = TRUE,
                    updated_at = NOW()
                WHERE id = $1
            `, [jornada_id]);
            
            console.log(`🔒 Lineups locked for Week ${jornadaInfo.week_number}`);
            
            // 🔄 FORZAR RECÁLCULO COMPLETO DE TODOS LOS EQUIPOS
            console.log(`🔄 Initiating complete team points recalculation...`);
            
            // Paso 1: Actualizar puntos de jugadores titulares en todos los equipos
            const updatePlayersResult = await client.query(`
                UPDATE user_team_players utp
                SET 
                    points_earned = CASE 
                        WHEN utp.position_type = 'starter' THEN COALESCE(ps.total_points, 0)
                        ELSE 0
                    END,
                    updated_at = NOW()
                FROM player_stats ps, user_teams ut
                WHERE utp.player_id = ps.player_id
                    AND utp.user_team_id = ut.id
                    AND ps.jornada_id = $1
                    AND ut.jornada_id = $1
            `, [jornada_id]);
            
            console.log(`👥 Updated ${updatePlayersResult.rowCount} player positions`);
            
            // Paso 2: Recalcular totales de equipos
            const updateTeamsResult = await client.query(`
                UPDATE user_teams ut
                SET 
                    total_points = (
                        SELECT COALESCE(SUM(utp.points_earned), 0)
                        FROM user_team_players utp
                        WHERE utp.user_team_id = ut.id
                            AND utp.position_type = 'starter'
                    ),
                    updated_at = NOW()
                WHERE ut.jornada_id = $1
            `, [jornada_id]);
            
            console.log(`🏆 Recalculated ${updateTeamsResult.rowCount} team totals`);
            
            // Paso 3: Verificar que los cálculos funcionaron
            const verificationResult = await client.query(`
                SELECT 
                    COUNT(*) as total_teams,
                    SUM(total_points) as total_points_distributed,
                    AVG(total_points) as avg_points_per_team,
                    MAX(total_points) as max_points,
                    COUNT(CASE WHEN total_points > 0 THEN 1 END) as teams_with_points
                FROM user_teams 
                WHERE jornada_id = $1
            `, [jornada_id]);
            
            const verification = verificationResult.rows[0];
            console.log(`📊 Verification:`, {
                total_teams: verification.total_teams,
                teams_with_points: verification.teams_with_points,
                total_points_distributed: verification.total_points_distributed,
                avg_points_per_team: Math.round(verification.avg_points_per_team || 0),
                max_points: verification.max_points
            });
            
            // Commit de la transacción
            await client.query('COMMIT');
            
            console.log(`🎉 Week ${jornadaInfo.week_number} activation completed successfully!`);
            
            // Respuesta exitosa con información detallada
            return res.status(200).json({
                message: `Player stats saved and Week ${jornadaInfo.week_number} activated successfully`,
                week_number: jornadaInfo.week_number,
                jornada_id: jornada_id,
                stats_summary: {
                    players_processed: results.length,
                    new_stats: newCount,
                    updated_stats: updatedCount,
                    total_points_in_stats: results.reduce((sum, r) => sum + (r.total_points || 0), 0)
                },
                team_recalculation: {
                    teams_updated: parseInt(updateTeamsResult.rowCount),
                    total_teams: parseInt(verification.total_teams),
                    teams_with_points: parseInt(verification.teams_with_points),
                    total_points_distributed: parseInt(verification.total_points_distributed),
                    avg_points_per_team: Math.round(verification.avg_points_per_team || 0),
                    max_points: parseInt(verification.max_points)
                },
                activation_status: {
                    week_activated: true,
                    lineups_locked: true,
                    auto_activation: true
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error in stats processing:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    if (req.method === 'DELETE') {
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
};

async function handleSpecificJornada(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { jornadaId } = req.query;
  
  if (!jornadaId || isNaN(parseInt(jornadaId))) {
    return res.status(400).json({ message: 'Invalid jornada ID' });
  }

  const jornada_id = parseInt(jornadaId);

  const jornadaCheck = await pool.query(
    'SELECT id, week_number, is_current, is_completed FROM jornadas WHERE id = $1',
    [jornada_id]
  );
  
  if (jornadaCheck.rows.length === 0) {
    return res.status(404).json({ message: 'Jornada not found' });
  }

  const result = await pool.query(`
    SELECT 
      p.id as player_id,
      p.name as player_name,
      p.image_url,
      COALESCE(ps.rebounds, 0) as rebounds,
      COALESCE(ps.two_points, 0) as two_points,
      COALESCE(ps.three_points, 0) as three_points,
      COALESCE(ps.free_throws, 0) as free_throws,
      COALESCE(ps.assists, 0) as assists,
      COALESCE(ps.blocks, 0) as blocks,
      COALESCE(ps.victories, false) as victories,
      COALESCE(ps.total_points, 0) as total_points,
      ps.created_at as stats_created_at,
      ps.updated_at as stats_updated_at,
      CASE 
        WHEN ps.player_id IS NOT NULL THEN true 
        ELSE false 
      END as has_stats
    FROM players p
    LEFT JOIN player_stats ps ON p.id = ps.player_id AND ps.jornada_id = $1
    WHERE p.is_active = TRUE
    ORDER BY 
      ps.total_points DESC NULLS LAST,
      p.name ASC
  `, [jornada_id]);
  
  const jornadaInfo = jornadaCheck.rows[0];
  
  const summaryResult = await pool.query(`
    SELECT 
      COUNT(*) as total_players_with_stats,
      AVG(ps.total_points) as avg_points,
      MAX(ps.total_points) as max_points,
      MIN(ps.total_points) as min_points,
      SUM(ps.total_points) as total_points_all_players
    FROM player_stats ps
    JOIN players p ON ps.player_id = p.id
    WHERE ps.jornada_id = $1 AND p.is_active = TRUE
  `, [jornada_id]);
  
  const summary = summaryResult.rows[0];
  
  return res.json({
    jornada: {
      id: jornadaInfo.id,
      week_number: jornadaInfo.week_number,
      is_current: jornadaInfo.is_current,
      is_completed: jornadaInfo.is_completed
    },
    summary: {
      total_players_with_stats: parseInt(summary.total_players_with_stats) || 0,
      avg_points: parseFloat(summary.avg_points) || 0,
      max_points: parseInt(summary.max_points) || 0,
      min_points: parseInt(summary.min_points) || 0,
      total_points_all_players: parseInt(summary.total_points_all_players) || 0
    },
    players: result.rows,
    total_players: result.rows.length
  });
}