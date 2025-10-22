import BaseScraper from './base-scraper.js';
import fetch from 'node-fetch';

export default class DniPeruScraper extends BaseScraper {
    constructor() {
        super();
        this.baseUrl = 'https://dniperu.com';
    }

    async searchByDni(dni) {
        try {
            if (!dni) {
                throw new Error('DNI is required');
            }

            // Obtener nonce de seguridad
            const nonce = await this._getSecurityNonce('dni');

            console.log('Nonce obtenido:', nonce);
            
            if (!nonce) {
                throw new Error('No se pudo obtener el nonce de seguridad');
            }

            // Realizar búsqueda por DNI
            const result = await this._performDniSearch({
                dni,
                nonce
            });

            console.log('Resultado de la búsqueda:', result);

            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Error en la búsqueda por DNI',
                details: error.details
            };
        } finally {
            await this.close();
        }
    }

    async searchByNames({ name, fatherLastName, motherLastName }) {
        try {
            // Validaciones
            if (!name || !fatherLastName || !motherLastName) {
                throw new Error('Name, fatherLastName and motherLastName are required');
            }

            // Obtener nonce de seguridad
            const nonce = await this._getSecurityNonce('name');

            console.log('Nonce obtenido:', nonce);
            
            if (!nonce) {
                throw new Error('No se pudo obtener el nonce de seguridad');
            }

            // Realizar búsqueda
            const result = await this._performSearch({
                name,
                fatherLastName,
                motherLastName,
                nonce
            });

            console.log('Resultado de la búsqueda:', result);

            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Error en la búsqueda',
                details: error.details
            };
        } finally {
            await this.close();
        }
    }

    async _getSecurityNonce(searchBy = 'name') {
        let endpoint = `/buscar-dni-nombres-apellidos/`;
        if (searchBy === 'dni') {
            endpoint = `/buscar-dni-por-nombres-y-apellidos/`;
        }
        // Primero intentamos con fetch ligero
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html'
                },
                timeout: 10000
            });
            
            let nonce = null;
            if (response.ok) {

              if (searchBy === 'dni') {
                const html = await response.text();
                // Buscar en el script con ID 'consultas-nombres-js-extra' if searchBy === 'dni'
                // Buscar en el script con ID 'consultas-dni-js-extra' if searchBy === 'name'

                const scriptRegex = /<script[^>]*id=["']consultas-nombres-js-extra["'][^>]*>([\s\S]*?)<\/script>/i;
                const scriptMatch = html.match(scriptRegex);
                
                if (scriptMatch && scriptMatch[1]) {
                    const scriptContent = scriptMatch[1];
                    const nonceMatch = scriptContent.match(/"nonce"\s*:\s*"([^"]+)"/);
                    if (nonceMatch && nonceMatch[1]) {
                        nonce = nonceMatch[1];
                    }
                }
              } else {
                const html = await response.text();
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
            }
            
            if (nonce) {
                return nonce;
            }
        } catch (error) {
            console.warn('Lightweight nonce fetch failed, falling back to Puppeteer:', error.message);
        }

        // Si falla el fetch ligero o no se encontró el nonce, usamos Puppeteer
        return this.withPage(async (page) => {
            await page.goto(`${this.baseUrl}/buscar-dni-nombres-apellidos/`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            return page.evaluate(() => {
                // Primero intentamos con el ID correcto
                const scriptElement = document.getElementById('consultas-nombres-js-extra');
                if (scriptElement) {
                    const scriptContent = scriptElement.textContent || scriptElement.innerText || '';
                    const match = scriptContent.match(/"nonce"\s*:\s*"([^"]+)"/);
                    if (match && match[1]) return match[1];
                }
                
                // Si no se encuentra, buscamos en todos los scripts
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const s of scripts) {
                    const txt = s.textContent || '';
                    const m = /"nonce"\s*:\s*"([^"]+)"/.exec(txt);
                    if (m && m[1]) return m[1];
                }
                
                return null;
            });
        });
    }

    async _performSearch({ name, fatherLastName, motherLastName, nonce }) {
        try {
            const formData = new URLSearchParams();
            formData.append('nombres', name);
            formData.append('apellido_paterno', fatherLastName);
            formData.append('apellido_materno', motherLastName);
            formData.append('company', '');
            formData.append('action', 'buscar_dni');
            formData.append('security', nonce);

            const headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'DNT': '1',
                'Host': new URL(this.baseUrl).host,
                'Origin': this.baseUrl,
                'Pragma': 'no-cache',
                'Referer': `${this.baseUrl}/`,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            };

            const response = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: headers,
                body: formData.toString(),
                credentials: 'include',
                referrer: `${this.baseUrl}/`,
                mode: 'cors'
            });

            if (!response.ok) {
                if (response.status === 403) {
                    const errorText = await response.text();
                    console.error('Detalles del error 403:', {
                        status: response.status,
                        statusText: response.statusText,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: errorText
                    });
                    throw new Error(`Acceso denegado (403). Detalles: ${errorText.substring(0, 200)}...`);
                }
                throw new Error(`Error en la solicitud: ${response.status} ${response.statusText}`);
            }

            const responseData = await response.json();
            
            if (!responseData.success || !responseData.data?.resultados?.length) {
                throw new Error('No se encontraron resultados para la búsqueda');
            }

            const persona = responseData.data.resultados[0];
            return {
                dni: persona.numero,
                name: persona.nombres,
                fatherLastName: persona.apellido_paterno,
                motherLastName: persona.apellido_materno
            };
        } catch (error) {
            console.error('Error en _performSearch:', error);
            throw error; // Re-lanzar el error para que pueda ser manejado por el llamador
        }
    }

    async _performDniSearch({ dni, nonce }) {
        try {
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
                'Host': new URL(this.baseUrl).host,
                'Origin': this.baseUrl,
                'Pragma': 'no-cache',
                'Referer': `${this.baseUrl}/`,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            };

            const response = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: headers,
                body: formData.toString(),
                credentials: 'include',
                referrer: `${this.baseUrl}/`,
                mode: 'cors'
            });

            if (!response.ok) {
                if (response.status === 403) {
                    const errorText = await response.text();
                    console.error('Detalles del error 403 en _performDniSearch:', {
                        status: response.status,
                        statusText: response.statusText,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: errorText
                    });
                    throw new Error(`Acceso denegado (403). Detalles: ${errorText.substring(0, 200)}...`);
                }
                throw new Error(`Error en la solicitud: ${response.status} ${response.statusText}`);
            }

            const responseData = await response.json();
            
            if (!responseData.success || !responseData.data?.message?.length) {
                throw new Error('No se encontraron resultados para el DNI proporcionado');
            }

            const result = responseData.data.message;
            const dniMatch = result.match(/Número de DNI: (\d+)/);
            const namesMatch = result.match(/Nombres: (.+)/);
            const fatherLastNameMatch = result.match(/Apellido Paterno: (.+)/);
            const motherLastNameMatch = result.match(/Apellido Materno: (.+)/);
            const verificationCodeMatch = result.match(/Código de Verificación: (\d+)/);
            
            if (!dniMatch || !namesMatch || !fatherLastNameMatch || !motherLastNameMatch) {
                throw new Error('Formato de respuesta inesperado del servidor');
            }

            return {
                dni: dniMatch[1],
                names: namesMatch[1],
                fatherLastName: fatherLastNameMatch[1],
                motherLastName: motherLastNameMatch[1],
                verificationCode: verificationCodeMatch ? verificationCodeMatch[1] : null
            };
        } catch (error) {
            console.error('Error en _performDniSearch:', error);
            throw error; // Re-lanzar el error para que pueda ser manejado por el llamador
        }
    }
}
