import "dotenv/config";
import express from 'express';
import path from 'path';
import { fileURLToPath } from "url";
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
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

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${process.env.API_KEY}`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Error en la API: ${response.statusText}`);
        }

        const result = await response.json();
        res.json(result);
        
    } catch (error) {
        console.error('Error in /api/generate-names:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
});

// Web scraping endpoint using Puppeteer
app.post('/api/scrape-data', async (req, res) => {
    let browser;
    try {
        const { fatherLastName, motherLastName, name } = req.body;
        
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

        res.json({
            success: true,
            count: results.length,
            data: results
        });
        
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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.ENV}`);
    console.log(`API Key: ${process.env.API_KEY}`);
});
