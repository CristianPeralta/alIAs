import fetch from 'node-fetch';

// Helper function for delays between retries
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to perform fetch with retry logic
const fetchWithRetry = async (url, options, retries = 3, delayMs = 2000) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            const text = await response.text();
            
            // Check for Cloudflare challenge
            if (text.includes('cf-chl-bypass') || text.includes('challenge-form')) {
                throw new Error('CLOUDFLARE_CHALLENGE');
            }
            
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('CLOUDFLARE_FORBIDDEN');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            try {
                const data = JSON.parse(text);
                return { data, response, error: null };
            } catch (e) {
                throw new Error('Invalid JSON response');
            }
        } catch (error) {
            if (i === retries - 1) throw error;
            await delay(delayMs * (i + 1));
        }
    }
    throw new Error('Max retries reached');
};

// Function to get headers with nonce
const getHeaders = (nonce) => ({
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'DNT': '1',
    'Host': 'dniperu.com',
    'Origin': 'https://dniperu.com',
    'Pragma': 'no-cache',
    'Referer': 'https://dniperu.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Cookie': nonce ? `wordpress_sec_${nonce}` : ''
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    const { dni } = req.body || {};

    if (!dni) {
      return res.status(400).json({ 
        success: false,
        error: 'DNI is required' 
      });
    }

    // 1) Get nonce with retry logic
    let nonce = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries && !nonce) {
      try {
        const pageResp = await fetch('https://dniperu.com/buscar-dni-por-nombres-y-apellidos/', {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
          }
        });

        if (pageResp.ok) {
          const html = await pageResp.text();
          
          // Try to find nonce in the script tag first
          const scriptRegex = /<script[^>]*id=["']consultas-nombres-js-extra["'][^>]*>([\s\S]*?)<\/script>/i;
          const scriptMatch = html.match(scriptRegex);
          
          if (scriptMatch && scriptMatch[1]) {
            const nonceMatch = scriptMatch[1].match(/"nonce"\s*:\s*"([^"]+)"/);
            if (nonceMatch && nonceMatch[1]) {
              nonce = nonceMatch[1];
              break;
            }
          }
          
          // If not found, try to find it anywhere in the HTML
          if (!nonce) {
            const globalNonceMatch = html.match(/"nonce"\s*:\s*"([^"]+)"/);
            if (globalNonceMatch && globalNonceMatch[1]) {
              nonce = globalNonceMatch[1];
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`Error getting nonce (attempt ${retryCount + 1}):`, err.message);
      }
      
      if (!nonce) {
        retryCount++;
        if (retryCount < maxRetries) {
          await delay(1000 * retryCount); // Wait before retry
        }
      }
    }

    if (!nonce) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo obtener el token de seguridad. Por favor, inténtelo de nuevo más tarde.'
      });
    }

    // 2) Perform DNI search with retry logic
    const formData = new URLSearchParams();
    formData.append('dni4', dni);
    formData.append('company', '');
    formData.append('action', 'buscar_nombres');
    formData.append('security', nonce);

    try {
      const { data, error } = await fetchWithRetry(
        'https://dniperu.com/wp-admin/admin-ajax.php',
        {
          method: 'POST',
          headers: getHeaders(nonce),
          body: formData.toString(),
          credentials: 'include',
          referrer: 'https://dniperu.com/',
          mode: 'cors'
        }
      );

      if (error) {
        throw new Error(error.message || 'Error en la solicitud');
      }

      if (!data || !data.success || !data.data?.message) {
        throw new Error('No se encontraron resultados para el DNI proporcionado');
      }

      const result = data.data.message;
      const dniMatch = typeof result === 'string' ? result.match(/Número de DNI:\s*(\d+)/i) : null;
      const namesMatch = typeof result === 'string' ? result.match(/Nombres:\s*(.+)/i) : null;
      const fatherLastNameMatch = typeof result === 'string' ? result.match(/Apellido Paterno:\s*(.+)/i) : null;
      const motherLastNameMatch = typeof result === 'string' ? result.match(/Apellido Materno:\s*(.+)/i) : null;
      const verificationCodeMatch = typeof result === 'string' ? result.match(/Código de Verificación:\s*(\d+)/i) : null;
      
      if (!dniMatch || !namesMatch || !fatherLastNameMatch || !motherLastNameMatch) {
        throw new Error('Formato de respuesta inesperado del servidor');
      }

      return res.status(200).json({
        success: true,
        dni: dniMatch[1].trim(),
        names: namesMatch[1].trim(),
        fatherLastName: fatherLastNameMatch[1].trim(),
        motherLastName: motherLastNameMatch[1].trim(),
        verificationCode: verificationCodeMatch ? verificationCodeMatch[1].trim() : null
      });

    } catch (error) {
      console.error('Error in DNI search:', error);
      
      if (error.message === 'CLOUDFLARE_CHALLENGE' || error.message === 'CLOUDFLARE_FORBIDDEN') {
        return res.status(403).json({
          success: false,
          error: 'El sitio está protegido por Cloudflare. Por favor, inténtelo de nuevo más tarde.',
          code: 'CLOUDFLARE_CHALLENGE'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: error.message || 'Error al consultar el DNI',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}
