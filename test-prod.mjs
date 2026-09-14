import puppeteer from 'puppeteer';
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const logs = [];
    page.on('console', msg => logs.push('[' + msg.type() + '] ' + msg.text()));
    page.on('pageerror', err => logs.push('[PAGEERROR] ' + err.message));
    
    await page.goto('https://panobianco-pdv-erp.vercel.app/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(e => logs.push('[NAV] ' + e.message));
    await new Promise(r => setTimeout(r, 4000));
    
    const check = await page.evaluate(() => ({
        appExists: typeof window.app !== 'undefined',
        appKeys: typeof window.app !== 'undefined' ? Object.keys(window.app).length : 0,
        windowAdapter: typeof window.supabaseAdapter !== 'undefined',
        adapterConnected: typeof window.supabaseAdapter !== 'undefined' ? window.supabaseAdapter.isConnected : null,
        windowConfig: typeof window.SUPABASE_CONFIG !== 'undefined',
        syncBadge: document.getElementById('sync-status-badge')?.innerText || null,
    }));
    
    console.log(JSON.stringify(check, null, 2));
    logs.filter(l => l.includes('Supabase') || l.includes('Realtime') || l.includes('INIT')).forEach(l => console.log(l));
    
    await browser.close();
})();
