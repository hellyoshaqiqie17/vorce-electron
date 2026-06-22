const fs = require('fs');
const path = require('path');

let addon = null;
let loadError = null;
let resolvedPath = "";

try {
  resolvedPath = require.resolve('./build/Release/wifi_native.node');
} catch (err) {
  loadError = err;
}

if (resolvedPath) {
  try {
    addon = require(resolvedPath);
  } catch (err) {
    loadError = err;
  }
}

// Fallback stub if load failed
if (!addon) {
  addon = {
    getSSID: () => null
  };
}

module.exports = {
  getSSID: addon.getSSID,
  loadError: loadError,
  resolvedPath: resolvedPath
};
