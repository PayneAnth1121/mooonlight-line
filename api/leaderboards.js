// api/leaderboard.js
const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { jornada_id } = req.query;

    // Get current jornada if not specified
    let targetJornada = jornada_id;
    if (!targetJornada) {
      const currentJornada = await pool.query('SELECT id FROM jornadas WHERE is_current = true LIMIT 1');
      if (currentJornada.rows.length === 0) {
        return res.status(404).json({ message: 'No active game week found' });
      }
      targetJornada = currentJornada.rows[0].id;
    }

    // Get leaderboard using the stored function
    const result = await pool.query('SELECT * FROM get_leaderboard($1)', [targetJornada]);
    
    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ message: 'Server error' });
  }
}