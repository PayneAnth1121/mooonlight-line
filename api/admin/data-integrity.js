// Script para verificar y corregir la integridad de datos
// Agregar este endpoint en api/admin/data-integrity.js

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
            return await performDataIntegrityCheck(req, res);
        }

        if (req.method === 'POST') {
            return await fixDataIntegrityIssues(req, res);
        }

        return res.status(405).json({ message: 'Method not allowed' });

    } catch (error) {
        console.error('Error in data integrity API:', error);
        if (error.message.includes('Access denied') || error.message.includes('token')) {
            return res.status(401).json({ message: error.message });
        }
        res.status(500).json({ 
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

async function performDataIntegrityCheck(req, res) {
    const issues = [];
    const summary = {};

    console.log('🔍 Starting data integrity check...');

    try {
        // 1. Verificar jornadas
        const jornadasCheck = await pool.query(`
            SELECT 
                j.id,
                j.week_number,
                j.is_current,
                j.is_completed,
                j.lineup_locked,
                COUNT(DISTINCT ps.id) as stats_count,
                COUNT(DISTINCT ut.id) as teams_count,
                COALESCE(SUM(ut.total_points), 0) as total_points
            FROM jornadas j
            LEFT JOIN player_stats ps ON j.id = ps.jornada_id
            LEFT JOIN user_teams ut ON j.id = ut.jornada_id
            GROUP BY j.id, j.week_number, j.is_current, j.is_completed, j.lineup_locked
            ORDER BY j.week_number
        `);

        summary.jornadas = {
            total: jornadasCheck.rows.length,
            current: jornadasCheck.rows.filter(j => j.is_current).length,
            with_stats: jornadasCheck.rows.filter(j => parseInt(j.stats_count) > 0).length,
            with_teams: jornadasCheck.rows.filter(j => parseInt(j.teams_count) > 0).length
        };

        // Verificar problemas en jornadas
        const currentJornadas = jornadasCheck.rows.filter(j => j.is_current);
        if (currentJornadas.length === 0) {
            issues.push({
                type: 'warning',
                category: 'jornadas',
                message: 'No current jornada found',
                suggestion: 'Set one jornada as current'
            });
        } else if (currentJornadas.length > 1) {
            issues.push({
                type: 'error',
                category: 'jornadas',
                message: `Multiple current jornadas found: ${currentJornadas.map(j => j.week_number).join(', ')}`,
                suggestion: 'Only one jornada should be current'
            });
        }

        // Verificar jornadas con stats pero sin puntos
        jornadasCheck.rows.forEach(jornada => {
            if (parseInt(jornada.stats_count) > 0 && parseInt(jornada.teams_count) > 0 && parseInt(jornada.total_points) === 0) {
                issues.push({
                    type: 'error',
                    category: 'calculation',
                    message: `Week ${jornada.week_number}: Has ${jornada.stats_count} stats and ${jornada.teams_count} teams but 0 total points`,
                    suggestion: 'Recalculate team points',
                    jornada_id: jornada.id
                });
            }
        });

        // 2. Verificar player_stats
        const statsCheck = await pool.query(`
            SELECT 
                ps.jornada_id,
                COUNT(*) as total_stats,
                COUNT(CASE WHEN ps.total_points > 0 THEN 1 END) as stats_with_points,
                SUM(ps.total_points) as total_points_in_stats,
                AVG(ps.total_points) as avg_points_per_player
            FROM player_stats ps
            GROUP BY ps.jornada_id
            ORDER BY ps.jornada_id
        `);

        summary.player_stats = {
            jornadas_with_stats: statsCheck.rows.length,
            total_stat_entries: statsCheck.rows.reduce((sum, s) => sum + parseInt(s.total_stats), 0),
            total_points_in_all_stats: statsCheck.rows.reduce((sum, s) => sum + parseInt(s.total_points_in_stats), 0)
        };

        // 3. Verificar user_teams
        const teamsCheck = await pool.query(`
            SELECT 
                ut.jornada_id,
                COUNT(*) as total_teams,
                COUNT(CASE WHEN ut.total_points > 0 THEN 1 END) as teams_with_points,
                SUM(ut.total_points) as total_points_in_teams,
                AVG(ut.total_points) as avg_points_per_team
            FROM user_teams ut
            GROUP BY ut.jornada_id
            ORDER BY ut.jornada_id
        `);

        summary.user_teams = {
            jornadas_with_teams: teamsCheck.rows.length,
            total_teams: teamsCheck.rows.reduce((sum, t) => sum + parseInt(t.total_teams), 0),
            total_points_in_all_teams: teamsCheck.rows.reduce((sum, t) => sum + parseInt(t.total_points_in_teams), 0)
        };

        // 4. Verificar user_team_players
        const playersCheck = await pool.query(`
            SELECT 
                ut.jornada_id,
                COUNT(*) as total_player_selections,
                COUNT(CASE WHEN utp.position_type = 'starter' THEN 1 END) as starters,
                COUNT(CASE WHEN utp.position_type = 'bench' THEN 1 END) as bench_players,
                SUM(CASE WHEN utp.position_type = 'starter' THEN utp.points_earned ELSE 0 END) as points_from_starters
            FROM user_team_players utp
            JOIN user_teams ut ON utp.user_team_id = ut.id
            GROUP BY ut.jornada_id
            ORDER BY ut.jornada_id
        `);

        summary.user_team_players = {
            total_player_selections: playersCheck.rows.reduce((sum, p) => sum + parseInt(p.total_player_selections), 0),
            total_starters: playersCheck.rows.reduce((sum, p) => sum + parseInt(p.starters), 0),
            total_bench: playersCheck.rows.reduce((sum, p) => sum + parseInt(p.bench_players), 0)
        };

        // 5. Verificar coherencia entre stats y teams
        for (const statsRow of statsCheck.rows) {
            const teamsRow = teamsCheck.rows.find(t => t.jornada_id === statsRow.jornada_id);
            if (teamsRow) {
                const statsTotalPoints = parseInt(statsRow.total_points_in_stats);
                const teamsTotalPoints = parseInt(teamsRow.total_points_in_teams);
                
                // Los puntos en teams no deberían exceder los puntos disponibles en stats
                if (teamsTotalPoints > statsTotalPoints) {
                    issues.push({
                        type: 'warning',
                        category: 'points_mismatch',
                        message: `Jornada ${statsRow.jornada_id}: Teams have more points (${teamsTotalPoints}) than available in stats (${statsTotalPoints})`,
                        suggestion: 'Verify point calculation logic'
                    });
                }
            }
        }

        // 6. Verificar usuarios sin administradores
        const usersCheck = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_admin = true THEN 1 END) as admins,
                COUNT(CASE WHEN is_admin = false THEN 1 END) as regular_users
            FROM users
        `);

        summary.users = usersCheck.rows[0];

        if (parseInt(summary.users.admins) === 0) {
            issues.push({
                type: 'error',
                category: 'users',
                message: 'No admin users found',
                suggestion: 'At least one admin user is required'
            });
        }

        // 7. Verificar jugadores activos
        const playersActiveCheck = await pool.query(`
            SELECT 
                COUNT(*) as total_players,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active_players,
                COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_players
            FROM players
        `);

        summary.players = playersActiveCheck.rows[0];

        if (parseInt(summary.players.active_players) === 0) {
            issues.push({
                type: 'error',
                category: 'players',
                message: 'No active players found',
                suggestion: 'Import players or activate existing ones'
            });
        }

        console.log('✅ Data integrity check completed');

        return res.json({
            status: issues.length === 0 ? 'healthy' : 'issues_found',
            summary,
            issues,
            recommendations: generateRecommendations(issues, summary),
            checked_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error during integrity check:', error);
        throw error;
    }
}

async function fixDataIntegrityIssues(req, res) {
    const { fix_type, jornada_id } = req.body;
    const fixes_applied = [];

    console.log('🔧 Starting data integrity fixes...', { fix_type, jornada_id });

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        if (fix_type === 'recalculate_all' || fix_type === 'recalculate_jornada') {
            const jornadaIds = jornada_id ? [jornada_id] : null;
            
            // Si no se especifica jornada, recalcular todas las que tienen stats
            const targetJornadas = jornadaIds || (await client.query(`
                SELECT DISTINCT jornada_id 
                FROM player_stats 
                ORDER BY jornada_id
            `)).rows.map(r => r.jornada_id);

            for (const targetJornada of targetJornadas) {
                console.log(`🔄 Recalculating jornada ${targetJornada}...`);

                // Actualizar puntos de jugadores
                const updatePlayersResult = await client.query(`
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
                const updateTeamsResult = await client.query(`
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

                fixes_applied.push({
                    type: 'recalculation',
                    jornada_id: targetJornada,
                    players_updated: updatePlayersResult.rowCount,
                    teams_updated: updateTeamsResult.rowCount
                });
            }
        }

        if (fix_type === 'fix_current_jornada') {
            // Asegurar que solo hay una jornada current
            await client.query('UPDATE jornadas SET is_current = false');
            
            // Encontrar la jornada más apropiada para ser current
            const bestCurrentResult = await client.query(`
                SELECT j.id, j.week_number,
                       COUNT(DISTINCT ps.id) as stats_count,
                       COUNT(DISTINCT ut.id) as teams_count
                FROM jornadas j
                LEFT JOIN player_stats ps ON j.id = ps.jornada_id
                LEFT JOIN user_teams ut ON j.id = ut.jornada_id
                GROUP BY j.id, j.week_number
                ORDER BY 
                    (COUNT(DISTINCT ps.id) > 0)::int DESC,
                    (COUNT(DISTINCT ut.id) > 0)::int DESC,
                    j.week_number DESC
                LIMIT 1
            `);

            if (bestCurrentResult.rows.length > 0) {
                const bestJornada = bestCurrentResult.rows[0];
                await client.query(
                    'UPDATE jornadas SET is_current = true WHERE id = $1',
                    [bestJornada.id]
                );

                fixes_applied.push({
                    type: 'current_jornada_fix',
                    jornada_id: bestJornada.id,
                    week_number: bestJornada.week_number
                });
            }
        }

        await client.query('COMMIT');

        console.log('✅ Data integrity fixes completed:', fixes_applied);

        return res.json({
            status: 'fixes_applied',
            fixes_applied,
            message: `Successfully applied ${fixes_applied.length} fixes`,
            fixed_at: new Date().toISOString()
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error applying fixes:', error);
        throw error;
    } finally {
        client.release();
    }
}

function generateRecommendations(issues, summary) {
    const recommendations = [];

    if (issues.some(i => i.category === 'calculation')) {
        recommendations.push({
            priority: 'high',
            action: 'Recalculate team points',
            description: 'Run a full recalculation to fix point discrepancies',
            api_call: 'POST /api/admin/data-integrity with fix_type: "recalculate_all"'
        });
    }

    if (issues.some(i => i.category === 'jornadas')) {
        recommendations.push({
            priority: 'medium',
            action: 'Fix jornada status',
            description: 'Ensure exactly one jornada is marked as current',
            api_call: 'POST /api/admin/data-integrity with fix_type: "fix_current_jornada"'
        });
    }

    if (parseInt(summary.users?.admins) === 0) {
        recommendations.push({
            priority: 'critical',
            action: 'Create admin user',
            description: 'At least one admin user is required for system management'
        });
    }

    return recommendations;
}