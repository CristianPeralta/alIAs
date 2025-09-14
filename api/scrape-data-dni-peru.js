import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let browser;

  try {
    const { name, fatherLastName, motherLastName } = req.body || {};

    if (!name || !fatherLastName || !motherLastName) {
      res.status(400).json({ error: 'Name, fatherLastName and motherLastName are required' });
      return;
    }

    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');

    await page.goto('https://dniperu.com/buscar-dni-por-nombres-y-apellidos/', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Extraer el nonce del script de la página
    const nonce = await page.evaluate(() => {
      const scriptElement = document.getElementById('consultas-dni-js-extra');
      if (scriptElement) {
        const scriptContent = scriptElement.textContent;
        const match = /"nonce":"(.*?)"/.exec(scriptContent);
        return match ? match[1] : null;
      }
      return null;
    });

    if (!nonce) {
      res.status(500).json({ success: false, error: 'No se pudo obtener el nonce de seguridad. El sitio puede haber cambiado.' });
      return;
    }

    const formData = new FormData();
      formData.append('nombres', name);
      formData.append('apellido_paterno', fatherLastName);
      formData.append('apellido_materno', motherLastName);
      formData.append('company', '');
      formData.append('action', 'buscar_dni');
      formData.append('security', nonce);

    const res = await fetch('https://dniperu.com/wp-admin/admin-ajax.php', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
        res.status(404).json({ success: false, error: `Error en la solicitud: ${response.statusText}` });
        return;
    }

    const response = await res.json();

    // Procesar la respuesta
    if (response && response.success && response.data && response.data.resultados && response.data.resultados.length > 0) {
      const persona = response.data.resultados[0];
      const output = {
        dni: persona.numero,
        name: persona.nombres,
        fatherLastName: persona.apellido_paterno,
        motherLastName: persona.apellido_materno
      };

      res.status(200).json(output);
      return;
    } else {
      res.status(404).json({ error: 'No se encontraron resultados o la solicitud no fue exitosa.' });
      return;
    }
  } catch (err) {
    console.error('Error in api/scrape-data-dni-peru:', err);
    res.status(500).json({ success: false, error: 'Error al scrapear dniperu.com', details: err?.message || String(err) });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}
