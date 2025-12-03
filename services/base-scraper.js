import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

class BaseScraper {
    constructor() {
        this.browser = null;
    }

    async init(options = {}) {
        const defaultOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath()
        };

        this.browser = await puppeteer.launch({
            ...defaultOptions,
            ...options
        });

        return this.browser;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async withPage(callback) {
        if (!this.browser) {
            await this.init();
        }

        const page = await this.browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
            return await callback(page);
        } finally {
            await page.close();
        }
    }

    static replaceDToEnie(str) {
        if (typeof str === 'string') {
            return str.replace(/Ð/g, 'Ñ').replace(/ð/g, 'ñ');
        }
        return str;
    }
}

export default BaseScraper;
