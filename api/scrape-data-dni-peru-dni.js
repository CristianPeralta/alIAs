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
        // As a first attempt, search for a script element id = consultas-nombres-js-extra and contains the nonce
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
      return res.status(500).json({ success: false, error: 'No se pudo obtener el nonce de seguridad sin ejecutar JavaScript. La función sin scraping requiere que el nonce esté presente en el HTML.' });
    }

    // 2) Perform AJAX POST to admin-ajax.php using URL encoded form
    const formData = new URLSearchParams();
    formData.append('dni4', dni);
    formData.append('company', '');
    formData.append('action', 'buscar_nombres');
    formData.append('security', nonce);

    const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
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
        'sec-ch-ua-platform': '"Windows"'
    };

    const ajaxResp = await fetch('https://dniperu.com/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: headers,
        body: formData.toString(),
        credentials: 'include',
        referrer: 'https://dniperu.com/',
        mode: 'cors'
    });

    if (!ajaxResp.ok) {
      if (ajaxResp.status === 403) {
        const errorText = await ajaxResp.text();
        console.error('Detalles del error 403 en la búsqueda por DNI:', {
            status: ajaxResp.status,
            statusText: ajaxResp.statusText,
            headers: Object.fromEntries(ajaxResp.headers.entries()),
            body: errorText
        });
        return res.status(403).json({ 
            success: false, 
            error: 'Acceso denegado (403)',
            details: process.env.NODE_ENV === 'development' ? errorText.substring(0, 500) : undefined
        });
      }
      return res.status(ajaxResp.status).json({ 
          success: false, 
          error: `Error en la solicitud: ${ajaxResp.status} ${ajaxResp.statusText}`
      });
    }

    let data;
    try {
      data = await ajaxResp.json();
    } catch (jsonError) {
      console.error('Error al analizar la respuesta JSON:', jsonError);
      return res.status(500).json({
          success: false,
          error: 'Error al procesar la respuesta del servidor',
          details: process.env.NODE_ENV === 'development' ? jsonError.message : undefined
      });
    }

    if (!data || typeof data !== 'object') {
      return res.status(500).json({
          success: false,
          error: 'Formato de respuesta inválido del servidor',
          details: process.env.NODE_ENV === 'development' ? 'La respuesta no es un objeto JSON válido' : undefined
      });
    }

    if (!data.success) {
      return res.status(404).json({ 
          success: false,
          error: data.data?.message || 'No se encontraron resultados para el DNI proporcionado'
      });
    }

    if (!data.data?.message?.length) {
      return res.status(404).json({
          success: false,
          error: 'No se encontraron datos en la respuesta del servidor'
      });
    }

    const result = data.data.message;

    try {
      // Extraer datos con manejo de errores mejorado
      const dniMatch = typeof result === 'string' ? result.match(/Número de DNI:\s*(\d+)/i) : null;
      const namesMatch = typeof result === 'string' ? result.match(/Nombres:\s*(.+)/i) : null;
      const fatherLastNameMatch = typeof result === 'string' ? result.match(/Apellido Paterno:\s*(.+)/i) : null;
      const motherLastNameMatch = typeof result === 'string' ? result.match(/Apellido Materno:\s*(.+)/i) : null;
      const verificationCodeMatch = typeof result === 'string' ? result.match(/Código de Verificación:\s*(\d+)/i) : null;
      
      if (!dniMatch || !namesMatch || !fatherLastNameMatch || !motherLastNameMatch) {
          throw new Error('Formato de respuesta inesperado del servidor');
      }

      const persona = {
          dni: dniMatch[1].trim(),
          names: namesMatch[1].trim(),
          fatherLastName: fatherLastNameMatch[1].trim(),
          motherLastName: motherLastNameMatch[1].trim(),
          verificationCode: verificationCodeMatch ? verificationCodeMatch[1].trim() : null
      };

      return res.status(200).json({
          success: true,
          ...persona
      });
    } catch (parseError) {
      console.error('Error al procesar la respuesta:', parseError);
      return res.status(500).json({
          success: false,
          error: 'Error al procesar la respuesta del servidor',
          details: process.env.NODE_ENV === 'development' ? parseError.message : undefined,
          rawData: process.env.NODE_ENV === 'development' ? data.data.message : undefined
      });
    }
  } catch (err) {
    console.error('Error in api/scrape-data-dni-peru (HTTP-only):', err);
    return res.status(500).json({ 
        success: false, 
        error: 'Error al consultar dniperu.com', 
        details: process.env.NODE_ENV === 'development' ? (err?.message || String(err)) : undefined 
    });
  }
}
