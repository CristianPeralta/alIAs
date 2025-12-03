import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

export async function scrapeDataFromDniPeruDni(dni, isServerless = false) {
  let browser;
  try {
      // Validaciones
      if (!dni) {
          return {
              success: false,
              error: 'DNI is required'
          };
      }

      if (!isServerless) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      }

      // Try a lightweight HTML fetch to extract the nonce quickly without launching Puppeteer
      let nonce = null;
      try {
          const resp = await fetch('https://dniperu.com/buscar-dni-por-nombres-y-apellidos/', {
              method: 'GET',
              headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                  'Accept': 'text/html'
              },
              // small timeout handled by AbortController below
          });

          if (resp.ok) {
              const html = await resp.text();
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
          // nonce = null;
      } catch (err) {
          // If lightweight fetch fails, we'll fallback to Puppeteer below
          console.warn('Lightweight nonce fetch failed, will fallback to Puppeteer:', err?.message || err);
      }

      // If we didn't get a nonce from the lightweight fetch, fallback to Puppeteer DOM parsing
      if (!nonce && !isServerless) {
          await page.goto('https://dniperu.com/buscar-dni-nombres-apellidos/', {
              waitUntil: 'networkidle2',
          });
          // <script type="text/javascript" id="consultas-nombres-js-extra">/* <![CDATA[ */var nombres_vars = {"ajax_url":"https:\/\/dniperu.com\/wp-admin\/admin-ajax.php","nonce":"33637034a7"};/* ]]> */</script>

          nonce = await page.evaluate(() => {
              const scriptElement = document.getElementById('consultas-nombres-js-extra');
              if (scriptElement) {
                  const scriptContent = scriptElement.textContent || scriptElement.innerText || '';
                  const match = /"nonce":"(.*?)"/.exec(scriptContent);
                  return match ? match[1] : null;
              }
              // attempt to find nonce in any inline script
              const scripts = Array.from(document.querySelectorAll('script'));
              for (const s of scripts) {
                  const txt = s.textContent || '';
                  const m = /"nonce"\s*:\s*"([^"]+)"/.exec(txt);
                  if (m && m[1]) return m[1];
              }
              return null;
          });
      }

      if (!nonce) {
          return {
              success: false,
              error: 'No se pudo obtener el nonce de seguridad. El sitio puede haber cambiado.'
          };
      }

      // Build form data and perform AJAX POST
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
          return {
              success: false,
              error: `Error en la solicitud: ${response.statusText}`
          };
      }
      
      const responseData = await response.json();
      // Procesar la respuesta
      if (responseData.success && responseData.data.message && responseData.data.message.length > 0) {
          const result = responseData.data.message;

          // Message example:
          const persona = {
              dni: result.match(/N\u00famero de DNI: (\d+)/)[1],
              names: result.match(/Nombres: (.+)/)[1],
              fatherLastName: result.match(/Apellido Paterno: (.+)/)[1],
              motherLastName: result.match(/Apellido Materno: (.+)/)[1],
              verificationCode: result.match(/C\u00f3digo de Verificaci\u00f3n: (\d+)/)[1],
          };
          
          return {
              success: true,
              data: persona
          };
      } else {
          return {
              success: false,
              error: 'No se encontraron resultados o la solicitud no fue exitosa.'
          };
      }
  } catch (err) {
      return {
          success: false,
          error: 'Error al scrapear dniperu.com',
          details: err?.message || String(err)
      };
  } finally {
      if (browser) {
          try { await browser.close(); } catch {}
      }
  }
}