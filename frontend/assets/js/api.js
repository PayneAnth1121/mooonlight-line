// API URL
const BASE_URL = 'http://localhost:3000/api';

/**
 * Clase para manejar las llamadas a la API
 */
class ApiService {
    /**
     * Obtener token de autenticación del localStorage
     */
    static getAuthToken() {
        return localStorage.getItem('authToken') || '';
    }
    
    /**
     * Verificar si el usuario está loggeado
     */
    static isUserLoggedIn() {
        return localStorage.getItem('authToken') !== null;
    }
    
    /**
     * Obtener ID del usuario actual
     */
    static getCurrentUserId() {
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        return userData.id;
    }
    
    /**
     * Realizar petición HTTP genérica
     */
    static async fetchData(endpoint, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        
        // Añadir headers por defecto
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        // Añadir token de autenticación si existe
        if (this.isUserLoggedIn()) {
            headers['Authorization'] = `Bearer ${this.getAuthToken()}`;
        }
        
        try {
            const response = await fetch(url, {
                ...options,
                headers
            });
            
            // Si la respuesta no es exitosa, lanzar error
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'API request failed');
            }
            
            // Devolver datos si la respuesta es exitosa
            return await response.json();
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    }
    
    /**
     * Iniciar sesión
     */
    static async login(username, password) {
        const data = await this.fetchData('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        // Guardar datos de sesión
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(data.user));
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('currentUser', JSON.stringify({
            id: data.user.id,
            username: data.user.username,
            teamName: data.user.team_name,
            email: data.user.email
        }));
        
        return data;
    }
    
    /**
     * Registrar nuevo usuario
     */
    static async register(username, email, password, teamName) {
        const data = await this.fetchData('/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                username,
                email,
                password,
                team_name: teamName
            })
        });
        
        // Guardar datos de sesión
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userData', JSON.stringify(data.user));
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('currentUser', JSON.stringify({
            id: data.user.id,
            username: data.user.username,
            teamName: data.user.team_name,
            email: data.user.email
        }));
        
        return data;
    }
    
    /**
     * Cerrar sesión
     */
    static logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        localStorage.removeItem('loggedIn');
        localStorage.removeItem('currentUser');
    }
    
    /**
     * Obtener leaderboard
     */
    static async getLeaderboard(jornadaId = null) {
        let endpoint = '/leaderboard';
        if (jornadaId) {
            endpoint += `?jornada_id=${jornadaId}`;
        }
        
        return await this.fetchData(endpoint);
    }
    
    /**
     * Obtener estadísticas del usuario
     */
    static async getUserStats(jornadaId = null) {
        let endpoint = '/user-stats';
        if (jornadaId) {
            endpoint += `?jornada_id=${jornadaId}`;
        }
        
        return await this.fetchData(endpoint);
    }
    
    /**
     * Obtener lista de jornadas
     */
    static async getJornadas() {
        return await this.fetchData('/admin/jornadas');
    }
    
    /**
     * Crear una nueva jornada
     */
    static async createJornada(weekNumber, startDate, endDate, isCurrent = false) {
        return await this.fetchData('/admin/jornadas', {
            method: 'POST',
            body: JSON.stringify({
                week_number: weekNumber,
                start_date: startDate,
                end_date: endDate,
                is_current: isCurrent
            })
        });
    }
    
    /**
     * Actualizar una jornada
     */
    static async updateJornada(id, weekNumber, startDate, endDate, isCurrent, isCompleted) {
        return await this.fetchData(`/admin/jornadas/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                week_number: weekNumber,
                start_date: startDate,
                end_date: endDate,
                is_current: isCurrent,
                is_completed: isCompleted
            })
        });
    }
    
    /**
     * Eliminar una jornada
     */
    static async deleteJornada(id) {
        return await this.fetchData(`/admin/jornadas/${id}`, {
            method: 'DELETE'
        });
    }
    
    /**
     * Obtener estadísticas de jugadores para una jornada
     */
    static async getPlayerStats(jornadaId) {
        return await this.fetchData(`/admin/player-stats/${jornadaId}`);
    }
    
    /**
     * Guardar estadísticas de jugadores
     */
    static async savePlayerStats(jornadaId, stats) {
        return await this.fetchData('/admin/player-stats', {
            method: 'POST',
            body: JSON.stringify({
                jornada_id: jornadaId,
                stats: stats
            })
        });
    }
    
    /**
     * Obtener equipos de usuarios para una jornada
     */
    static async getUserTeams(jornadaId) {
        return await this.fetchData(`/admin/user-teams/${jornadaId}`);
    }
}

// Exportar para uso en otros archivos
window.ApiService = ApiService;