// public/assets/js/team-utils.js - TEAM LOGO UTILITIES WITH DEBUGGING
/**
 * Mapea el nombre del equipo al archivo del logo correspondiente
 */
function getTeamLogoPath(teamName) {
    console.log('Getting logo for team:', teamName); // Debug
    
    if (!teamName) {
        console.log('No team name provided, using default');
        return '/assets/images/logos/warriors.png'; // Usar un logo existente como default
    }
    
    // Normalizar el nombre del equipo (quitar espacios extra, convertir a mayúsculas)
    const normalizedTeam = teamName.trim().toUpperCase();
    
    const teamLogoMap = {
        'ANGEL BEES': '/assets/images/logos/angelbee.png',
        'WARRIORS': '/assets/images/logos/warriors.png',
        'TMT': '/assets/images/logos/tmt.png',
        'TITANS': '/assets/images/logos/titans.png',
        'RAPTORS': '/assets/images/logos/raptors.png',
        'ARMONIA': '/assets/images/logos/armonia.png'
    };
    
    const logoPath = teamLogoMap[normalizedTeam] || '/assets/images/logos/warriors.png';
    console.log('Team:', normalizedTeam, 'Logo path:', logoPath); // Debug
    
    return logoPath;
}

/**
 * Obtiene el color principal del equipo para efectos visuales
 */
function getTeamColor(teamName) {
    if (!teamName) return '#ff8c00';
    
    const normalizedTeam = teamName.trim().toUpperCase();
    
    const teamColorMap = {
        'ANGEL BEES': '#FFD700', // Dorado
        'WARRIORS': '#1D428A', // Azul Warriors
        'TMT': '#CE1141', // Rojo
        'TITANS': '#002B5C', // Azul oscuro
        'RAPTORS': '#CE1141', // Rojo Raptors
        'ARMONIA': '#00788C' // Verde azulado
    };
    
    return teamColorMap[normalizedTeam] || '#ff8c00'; // Naranja por defecto
}

/**
 * Crea el HTML para mostrar el logo del equipo en la carta del jugador
 */
function createTeamLogoElement(teamName, playerName) {
    const logoPath = getTeamLogoPath(teamName);
    const teamColor = getTeamColor(teamName);
    
    return `
        <div class="team-logo-container" style="border-color: ${teamColor};">
            <img src="${logoPath}" alt="${teamName} Logo" class="team-logo" 
                 onerror="this.src='/assets/images/logos/warriors.png'; console.log('Error loading logo for ${teamName}');">
            <div class="team-logo-overlay" style="background: linear-gradient(45deg, ${teamColor}22, ${teamColor}11);"></div>
        </div>
    `;
}

// Hacer las funciones globalmente disponibles
window.getTeamLogoPath = getTeamLogoPath;
window.getTeamColor = getTeamColor;
window.createTeamLogoElement = createTeamLogoElement;

console.log('Team utils loaded successfully'); // Debug