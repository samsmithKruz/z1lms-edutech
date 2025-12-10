#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const exists = promisify(fs.exists);

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function logSuccess(message) {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

async function getRegistry() {
  try {
    // Read .edutechrc for registry URL
    const configContent = await readFile('.edutechrc', 'utf8');
    const config = JSON.parse(configContent);
    
    logInfo('Fetching portal registry...');
    const registry = await fetchJSON(config.registryUrl);
    
    // Cache the registry locally
    await writeFile('portal-registry-cache.json', JSON.stringify({
      ...registry,
      lastFetched: new Date().toISOString()
    }, null, 2));
    
    return registry;
  } catch (error) {
    logWarning(`Failed to fetch registry: ${error.message}`);
    logInfo('Using cached registry...');
    
    // Try to use cached registry
    if (await exists('portal-registry-cache.json')) {
      const cache = await readFile('portal-registry-cache.json', 'utf8');
      return JSON.parse(cache);
    }
    
    throw new Error('No registry available. Check your internet connection.');
  }
}

async function addPortal(portalName, theme = 'default') {
  console.log(`\n${colors.cyan}🚀 Adding portal: ${portalName} (${theme} theme)${colors.reset}\n`);
  
  // 1. Validate portal name
  if (!portalName.match(/^[a-z0-9-]+$/)) {
    logError('Portal name can only contain lowercase letters, numbers, and hyphens');
    process.exit(1);
  }
  
  // 2. Check if portal already exists
  const portalPath = `portals/${portalName}`;
  if (await exists(portalPath)) {
    logError(`Portal "${portalName}" already exists at ${portalPath}`);
    logInfo('Use: pnpm run portal:update to update existing portal');
    process.exit(1);
  }
  
  // 3. Fetch registry
  let registry;
  try {
    registry = await getRegistry();
  } catch (error) {
    logError(error.message);
    process.exit(1);
  }
  
  // 4. Find portal in registry
  if (!registry.portals || !registry.portals[portalName]) {
    logError(`Portal "${portalName}" not found in registry`);
    
    // Show available portals
    if (registry.portals) {
      console.log(`\n${colors.yellow}Available portals:${colors.reset}`);
      Object.keys(registry.portals).forEach(name => {
        const portal = registry.portals[name];
        console.log(`  ${colors.cyan}${name}${colors.reset}: ${portal.description || 'No description'}`);
        if (portal.themes) {
          console.log(`    Themes: ${Object.keys(portal.themes).join(', ')}`);
        }
      });
    }
    
    process.exit(1);
  }
  
  const portalInfo = registry.portals[portalName];
  
  // 5. Get theme repo URL
  if (!portalInfo.themes || !portalInfo.themes[theme]) {
    logError(`Theme "${theme}" not available for portal "${portalName}"`);
    
    if (portalInfo.themes) {
      console.log(`\n${colors.yellow}Available themes for ${portalName}:${colors.reset}`);
      Object.keys(portalInfo.themes).forEach(themeName => {
        console.log(`  ${colors.green}${themeName}${colors.reset}`);
      });
    }
    
    process.exit(1);
  }
  
  let repoUrl = portalInfo.themes[theme];
  
  // Handle shorthand repo URLs (user/repo)
  if (!repoUrl.includes('://') && !repoUrl.startsWith('git@')) {
    repoUrl = `https://github.com/${repoUrl}`;
  }
  
  // 6. Use degit to clone (install degit if not available)
  logInfo(`Cloning from: ${repoUrl}`);
  
  try {
    // Check if degit is available
    execSync('npx degit --version', { stdio: 'pipe' });
  } catch (error) {
    logInfo('Installing degit...');
    execSync('npm install -g degit', { stdio: 'pipe' });
  }
  
  // Clone with degit
  try {
    execSync(`npx degit ${repoUrl} ${portalPath}`, { stdio: 'inherit' });
    logSuccess('Cloned successfully');
  } catch (error) {
    // Try alternative: git clone without history
    logWarning('Degit failed, trying git clone...');
    try {
      execSync(`git clone --depth 1 ${repoUrl} temp-clone-${portalName}`, { stdio: 'pipe' });
      
      // Remove .git folder
      const gitPath = path.join(`temp-clone-${portalName}`, '.git');
      if (await exists(gitPath)) {
        fs.rmSync(gitPath, { recursive: true, force: true });
      }
      
      // Move to portals directory
      if (await exists(portalPath)) {
        fs.rmSync(portalPath, { recursive: true, force: true });
      }
      fs.renameSync(`temp-clone-${portalName}`, portalPath);
      
      logSuccess('Cloned with git (history removed)');
    } catch (gitError) {
      // Cleanup
      if (await exists(`temp-clone-${portalName}`)) {
        fs.rmSync(`temp-clone-${portalName}`, { recursive: true, force: true });
      }
      if (await exists(portalPath)) {
        fs.rmSync(portalPath, { recursive: true, force: true });
      }
      
      logError(`Failed to clone repository: ${gitError.message}`);
      process.exit(1);
    }
  }
  
  // 7. Save portal metadata
  const portalConfig = {
    name: portalName,
    theme: theme,
    repo: repoUrl,
    version: portalInfo.version || '1.0.0',
    installedAt: new Date().toISOString(),
    source: 'registry'
  };
  
  await writeFile(
    path.join(portalPath, '.portal-config.json'),
    JSON.stringify(portalConfig, null, 2)
  );
  
  // 8. Update root package.json workspaces
  try {
    const rootPkgPath = 'package.json';
    const rootPkgContent = await readFile(rootPkgPath, 'utf8');
    const rootPkg = JSON.parse(rootPkgContent);
    
    if (!rootPkg.workspaces) {
      rootPkg.workspaces = [];
    }
    
    if (!rootPkg.workspaces.includes(`portals/${portalName}`)) {
      rootPkg.workspaces.push(`portals/${portalName}`);
      await writeFile(rootPkgPath, JSON.stringify(rootPkg, null, 2));
      logSuccess('Updated workspaces configuration');
    }
  } catch (error) {
    logWarning(`Could not update workspaces: ${error.message}`);
  }
  
  // 9. Update ecosystem.config.js if it exists
  if (await exists('ecosystem.config.js')) {
    try {
      const ecosystemContent = await readFile('ecosystem.config.js', 'utf8');
      let apps = [];
      
      // Parse existing apps
      const appsMatch = ecosystemContent.match(/module\.exports\s*=\s*{\s*apps:\s*(\[.*?\])\s*}/s);
      if (appsMatch) {
        try {
          apps = eval(`(${appsMatch[1]})`);
        } catch (e) {
          apps = [];
        }
      }
      
      // Find next available port
      let nextPort = 3000;
      if (apps.length > 0) {
        const lastPort = apps[apps.length - 1].env?.PORT;
        if (lastPort) {
          nextPort = parseInt(lastPort) + 1;
        }
      }
      
      // Add new app
      apps.push({
        name: `${portalName}-portal`,
        cwd: `./portals/${portalName}`,
        script: 'npm',
        args: 'run dev',
        env: {
          PORT: nextPort,
          NODE_ENV: 'development'
        }
      });
      
      // Write updated config
      const newContent = `module.exports = {
  apps: ${JSON.stringify(apps, null, 2)}
};`;
      
      await writeFile('ecosystem.config.js', newContent);
      logSuccess(`Updated PM2 config (port: ${nextPort})`);
    } catch (error) {
      logWarning(`Could not update ecosystem.config.js: ${error.message}`);
    }
  }
  
  // 10. Install dependencies
  logInfo('Installing dependencies...');
  try {
    execSync('pnpm install', { stdio: 'inherit' });
    logSuccess('Dependencies installed');
  } catch (error) {
    logWarning('Dependency installation had issues. You may need to run: pnpm install');
  }
  
  // 11. Final success message
  console.log(`\n${colors.green}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}🎉 PORTAL "${portalName.toUpperCase()}" ADDED SUCCESSFULLY!${colors.reset}`);
  console.log(`${colors.green}═══════════════════════════════════════════════════${colors.reset}\n`);
  
  console.log(`${colors.cyan}📁 Location:${colors.reset} portals/${portalName}/`);
  console.log(`${colors.cyan}🎨 Theme:${colors.reset} ${theme}`);
  
  // Check if it's a Next.js app
  const portalPkgPath = path.join(portalPath, 'package.json');
  if (await exists(portalPkgPath)) {
    try {
      const portalPkg = JSON.parse(await readFile(portalPkgPath, 'utf8'));
      
      console.log(`\n${colors.cyan}📦 Portal scripts:${colors.reset}`);
      if (portalPkg.scripts) {
        Object.entries(portalPkg.scripts).forEach(([name, script]) => {
          console.log(`  ${colors.yellow}${name}${colors.reset}: ${script}`);
        });
      }
    } catch (error) {
      // Ignore package.json errors
    }
  }
  
  console.log(`\n${colors.cyan}🚀 To start development:${colors.reset}`);
  console.log(`  ${colors.green}pnpm run dev${colors.reset}          # Start all portals`);
  console.log(`  ${colors.green}cd portals/${portalName} && npm run dev${colors.reset}  # Start this portal only`);
  
  console.log(`\n${colors.cyan}🏗️  To build for production:${colors.reset}`);
  console.log(`  ${colors.green}pnpm run build${colors.reset}        # Build all portals`);
  console.log(`  ${colors.green}pnpm run build:portal ./portals/${portalName}${colors.reset}  # Build this portal`);
  
  console.log(`\n${colors.yellow}📝 Note:${colors.reset} Portal configuration saved to portals/${portalName}/.portal-config.json`);
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  let portalName = '';
  let theme = 'default';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--theme' || args[i] === '-t') {
      theme = args[i + 1] || 'default';
      i++;
    } else if (!args[i].startsWith('-')) {
      portalName = args[i];
    }
  }
  
  if (!portalName) {
    logError('Portal name is required');
    showHelp();
    process.exit(1);
  }
  
  return { portalName, theme };
}

function showHelp() {
  console.log(`
${colors.cyan}Usage:${colors.reset}
  pnpm run portal:add <portal-name> [options]

${colors.cyan}Options:${colors.reset}
  --theme, -t <theme>    Theme to use (default: "default")
  --help, -h             Show this help message

${colors.cyan}Examples:${colors.reset}
  pnpm run portal:add cbt
  pnpm run portal:add cbt --theme silk
  pnpm run portal:add academic --theme modern

${colors.cyan}Notes:${colors.reset}
  • Portal will be added to ./portals/<portal-name>/
  • Dependencies will be installed automatically
  • PM2 config will be updated if available
  `);
}

// Main execution
async function main() {
  try {
    const { portalName, theme } = parseArgs();
    await addPortal(portalName, theme);
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = { addPortal, fetchJSON, getRegistry };