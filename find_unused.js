const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDirs = ['Code', 'App.js'];
const basePath = path.resolve(__dirname);

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.js') || file.endsWith('.jsx')) {
          arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

const allFiles = getAllFiles(path.join(basePath, 'Code'));
const unusedFiles = [];

for (const file of allFiles) {
  const ext = path.extname(file);
  const baseName = path.basename(file, ext);

  // Skip common utils or index files just in case
  if (baseName === 'index' || baseName === 'style' || baseName === 'themeColors' || baseName === 'colors') continue;
  if (file.includes('Helper') || file.includes('Firebase') || file.includes('Ads')) continue; // Skip helpers

  // Use ripgrep to search for the baseName import
  // `rg -lw "baseName" Code/ App.js`
  try {
    const result = execSync(`rg -l -w "${baseName}" Code App.js`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const matchingFiles = result.trim().split('\n').filter(Boolean);

    // If it only matches itself, or no matches, it's unused
    const otherFiles = matchingFiles.filter(m => !file.endsWith(m));
    if (otherFiles.length === 0) {
      unusedFiles.push(file.replace(basePath + '/', ''));
    }
  } catch (err) {
    // If rg fails, it means 0 matches found
    unusedFiles.push(file.replace(basePath + '/', ''));
  }
}

console.log("Potentially unused components:");
console.log(unusedFiles.join('\n'));
