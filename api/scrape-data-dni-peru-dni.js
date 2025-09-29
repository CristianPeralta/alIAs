import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { dni } = req.body || {};

    if (!dni) {
      res.status(400).json({ error: 'DNI is required' });
      return;
    }

    // 1) Lightweight GET to extract nonce from HTML without a headless browser
    let nonce = null;
    try {
      const pageResp = await fetch('https://dniperu.com/buscar-dni-por-nombres-y-apellidos/', {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
          'Accept': 'text/html'
        }
      });

      if (pageResp.ok) {
        const html = await pageResp.text();
        // First try to find the nonce in the specific script element
        const scriptRegex = /<script[^>]*id=["']consultas-nombres-js-extra["'][^>]*>([\s\S]*?)<\/script>/i;
        const scriptMatch = html.match(scriptRegex);
        
        if (scriptMatch && scriptMatch[1]) {
          const scriptContent = scriptMatch[1];
          const nonceMatch = scriptContent.match(/"nonce"\s*:\s*"([^"]+)"/);
          if (nonceMatch && nonceMatch[1]) {
            nonce = nonceMatch[1];
          }
        }
        
        // If nonce not found in the specific script, try to find it anywhere in the HTML
        if (!nonce) {
          const globalNonceMatch = html.match(/"nonce"\s*:\s*"([^"]+)"/);
          if (globalNonceMatch && globalNonceMatch[1]) {
            nonce = globalNonceMatch[1];
          }
        }
      }
    } catch (err) {
      console.warn('Lightweight nonce fetch failed; falling back to error response:', err?.message || err);
    }

    if (!nonce) {
      // If we can't obtain the nonce without executing JS on the page, return an informative error.
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo obtener el nonce de seguridad sin ejecutar JavaScript. La función sin scraping requiere que el nonce esté presente en el HTML.' 
      });
    }

    // 2) Perform AJAX POST to admin-ajax.php using URL encoded form
    const formData = new URLSearchParams();
    formData.append('dni4', dni);
    formData.append('company', '');
    formData.append('action', 'buscar_nombres');
    formData.append('security', nonce);

    const response = await fetch('https://dniperu.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: formData.toString()
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        success: false, 
        error: `Error en la solicitud: ${response.statusText}` 
      });
    }
    
    const responseData = await response.json();

    // Process the response
    if (responseData.success && responseData.data.message && responseData.data.message.length > 0) {
      const result = responseData.data.message;
      
      // Extract data using regex patterns
      const dniMatch = result.match(/Número de DNI: (\d+)/);
      const namesMatch = result.match(/Nombres: (.+)/);
      const fatherLastNameMatch = result.match(/Apellido Paterno: (.+)/);
      const motherLastNameMatch = result.match(/Apellido Materno: (.+)/);
      const verificationCodeMatch = result.match(/Código de Verificación: (\d+)/);
      
      if (dniMatch && namesMatch && fatherLastNameMatch && motherLastNameMatch) {
        const persona = {
          dni: dniMatch[1],
          name: namesMatch[1],
          fatherLastName: fatherLastNameMatch[1],
          motherLastName: motherLastNameMatch[1],
          verificationCode: verificationCodeMatch ? verificationCodeMatch[1] : null
        };
        
        return res.status(200).json({
          success: true,
          data: persona
        });
      }
    }

    return res.status(404).json({ 
      success: false,
      error: 'No se encontraron resultados o la solicitud no fue exitosa.' 
    });
  } catch (err) {
    console.error('Error in api/scrape-data-dni-peru (HTTP-only):', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Error al consultar dniperu.com', 
      details: err?.message || String(err) 
    });
  }
}
