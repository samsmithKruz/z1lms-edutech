#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const exists = promisify(fs.exists);

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
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

async function backupPortal(portalName) {
  const portalPath = `portals/${portalName}`;
  const backupDir = `backup-${portalName}-${Date.now()}`;
  
  if (!await exists(portalPath)) {
    throw new Error(`Portal "${portalName}" does not exist`);
  }
  
  logInfo(`Creating backup: ${backupDir}`);
  
  // Copy portal to backup directory
  execSync(`cp -r ${portalPath} ${backupDir}`);
  
  return backupDir;
}

async function getPortalConfig(portalName) {
  const configPath = `portals/${portalName}/.portal-config.json`;
  
  if (!await exists(configPath)) {
    throw new Error(`No configuration found for portal "${portalName}". This portal may have been added manually.`);
  }
  
  const configContent = await readFile(configPath, 'utf8');
  return JSON.parse(configContent);
}

async function updatePortal(portalName, force = false) {
  console.log(`\n${colors.blue}🔄 Updating portal: ${portalName}${colors.reset}\n`);
  
  // 1. Get portal configuration
  let portalConfig;
  try {
    portalConfig = await getPortalConfig(portalName);
    logInfo(`Current version: ${portalConfig.version || 'unknown'}`);
    logInfo(`Source: ${portalConfig.repo}`);
  } catch (error) {
    logError(error.message);
    process.exit(1);
  }
  
  // 2. Check for uncommitted changes
  const portalPath = `portals/${portalName}`;
  
  try {
    execSync(`cd ${portalPath} && git status --porcelain`, { stdio: 'pipe' });
    const hasChanges = execSync(`cd ${portalPath} && git status --porcelain | wc -l`, { stdio: 'pipe' })
      .toString()
      .trim();
    
    if (hasChanges !== '0' && !force) {
      logWarning(`Portal "${portalName}" has uncommitted changes.`);
      console.log(`
${colors.yellow}Options:${colors.reset}
  1. Commit or stash your changes first
  2. Use --force flag to overwrite changes
  3. Update manually by merging changes
  
${colors.blue}To see changes:${colors.reset}
  cd portals/${portalName} && git status
  
${colors.blue}To force update (will overwrite changes):${colors.reset}
  pnpm run portal:update ${portalName} --force
`);
      process.exit(1);
    }
  } catch (error) {
    // Not a git repo, that's okay
    logInfo('Portal is not a git repository (normal for degit clones)');
  }
  
  // 3. Create backup
  let backupDir;
  try {
    backupDir = await backupPortal(portalName);
    logSuccess(`Backup created: ${backupDir}`);
  } catch (error) {
    logError(`Failed to create backup: ${error.message}`);
    process.exit(1);
  }
  
  // 4. Fetch latest version
  logInfo(`Fetching latest version from: ${portalConfig.repo}`);
  
  const tempDir = `temp-update-${portalName}-${Date.now()}`;
  
  try {
    // Use degit for clean clone
    execSync(`npx degit ${portalConfig.repo} ${tempDir}`, { stdio: 'inherit' });
    
    // Check if new version exists
    if (!await exists(tempDir) || fs.readdirSync(tempDir).length === 0) {
      throw new Error('Failed to fetch update (empty directory)');
    }
    
    logSuccess('Fetched latest version');
    
    // 5. Compare versions
    const newConfigPath = path.join(tempDir, '.portal-config.json');
    if (await exists(newConfigPath)) {
      const newConfig = JSON.parse(await readFile(newConfigPath, 'utf8'));
      logInfo(`New version: ${newConfig.version || 'unknown'}`);
      
      if (portalConfig.version && newConfig.version && portalConfig.version === newConfig.version) {
        logWarning('Portal is already at the latest version');
      }
    }
    
    // 6. Merge or replace
    if (force) {
      // Force replace
      logWarning('Force mode: Replacing portal completely');
      
      // Remove old portal
      fs.rmSync(portalPath, { recursive: true, force: true });
      
      // Move new portal in place
      fs.renameSync(tempDir, portalPath);
      
      logSuccess('Portal replaced with new version');
    } else {
      // Smart merge attempt
      logInfo('Attempting smart merge...');
      
      // Copy new files, but preserve existing custom files
      // For now, we'll do a simple merge strategy
      mergeDirectories(tempDir, portalPath);
      
      // Cleanup temp dir
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      logSuccess('Merge completed');
    }
    
    // 7. Update portal configuration
    const updatedConfig = {
      ...portalConfig,
      updatedAt: new Date().toISOString(),
      previousVersion: portalConfig.version,
      backupLocation: backupDir
    };
    
    await writeFile(
      path.join(portalPath, '.portal-config.json'),
      JSON.stringify(updatedConfig, null, 2)
    );
    
    // 8. Install updated dependencies
    logInfo('Checking for dependency updates...');
    
    const portalPkgPath = path.join(portalPath, 'package.json');
    if (await exists(portalPkgPath)) {
      const oldPkg = JSON.parse(await readFile(path.join(backupDir, 'package.json'), 'utf8'));
      const newPkg = JSON.parse(await readFile(portalPkgPath, 'utf8'));
      
      if (JSON.stringify(oldPkg.dependencies) !== JSON.stringify(newPkg.dependencies) ||
          JSON.stringify(oldPkg.devDependencies) !== JSON.stringify(newPkg.devDependencies)) {
        logInfo('Dependencies changed, installing updates...');
        try {
          execSync('pnpm install', { stdio: 'inherit' });
          logSuccess('Dependencies updated');
        } catch (error) {
          logWarning('Failed to install dependencies. You may need to run: pnpm install');
        }
      }
    }
    
    // 9. Success message
    console.log(`\n${colors.green}═══════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}🎉 PORTAL "${portalName.toUpperCase()}" UPDATED SUCCESSFULLY!${colors.reset}`);
    console.log(`${colors.green}═══════════════════════════════════════════════════${colors.reset}\n`);
    
    console.log(`${colors.cyan}📁 Updated:${colors.reset} portals/${portalName}/`);
    console.log(`${colors.cyan}💾 Backup:${colors.reset} ${backupDir}/`);
    
    console.log(`\n${colors.yellow}⚠️  Important:${colors.reset}`);
    console.log(`  1. Review the changes in your portal`);
    console.log(`  2. Test the updated portal: pnpm run dev`);
    console.log(`  3. Backup will be kept for rollback if needed`);
    
    console.log(`\n${colors.blue}🔧 Next steps:${colors.reset}`);
    console.log(`  ${colors.green}cd portals/${portalName}${colors.reset}`);
    console.log(`  ${colors.green}npm run dev${colors.reset}          # Test the updated portal`);
    console.log(`  ${colors.green}rm -rf ${backupDir}${colors.reset}  # Remove backup when confirmed working`);
    
  } catch (error) {
    // Cleanup on error
    if (await exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    logError(`Update failed: ${error.message}`);
    
    // Restore from backup
    logInfo('Restoring from backup...');
    if (await exists(portalPath)) {
      fs.rmSync(portalPath, { recursive: true, force: true });
    }
    fs.renameSync(backupDir, portalPath);
    
    logSuccess('Portal restored from backup');
    process.exit(1);
  }
}

// Simple directory merge utility
function mergeDirectories(sourceDir, targetDir) {
  const files = fs.readdirSync(sourceDir);
  
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    const stat = fs.statSync(sourcePath);
    
    if (stat.isDirectory()) {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      mergeDirectories(sourcePath, targetPath);
    } else {
      // Skip portal config - we'll update it separately
      if (file === '.portal-config.json') {
        continue;
      }
      
      // Copy file
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  let portalName = '';
  let force = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force' || args[i] === '-f') {
      force = true;
    } else if (!args[i].startsWith('-')) {
      portalName = args[i];
    }
  }
  
  if (!portalName) {
    logError('Portal name is required');
    showHelp();
    process.exit(1);
  }
  
  return { portalName, force };
}

function showHelp() {
  console.log(`
${colors.blue}Usage:${colors.reset}
  pnpm run portal:update <portal-name> [options]

${colors.blue}Options:${colors.reset}
  --force, -f           Force update (overwrites local changes)
  --help, -h            Show this help message

${colors.blue}Examples:${colors.reset}
  pnpm run portal:update cbt
  pnpm run portal:update academic --force
  pnpm run portal:update finance

${colors.blue}Notes:${colors.reset}
  • Creates a backup before updating
  • Checks for uncommitted changes (unless --force)
  • Preserves custom files when possible
  • Updates dependencies if changed
  
${colors.yellow}⚠️  Warning:${colors.reset}
  Using --force will overwrite all local changes!
  Always commit or backup your work first.
  `);
}

// List all portals that can be updated
async function listUpdatablePortals() {
  if (!await exists('portals')) {
    logInfo('No portals directory found');
    return [];
  }
  
  const portals = fs.readdirSync('portals');
  const updatable = [];
  
  for (const portal of portals) {
    const configPath = `portals/${portal}/.portal-config.json`;
    if (await exists(configPath)) {
      updatable.push(portal);
    }
  }
  
  return updatable;
}

async function main() {
  try {
    const { portalName, force } = parseArgs();
    
    if (portalName === 'all') {
      const portals = await listUpdatablePortals();
      
      if (portals.length === 0) {
        logInfo('No updatable portals found');
        return;
      }
      
      console.log(`\n${colors.blue}Updating all portals:${colors.reset} ${portals.join(', ')}\n`);
      
      for (const portal of portals) {
        try {
          await updatePortal(portal, force);
        } catch (error) {
          logError(`Failed to update ${portal}: ${error.message}`);
          // Continue with other portals
        }
      }
      
      logSuccess('All portals update completed');
    } else {
      await updatePortal(portalName, force);
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
module.exports = { updatePortal, getPortalConfig, backupPortal };