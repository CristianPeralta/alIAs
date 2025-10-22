import DniPeruScraper from '../services/dni-peru-scraper.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { dni } = req.body || {};

    if (!dni) {
      return res.status(400).json({ 
        error: 'El campo DNI es obligatorio' 
      });
    }

    // Validar formato de DNI (8 dígitos numéricos)
    if (!/^\d{8}$/.test(dni)) {
      return res.status(400).json({ 
        error: 'El DNI debe contener exactamente 8 dígitos numéricos' 
      });
    }

    const scraper = new DniPeruScraper();
    
    try {
      // Usar el método público searchByDni que maneja internamente el nonce
      const { success, data, error } = await scraper.searchByDni(dni);
      
      if (!success) {
        throw new Error(error || 'Error al buscar por DNI');
      }

      return res.status(200).json({
        dni: data.dni,
        name: data.names,
        fatherLastName: data.fatherLastName,
        motherLastName: data.motherLastName,
        verificationCode: data.verificationCode
      });
    } catch (error) {
      console.error('Error en la búsqueda por DNI:', error);
      
      if (error.message.includes('No se encontraron resultados')) {
        return res.status(404).json({ 
          error: 'No se encontraron resultados para el DNI proporcionado' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Error al consultar el servicio de DNI',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
