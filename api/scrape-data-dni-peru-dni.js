import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://159.54.139.34:3000';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { dni } = req.body || {};

  if (!dni) {
    return res.status(400).json({ error: 'DNI is required' });
  }

  try {
    const response = await fetch(`${API_URL}/api/scrape-data-dni-peru-dni`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dni })
    });

    const data = await response.json();
    
    // Forward the status code and response from the API
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('Error forwarding request to API server:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al conectar con el servidor de API',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
