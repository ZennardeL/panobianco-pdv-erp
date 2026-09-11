import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

const modules = [
    ['src/core/helpers.js', 'helpers'],
    ['src/core/constants.js', 'constants'],
    ['src/modules/inventory.js', 'inventory'],
    ['src/core/app.js', 'orchestrator'],
];

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    await new Promise(r => setTimeout(r, 3000));

    // Test individual modules
    for (const [path, name] of modules) {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
<script type="module">
import('/${path}').then(() => { window.__result = 'OK'; }).catch(e => { window.__result = 'ERR:' + e.message; });
</script></body></html>`;
        writeFileSync('public/_test_mod.html', html);

        const page = await browser.newPage();
        let pageErr = null;
        page.on('pageerror', err => { if (!pageErr) pageErr = err.message; });

        await page.goto('http://localhost:5558/_test_mod.html', { waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 500));

        const result = await page.evaluate(() => window.__result || 'TIMEOUT');
        
        if (result === 'OK' && !pageErr) {
            console.log(`✅ ${name}`);
        } else {
            console.error(`❌ ${name} → ${pageErr || result}`);
        }
        await page.close();
    }

    // Test full page with module loading
    console.log('\n=== Full Page Test ===');
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`); });

    await page.goto('http://localhost:5558/', { waitUntil: 'networkidle0', timeout: 15000 }).catch(e => errors.push(e.message));
    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate(() => ({
        appExists: typeof window.app !== 'undefined',
        appKeys: typeof window.app !== 'undefined' ? Object.keys(window.app).length : 0,
        hasLogin: typeof window.app?.handleEmployeeLogin === 'function',
    }));
    console.log('Result:', JSON.stringify(result));
    console.log('Errors:', errors.length ? errors.join('\n') : 'none');

    await page.close();
    await browser.close();
})();
