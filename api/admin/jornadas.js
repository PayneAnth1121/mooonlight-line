// api/admin/jornadas.js
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

export default async function handler(req, res) {
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
      // Get all jornadas
      const result = await pool.query(`
        SELECT * FROM jornadas 
        ORDER BY week_number DESC
      `);
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      // Create new jornada
      const { week_number, start_date, end_date, is_current } = req.body;
      
      if (!week_number || !start_date || !end_date) {
        return res.status(400).json({ message: 'Week number, start date and end date are required' });
      }
      
      // If setting this jornada as current, unset any other current jornadas
      if (is_current) {
        await pool.query('UPDATE jornadas SET is_current = false WHERE is_current = true');
      }
      
      const result = await pool.query(
        'INSERT INTO jornadas (week_number, start_date, end_date, is_current) VALUES ($1, $2, $3, $4) RETURNING *',
        [week_number, start_date, end_date, is_current]
      );
      
      return res.status(201).json(result.rows[0]);
    }

    return res.status(405).json({ message: 'Method not allowed' });

  } catch (error) {
    console.error('Error in admin jornadas:', error);
    if (error.message.includes('Access denied') || error.message.includes('token')) {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
}