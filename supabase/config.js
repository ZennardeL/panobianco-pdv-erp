/**
 * Configurações de Conexão com o Supabase
 * 
 * Substitua os valores abaixo pelas credenciais do seu projeto Supabase:
 * Encontradas em: Project Settings > API (Project URL & anon public key)
 */
const SUPABASE_CONFIG = {
    url: window.SUPABASE_URL || localStorage.getItem('panobianco_supabase_url') || 'https://jawrukqnncnjgzixjaqy.supabase.co',
    anonKey: window.SUPABASE_ANON_KEY || localStorage.getItem('panobianco_supabase_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphd3J1a3FubmNuamd6aXhqYXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODc1NDksImV4cCI6MjEwMzg2MzU0OX0.U8GsG32Msjeu3YZwFhOErFdS2qJ7maYcH4FF07bTHKw',
    tenantId: 'default'
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SUPABASE_CONFIG;
}
