// api/admin/player-images.js
const jwt = require('jsonwebtoken');
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

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  try {
    // Authenticate admin
    authenticateAdmin(req);

    if (req.method === 'GET') {
      // Get all players with their images for admin management
      const result = await pool.query(`
        SELECT id, name, image_url, is_active 
        FROM players 
        ORDER BY name ASC
      `);
      return res.json(result.rows);
    }

    if (req.method === 'PUT') {
      // Update player image
      const { player_id, image_url } = req.body;
      
      if (!player_id) {
        return res.status(400).json({ message: 'Player ID is required' });
      }
      
      const result = await pool.query(
        'UPDATE players SET image_url = $1 WHERE id = $2 RETURNING *',
        [image_url, player_id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Player not found' });
      }
      
      return res.json({
        message: 'Player image updated successfully',
        player: result.rows[0]
      });
    }

    return res.status(405).json({ message: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin player images:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};