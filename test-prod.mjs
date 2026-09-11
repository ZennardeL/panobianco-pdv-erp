import puppeteer from 'puppeteer';
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    // Interceptar console.log para capturar tudo
    const logs = [];
    page.on('console', msg => logs.push('[' + msg.type() + '] ' + msg.text()));
    page.on('pageerror', err => logs.push('[PAGEERROR] ' + err.message));

    await page.goto('https://panobianco-pdv-erp.vercel.app/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(e => logs.push(e.message));
    await new Promise(r => setTimeout(r, 3000));

    // Try calling init manually
    const manualInit = await page.evaluate(() => {
        try {
            const result = supabaseAdapter.init();
            return { result, isConnected: supabaseAdapter.isConnected, clientExists: !!supabaseAdapter.client };
        } catch(e) {
            return { error: e.message };
        }
    });
    console.log('Manual init result:', JSON.stringify(manualInit, null, 2));
    
    console.log('\\nAll logs:');
    logs.forEach(l => console.log(l));
    
    await browser.close();
})();
