import DniPeruScraper from '../services/dni-peru-scraper.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, fatherLastName, motherLastName } = req.body || {};

    if (!name || !fatherLastName || !motherLastName) {
      return res.status(400).json({ 
        error: 'Se requieren los siguientes campos: nombres, apellido paterno y apellido materno' 
      });
    }

    const scraper = new DniPeruScraper();
    
    try {
      const result = await scraper.searchByNames({
        name,
        fatherLastName,
        motherLastName
      });

      return res.status(200).json({
        dni: result.dni,
        name: result.name,
        fatherLastName: result.fatherLastName,
        motherLastName: result.motherLastName
      });
    } catch (error) {
      console.error('Error en la búsqueda por nombres:', error);
      
      if (error.message.includes('No se encontraron resultados')) {
        return res.status(404).json({ 
          error: 'No se encontraron resultados para la búsqueda' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Error al consultar el servicio de DNI',
        details: error.message 
      });
    }
  } catch (error) {
    console.error('Error inesperado:', error);
    return res.status(500).json({ 
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
