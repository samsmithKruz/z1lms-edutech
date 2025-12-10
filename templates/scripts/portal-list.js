#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const exists = promisify(fs.exists);
const readdir = promisify(fs.readdir);

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

// Style helpers
const bold = '\x1b[1m';
const dim = '\x1b[2m';

function log(message, color = '', style = '') {
  console.log(`${style}${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
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

async function getRegistry(forceRefresh = false) {
  try {
    // Read .edutechrc for registry URL
    const configContent = await readFile('.edutechrc', 'utf8');
    const config = JSON.parse(configContent);
    
    // Check cache
    const cachePath = 'portal-registry-cache.json';
    const now = Date.now();
    
    if (!forceRefresh && await exists(cachePath)) {
      const cacheContent = await readFile(cachePath, 'utf8');
      const cache = JSON.parse(cacheContent);
      
      // Use cache if less than 1 hour old
      if (cache.lastFetched) {
        const cacheTime = new Date(cache.lastFetched).getTime();
        if (now - cacheTime < 60 * 60 * 1000) { // 1 hour
          logInfo('Using cached registry (use --refresh to update)');
          return cache;
        }
      }
    }
    
    // Fetch fresh registry
    logInfo('Fetching latest registry...');
    const registry = await fetchJSON(config.registryUrl);
    
    // Update cache
    await writeFile(cachePath, JSON.stringify({
      ...registry,
      lastFetched: new Date().toISOString()
    }, null, 2));
    
    logSuccess('Registry updated');
    return registry;
    
  } catch (error) {
    logWarning(`Failed to fetch registry: ${error.message}`);
    
    // Try to use cached registry
    if (await exists('portal-registry-cache.json')) {
      logInfo('Falling back to cached registry');
      const cache = await readFile('portal-registry-cache.json', 'utf8');
      return JSON.parse(cache);
    }
    
    throw new Error('No registry available');
  }
}

async function getInstalledPortals() {
  if (!await exists('portals')) {
    return [];
  }
  
  const portalNames = await readdir('portals');
  const portals = [];
  
  for (const portalName of portalNames) {
    const portalPath = `portals/${portalName}`;
    const configPath = path.join(portalPath, '.portal-config.json');
    const pkgPath = path.join(portalPath, 'package.json');
    
    let config = {};
    let pkg = {};
    
    if (await exists(configPath)) {
      config = JSON.parse(await readFile(configPath, 'utf8'));
    }
    
    if (await exists(pkgPath)) {
      pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    }
    
    portals.push({
      name: portalName,
      installed: true,
      theme: config.theme || 'default',
      version: config.version || 'unknown',
      installedAt: config.installedAt || 'unknown',
      repo: config.repo || 'unknown',
      description: pkg.description || 'No description',
      path: portalPath
    });
  }
  
  return portals;
}

function formatDate(dateString) {
  if (!dateString || dateString === 'unknown') {
    return 'unknown';
  }
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch (error) {
    return dateString;
  }
}

function printTable(headers, rows, colors = []) {
  // Calculate column widths
  const colWidths = headers.map((header, colIndex) => {
    const rowLengths = rows.map(row => {
      const cell = row[colIndex] || '';
      return cell.toString().length;
    });
    return Math.max(header.length, ...rowLengths);
  });
  
  // Print header
  console.log();
  console.log(bold + colors.blue + '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐' + colors.reset);
  
  const headerRow = headers.map((header, i) => {
    return ' ' + header.padEnd(colWidths[i]) + ' ';
  }).join('│');
  
  console.log(bold + colors.blue + '│' + colors.cyan + headerRow + colors.blue + '│' + colors.reset);
  console.log(bold + colors.blue + '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤' + colors.reset);
  
  // Print rows
  rows.forEach((row, rowIndex) => {
    const rowCells = row.map((cell, colIndex) => {
      const cellStr = (cell || '').toString();
      return ' ' + cellStr.padEnd(colWidths[colIndex]) + ' ';
    }).join('│');
    
    const rowColor = colors[rowIndex % colors.length] || colors.reset;
    console.log(bold + colors.blue + '│' + rowColor + rowCells + colors.blue + '│' + colors.reset);
  });
  
  console.log(bold + colors.blue + '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘' + colors.reset);
  console.log();
}

async function listAvailablePortals(registry) {
  if (!registry || !registry.portals) {
    logError('No portal registry available');
    return;
  }
  
  const installedPortals = await getInstalledPortals();
  const installedNames = installedPortals.map(p => p.name);
  
  console.log(`\n${bold}${colors.cyan}📚 AVAILABLE PORTALS${colors.reset}\n`);
  
  const rows = [];
  Object.entries(registry.portals).forEach(([name, info]) => {
    const isInstalled = installedNames.includes(name);
    const status = isInstalled ? `${colors.green}✓ Installed${colors.reset}` : `${dim}Available${colors.reset}`;
    
    rows.push([
      `${isInstalled ? colors.green : colors.cyan}${name}${colors.reset}`,
      info.description || 'No description',
      Object.keys(info.themes || {}).join(', ') || 'default',
      info.version || '1.0.0',
      status
    ]);
  });
  
  printTable(
    ['Portal', 'Description', 'Themes', 'Version', 'Status'],
    rows,
    [colors.white, colors.white, colors.white, colors.white]
  );
  
  console.log(`${dim}Total:${colors.reset} ${Object.keys(registry.portals).length} portal(s) available`);
  console.log(`${dim}Use:${colors.reset} ${colors.green}pnpm run portal:add <name> [--theme <theme>]${colors.reset} to install`);
}

async function listInstalledPortals() {
  const portals = await getInstalledPortals();
  
  if (portals.length === 0) {
    console.log(`\n${colors.yellow}No portals installed yet${colors.reset}`);
    console.log(`${dim}Use ${colors.green}pnpm run portal:list --available${colors.reset} to see available portals`);
    return;
  }
  
  console.log(`\n${bold}${colors.green}📁 INSTALLED PORTALS${colors.reset}\n`);
  
  const rows = portals.map(portal => [
    `${colors.cyan}${portal.name}${colors.reset}`,
    portal.description,
    portal.theme,
    portal.version,
    formatDate(portal.installedAt),
    portal.path
  ]);
  
  printTable(
    ['Name', 'Description', 'Theme', 'Version', 'Installed', 'Path'],
    rows,
    [colors.white, colors.white, colors.white, colors.white, colors.white]
  );
  
  console.log(`${dim}Total:${colors.reset} ${portals.length} portal(s) installed`);
  console.log(`${dim}Manage:${colors.reset} ${colors.green}pnpm run portal:update <name>${colors.reset} to update`);
  console.log(`${dim}        ${colors.green}pnpm run portal:remove <name>${colors.reset} to remove`);
}

async function listAll() {
  const registry = await getRegistry();
  const installedPortals = await getInstalledPortals();
  
  console.log(`${bold}${colors.magenta}╔════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${bold}${colors.magenta}║         Z1LMS EDUTECH PORTALS             ║${colors.reset}`);
  console.log(`${bold}${colors.magenta}╚════════════════════════════════════════════╝${colors.reset}`);
  
  // Show installed portals
  if (installedPortals.length > 0) {
    await listInstalledPortals();
  } else {
    console.log(`\n${colors.yellow}No portals installed yet${colors.reset}`);
  }
  
  // Show available portals
  if (registry && registry.portals) {
    const availableCount = Object.keys(registry.portals).length - installedPortals.length;
    if (availableCount > 0) {
      console.log(`\n${bold}${colors.yellow}✨ ${availableCount} more portal(s) available to install${colors.reset}`);
    }
  }
  
  console.log(`\n${dim}Commands:${colors.reset}`);
  console.log(`  ${colors.green}pnpm run portal:list --installed${colors.reset}  Show installed portals`);
  console.log(`  ${colors.green}pnpm run portal:list --available${colors.reset}  Show available portals`);
  console.log(`  ${colors.green}pnpm run portal:list --refresh${colors.reset}    Refresh registry cache`);
  console.log(`  ${colors.green}pnpm run portal:add <name>${colors.reset}        Install a portal`);
}

function printPortalInfo(portal, isDetailed = false) {
  console.log(`\n${bold}${colors.cyan}${portal.name}${colors.reset}`);
  console.log(`${dim}${'─'.repeat(portal.name.length + 2)}${colors.reset}`);
  
  console.log(`  ${colors.white}Description:${colors.reset} ${portal.description}`);
  console.log(`  ${colors.white}Theme:${colors.reset} ${portal.theme}`);
  console.log(`  ${colors.white}Version:${colors.reset} ${portal.version}`);
  console.log(`  ${colors.white}Installed:${colors.reset} ${formatDate(portal.installedAt)}`);
  
  if (isDetailed) {
    console.log(`  ${colors.white}Path:${colors.reset} ${portal.path}`);
    console.log(`  ${colors.white}Repository:${colors.reset} ${portal.repo}`);
    
    // Check for Next.js
    const nextConfig = path.join(portal.path, 'next.config.js');
    if (fs.existsSync(nextConfig)) {
      console.log(`  ${colors.white}Framework:${colors.reset} Next.js`);
    }
    
    // Check package.json scripts
    const pkgPath = path.join(portal.path, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts) {
          console.log(`  ${colors.white}Scripts:${colors.reset}`);
          Object.entries(pkg.scripts).forEach(([name, script]) => {
            console.log(`    ${colors.green}${name}${colors.reset}: ${script}`);
          });
        }
      } catch (error) {
        // Ignore
      }
    }
  }
  
  console.log();
}

async function showPortalDetails(portalName) {
  const portals = await getInstalledPortals();
  const portal = portals.find(p => p.name === portalName);
  
  if (!portal) {
    logError(`Portal "${portalName}" is not installed`);
    
    // Check if it's available
    try {
      const registry = await getRegistry();
      if (registry.portals && registry.portals[portalName]) {
        const availablePortal = registry.portals[portalName];
        console.log(`\n${colors.yellow}This portal is available but not installed:${colors.reset}`);
        console.log(`  ${colors.white}Description:${colors.reset} ${availablePortal.description}`);
        console.log(`  ${colors.white}Themes:${colors.reset} ${Object.keys(availablePortal.themes || {}).join(', ')}`);
        console.log(`  ${colors.white}Version:${colors.reset} ${availablePortal.version || '1.0.0'}`);
        console.log(`\n${colors.green}Install with:${colors.reset} pnpm run portal:add ${portalName}`);
      }
    } catch (error) {
      // Ignore registry errors
    }
    
    return;
  }
  
  printPortalInfo(portal, true);
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const options = {
    installed: args.includes('--installed'),
    available: args.includes('--available'),
    refresh: args.includes('--refresh'),
    details: false,
    portalName: null
  };
  
  // Check for --details <portal-name>
  const detailsIndex = args.indexOf('--details');
  if (detailsIndex !== -1 && args[detailsIndex + 1]) {
    options.details = true;
    options.portalName = args[detailsIndex + 1];
  }
  
  // Check for -d <portal-name>
  const dIndex = args.indexOf('-d');
  if (dIndex !== -1 && args[dIndex + 1]) {
    options.details = true;
    options.portalName = args[dIndex + 1];
  }
  
  // If no specific flags, show all
  if (!options.installed && !options.available && !options.details) {
    options.all = true;
  }
  
  return options;
}

function showHelp() {
  console.log(`
${bold}${colors.blue}Usage:${colors.reset}
  pnpm run portal:list [options]

${bold}${colors.blue}Options:${colors.reset}
  --installed, -i        List only installed portals
  --available, -a        List only available portals
  --details, -d <name>   Show detailed information about a portal
  --refresh, -r          Refresh the portal registry cache
  --help, -h             Show this help message

${bold}${colors.blue}Examples:${colors.reset}
  pnpm run portal:list                 # Show all portals
  pnpm run portal:list --installed     # Show installed portals only
  pnpm run portal:list --available     # Show available portals only
  pnpm run portal:list --refresh       # Refresh and show all
  pnpm run portal:list --details cbt   # Show details about CBT portal
  pnpm run portal:list -d academic     # Show details about Academic portal

${bold}${colors.blue}Notes:${colors.reset}
  • Registry is cached for 1 hour
  • Use --refresh to force update
  • Portal details show scripts and configuration
  `);
}

async function main() {
  try {
    const options = parseArgs();
    
    if (options.details && options.portalName) {
      await showPortalDetails(options.portalName);
      return;
    }
    
    if (options.refresh) {
      logInfo('Refreshing registry cache...');
      await getRegistry(true);
    }
    
    if (options.installed) {
      await listInstalledPortals();
    } else if (options.available) {
      const registry = await getRegistry(options.refresh);
      await listAvailablePortals(registry);
    } else {
      // Show all
      await listAll();
    }
    
  } catch (error) {
    if (error.message === 'No registry available') {
      logError('Cannot connect to portal registry');
      logInfo('Check your internet connection or .edutechrc configuration');
      
      // Still show installed portals if any
      const installed = await getInstalledPortals();
      if (installed.length > 0) {
        console.log(`\n${colors.yellow}Showing installed portals only:${colors.reset}`);
        await listInstalledPortals();
      }
    } else {
      logError(`Error: ${error.message}`);
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  getRegistry,
  getInstalledPortals,
  listAvailablePortals,
  listInstalledPortals
};