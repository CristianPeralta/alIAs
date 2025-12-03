import BaseScraper from './base-scraper.js';

export default class MinsaScraper extends BaseScraper {
    constructor() {
        super();
        this.baseUrl = 'https://contingenciasis.minsa.gob.pe/frmConsultaContingencia.aspx';
    }

    async searchByDni(dni) {
        return this.withPage(async (page) => {
            try {
                // Navegar a la página
                await page.goto(this.baseUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Seleccionar tipo de búsqueda: Datos Personales
                await page.select('select#cboTipoBusqueda', '2');

                // Seleccionar tipo de documento: DNI
                await page.select('select#cboTipoDocumento', '1');

                // Ingresar DNI
                await page.type('input#txtNroDocumento', dni);

                // Hacer clic en el botón de búsqueda
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0' }),
                    page.click('input#btnBuscar')
                ]);

                // Verificar si hay resultados
                const noResults = await page.$eval('body', (body) => {
                    return body.textContent.includes('No se encontraron resultados');
                });

                if (noResults) {
                    return {
                        success: true,
                        count: 0,
                        data: []
                    };
                }

                // Extraer datos de la tabla de resultados
                const results = await page.$$eval('#gvResultados tr', (rows) => {
                    return Array.from(rows).slice(1).map(row => {
                        const cells = row.querySelectorAll('td');
                        return {
                            dni: cells[0]?.textContent?.trim(),
                            fullName: cells[1]?.textContent?.trim(),
                            gender: cells[2]?.textContent?.trim(),
                            birthDate: cells[3]?.textContent?.trim(),
                            ubigeo: cells[4]?.textContent?.trim(),
                            department: cells[5]?.textContent?.trim(),
                            province: cells[6]?.textContent?.trim(),
                            district: cells[7]?.textContent?.trim(),
                            establishment: cells[8]?.textContent?.trim(),
                            date: cells[9]?.textContent?.trim(),
                            hour: cells[10]?.textContent?.trim()
                        };
                    });
                });

                return {
                    success: true,
                    count: results.length,
                    data: results
                };

            } catch (error) {
                console.error('Error en el scraping de Minsa:', error);
                return {
                    success: false,
                    error: 'Error al realizar la búsqueda',
                    details: error.message
                };
            }
        });
    }
}
