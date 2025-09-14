import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { name, fatherLastName, motherLastName } = req.body || {};

    if (!name || !fatherLastName || !motherLastName) {
      res.status(400).json({ error: 'Name, fatherLastName and motherLastName are required' });
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
        const m = /"nonce"\s*:\s*"([^"]+)"/.exec(html);
        if (m && m[1]) nonce = m[1];
        else {
          // Try to find by script id and then extract
          const idMatch = /id=["']consultas-dni-js-extra["'][^>]*>\s*([^<]+)/.exec(html);
          if (idMatch && idMatch[1]) {
            const innerMatch = /"nonce"\s*:\s*"([^"]+)"/.exec(idMatch[1]);
            if (innerMatch && innerMatch[1]) nonce = innerMatch[1];
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
    const body = new URLSearchParams();
    body.append('nombres', name);
    body.append('apellido_paterno', fatherLastName);
    body.append('apellido_materno', motherLastName);
    body.append('company', '');
    body.append('action', 'buscar_dni');
    body.append('security', nonce);

    const ajaxResp = await fetch('https://dniperu.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });

    if (!ajaxResp.ok) {
      return res.status(ajaxResp.status).json({ success: false, error: `Error en la solicitud: ${ajaxResp.statusText}` });
    }

    const data = await ajaxResp.json();

    if (data && data.success && data.data && Array.isArray(data.data.resultados) && data.data.resultados.length > 0) {
      const persona = data.data.resultados[0];
      const output = {
        dni: persona.numero,
        name: persona.nombres,
        fatherLastName: persona.apellido_paterno,
        motherLastName: persona.apellido_materno
      };

      return res.status(200).json(output);
    }

    return res.status(404).json({ error: 'No se encontraron resultados o la solicitud no fue exitosa.' });
  } catch (err) {
    console.error('Error in api/scrape-data-dni-peru (HTTP-only):', err);
    return res.status(500).json({ success: false, error: 'Error al consultar dniperu.com', details: err?.message || String(err) });
  }
}
