// api/players.js - UPDATED TO INCLUDE TEAM INFO
const { Pool } = require('pg');

// Configuración de la base de datos con mejor error handling
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

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      message: 'Method not allowed',
      error: `Expected GET, received ${req.method}` 
    });
  }

  try {
    console.log('Fetching players from database...');
    
    // Test database connection first
    await pool.query('SELECT 1');
    console.log('Database connection successful');

    // 🆕 UPDATED QUERY TO INCLUDE TEAM INFORMATION
    const result = await pool.query(`
      SELECT 
        id,
        name,
        team,
        image_url,
        is_active,
        created_at
      FROM players 
      WHERE is_active = TRUE
      ORDER BY team, name ASC
    `);
    
    console.log(`Found ${result.rows.length} players`);
    
    if (result.rows.length === 0) {
      return res.status(200).json({
        message: 'No active players found',
        players: [],
        count: 0
      });
    }
    
    // Transform the data to match frontend expectations
    const players = result.rows.map(player => ({
      id: player.id,
      name: player.name,
      team: player.team, // 🆕 INCLUDE TEAM INFO
      image: player.image_url || `/images/players/default-player.png`,
      imageUrl: player.image_url,
      isActive: player.is_active,
      // Generate design-only stats (these don't affect gameplay)
      stats: generateRandomStats(),
      position: getRandomPosition(),
      nickname: generateNickname(player.name),
      signatureMove: getRandomSignatureMove()
    }));

    console.log('Players transformed successfully with team info');

    res.status(200).json(players);

  } catch (error) {
    console.error('Error fetching players:', error);
    
    // More detailed error response
    res.status(500).json({ 
      message: 'Failed to fetch players',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

// Utility functions to generate design-only data
function generateRandomStats() {
  return {
    speed: Math.floor(Math.random() * 30) + 70,      // 70-99
    defense: Math.floor(Math.random() * 30) + 70,    // 70-99
    shooting: Math.floor(Math.random() * 30) + 70,   // 70-99
    offense: Math.floor(Math.random() * 30) + 70     // 70-99
  };
}

function getRandomPosition() {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  return positions[Math.floor(Math.random() * positions.length)];
}

function generateNickname(name) {
  const nicknames = [
    'THE KING', 'CHEF CURRY', 'GREEK FREAK', 'SLIM REAPER', 
    'THE BEARD', 'KING JAMES', 'THE PROCESS', 'FLASH',
    'THE ANSWER', 'BIG DIESEL', 'THE MAMBA', 'THE GLOVE',
    'BIG FUNDAMENTAL', 'THE MAILMAN', 'AIR JORDAN', 'MAGIC',
    'THE DREAM', 'THE ROUND MOUND', 'PISTOL PETE', 'DR J'
  ];
  return nicknames[Math.floor(Math.random() * nicknames.length)];
}

function getRandomSignatureMove() {
  const moves = [
    'FADEAWAY SHOT', 'CHASE-DOWN BLOCK', 'DEEP THREE SPLASH',
    'EURO STEP SLAM', 'STEP-BACK THREE', 'TOMAHAWK DUNK',
    'CROSSOVER DRIVE', 'PULL-UP JIMBO', 'SPIN MOVE', 'POSTERIZE',
    'SKY HOOK', 'DREAM SHAKE', 'FINGER ROLL', 'BASELINE REVERSE'
  ];
  return moves[Math.floor(Math.random() * moves.length)];
}