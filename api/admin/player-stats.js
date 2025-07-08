// api/admin/player-stats.js - SOLUCION COMPLETA CORREGIDA
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

        if (req.method === 'GET') {
            return await handleGetPlayerStats(req, res);
        }

        if (req.method === 'POST') {
            return await handleSavePlayerStats(req, res);
        }
        
        return res.status(405).json({ message: 'Method not allowed' });
        
    } catch (error) {
        console.error('❌ API Error:', error);
        
        if (error.message.includes('Access denied') || error.message.includes('token')) {
            return res.status(401).json({ message: error.message });
        }
        
        return res.status(500).json({ 
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// 🔥 FUNCIÓN CORREGIDA PARA OBTENER JUGADORES CON SUS ESTADÍSTICAS
async function handleGetPlayerStats(req, res) {
    const { jornada_id } = req.query;
    
    if (!jornada_id || isNaN(parseInt(jornada_id))) {
        return res.status(400).json({ message: 'Valid jornada_id is required' });
    }

    const jornadaId = parseInt(jornada_id);

    try {
        console.log(`📊 Fetching player stats for jornada ${jornadaId}`);

        // Verificar que la jornada existe
        const jornadaCheck = await pool.query(
            'SELECT id, week_number, is_current, is_completed FROM jornadas WHERE id = $1',
            [jornadaId]
        );
        
        if (jornadaCheck.rows.length === 0) {
            return res.status(404).json({ 
                message: `Game week ${jornadaId} not found` 
            });
        }

        const jornadaInfo = jornadaCheck.rows[0];

        // 🔥 CONSULTA CORREGIDA: Obtener TODOS los jugadores activos con sus estadísticas (si existen)
        const playersWithStats = await pool.query(`
            SELECT 
                p.id as player_id,
                p.name as player_name,
                p.team,
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
                p.team ASC,
                p.name ASC
        `, [jornadaId]);

        console.log(`✅ Found ${playersWithStats.rows.length} players for jornada ${jornadaId}`);

        // Estadísticas de resumen
        const statsCount = playersWithStats.rows.filter(p => p.has_stats).length;
        const totalPoints = playersWithStats.rows.reduce((sum, p) => sum + parseInt(p.total_points), 0);

        const response = {
            jornada: {
                id: jornadaInfo.id,
                week_number: jornadaInfo.week_number,
                is_current: jornadaInfo.is_current,
                is_completed: jornadaInfo.is_completed
            },
            summary: {
                total_players: playersWithStats.rows.length,
                players_with_stats: statsCount,
                total_points: totalPoints,
                avg_points: statsCount > 0 ? Math.round(totalPoints / statsCount) : 0
            },
            players: playersWithStats.rows
        };

        return res.json(response);

    } catch (error) {
        console.error('❌ Error fetching player stats:', error);
        throw error;
    }
}

// 🔥 FUNCIÓN CORREGIDA PARA GUARDAR ESTADÍSTICAS
async function handleSavePlayerStats(req, res) {
    const { jornada_id, stats } = req.body;
    
    // Validación mejorada
    if (!jornada_id || !Number.isInteger(jornada_id)) {
        return res.status(400).json({ 
            message: 'Valid jornada_id is required',
            received: jornada_id,
            type: typeof jornada_id
        });
    }
    
    if (!stats || !Array.isArray(stats)) {
        return res.status(400).json({ 
            message: 'Stats array is required',
            received: typeof stats
        });
    }

    console.log(`📊 Processing ${stats.length} player stats for jornada ${jornada_id}`);

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Verificar que la jornada existe
        const jornadaCheck = await client.query(
            'SELECT id, week_number FROM jornadas WHERE id = $1',
            [jornada_id]
        );
        
        if (jornadaCheck.rows.length === 0) {
            throw new Error(`Jornada ${jornada_id} not found`);
        }

        const jornadaInfo = jornadaCheck.rows[0];
        let savedCount = 0;
        let totalPointsCalculated = 0;

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
            
            // Validar player_id
            if (!player_id || !Number.isInteger(player_id)) {
                console.warn(`⚠️ Invalid player_id: ${player_id}, skipping...`);
                continue;
            }
            
            // Verificar que el jugador existe y está activo
            const playerCheck = await client.query(
                'SELECT id, name FROM players WHERE id = $1 AND is_active = TRUE',
                [player_id]
            );
            
            if (playerCheck.rows.length === 0) {
                console.warn(`⚠️ Player ${player_id} not found or inactive, skipping...`);
                continue;
            }
            
            // Validar que no hay valores negativos
            if (rebounds < 0 || two_points < 0 || three_points < 0 || 
                free_throws < 0 || assists < 0 || blocks < 0) {
                throw new Error(`Negative stats not allowed for player ${player_id}`);
            }
            
            // 🔥 CÁLCULO CORRECTO DE PUNTOS SEGÚN LA FÓRMULA
            const total_points = 
                (rebounds * 1) +
                (two_points * 2) +
                (three_points * 3) +
                (free_throws * 1) +
                (assists * 1) +
                (blocks * 2) +
                (victories ? 5 : 0);
            
            totalPointsCalculated += total_points;
            
            console.log(`📈 Player ${playerCheck.rows[0].name}: ${total_points} points calculated`);
            
            // 🔥 INSERTAR/ACTUALIZAR ESTADÍSTICAS CON TRIGGER AUTOMÁTICO
            await client.query(`
                INSERT INTO player_stats (
                    player_id, jornada_id, rebounds, two_points, three_points, 
                    free_throws, assists, blocks, victories, total_points
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
            `, [player_id, jornada_id, rebounds, two_points, three_points, 
                free_throws, assists, blocks, victories, total_points]);
            
            savedCount++;
        }

        // 🔥 ACTIVAR JORNADA Y BLOQUEAR LINEUPS
        await client.query(`
            UPDATE jornadas 
            SET is_current = FALSE
            WHERE is_current = TRUE AND id != $1
        `, [jornada_id]);
        
        await client.query(`
            UPDATE jornadas 
            SET is_current = TRUE, lineup_locked = TRUE
            WHERE id = $1
        `, [jornada_id]);

        // 🔥 FORZAR RECÁLCULO DE PUNTOS DE EQUIPOS
        console.log('🔄 Recalculating team points...');
        
        // Actualizar puntos de jugadores en equipos (solo starters)
        const teamPointsUpdate = await client.query(`
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
        `, [jornada_id]);

        // Actualizar totales de equipos
        const teamsPointsUpdate = await client.query(`
            UPDATE user_teams 
            SET total_points = (
                SELECT COALESCE(SUM(points_earned), 0)
                FROM user_team_players
                WHERE user_team_id = user_teams.id
                    AND position_type = 'starter'
            ),
            updated_at = NOW()
            WHERE jornada_id = $1
        `, [jornada_id]);

        await client.query('COMMIT');

        console.log(`✅ Successfully saved ${savedCount} player stats with ${totalPointsCalculated} total points`);
        console.log(`🔄 Updated ${teamPointsUpdate.rowCount} player selections and ${teamsPointsUpdate.rowCount} teams`);

        return res.status(200).json({
            message: `Stats saved successfully for Week ${jornadaInfo.week_number}`,
            jornada_id: jornada_id,
            week_number: jornadaInfo.week_number,
            stats_saved: savedCount,
            total_points_calculated: totalPointsCalculated,
            team_updates: {
                player_selections_updated: teamPointsUpdate.rowCount,
                teams_updated: teamsPointsUpdate.rowCount
            },
            activation_status: {
                week_activated: true,
                lineups_locked: true
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Transaction error:', error);
        throw error;
    } finally {
        client.release();
    }
}