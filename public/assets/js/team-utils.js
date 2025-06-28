// public/assets/js/team-utils.js - SIMPLIFIED WITH EXTENSIVE DEBUGGING
console.log('🚀 Team utils file loading...');

/**
 * Mapea el nombre del equipo al archivo del logo correspondiente
 */
function getTeamLogoPath(teamName) {
    console.log('🔍 getTeamLogoPath called with:', teamName, typeof teamName);
    
    if (!teamName) {
        console.log('❌ No team name provided, using warriors as default');
        return '/assets/images/logos/warriors.png';
    }
    
    // Limpiar y normalizar el nombre del equipo
    const cleanTeam = String(teamName).trim();
    console.log('🧹 Cleaned team name:', cleanTeam);
    
    // Mapping exacto basado en los nombres de la base de datos
    const teamLogoMap = {
        'Angel Bees': '/assets/images/logos/angelbee.png',
        'Warriors': '/assets/images/logos/warriors.png',
        'TMT': '/assets/images/logos/tmt.png',
        'Titans': '/assets/images/logos/titans.png',
        'Raptors': '/assets/images/logos/raptors.png',
        'Armonia': '/assets/images/logos/armonia.png'
    };
    
    const logoPath = teamLogoMap[cleanTeam] || '/assets/images/logos/warriors.png';
    console.log('✅ Logo path result:', logoPath);
    
    return logoPath;
}

/**
 * Obtiene el color principal del equipo
 */
function getTeamColor(teamName) {
    if (!teamName) return '#ff8c00';
    
    const teamColorMap = {
        'Angel Bees': '#FFD700',
        'Warriors': '#1D428A', 
        'TMT': '#CE1141',
        'Titans': '#002B5C',
        'Raptors': '#CE1141',
        'Armonia': '#00788C'
    };
    
    return teamColorMap[String(teamName).trim()] || '#ff8c00';
}

// Hacer las funciones globalmente disponibles
window.getTeamLogoPath = getTeamLogoPath;
window.getTeamColor = getTeamColor;

console.log('✅ Team utils loaded successfully!');
console.log('🔧 Functions available:', {
    getTeamLogoPath: typeof getTeamLogoPath,
    getTeamColor: typeof getTeamColor
});