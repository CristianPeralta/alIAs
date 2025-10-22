import DniPeruScraper from '../services/dni-peru-scraper.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { dni } = req.body || {};

  if (!dni) {
    return res.status(400).json({ error: 'DNI is required' });
  }

  const scraper = new DniPeruScraper();
  
  try {
    const result = await scraper.searchByDni(dni);
    
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || 'Error en la búsqueda',
        details: result.details
      });
    }
  } catch (error) {
    console.error('Error en la búsqueda por DNI:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // Asegurarse de que el scraper se cierre correctamente
    try {
      await scraper.close();
    } catch (e) {
      console.error('Error al cerrar el scraper:', e);
    }
  }
}
