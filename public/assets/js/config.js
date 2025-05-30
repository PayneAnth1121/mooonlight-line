
// public/assets/js/config.js - Environment configuration
window.AppConfig = {
    // API Configuration
    API_BASE_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:3000/api'  // Local development
        : '/api',                      // Production (relative path)
    
    // Feature flags
    FEATURES: {
        ENABLE_FALLBACK_DATA: true,
        ENABLE_DEBUG_LOGGING: window.location.hostname === 'localhost',
        ENABLE_OFFLINE_MODE: true,
        AUTO_SAVE_TEAMS: true
    },
    
    // App constants
    CONSTANTS: {
        MAX_PLAYERS_PER_TEAM: 10,
        MAX_STARTERS: 5,
        MAX_BENCH: 10,
        POINTS_FORMULA: {
            REBOUNDS: 1,
            TWO_POINTS: 2,
            THREE_POINTS: 3,
            FREE_THROWS: 1,
            ASSISTS: 1,
            BLOCKS: 2,
            VICTORY_BONUS: 5
        }
    },
    
    // UI Configuration
    UI: {
        ANIMATION_DURATION: 300,
        TOAST_DURATION: 5000,
        AUTO_REFRESH_INTERVAL: 30000, // 30 seconds
        DEBOUNCE_DELAY: 500
    },
    
    // Error messages
    ERRORS: {
        NETWORK_ERROR: 'Network connection failed. Please check your internet connection.',
        API_ERROR: 'Server is temporarily unavailable. Please try again later.',
        AUTH_ERROR: 'Authentication failed. Please login again.',
        VALIDATION_ERROR: 'Please check your input and try again.',
        UNKNOWN_ERROR: 'An unexpected error occurred. Please refresh the page.'
    },
    
    // Success messages
    MESSAGES: {
        SAVE_SUCCESS: 'Changes saved successfully!',
        LOAD_SUCCESS: 'Data loaded successfully!',
        DELETE_SUCCESS: 'Item deleted successfully!',
        UPDATE_SUCCESS: 'Updated successfully!'
    }
};

// Utility functions
window.AppUtils = {
    // API call wrapper with error handling
    async apiCall(endpoint, options = {}) {
        const url = `${window.AppConfig.API_BASE_URL}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        // Add auth token if available
        const token = localStorage.getItem('authToken');
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const response = await fetch(url, { ...defaultOptions, ...options });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },
    
    // Show toast notification
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: ${type === 'error' ? 'rgba(255, 107, 107, 0.9)' : type === 'success' ? 'rgba(0, 255, 128, 0.9)' : 'rgba(0, 240, 255, 0.9)'};
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            z-index: 10000;
            font-family: 'Orbitron', sans-serif;
            font-size: 0.9rem;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 100);
        
        // Auto remove
        setTimeout(() => {
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, window.AppConfig.UI.TOAST_DURATION);
    },
    
    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Format date
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },
    
    // Format number with commas
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    
    // Calculate fantasy points
    calculateFantasyPoints(stats) {
        const formula = window.AppConfig.CONSTANTS.POINTS_FORMULA;
        return (
            (stats.rebounds || 0) * formula.REBOUNDS +
            (stats.two_points || 0) * formula.TWO_POINTS +
            (stats.three_points || 0) * formula.THREE_POINTS +
            (stats.free_throws || 0) * formula.FREE_THROWS +
            (stats.assists || 0) * formula.ASSISTS +
            (stats.blocks || 0) * formula.BLOCKS +
            (stats.victories ? formula.VICTORY_BONUS : 0)
        );
    },
    
    // Validate form data
    validateFormData(data, rules) {
        const errors = {};
        
        for (const field in rules) {
            const rule = rules[field];
            const value = data[field];
            
            if (rule.required && (!value || value.toString().trim() === '')) {
                errors[field] = `${field} is required`;
            }
            
            if (value && rule.minLength && value.toString().length < rule.minLength) {
                errors[field] = `${field} must be at least ${rule.minLength} characters`;
            }
            
            if (value && rule.maxLength && value.toString().length > rule.maxLength) {
                errors[field] = `${field} must be no more than ${rule.maxLength} characters`;
            }
            
            if (value && rule.pattern && !rule.pattern.test(value)) {
                errors[field] = rule.message || `${field} format is invalid`;
            }
        }
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    },
    
    // Local storage helpers
    storage: {
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch {
                return defaultValue;
            }
        },
        
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        
        remove(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch {
                return false;
            }
        }
    }
};

// Global error handler
window.addEventListener('error', function(event) {
    if (window.AppConfig.FEATURES.ENABLE_DEBUG_LOGGING) {
        console.error('Global error:', event.error);
    }
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', function(event) {
    if (window.AppConfig.FEATURES.ENABLE_DEBUG_LOGGING) {
        console.error('Unhandled promise rejection:', event.reason);
    }
    event.preventDefault();
});

console.log('🚀 Moonlight Line App Configuration Loaded');
console.log('Environment:', window.AppConfig);