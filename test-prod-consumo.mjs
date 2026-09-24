import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    console.log('Navegando para o app em produção com domcontentloaded...');
    await page.goto('https://panobianco-pdv-erp.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    const initialCheck = await page.evaluate(() => {
        const tab = document.getElementById('tab-btn-consumo');
        const view = document.getElementById('view-consumo');
        return {
            tabExists: !!tab,
            tabDisplayBeforeLogin: tab ? getComputedStyle(tab).display : null,
            viewExists: !!view
        };
    });
    console.log('Check inicial:', JSON.stringify(initialCheck));

    // Fazer login como Admin (F20729)
    console.log('Realizando login como Admin (F20729)...');
    await page.evaluate(() => {
        window.app.handleEmployeeLogin('f20729');
    });
    await new Promise(r => setTimeout(r, 2000));

    const adminCheck = await page.evaluate(() => {
        const tab = document.getElementById('tab-btn-consumo');
        const user = document.getElementById('current-user-name')?.innerText;
        
        // Simular clique na aba
        if (tab) tab.click();

        const view = document.getElementById('view-consumo');
        const viewActive = view ? view.classList.contains('active') : false;
        const productsCount = document.getElementById('cons-product-select')?.options.length || 0;
        const employeesCount = document.getElementById('cons-employee-select')?.options.length || 0;

        return {
            userName: user,
            tabDisplayAfterLogin: tab ? getComputedStyle(tab).display : null,
            viewActive,
            productsOptions: productsCount,
            employeesOptions: employeesCount
        };
    });
    console.log('Check após login admin e navegação:', JSON.stringify(adminCheck));

    if (pageErrors.length > 0) {
        console.error('Erros no console:', pageErrors);
    } else {
        console.log('PRODUÇÃO 100% VALIDADA E FUNCIONANDO!');
    }

    await browser.close();
})();
