/**
 * Servicio para generar nombres aleatorios
 */

export default class NameGenerator {
    constructor() {
        this.nombres = [
            'Juan', 'María', 'José', 'Ana', 'Carlos', 'Sofía', 'Luis', 'Elena',
            'Pedro', 'Laura', 'Miguel', 'Carmen', 'Jorge', 'Isabel', 'Fernando', 'Lucía'
        ];
        
        this.apellidos = [
            'García', 'González', 'Rodríguez', 'Fernández', 'López', 'Martínez',
            'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz',
            'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Muñoz', 'Romero'
        ];
    }

    /**
     * Genera nombres aleatorios basados en un nombre de entrada
     * @param {string} name - Nombre base para la generación
     * @param {number} limit - Número máximo de resultados a devolver
     * @returns {Array} - Lista de nombres generados
     */
    generateNames(name, limit = 10) {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            throw new Error('El nombre de entrada no es válido');
        }

        if (limit < 1 || limit > 100) {
            throw new Error('El límite debe estar entre 1 y 100');
        }

        const results = new Set();
        const nameLower = name.toLowerCase();
        
        // Añadir el nombre original
        results.add(this._capitalize(nameLower));

        // Generar variantes hasta alcanzar el límite
        while (results.size < limit) {
            const randomName = this._generateRandomName(nameLower);
            results.add(randomName);

            // Si después de varios intentos no podemos generar más nombres únicos, salimos
            if (results.size >= Math.min(limit, this.nombres.length * 2)) {
                break;
            }
        }

        return Array.from(results).slice(0, limit);
    }

    _generateRandomName(baseName) {
        // 50% de probabilidad de usar un nombre aleatorio
        const useRandomName = Math.random() > 0.5;
        
        if (useRandomName) {
            const randomFirstName = this._getRandomElement(this.nombres);
            const randomLastName1 = this._getRandomElement(this.apellidos);
            const randomLastName2 = this._getRandomElement(this.apellidos);
            
            return `${randomFirstName} ${randomLastName1} ${randomLastName2}`;
        } else {
            // Usar el nombre base con apellidos aleatorios
            const randomLastName1 = this._getRandomElement(this.apellidos);
            const randomLastName2 = this._getRandomElement(this.apellidos);
            
            return `${this._capitalize(baseName)} ${randomLastName1} ${randomLastName2}`;
        }
    }

    _getRandomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    _capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
}
