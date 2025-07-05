// api/leaderboards.js - FIXED: Sistema de puntuación corregido + debugging mejorado
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

        // 🆕 DETECTAR JORNADA ACTIVA CON PRIORIDAD MEJORADA
        let targetJornada = jornada_id;
        let jornadaInfo = null;

        if (!targetJornada) {
            console.log('📅 Auto-detecting active game week...');
            
            // 1. Buscar jornada marcada como current
            const currentJornada = await pool.query(`
                SELECT id, week_number, is_current, is_completed, lineup_locked,
                       (SELECT COUNT(*) FROM player_stats WHERE jornada_id = j.id) as stats_count,
                       (SELECT COUNT(*) FROM user_teams WHERE jornada_id = j.id) as teams_count
                FROM jornadas j 
                WHERE is_current = true 
                ORDER BY week_number DESC
                LIMIT 1
            `);
            
            if (currentJornada.rows.length > 0) {
                targetJornada = currentJornada.rows[0].id;
                jornadaInfo = currentJornada.rows[0];
                console.log('✅ Using current jornada:', jornadaInfo.week_number, 
                           `(${jornadaInfo.stats_count} stats, ${jornadaInfo.teams_count} teams)`);
            } else {
                // 2. Buscar la jornada más reciente con estadísticas Y equipos
                const latestWithData = await pool.query(`
                    SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                           COUNT(DISTINCT ps.id) as stats_count,
                           COUNT(DISTINCT ut.id) as teams_count,
                           COALESCE(SUM(ut.total_points), 0) as total_points
                    FROM jornadas j
                    LEFT JOIN player_stats ps ON j.id = ps.jornada_id
                    LEFT JOIN user_teams ut ON j.id = ut.jornada_id
                    GROUP BY j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked
                    HAVING COUNT(DISTINCT ps.id) > 0 AND COUNT(DISTINCT ut.id) > 0
                    ORDER BY j.week_number DESC 
                    LIMIT 1
                `);
                
                if (latestWithData.rows.length > 0) {
                    targetJornada = latestWithData.rows[0].id;
                    jornadaInfo = latestWithData.rows[0];
                    console.log('✅ Using latest jornada with data:', jornadaInfo.week_number);
                } else {
                    // 3. Fallback: jornada más reciente (aunque no tenga datos)
                    const latestJornada = await pool.query(`
                        SELECT id, week_number, is_current, is_completed, lineup_locked
                        FROM jornadas 
                        ORDER BY week_number DESC 
                        LIMIT 1
                    `);
                    
                    if (latestJornada.rows.length > 0) {
                        targetJornada = latestJornada.rows[0].id;
                        jornadaInfo = latestJornada.rows[0];
                        console.log('⚠️ Using latest jornada (no data yet):', jornadaInfo.week_number);
                    } else {
                        return res.status(404).json({ 
                            message: 'No game weeks found',
                            suggestion: 'Create a game week first in Admin Panel'
                        });
                    }
                }
            }
        } else {
            // Si se especificó una jornada, obtener su info
            const specifiedJornada = await pool.query(`
                SELECT j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked,
                       (SELECT COUNT(*) FROM player_stats WHERE jornada_id = j.id) as stats_count,
                       (SELECT COUNT(*) FROM user_teams WHERE jornada_id = j.id) as teams_count
                FROM jornadas j
                WHERE id = $1
            `, [targetJornada]);
            
            if (specifiedJornada.rows.length > 0) {
                jornadaInfo = specifiedJornada.rows[0];
                console.log('✅ Using specified jornada:', jornadaInfo.week_number);
            } else {
                return res.status(404).json({ message: 'Specified game week not found' });
            }
        }

        console.log('🎯 Target jornada:', targetJornada, `(Week ${jornadaInfo.week_number})`);

        // 🆕 VERIFICAR Y FORZAR RECÁLCULO SI ES NECESARIO
        const dataCheck = await pool.query(`
            SELECT 
                COUNT(DISTINCT ps.id) as stats_count,
                COUNT(DISTINCT ut.id) as teams_count,
                COUNT(DISTINCT u.id) as users_count,
                COALESCE(SUM(ut.total_points), 0) as total_team_points,
                COUNT(CASE WHEN ut.total_points > 0 THEN 1 END) as teams_with_points
            FROM jornadas j
            LEFT JOIN player_stats ps ON j.id = ps.jornada_id
            LEFT JOIN user_teams ut ON j.id = ut.jornada_id
            LEFT JOIN users u ON ut.user_id = u.id AND u.is_admin = FALSE
            WHERE j.id = $1
        `, [targetJornada]);
        
        const dataInfo = dataCheck.rows[0];
        console.log('📊 Data check:', {
            stats_count: dataInfo.stats_count,
            teams_count: dataInfo.teams_count,
            total_team_points: dataInfo.total_team_points,
            teams_with_points: dataInfo.teams_with_points
        });

        // 🔧 FORZAR RECÁLCULO SI HAY ESTADÍSTICAS PERO NO PUNTOS
        const shouldRecalculate = force_refresh === 'true' || 
                                 (parseInt(dataInfo.stats_count) > 0 && 
                                  parseInt(dataInfo.teams_count) > 0 && 
                                  parseInt(dataInfo.total_team_points) === 0);

        if (shouldRecalculate) {
            console.log('🔄 Forcing recalculation...');
            
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // Actualizar puntos de jugadores titulares
                const updateResult1 = await client.query(`
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
                `, [targetJornada]);
                
                // Actualizar totales de equipos
                const updateResult2 = await client.query(`
                    UPDATE user_teams 
                    SET total_points = (
                        SELECT COALESCE(SUM(points_earned), 0)
                        FROM user_team_players
                        WHERE user_team_id = user_teams.id
                            AND position_type = 'starter'
                    ),
                    updated_at = NOW()
                    WHERE jornada_id = $1
                `, [targetJornada]);
                
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

        // 🆕 CONSULTA MEJORADA PARA LEADERBOARD CON CACHE BUSTING
        let leaderboardData = [];
        
        try {
            console.log('🔧 Fetching leaderboard data...');
            
            const leaderboardQuery = `
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
            
            const result = await pool.query(leaderboardQuery, [targetJornada]);
            
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
                top_score: leaderboardData.length > 0 ? leaderboardData[0].points : 0
            });
            
        } catch (queryError) {
            console.error('❌ Leaderboard query failed:', queryError);
            throw queryError;
        }

        // 🆕 VALIDACIÓN FINAL Y LOGS DE DEBUG
        const totalPointsInLeaderboard = leaderboardData.reduce((sum, entry) => sum + entry.points, 0);
        const usersWithPoints = leaderboardData.filter(entry => entry.points > 0).length;
        
        // Si no hay puntos pero hay stats, intentar un último recálculo
        if (totalPointsInLeaderboard === 0 && parseInt(dataInfo.stats_count) > 0 && parseInt(dataInfo.teams_count) > 0) {
            console.log('🚨 Zero points detected but stats exist - attempting emergency recalculation...');
            
            try {
                const emergencyResult = await pool.query(`
                    WITH updated_players AS (
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
                        RETURNING utp.user_team_id, utp.points_earned
                    ),
                    updated_teams AS (
                        UPDATE user_teams 
                        SET total_points = (
                            SELECT COALESCE(SUM(points_earned), 0)
                            FROM user_team_players
                            WHERE user_team_id = user_teams.id
                                AND position_type = 'starter'
                        ),
                        updated_at = NOW()
                        WHERE jornada_id = $1
                        RETURNING id, total_points
                    )
                    SELECT COUNT(*) as teams_updated FROM updated_teams
                `, [targetJornada]);
                
                console.log('🔧 Emergency recalculation result:', emergencyResult.rows[0]);
                
                // Volver a consultar después del recálculo de emergencia
                const retryResult = await pool.query(leaderboardQuery, [targetJornada]);
                leaderboardData = retryResult.rows.map(row => ({
                    rank: parseInt(row.rank),
                    user_id: parseInt(row.user_id),
                    manager: row.manager,
                    team: row.team,
                    points: parseInt(row.points),
                    team_status: row.team_status,
                    last_update: row.team_last_update
                }));
                
                console.log('🆘 Emergency recalculation completed');
                
            } catch (emergencyError) {
                console.error('❌ Emergency recalculation failed:', emergencyError);
            }
        }

        // 🆕 INFORMACIÓN DE DEBUG DETALLADA
        const debugInfo = {
            request_info: {
                jornada_id: targetJornada,
                force_refresh: force_refresh === 'true',
                processing_time_ms: Date.now() - startTime
            },
            jornada_info: {
                id: targetJornada,
                week_number: jornadaInfo?.week_number,
                is_current: jornadaInfo?.is_current,
                is_completed: jornadaInfo?.is_completed,
                lineup_locked: jornadaInfo?.lineup_locked
            },
            data_summary: {
                stats_count: parseInt(dataInfo.stats_count),
                teams_count: parseInt(dataInfo.teams_count),
                users_count: parseInt(dataInfo.users_count),
                total_points_distributed: totalPointsInLeaderboard,
                users_with_points: usersWithPoints,
                recalculation_triggered: shouldRecalculate
            },
            leaderboard_stats: {
                total_entries: leaderboardData.length,
                entries_with_points: usersWithPoints,
                top_score: leaderboardData.length > 0 ? leaderboardData[0].points : 0,
                avg_score: leaderboardData.length > 0 ? Math.round(totalPointsInLeaderboard / leaderboardData.length) : 0
            },
            timestamp: new Date().toISOString()
        };

        // Agregar headers informativos
        res.setHeader('X-Jornada-ID', targetJornada);
        res.setHeader('X-Week-Number', jornadaInfo?.week_number || 'unknown');
        res.setHeader('X-Processing-Time', Date.now() - startTime);
        res.setHeader('X-Total-Points', totalPointsInLeaderboard);
        res.setHeader('X-Cache-Control', 'no-cache');
        
        // Log final
        console.log('📋 Leaderboard response ready:', {
            jornada: `Week ${jornadaInfo?.week_number}`,
            entries: leaderboardData.length,
            total_points: totalPointsInLeaderboard,
            processing_time: `${Date.now() - startTime}ms`
        });

        // En desarrollo, incluir debug info
        if (process.env.NODE_ENV === 'development') {
            return res.json({
                leaderboard: leaderboardData,
                debug: debugInfo
            });
        }

        // En producción, solo devolver leaderboard
        return res.json(leaderboardData);

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
        