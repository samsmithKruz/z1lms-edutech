#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execSync } = require('child_process');

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
  reset: '\x1b[0m'
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
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

async function confirmAction(message, defaultValue = false) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const hint = defaultValue ? 'Y/n' : 'y/N';
    rl.question(`${message} (${hint}): `, (answer) => {
      rl.close();
      
      if (answer === '') {
        resolve(defaultValue);
      } else {
        resolve(/^y(es)?$/i.test(answer));
      }
    });
  });
}

async function getPortalInfo(portalName) {
  const portalPath = `portals/${portalName}`;
  
  if (!await exists(portalPath)) {
    throw new Error(`Portal "${portalName}" does not exist`);
  }
  
  const configPath = path.join(portalPath, '.portal-config.json');
  let config = {};
  
  if (await exists(configPath)) {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  }
  
  const pkgPath = path.join(portalPath, 'package.json');
  let packageInfo = {};
  
  if (await exists(pkgPath)) {
    packageInfo = JSON.parse(await readFile(pkgPath, 'utf8'));
  }
  
  return {
    name: portalName,
    path: portalPath,
    config,
    package: packageInfo,
    size: getDirectorySize(portalPath),
    createdAt: config.installedAt || 'unknown'
  };
}

function getDirectorySize(dir) {
  let size = 0;
  
  function scan(directory) {
    const items = fs.readdirSync(directory);
    
    for (const item of items) {
      const itemPath = path.join(directory, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        scan(itemPath);
      } else {
        size += stat.size;
      }
    }
  }
  
  if (fs.existsSync(dir)) {
    scan(dir);
  }
  
  // Convert to human readable format
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let readableSize = size;
  
  while (readableSize >= 1024 && unitIndex < units.length - 1) {
    readableSize /= 1024;
    unitIndex++;
  }
  
  return `${readableSize.toFixed(1)} ${units[unitIndex]}`;
}

async function removeFromWorkspaces(portalName) {
  const pkgPath = 'package.json';
  
  if (!await exists(pkgPath)) {
    return;
  }
  
  const pkgContent = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgContent);
  
  if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
    const workspacePath = `portals/${portalName}`;
    const index = pkg.workspaces.indexOf(workspacePath);
    
    if (index !== -1) {
      pkg.workspaces.splice(index, 1);
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      logSuccess(`Removed from workspaces configuration`);
    }
  }
}

async function removeFromEcosystem(portalName) {
  const ecosystemPath = 'ecosystem.config.js';
  
  if (!await exists(ecosystemPath)) {
    return;
  }
  
  try {
    const content = await readFile(ecosystemPath, 'utf8');
    const appsMatch = content.match(/module\.exports\s*=\s*{\s*apps:\s*(\[.*?\])\s*}/s);
    
    if (appsMatch) {
      let apps;
      try {
        apps = eval(`(${appsMatch[1]})`);
      } catch (e) {
        apps = [];
      }
      
      const appName = `${portalName}-portal`;
      const filteredApps = apps.filter(app => app.name !== appName);
      
      if (filteredApps.length < apps.length) {
        const newContent = `module.exports = {
  apps: ${JSON.stringify(filteredApps, null, 2)}
};`;
        
        await writeFile(ecosystemPath, newContent);
        logSuccess(`Removed from PM2 configuration`);
      }
    }
  } catch (error) {
    logWarning(`Could not update ecosystem.config.js: ${error.message}`);
  }
}

async function createBackup(portalName, portalPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `portal-backups/${portalName}-${timestamp}`;
  
  await fs.promises.mkdir('portal-backups', { recursive: true });
  
  // Copy portal to backup directory
  execSync(`cp -r "${portalPath}" "${backupDir}"`, { stdio: 'pipe' });
  
  // Create backup info file
  const backupInfo = {
    portal: portalName,
    backedUpAt: new Date().toISOString(),
    originalPath: portalPath,
    backupLocation: backupDir
  };
  
  await writeFile(
    path.join(backupDir, '.backup-info.json'),
    JSON.stringify(backupInfo, null, 2)
  );
  
  return backupDir;
}

async function removePortal(portalName, force = false, backup = true) {
  console.log(`\n${colors.magenta}🗑️  Removing portal: ${portalName}${colors.reset}\n`);
  
  // 1. Get portal information
  let portalInfo;
  try {
    portalInfo = await getPortalInfo(portalName);
  } catch (error) {
    logError(error.message);
    process.exit(1);
  }
  
  // 2. Display portal information
  console.log(`${colors.blue}Portal Information:${colors.reset}`);
  console.log(`  Name: ${portalInfo.name}`);
  console.log(`  Path: ${portalInfo.path}`);
  console.log(`  Size: ${portalInfo.size}`);
  console.log(`  Installed: ${portalInfo.createdAt}`);
  
  if (portalInfo.config.theme) {
    console.log(`  Theme: ${portalInfo.config.theme}`);
  }
  
  if (portalInfo.package.name) {
    console.log(`  Package: ${portalInfo.package.name}`);
  }
  
  // 3. Check for uncommitted changes
  const portalPath = portalInfo.path;
  let hasUncommittedChanges = false;
  
  try {
    execSync(`cd ${portalPath} && git status --porcelain`, { stdio: 'pipe' });
    const changes = execSync(`cd ${portalPath} && git status --porcelain | wc -l`, { stdio: 'pipe' })
      .toString()
      .trim();
    
    hasUncommittedChanges = changes !== '0';
    
    if (hasUncommittedChanges) {
      logWarning('Portal has uncommitted changes!');
    }
  } catch (error) {
    // Not a git repo, that's okay
  }
  
  // 4. Confirm removal
  if (!force) {
    const confirmed = await confirmAction(
      `Are you sure you want to remove portal "${portalName}"?`,
      false
    );
    
    if (!confirmed) {
      logInfo('Removal cancelled');
      return;
    }
    
    // Ask about backup
    if (backup) {
      const backupConfirmed = await confirmAction(
        'Create a backup before removal?',
        true
      );
      
      if (!backupConfirmed) {
        backup = false;
      }
    }
  }
  
  // 5. Create backup if requested
  let backupDir = null;
  if (backup) {
    try {
      backupDir = await createBackup(portalName, portalPath);
      logSuccess(`Backup created: ${backupDir}`);
    } catch (error) {
      logWarning(`Failed to create backup: ${error.message}`);
      const continueAnyway = await confirmAction('Continue without backup?', false);
      
      if (!continueAnyway) {
        logInfo('Removal cancelled');
        return;
      }
    }
  }
  
  // 6. Remove from configurations first
  try {
    await removeFromWorkspaces(portalName);
    await removeFromEcosystem(portalName);
  } catch (error) {
    logWarning(`Failed to update configurations: ${error.message}`);
  }
  
  // 7. Remove portal directory
  try {
    fs.rmSync(portalPath, { recursive: true, force: true });
    logSuccess(`Portal directory removed: ${portalPath}`);
  } catch (error) {
    logError(`Failed to remove portal directory: ${error.message}`);
    
    if (backupDir) {
      logInfo(`Backup is available at: ${backupDir}`);
    }
    
    process.exit(1);
  }
  
  // 8. Clean up empty portals directory
  try {
    const remainingPortals = await readdir('portals');
    if (remainingPortals.length === 0) {
      fs.rmdirSync('portals');
      logInfo('Removed empty portals directory');
    }
  } catch (error) {
    // Ignore errors
  }
  
  // 9. Success message
  console.log(`\n${colors.green}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}🗑️  PORTAL "${portalName.toUpperCase()}" REMOVED SUCCESSFULLY!${colors.reset}`);
  console.log(`${colors.green}═══════════════════════════════════════════════════${colors.reset}\n`);
  
  if (backupDir) {
    console.log(`${colors.cyan}💾 Backup saved to:${colors.reset} ${backupDir}`);
    console.log(`${colors.yellow}⚠️  Backup will not be automatically cleaned up${colors.reset}`);
  }
  
  console.log(`${colors.blue}🔧 Next steps:${colors.reset}`);
  console.log(`  ${colors.green}pnpm install${colors.reset}           # Update workspace dependencies`);
  
  if (hasUncommittedChanges && !backupDir) {
    console.log(`\n${colors.red}⚠️  WARNING: Uncommitted changes were lost!${colors.reset}`);
  }
}

async function listAllPortals() {
  if (!await exists('portals')) {
    return [];
  }
  
  const portals = await readdir('portals');
  const portalInfos = [];
  
  for (const portal of portals) {
    try {
      const info = await getPortalInfo(portal);
      portalInfos.push(info);
    } catch (error) {
      // Skip invalid portals
    }
  }
  
  return portalInfos;
}

async function interactiveRemove() {
  const portals = await listAllPortals();
  
  if (portals.length === 0) {
    logInfo('No portals found');
    return;
  }
  
  console.log(`\n${colors.blue}Available Portals:${colors.reset}\n`);
  
  portals.forEach((portal, index) => {
    console.log(`${index + 1}. ${colors.cyan}${portal.name}${colors.reset}`);
    console.log(`   📁 ${portal.path}`);
    console.log(`   📦 ${portal.size} | 🎨 ${portal.config.theme || 'default'}`);
    console.log(`   📅 ${portal.createdAt.split('T')[0]}`);
    console.log();
  });
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question(`Enter portal number or name (1-${portals.length}): `, async (answer) => {
    rl.close();
    
    let portalName = '';
    
    // Check if answer is a number
    const index = parseInt(answer) - 1;
    if (!isNaN(index) && index >= 0 && index < portals.length) {
      portalName = portals[index].name;
    } else {
      // Check if answer is a valid portal name
      const portal = portals.find(p => p.name === answer);
      if (portal) {
        portalName = portal.name;
      }
    }
    
    if (!portalName) {
      logError('Invalid selection');
      process.exit(1);
    }
    
    await removePortal(portalName, false, true);
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  let portalName = '';
  let force = false;
  let noBackup = false;
  let interactive = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--no-backup' || arg === '-n') {
      noBackup = true;
    } else if (arg === '--interactive' || arg === '-i') {
      interactive = true;
    } else if (arg === '--list' || arg === '-l') {
      // Will be handled separately
    } else if (!arg.startsWith('-')) {
      portalName = arg;
    }
  }
  
  if (args.includes('--list') || args.includes('-l')) {
    return { action: 'list' };
  }
  
  if (interactive) {
    return { action: 'interactive' };
  }
  
  if (!portalName && !interactive) {
    logError('Portal name is required (or use --interactive)');
    showHelp();
    process.exit(1);
  }
  
  return {
    action: 'remove',
    portalName,
    force,
    backup: !noBackup
  };
}

function showHelp() {
  console.log(`
${colors.blue}Usage:${colors.reset}
  pnpm run portal:remove <portal-name> [options]
  pnpm run portal:remove --interactive
  pnpm run portal:remove --list

${colors.blue}Options:${colors.reset}
  --force, -f           Force removal without confirmation
  --no-backup, -n       Do not create a backup
  --interactive, -i     Interactive portal selection
  --list, -l            List all portals
  --help, -h            Show this help message

${colors.blue}Examples:${colors.reset}
  pnpm run portal:remove cbt
  pnpm run portal:remove academic --no-backup
  pnpm run portal:remove finance --force
  pnpm run portal:remove --interactive
  pnpm run portal:remove --list

${colors.blue}Notes:${colors.reset}
  • Creates backup by default in portal-backups/
  • Removes from workspaces and PM2 config
  • Interactive mode shows all portals
  • Use --list to see removable portals
  
${colors.yellow}⚠️  Warning:${colors.reset}
  This action cannot be undone (unless backup is created)!
  `);
}

async function main() {
  try {
    const args = parseArgs();
    
    if (args.action === 'list') {
      const portals = await listAllPortals();
      
      if (portals.length === 0) {
        logInfo('No portals found');
        return;
      }
      
      console.log(`\n${colors.blue}Available Portals:${colors.reset}\n`);
      
      portals.forEach(portal => {
        console.log(`${colors.cyan}${portal.name}${colors.reset}`);
        console.log(`  Path: ${portal.path}`);
        console.log(`  Size: ${portal.size}`);
        console.log(`  Theme: ${portal.config.theme || 'default'}`);
        console.log(`  Installed: ${portal.createdAt.split('T')[0]}`);
        console.log();
      });
      
      console.log(`${colors.blue}Total:${colors.reset} ${portals.length} portal(s)`);
      
    } else if (args.action === 'interactive') {
      await interactiveRemove();
      
    } else if (args.action === 'remove') {
      await removePortal(args.portalName, args.force, args.backup);
      
      // Suggest to run install
      console.log(`\n${colors.yellow}💡 Tip:${colors.reset} Run ${colors.green}pnpm install${colors.reset} to clean up dependencies`);
    }
    
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
module.exports = {
  removePortal,
  getPortalInfo,
  listAllPortals
};