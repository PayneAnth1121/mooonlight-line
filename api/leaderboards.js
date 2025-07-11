// api/leaderboards.js - ACTUALIZADO para mostrar puntos totales acumulados
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
        const startTime = Date.now();

        console.log('🔍 Leaderboards request:', { 
            jornada_id, 
            force_refresh, 
            timestamp: new Date().toISOString() 
        });

        // 🆕 NUEVA LÓGICA: PUNTOS TOTALES ACUMULADOS
        let targetJornada = null;
        let jornadaInfo = null;

        // Solo buscar jornada específica si se proporciona
        if (jornada_id) {
            const specifiedJornada = await pool.query(`
                SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                       (SELECT COUNT(*) FROM player_stats WHERE jornada_id = j.id) as stats_count,
                       (SELECT COUNT(*) FROM user_teams WHERE jornada_id = j.id) as teams_count
                FROM jornadas j
                WHERE id = $1
            `, [jornada_id]);
            
            if (specifiedJornada.rows.length > 0) {
                targetJornada = jornada_id;
                jornadaInfo = specifiedJornada.rows[0];
                console.log('✅ Using specified jornada:', jornadaInfo.week_number);
            } else {
                return res.status(404).json({ message: 'Specified game week not found' });
            }
        } else {
            // 🆕 PARA LEADERBOARD GENERAL: Encontrar jornada activa para referencia
            const currentJornada = await pool.query(`
                SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                       (SELECT COUNT(*) FROM player_stats WHERE jornada_id = j.id) as stats_count,
                       (SELECT COUNT(*) FROM user_teams WHERE jornada_id = j.id) as teams_count
                FROM jornadas j 
                WHERE is_current = true 
                ORDER BY week_number DESC
                LIMIT 1
            `);
            
            if (currentJornada.rows.length > 0) {
                jornadaInfo = currentJornada.rows[0];
                console.log('✅ Using current jornada as reference:', jornadaInfo.week_number);
            } else {
                // Fallback: usar la más reciente
                const latestJornada = await pool.query(`
                    SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                           COUNT(DISTINCT ps.id) as stats_count,
                           COUNT(DISTINCT ut.id) as teams_count
                    FROM jornadas j
                    LEFT JOIN player_stats ps ON j.id = ps.jornada_id
                    LEFT JOIN user_teams ut ON j.id = ut.jornada_id
                    GROUP BY j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked
                    ORDER BY j.week_number DESC 
                    LIMIT 1
                `);
                
                if (latestJornada.rows.length > 0) {
                    jornadaInfo = latestJornada.rows[0];
                    console.log('⚠️ Using latest jornada as reference:', jornadaInfo.week_number);
                }
            }
        }

        console.log('🎯 Target configuration:', { 
            specific_jornada: targetJornada, 
            reference_week: jornadaInfo?.week_number 
        });

        // 🆕 FORZAR RECÁLCULO SI ES NECESARIO
        if (force_refresh === 'true') {
            console.log('🔄 Forcing recalculation...');
            
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                const updateResult1 = await client.query(`
                    UPDATE user_team_players utp
                    SET points_earned = CASE 
                        WHEN utp.position_type = 'starter' THEN COALESCE(ps.total_points, 0)
                        ELSE 0
                    END
                    FROM player_stats ps, user_teams ut
                    WHERE utp.player_id = ps.player_id
                        AND utp.user_team_id = ut.id
                        AND ps.jornada_id = ut.jornada_id
                `);
                
                const updateResult2 = await client.query(`
                    UPDATE user_teams 
                    SET total_points = (
                        SELECT COALESCE(SUM(points_earned), 0)
                        FROM user_team_players
                        WHERE user_team_id = user_teams.id
                            AND position_type = 'starter'
                    ),
                    updated_at = NOW()
                `);
                
                await client.query('COMMIT');
                
                console.log('✅ Forced recalculation completed:', {
                    players_updated: updateResult1.rowCount,
                    teams_updated: updateResult2.rowCount
                });
                
            } catch (recalcError) {
                await client.query('ROLLBACK');
                console.error('❌ Recalculation failed:', recalcError);
            } finally {
                client.release();
            }
        }

        // 🆕 CONSULTA PRINCIPAL: PUNTOS TOTALES ACUMULADOS
        let leaderboardData = [];
        
        try {
            console.log('🔧 Fetching cumulative leaderboard data...');
            
            let leaderboardQuery;
            let queryParams = [];
            
            if (targetJornada) {
                // 🆕 CASO 1: Jornada específica (solo esa semana)
                leaderboardQuery = `
                    SELECT 
                        ROW_NUMBER() OVER (ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC) as rank,
                        u.id as user_id,
                        u.username as manager,
                        u.team_name as team,
                        COALESCE(ut.total_points, 0) as points,
                        ut.updated_at as team_last_update,
                        CASE 
                            WHEN ut.id IS NOT NULL THEN 'has_team'
                            ELSE 'no_team'
                        END as team_status
                    FROM users u
                    LEFT JOIN user_teams ut ON u.id = ut.user_id AND ut.jornada_id = $1
                    WHERE u.is_admin = FALSE
                    ORDER BY COALESCE(ut.total_points, 0) DESC, u.username ASC
                `;
                queryParams = [targetJornada];
            } else {
                // 🆕 CASO 2: Leaderboard global (suma de todas las weeks)
                leaderboardQuery = `
                    WITH user_total_points AS (
                        SELECT 
                            u.id as user_id,
                            u.username as manager,
                            u.team_name as team,
                            COALESCE(SUM(ut.total_points), 0) as total_points,
                            MAX(ut.updated_at) as team_last_update,
                            COUNT(ut.id) as weeks_participated
                        FROM users u
                        LEFT JOIN user_teams ut ON u.id = ut.user_id
                        WHERE u.is_admin = FALSE
                        GROUP BY u.id, u.username, u.team_name
                    )
                    SELECT 
                        ROW_NUMBER() OVER (ORDER BY total_points DESC, manager ASC) as rank,
                        user_id,
                        manager,
                        team,
                        total_points as points,
                        team_last_update,
                        CASE 
                            WHEN weeks_participated > 0 THEN 'has_team'
                            ELSE 'no_team'
                        END as team_status
                    FROM user_total_points
                    ORDER BY total_points DESC, manager ASC
                `;
                queryParams = [];
            }
            
            const result = await pool.query(leaderboardQuery, queryParams);
            
            leaderboardData = result.rows.map(row => ({
                rank: parseInt(row.rank),
                user_id: parseInt(row.user_id),
                manager: row.manager,
                team: row.team,
                points: parseInt(row.points),
                team_status: row.team_status,
                last_update: row.team_last_update
            }));
            
            console.log('✅ Leaderboard data fetched successfully:', {
                total_entries: leaderboardData.length,
                users_with_points: leaderboardData.filter(entry => entry.points > 0).length,
                total_points_distributed: leaderboardData.reduce((sum, entry) => sum + entry.points, 0),
                top_score: leaderboardData.length > 0 ? leaderboardData[0].points : 0,
                query_type: targetJornada ? 'specific_week' : 'cumulative_total'
            });
            
        } catch (queryError) {
            console.error('❌ Leaderboard query failed:', queryError);
            throw queryError;
        }

        // 🆕 INFORMACIÓN DE DEBUG MEJORADA
        const totalPointsInLeaderboard = leaderboardData.reduce((sum, entry) => sum + entry.points, 0);
        const usersWithPoints = leaderboardData.filter(entry => entry.points > 0).length;
        
        const debugInfo = {
            request_info: {
                jornada_id: targetJornada,
                force_refresh: force_refresh === 'true',
                processing_time_ms: Date.now() - startTime,
                query_type: targetJornada ? 'specific_week' : 'cumulative_total'
            },
            jornada_info: {
                reference_id: jornadaInfo?.id,
                reference_week_number: jornadaInfo?.week_number,
                is_current: jornadaInfo?.is_current,
                is_completed: jornadaInfo?.is_completed,
                lineup_locked: jornadaInfo?.lineup_locked
            },
            leaderboard_stats: {
                total_entries: leaderboardData.length,
                entries_with_points: usersWithPoints,
                total_points_distributed: totalPointsInLeaderboard,
                top_score: leaderboardData.length > 0 ? leaderboardData[0].points : 0,
                avg_score: leaderboardData.length > 0 ? Math.round(totalPointsInLeaderboard / leaderboardData.length) : 0
            },
            timestamp: new Date().toISOString()
        };

        // Headers informativos
        res.setHeader('X-Query-Type', targetJornada ? 'specific-week' : 'cumulative-total');
        res.setHeader('X-Reference-Week', jornadaInfo?.week_number || 'unknown');
        res.setHeader('X-Processing-Time', Date.now() - startTime);
        res.setHeader('X-Total-Points', totalPointsInLeaderboard);
        res.setHeader('X-Cache-Control', 'no-cache');
        
        // Log final
            console.log('📋 Leaderboard response ready:', {
                query_type: targetJornada ? 'specific_week' : 'cumulative_total',
                reference_week: jornadaInfo?.week_number,
                entries: leaderboardData.length,
                total_points: totalPointsInLeaderboard,
                processing_time: `${Date.now() - startTime}ms`
            });

            // Preparar respuesta con información de semana actual
        const response = {
            leaderboard: leaderboardData,  // <-- Importante: debe ser leaderboardData, no otra cosa
            current_week: {
                id: jornadaInfo?.id || null,
                week_number: jornadaInfo?.week_number || null,
                is_current: jornadaInfo?.is_current || false,
                is_completed: jornadaInfo?.is_completed || false,
                lineup_locked: jornadaInfo?.lineup_locked || false,
                is_active: jornadaInfo ? true : false
            }
        };

        // En desarrollo, incluir debug info
        if (process.env.NODE_ENV === 'development') {
            response.debug = debugInfo;
        }

        return res.json(response);

    } catch (error) {
        console.error('❌ Error in leaderboards API:', error);
        
        const errorResponse = {
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        };
        
        if (process.env.NODE_ENV === 'development') {
            errorResponse.details = {
                stack: error.stack,
                sql_state: error.code
            };
        }
        
        res.status(500).json(errorResponse);
    }
}; 