import puppeteer from 'puppeteer';
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    // Interceptar ANTES de navegar
    await page.evaluateOnNewDocument(() => {
        // Patch para logar quando supabaseAdapter é definido
        let _adapterSet = false;
        Object.defineProperty(window, '_supabaseAdapterCheck', {
            get() {
                return typeof supabaseAdapter !== 'undefined';
            }
        });
    });
    
    const logs = [];
    page.on('console', msg => logs.push('[' + msg.type() + '] ' + msg.text()));
    
    await page.goto('https://panobianco-pdv-erp.vercel.app/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    
    const check = await page.evaluate(() => ({
        windowAdapter: typeof window.supabaseAdapter,
        bareAdapter: typeof supabaseAdapter,
        windowConfig: typeof window.SUPABASE_CONFIG,
        bareConfig: typeof SUPABASE_CONFIG,
    }));
    console.log('After load:', JSON.stringify(check, null, 2));
    logs.filter(l => l.includes('INIT')).forEach(l => console.log(l));
    
    await browser.close();
})();
