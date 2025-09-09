import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  let browser;
  try {
    const { fatherLastName, motherLastName, name } = req.body || {};

    if (!fatherLastName || !motherLastName || !name) {
      res.status(400).json({ error: 'Father lastname, mother lastname and name are required' });
      return;
    }
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');

    await page.goto('https://contingenciasis.minsa.gob.pe/frmConsultaContingencia.aspx', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    await page.select('select#cboTipoBusqueda', '1');
    await page.type('input#txtApePaterno', fatherLastName);
    await page.type('input#txtApeMaterno', motherLastName);
    await page.type('input#txtPriNombre', name);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 }),
      page.click('input#btnConsultar')
    ]);

    const results = await page.evaluate(() => {
      const data = [];
      const rows = document.querySelectorAll('#dgConsulta tr:not(:first-child):not(:last-child)');

      rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 15) {
          data.push({
            tipoSeguro: cols[1].textContent.trim(),
            tipoFormato: cols[2].textContent.trim(),
            numeroAfiliacion: cols[3].textContent.trim(),
            planBeneficios: cols[4].textContent.trim(),
            fechaAfiliacion: cols[5].textContent.trim(),
            vigencia: cols[6].textContent.trim(),
            tipoDocumento: cols[7].textContent.trim(),
            numeroDocumento: cols[8].textContent.trim(),
            apellidoPaterno: cols[9].textContent.trim(),
            apellidoMaterno: cols[10].textContent.trim(),
            nombres: cols[11].textContent.trim(),
            fechaNacimiento: cols[12].textContent.trim(),
            sexo: cols[13].textContent.trim(),
            eess: cols[14].textContent.trim(),
            ubicacionEESS: (cols[15] && cols[15].textContent || '').trim(),
          });
        }
      });

      return data;
    });

    if (!results || results.length === 0) {
      res.status(404).json({ error: 'No se encontraron datos' });
      return;
    }

    res.status(200).json(results[0]);
  } catch (error) {
    console.error('Error in api/scrape-data:', error);
    res.status(500).json({ success: false, error: 'Error al procesar la solicitud', details: error.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}
