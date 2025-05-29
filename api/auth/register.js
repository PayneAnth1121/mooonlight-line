// api/auth/register.js
const bcrypt = require('bcrypt');
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

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, email, password, team_name } = req.body;
    
    // Validate required fields
    if (!username || !email || !password || !team_name) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Check if username or email already exists
    const checkUser = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (username, email, password, team_name) VALUES ($1, $2, $3, $4) RETURNING id, username, email, team_name, is_admin',
      [username, email, hashedPassword, team_name]
    );
    
    const user = result.rows[0];
    
    // Create JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username,
        is_admin: user.is_admin 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        team_name: user.team_name,
        is_admin: user.is_admin
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
}