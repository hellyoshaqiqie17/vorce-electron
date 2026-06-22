const fs = require('fs');
const path = require('path');

let addon = null;
let loadError = null;
let resolvedPath = "";
let isStub = true; // Assume stub until proven otherwise

try {
  resolvedPath = require.resolve('./build/Release/wifi_native.node');
} catch (err) {
  loadError = err;
}

if (resolvedPath) {
  try {
    addon = require(resolvedPath);
    isStub = false; // Real native binary loaded successfully
  } catch (err) {
    loadError = err;
  }
}

// Fallback stub if real addon failed to load
if (!addon) {
  addon = {
    getSSID: () => null
  };
  isStub = true;
}

module.exports = {
  getSSID: addon.getSSID,
  loadError: loadError,
  resolvedPath: resolvedPath,
  isStub: isStub
};
