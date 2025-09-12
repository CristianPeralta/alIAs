import "dotenv/config";
import express from 'express';
import path from 'path';
import { fileURLToPath } from "url";
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import { replaceEnieToD, replaceDToEnie } from './utils.js';
import Redis from 'ioredis';

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Redis client setup (optional). If Redis isn't available, the app will continue without cache.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60 * 60 * 24 * 7); // default 1 week
let redis;
try {
  redis = new Redis(REDIS_URL, { lazyConnect: true });
  // Attempt to connect on startup, but don't crash if it fails
  redis.connect().then(() => {
    console.log("Connected to Redis successfully");
  }).catch((err) => {
    console.warn("Redis connection failed. Caching will be disabled.", err?.message || err);
  });
} catch (e) {
  console.warn("Redis client initialization failed. Caching will be disabled.", e?.message || e);
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
        // max limit 20
        if (limit > 20) {
            return res.status(400).json({ error: 'Limit must be less than or equal to 20' });
        }
        const modelId = 'gemini-2.5-flash-preview-05-20';
        const version = 'v1';
        const normalizedName = String(name).trim().toLowerCase();
        const cacheKey = `names:${modelId}:${version}:${normalizedName}:${limit}`;

        // 1) Try cache first
        if (redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const payload = JSON.parse(cached);
                    return res.json(payload);
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

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${process.env.API_KEY}`;
        
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

        // 2) Store in cache
        if (redis) {
            try {
                await redis.set(cacheKey, JSON.stringify(responseBody), 'EX', CACHE_TTL_SECONDS);
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

// Mock endpoint to scrape data from Minsa website.
app.post('/api/scrape-data-mock', (req, res) => {
    let { fatherLastName, motherLastName, name } = req.body;
    
    if (!fatherLastName || !motherLastName || !name) {
        return res.status(400).json({ error: 'Father lastname, mother lastname and name are required' });
    }

    const foundedData = Math.random() > 0.5;
    // Replace 'Ñ' with 'Ð' in input parameters
    fatherLastName = replaceEnie(fatherLastName);
    motherLastName = replaceEnie(motherLastName);
    name = replaceEnie(name);
    
    const data = {
        tipoDocumento: 'DNI',
        numeroDocumento: '12345678',
        apellidoPaterno: fatherLastName,
        apellidoMaterno: motherLastName,
        nombres: name,
        fechaNacimiento: '2000-01-01',
        ubicacionEESS: replaceEnie('Ubicación 1')
    };
    if (!foundedData) {
        return res.status(404).json({ error: 'No se encontraron datos' });
    }
    res.json(data);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.ENV}`);
    console.log(`API Key: ${process.env.API_KEY}`);
});

// TODO: Replace 'Ñ' with 'Ð' for 'minsa' endpoint, both for scraping and returning data.
// TODO: Implement error handling for the limit quote error from the GEMINI API
// TODO: Implement scraping data from other websites, for example https://dniperu.com/search-by-name-and-surname/
// TODO: Implement caching for Minsa data
// TODO: Implement rate limiter for the number of requests
// TODO: Deploy to the cloud
// TODO: Add endpoints for querying by DNI
// TODO: Add limiter for name length in the generate names endpoint