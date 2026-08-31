const fs = require('fs');
const path = require('path');
const dbModule = require('./db.js');

const DB_JSON_PATH = path.join(__dirname, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'products');

function migrate() {
    console.log('Iniciando migração do database.json para SQLite...');
    
    if (!fs.existsSync(DB_JSON_PATH)) {
        console.error('Erro: database.json não encontrado!');
        process.exit(1);
    }
    
    const rawData = fs.readFileSync(DB_JSON_PATH, 'utf-8');
    const data = JSON.parse(rawData);
    
    // 2. Call db.initDatabase()
    const db = dbModule.initDatabase();
    const sqlite = dbModule.getDb();
    
    let stats = {
        users: 0,
        products: 0,
        photos: 0,
        sales: 0,
        saleItems: 0,
        saleCounter: data.saleCounter || 0
    };
    
    const migrateTxn = sqlite.transaction(() => {
        // 3. Migrate users
        const users = data.users || [];
        let leticiaFound = false;
        
        for (const u of users) {
            // Fix encoding issue
            if (u.name && u.name.includes('Letcia')) {
                u.name = u.name.replace('Letcia', 'Letícia');
            }
            if (u.code && u.code.toLowerCase() === 'f30188') {
                u.name = 'Letícia Santos';
                leticiaFound = true;
            }
            
            const userToSave = { ...u };
            delete userToSave.pin; // Remove pin field
            
            dbModule.upsertUser(userToSave, 'default'); // Set tenant_id = 'default' inside
            stats.users++;
        }
        
        // Ensure f30188 exists if not found in users array
        if (!leticiaFound) {
            dbModule.upsertUser({
                id: 'f30188',
                code: 'f30188',
                name: 'Letícia Santos',
                role: 'OPERADOR',
                title: 'Recepção',
                avatar: '👤'
            }, 'default');
            stats.users++;
        }

        // 4. Migrate products
        const products = data.products || [];
        for (const p of products) {
            const productToSave = { ...p };
            
            if (p.image && p.image.startsWith('data:image')) {
                const base64Data = p.image.replace(/^data:image\/\w+;base64,/, '');
                const relPath = `uploads/products/${p.id}.jpg`;
                const absPath = path.join(__dirname, relPath);
                
                if (!fs.existsSync(UPLOADS_DIR)) {
                    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
                }
                
                fs.writeFileSync(absPath, base64Data, 'base64');
                productToSave.imagePath = relPath;
                stats.photos++;
            }
            
            dbModule.upsertProduct(productToSave, 'default');
            stats.products++;
        }

        // 5. Migrate shifts & activeShift
        const shifts = data.shifts || [];
        for (const s of shifts) {
            const shiftCode = s.shiftCode || s.id;
            sqlite.prepare(`
                INSERT INTO shifts (id, tenant_id, shift_code, operator_id, operator_name, start_time, end_time, status)
                VALUES (?, 'default', ?, ?, ?, ?, ?, 'CLOSED')
                ON CONFLICT(id) DO NOTHING
            `).run(s.id, shiftCode, s.operatorId, s.operatorName, s.startTime || new Date().toISOString(), s.endTime || new Date().toISOString());
        }

        if (data.activeShift && data.activeShift.id) {
            const s = data.activeShift;
            const shiftCode = s.shiftCode || s.id;
            sqlite.prepare(`
                INSERT INTO shifts (id, tenant_id, shift_code, operator_id, operator_name, start_time, status)
                VALUES (?, 'default', ?, ?, ?, ?, 'OPEN')
                ON CONFLICT(id) DO NOTHING
            `).run(s.id, shiftCode, s.operatorId, s.operatorName, s.startTime || new Date().toISOString());
        }

        // 6. Migrate Counters
        sqlite.prepare(`
            INSERT INTO counters (tenant_id, key, value) VALUES ('default', 'sale_counter', ?)
            ON CONFLICT(tenant_id, key) DO UPDATE SET value = ?
        `).run(data.saleCounter || 0, data.saleCounter || 0);

        // 7. Migrate sales
        const sales = data.sales || [];
        const insertSale = sqlite.prepare(`
            INSERT INTO sales (id, tenant_id, seq, operator_id, operator_name, operator_code,
                               payment_method, total, cost, profit, status, shift_id, created_at)
            VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `);
        
        const insertItem = sqlite.prepare(`
            INSERT INTO sale_items (sale_id, tenant_id, product_id, product_name, qty, unit_price, unit_cost)
            VALUES (?, 'default', ?, ?, ?, ?, ?)
        `);
        
        for (const sale of sales) {
            // Fix encoding in operator name
            let opName = sale.operatorName;
            if (opName && opName.includes('Letcia')) {
                opName = opName.replace('Letcia', 'Letícia');
            }

            let shiftId = null;
            if (data.activeShift && data.activeShift.sales && data.activeShift.sales.some(s => s.id === sale.id)) {
                shiftId = data.activeShift.id;
            }

            const info = insertSale.run(
                sale.id, sale.seq || 0, sale.operatorId, opName, sale.operatorCode,
                sale.paymentMethod, sale.total, sale.cost || 0, sale.profit || 0,
                sale.status || 'CONCLUIDA', shiftId, sale.timestamp || new Date().toISOString()
            );

            // Insert items only if sale was successfully inserted
            if (info.changes > 0) {
                stats.sales++;
                const items = sale.items || [];
                for (const item of items) {
                    insertItem.run(sale.id, item.productId, item.name, item.qty, item.price, item.cost || 0);
                    stats.saleItems++;
                }
            }
        }
    });

    try {
        migrateTxn();
        console.log('\n=== Resumo da Migração ===');
        console.log(`Usuários migrados: ${stats.users}`);
        console.log(`Produtos migrados: ${stats.products}`);
        console.log(`Fotos extraídas: ${stats.photos}`);
        console.log(`Vendas migradas: ${stats.sales}`);
        console.log(`Itens de venda: ${stats.saleItems}`);
        console.log(`Contador de vendas (saleCounter): ${stats.saleCounter}`);
        console.log('Migração concluída com sucesso!');
    } catch (err) {
        console.error('Erro na migração:', err);
    } finally {
        dbModule.closeDatabase();
    }
}

migrate();
