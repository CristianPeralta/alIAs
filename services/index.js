import BaseScraper from './base-scraper.js';
import DniPeruScraper from './dni-peru-scraper.js';
import MinsaScraper from './minsa-scraper.js';
import NameGenerator from './name-generator.js';

// Exportar las clases directamente
export {
    BaseScraper,
    DniPeruScraper,
    MinsaScraper,
    NameGenerator
};

// Crear instancias para uso directo
export const nameGenerator = new NameGenerator();

export const createScraper = (type) => {
    switch (type) {
        case 'dni-peru':
            return new DniPeruScraper();
        case 'minsa':
            return new MinsaScraper();
        default:
            throw new Error(`Tipo de scraper no soportado: ${type}`);
    }
};

// Métodos de conveniencia
export const searchByDni = async (dni) => {
    const scraper = new MinsaScraper();
    try {
        return await scraper.searchByDni(dni);
    } finally {
        await scraper.close();
    }
};

export const searchByNames = async ({ name, fatherLastName, motherLastName }) => {
    const scraper = new DniPeruScraper();
    try {
        return await scraper.searchByNames({ name, fatherLastName, motherLastName });
    } finally {
        await scraper.close();
    }
};
