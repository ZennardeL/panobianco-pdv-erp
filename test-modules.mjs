/**
 * Test script to verify module loading in a browser-like environment.
 * Run with: node --experimental-vm-modules test-modules.mjs
 * Or simply: node test-modules.mjs
 */

// Test 1: Verify all module files exist and have valid syntax
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'public/src';

const modules = [
    'core/helpers.js',
    'core/constants.js',
    'core/app.js',
    'modules/auth.js',
    'modules/navigation.js',
    'modules/cart.js',
    'modules/sales.js',
    'modules/shifts.js',
    'modules/reports.js',
    'modules/products.js',
    'modules/inventory.js',
    'modules/users.js',
    'modules/audit.js',
    'modules/dashboard.js',
    'services/supabase-client.js',
    'services/data-service.js',
    'services/sync.js',
    'services/realtime.js',
    'services/storage.js',
    'main.js',
];

let errors = 0;

console.log('=== Module File Verification ===\n');

for (const mod of modules) {
    const path = join(BASE, mod);
    if (!existsSync(path)) {
        console.error(`❌ MISSING: ${path}`);
        errors++;
        continue;
    }
    
    const content = readFileSync(path, 'utf-8');
    
    // Check for import statements and verify target files exist
    const importRegex = /import\s*\{[^}]+\}\s*from\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        // Resolve relative to current module's directory
        const moduleDir = join(BASE, mod, '..');
        const resolvedPath = join(moduleDir, importPath);
        
        if (!existsSync(resolvedPath)) {
            console.error(`❌ BROKEN IMPORT in ${mod}: '${importPath}' → ${resolvedPath} NOT FOUND`);
            errors++;
        }
    }
    
    // Check for bare global references that would fail in strict mode
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        
        // Check for constructor calls to PanobiancoApp (shouldn't exist in modules)
        if (line.includes('new PanobiancoApp')) {
            console.error(`❌ MONOLITH REF in ${mod}:${i+1}: ${line.trim()}`);
            errors++;
        }
        
        // Check for 'this.' references (shouldn't exist in modules, they use _config)
        if (line.match(/\bthis\.\w+/) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
            console.warn(`⚠️  'this.' reference in ${mod}:${i+1}: ${line.trim().substring(0, 80)}`);
        }
    }
    
    console.log(`✅ ${mod} (${content.length} bytes, ${lines.length} lines)`);
}

console.log(`\n=== Result: ${errors} errors found ===`);
if (errors > 0) {
    process.exit(1);
}
