// public/assets/js/team-utils.js - TEAM LOGO UTILITIES
/**
 * Mapea el nombre del equipo al archivo del logo correspondiente
 */
function getTeamLogoPath(teamName) {
    if (!teamName) return '/assets/images/logos/default-team.png';
    
    const teamLogoMap = {
        'Angel Bees': '/assets/images/logos/angelbee.png',
        'Warriors': '/assets/images/logos/warriors.png',
        'TMT': '/assets/images/logos/tmt.png',
        'Titans': '/assets/images/logos/titans.png',
        'Raptors': '/assets/images/logos/raptors.png',
        'Armonia': '/assets/images/logos/armonia.png'
    };
    
    return teamLogoMap[teamName] || '/assets/images/logos/default-team.png';
}

/**
 * Obtiene el color principal del equipo para efectos visuales
 */
function getTeamColor(teamName) {
    const teamColorMap = {
        'Angel Bees': '#FFD700', // Dorado
        'Warriors': '#1D428A', // Azul Warriors
        'TMT': '#CE1141', // Rojo
        'Titans': '#002B5C', // Azul oscuro
        'Raptors': '#CE1141', // Rojo Raptors
        'Armonia': '#00788C' // Verde azulado
    };
    
    return teamColorMap[teamName] || '#ff8c00'; // Naranja por defecto
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
                 onerror="this.src='/assets/images/logos/default-team.png'">
            <div class="team-logo-overlay" style="background: linear-gradient(45deg, ${teamColor}22, ${teamColor}11);"></div>
        </div>
    `;
}

// Hacer las funciones globalmente disponibles
window.getTeamLogoPath = getTeamLogoPath;
window.getTeamColor = getTeamColor;
window.createTeamLogoElement = createTeamLogoElement;