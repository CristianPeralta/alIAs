import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  let browser;
  // Helper function to replace 'Ñ' or 'ñ' with 'Ð' in strings
  function replaceEnieToD(str) {
    if (typeof str === 'string') {
        return str.replace(/Ñ/g, 'Ð').replace(/ñ/g, 'ð');
    }
    return str;
  }
  // Helper function to replace 'Ð' or 'ð' with 'Ñ' or 'ñ' respectively in strings
  function replaceDToEnie(str) {
    if (typeof str === 'string') {
        return str.replace(/Ð/g, 'Ñ').replace(/ð/g, 'ñ');
    }
    return str;
  }

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
    await page.type('input#txtApePaterno', replaceEnieToD(fatherLastName));
    await page.type('input#txtApeMaterno', replaceEnieToD(motherLastName));
    await page.type('input#txtPriNombre', replaceEnieToD(name));

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

    // Replace 'Ñ' with 'Ð' in the response data
    const formattedResults = results[0];
    Object.keys(formattedResults).forEach(key => {
        if (typeof formattedResults[key] === 'string') {
            console.log(formattedResults[key]);
            formattedResults[key] = replaceDToEnie(formattedResults[key]);
            console.log(replaceDToEnie(formattedResults[key]));
        }
    });

    res.status(200).json(formattedResults);
  } catch (error) {
    console.error('Error in api/scrape-data:', error);
    res.status(500).json({ success: false, error: 'Error al procesar la solicitud', details: error.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}