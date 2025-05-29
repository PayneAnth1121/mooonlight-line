// api/players.js
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
    // Get all active players including image_url
    const result = await pool.query(`
      SELECT 
        id,
        name,
        image_url,
        is_active
      FROM players 
      WHERE is_active = TRUE
      ORDER BY name ASC
    `);
    
    // Transform the data to match frontend expectations
    const players = result.rows.map(player => ({
      id: player.id,
      name: player.name,
      image: player.image_url || `/images/players/default-player.png`,
      imageUrl: player.image_url,
      // Generate design-only stats (these don't affect gameplay)
      stats: generateRandomStats(),
      position: getRandomPosition(),
      nickname: generateNickname(player.name),
      signatureMove: getRandomSignatureMove()
    }));

    res.json(players);

  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

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