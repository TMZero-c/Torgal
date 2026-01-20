/**
 * Simple persistent JSON store for app settings.
 * Stores settings in the user data directory.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class Store {
    constructor(options = {}) {
        // Get the user data path from Electron
        const userDataPath = app.getPath('userData');
        this.path = path.join(userDataPath, options.configName ? `${options.configName}.json` : 'settings.json');
        this.data = this._loadData(options.defaults || {});
    }

    _loadData(defaults) {
        try {
            if (fs.existsSync(this.path)) {
                const data = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
                // Merge with defaults to ensure new keys are present
                return { ...defaults, ...data };
            }
        } catch (e) {
            console.error('[Store] Failed to load settings:', e);
        }
        return defaults;
    }

    get(key, defaultValue = undefined) {
        const keys = key.split('.');
        let value = this.data;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        return value;
    }

    set(key, value) {
        const keys = key.split('.');
        let obj = this.data;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in obj) || typeof obj[k] !== 'object') {
                obj[k] = {};
            }
            obj = obj[k];
        }
        obj[keys[keys.length - 1]] = value;
        this._save();
    }

    setAll(obj) {
        this.data = { ...this.data, ...obj };
        this._save();
    }

    getAll() {
        return { ...this.data };
    }

    _save() {
        try {
            fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('[Store] Failed to save settings:', e);
        }
    }
}

module.exports = Store;
