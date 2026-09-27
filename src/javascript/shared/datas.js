window.localISODate = function localISODate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

if (typeof module !== 'undefined' && module.exports) module.exports = { localISODate: window.localISODate };
