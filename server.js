import "dotenv/config";
import express from 'express';
import path from 'path';
import { fileURLToPath } from "url";
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import { Redis } from '@upstash/redis';
import { replaceEnieToD, replaceDToEnie } from './utils.js';

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API Key
const API_KEY = process.env.API_KEY;

// Environment
const ENV = process.env.ENV;

// Redis client setup (optional). If Redis isn't available, the app will continue without cache.
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60 * 60 * 24 * 7); // default 1 week
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis;
try {
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
    console.log("Upstash Redis client configured successfully");
  } else {
    console.warn("Upstash Redis env vars not set. Caching will be disabled.");
  }
} catch (e) {
  console.warn("Upstash Redis client initialization failed. Caching will be disabled.", e?.message || e);
}

// Serve the main HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/consult', (req, res) => {
    res.sendFile(path.join(__dirname, 'consult.html'));
});

// API endpoint to handle name variations
app.post('/api/generate-names', async (req, res) => {
    try {
        const { name, limit } = req.body;
        
        if (!name || !limit) {
            return res.status(400).json({ error: 'Name and limit are required' });
        }

        if (name.length > 20) {
            return res.status(400).json({ error: 'Name must be less than or equal to 20 characters' });
        }

        // max limit 20
        if (limit > 20) {
            return res.status(400).json({ error: 'Limit must be less than or equal to 20' });
        }
        const modelId = 'gemini-2.5-flash-preview-05-20';
        const version = 'v1';
        const normalizedName = String(name).trim().toLowerCase();
        const cacheKey = `names:${modelId}:${version}:${normalizedName}:${limit}`;

        // 1) Try cache first (Upstash REST)
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return res.json(cached);
                }
            } catch (cacheErr) {
                console.warn('Redis GET failed, proceeding without cache:', cacheErr?.message || cacheErr);
            }
        }

        const systemPrompt = "Eres un experto en onomástica, con un profundo conocimiento de nombres en Latinoamérica. Tu tarea es generar variaciones de nombres de persona que suenen lo más similar posible al nombre dado, priorizando la fonética y la ortografía común de la región. Evita las abreviaciones, acortamientos o nombres que, aunque relacionados, no compartan la misma pronunciación exacta (por ejemplo, para 'Cristian' evita 'Cris' y para 'Leonidas' evita 'León' o 'Leonardo'). La lista debe estar ordenada de las variaciones más comunes a las menos comunes y debe ser un arreglo de cadenas de texto en formato JSON. Considera los patrones como 'Yesica', 'Jessica', 'Jesika', 'Jezica', etc.";
        const userQuery = `Genera una lista de ${limit} variaciones de nombres que suenen o se escriban de manera similar a "${name}".`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "STRING"
                    }
                }
            }
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${API_KEY}`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Error en la API: ${response.statusText}`);
        }

        const result = await response.json();
        const textArray = result.candidates[0].content.parts[0].text ?? "[]";
        const names = JSON.parse(textArray);
          const responseBody = {
            name,
            candidates: names,
        };

        // 2) Store in cache (Upstash REST)
        if (redis) {
            try {
                await redis.set(cacheKey, responseBody, { ex: CACHE_TTL_SECONDS });
            } catch (cacheErr) {
                console.warn('Redis SET failed, continuing without caching:', cacheErr?.message || cacheErr);
            }
        }

        res.json(responseBody);
        
    } catch (error) {
        console.error('Error in /api/generate-names:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
});
let indexNames = 0;
// Mock endpoint to generate names
app.post('/api/generate-names-mock', (req, res) => {
    const { name, limit } = req.body;
    
    if (!name || !limit) {
        return res.status(400).json({ error: 'Name and limit are required' });
    }
    
    const names = [
        [
            "Jessica",
            "Yesica",
            "Yessica",
            "Jéssica",
            "Jesica",
            "Jessika",
            "Yesika",
            "Jesyca",
            "Jezica",
            "Yezica"
        ],
        [
            "John",
            "Jon",
            "Jo",
            "Jón",
            "Jonh",
            "Jonny",
            "Jony",
            "Joh",
            "Johann",
            "Johan",
            "Johannes"
        ]
    ];
    indexNames++;
    if (indexNames >= names.length) {
        indexNames = 0;
    }
    res.json({
        name,
        candidates: names[indexNames],
    });
});

/**
 * Endpoint to scrape data from Minsa website.
 * @method POST
 * @path /api/scrape-data
 * @body {Object} body - The request body.
 * @bodyparam {string} fatherLastName - The father's last name.
 * @bodyparam {string} motherLastName - The mother's last name.
 * @bodyparam {string} name - The person's name.
 * @response {Object} result - The result of the scrapping.
 * @response {boolean} result.success - True if the scrapping was successful.
 * @response {number} result.count - The number of results found.
 * @response {Array<Object>} result.data - The scraped data.
 */

app.post('/api/scrape-data', async (req, res) => {
    let browser;
    try {
        let { fatherLastName, motherLastName, name } = req.body;
        
        if (!fatherLastName || !motherLastName || !name) {
            return res.status(400).json({ error: 'Father lastname, mother lastname and name are required' });
        }

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to mimic a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to the page
        await page.goto('https://contingenciasis.minsa.gob.pe/frmConsultaContingencia.aspx', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Select 'Datos Personales' in the dropdown
        await page.select('select#cboTipoBusqueda', '1');
        
        // Replace 'Ñ' with 'Ð' in input parameters
        fatherLastName = replaceEnieToD(fatherLastName);
        motherLastName = replaceEnieToD(motherLastName);
        name = replaceEnieToD(name);
        
        // Fill in the form fields
        await page.type('input#txtApePaterno', fatherLastName);
        await page.type('input#txtApeMaterno', motherLastName);
        await page.type('input#txtPriNombre', name);
        
        // Click the search button and wait for results
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.click('input#btnConsultar')
        ]);

        // Extract the data from the results table
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
                        ubicacionEESS: cols[15]?.textContent.trim() || ''
                    });
                }
            });
            
            return data;
        });
        if (results.length === 0) {
            return res.status(404).json({ error: 'No se encontraron datos' });
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
        
        res.json(formattedResults);
        
    } catch (error) {
        console.error('Error in /api/scrape-data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al procesar la solicitud',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

/**
 * Endpoint to scrape data from Minsa website.
 * @method POST
 * @path /api/scrape-data-dni
 * @body {Object} body - The request body.
 * @bodyparam {string} dni - The DNI of the person.
 * @response {Object} result - The result of the scrapping.
 * @response {boolean} result.success - True if the scrapping was successful.
 * @response {number} result.count - The number of results found.
 * @response {Array<Object>} result.data - The scraped data.
 */
app.post('/api/scrape-data-dni', async (req, res) => {
    let browser;
    try {
        let { dni } = req.body;
        
        if (!dni) {
            return res.status(400).json({ error: 'DNI is required' });
        }

        // Launch browser in headless mode
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to mimic a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to the page
        await page.goto('https://contingenciasis.minsa.gob.pe/frmConsultaContingencia.aspx', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Select 'Datos Personales' in the dropdown (2) Tipo de documento
        await page.select('select#cboTipoBusqueda', '2');

        // Select 'DNI' in the dropdown cboTipoDocumento (1) DNI
        await page.select('select#cboTipoDocumento', '1');

        // Fill in the form fields // txtNroDocumento
        await page.type('input#txtNroDocumento', dni);
        
        // Click the search button and wait for results
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.click('input#btnConsultar')
        ]);

        // Extract the data from the results table
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
                        ubicacionEESS: cols[15]?.textContent.trim() || ''
                    });
                }
            });
            
            return data;
        });
        if (results.length === 0) {
            return res.status(404).json({ error: 'No se encontraron datos' });
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
        
        res.json(formattedResults);
        
    } catch (error) {
        console.error('Error in /api/scrape-data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al procesar la solicitud',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});


// Mock endpoint to scrape data from Minsa website.
app.post('/api/scrape-data-mock', (req, res) => {
    let { fatherLastName, motherLastName, name } = req.body;
    
    if (!fatherLastName || !motherLastName || !name) {
        return res.status(400).json({ error: 'Father lastname, mother lastname and name are required' });
    }

    const foundedData = Math.random() > 0.5;
    // Replace 'Ñ' with 'Ð' in input parameters
    fatherLastName = replaceEnieToD(fatherLastName);
    motherLastName = replaceEnieToD(motherLastName);
    name = replaceEnieToD(name);
    
    const data = {
        tipoDocumento: 'DNI',
        numeroDocumento: '12345678',
        apellidoPaterno: replaceDToEnie(fatherLastName),
        apellidoMaterno: replaceDToEnie(motherLastName),
        nombres: replaceDToEnie(name),
        fechaNacimiento: '2000-01-01',
        ubicacionEESS: ('Ubicación 1')
    };
    if (!foundedData) {
        return res.status(404).json({ error: 'No se encontraron datos' });
    }
    res.json(data);
});

// Endpoint to scrape data from DNI Peru website. https://dniperu.com/buscar-dni-por-nombres-y-apellidos/
/**
 * Endpoint to scrape data from DNI Peru website.
 * @method POST
 * @path /api/scrape-data-dni-peru
 * @body {Object} body - The request body.
 * @bodyparam {string} name - The person's name.
 * @bodyparam {string} fatherLastName - The father's last name.
 * @bodyparam {string} motherLastName - The mother's last name.
 * @response {Object} result - The result of the scrapping.
 * @response {boolean} result.success - True if the scrapping was successful.
 * @response {number} result.count - The number of results found.
 * @response {Array<Object>} result.data - The scraped data.
 */

app.post('/api/scrape-data-dni-peru', async (req, res) => {
    const { name, fatherLastName, motherLastName } = req.body;
    const result = await scrapeDataFromDniPeru(name, fatherLastName, motherLastName);
    if (!result.success) {
        return res.status(404).json({ error: result.error });
    }
    res.json(result.data);
});

app.post('/api/scrape-data-dni-peru-dni', async (req, res) => {
    const { dni } = req.body;
    const result = await scrapeDataFromDniPeruDni(dni);
    if (!result.success) {
        return res.status(404).json({ error: result.error });
    }
    res.json(result.data);
});

async function scrapeDataFromDniPeru(name, fatherLastName, motherLastName) {
    let browser;
    try {
        // Validaciones
        if (!name || !fatherLastName || !motherLastName) {
            return {
                success: false,
                error: 'Name, fatherLastName and motherLastName are required'
            };
        }

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

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
                // Try to find the script block with the nonce using regex
                const match = /"nonce"\s*:\s*"([^"]+)"/.exec(html);
                if (match && match[1]) {
                    nonce = match[1];
                } else {
                    // As a second attempt, search for a script element id
                    const idMatch = /id=["']consultas-dni-js-extra["'][^>]*>\s*([^<]+)/.exec(html);
                    if (idMatch && idMatch[1]) {
                        const scriptContent = idMatch[1];
                        const innerMatch = /"nonce"\s*:\s*"([^"]+)"/.exec(scriptContent);
                        if (innerMatch && innerMatch[1]) nonce = innerMatch[1];
                    }
                }
            }
        } catch (err) {
            // If lightweight fetch fails, we'll fallback to Puppeteer below
            console.warn('Lightweight nonce fetch failed, will fallback to Puppeteer:', err?.message || err);
        }

        // If we didn't get a nonce from the lightweight fetch, fallback to Puppeteer DOM parsing
        if (!nonce) {
            await page.goto('https://dniperu.com/buscar-dni-por-nombres-y-apellidos/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            nonce = await page.evaluate(() => {
                const scriptElement = document.getElementById('consultas-dni-js-extra');
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
        formData.append('nombres', name);
        formData.append('apellido_paterno', fatherLastName);
        formData.append('apellido_materno', motherLastName);
        formData.append('company', '');
        formData.append('action', 'buscar_dni');
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
        if (responseData.success && responseData.data.resultados.length > 0) {
            const persona = responseData.data.resultados[0];
            const output = {
                dni: persona.numero,
                name: persona.nombres,
                fatherLastName: persona.apellido_paterno,
                motherLastName: persona.apellido_materno
            }
            
            return {
                success: true,
                data: output
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

async function scrapeDataFromDniPeruDni(dni) {
    let browser;
    try {
        // Validaciones
        if (!dni) {
            return {
                success: false,
                error: 'DNI is required'
            };
        }

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

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
        if (!nonce) {
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
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${ENV}`);
    console.log(`API Key: ${API_KEY}`);
});

// TODO: Implement error handling for the limit quote error from the GEMINI API
// TODO: Implement scraping data from other websites, for example https://dniperu.com/search-by-name-and-surname/
// TODO: Implement caching for Minsa data
// TODO: Implement rate limiter for the number of requests


