/**
 * Configurações de Conexão com o Supabase
 * 
 * Substitua os valores abaixo pelas credenciais do seu projeto Supabase:
 * Encontradas em: Project Settings > API (Project URL & anon public key)
 */
const SUPABASE_CONFIG = {
    // Exemplo: 'https://xyzcompany.supabase.co'
    url: window.SUPABASE_URL || localStorage.getItem('panobianco_supabase_url') || 'https://SUA-URL-DO-PROJETO.supabase.co',
    
    // Exemplo: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    anonKey: window.SUPABASE_ANON_KEY || localStorage.getItem('panobianco_supabase_key') || 'SUA-ANON-KEY-AQUI',
    
    tenantId: 'default'
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SUPABASE_CONFIG;
}
