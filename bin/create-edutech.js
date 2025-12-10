#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const copyFile = promisify(fs.copyFile);
const chmod = promisify(fs.chmod);

// CLI banner
const BANNER = `
╔══════════════════════════════════════╗
║      Z1LMS Edutech Platform CLI      ║
╚══════════════════════════════════════╝
`;

async function createWorkspace(institution, firstPortal) {
  console.log(BANNER);
  
  if (!institution) {
    console.log('Usage: create-edutech <institution-name> [first-portal]');
    console.log('\nExamples:');
    console.log('  create-edutech aks academic');
    console.log('  create-edutech harvard');
    process.exit(1);
  }

  const workspaceName = `${institution}-workspace`;
  
  try {
    // 1. Create workspace directory
    console.log(`🚀 Creating workspace: ${workspaceName}`);
    
    if (fs.existsSync(workspaceName)) {
      console.error(`❌ Directory "${workspaceName}" already exists`);
      process.exit(1);
    }
    
    await mkdir(workspaceName);
    process.chdir(workspaceName);
    
    // 2. Initialize git
    console.log('📦 Initializing git repository...');
    execSync('git init', { stdio: 'pipe' });
    
    // 3. Initialize npm workspace
    console.log('📦 Setting up npm workspace...');
    
    const packageJson = {
      name: workspaceName,
      version: '1.0.0',
      private: true,
      workspaces: ["portals/*", "shared"],
      scripts: {
        "portal:add": "node scripts/portal-add.js",
        "portal:update": "node scripts/portal-update.js",
        "portal:remove": "node scripts/portal-remove.js",
        "portal:list": "node scripts/portal-list.js",
        "dev": "turbo dev",
        "build": "turbo build",
        "build:portal": "turbo run build --filter",
        "lint": "turbo lint"
      },
      devDependencies: {
        "turbo": "^2.0.0"
      }
    };
    
    await writeFile('package.json', JSON.stringify(packageJson, null, 2));
    
    // 4. Create directory structure
    console.log('📁 Creating directory structure...');
    
    await mkdir('portals');
    await mkdir('shared');
    await mkdir('scripts');
    await mkdir('.github/workflows', { recursive: true });
    
    // 5. Create .edutechrc configuration
    const edutechConfig = {
      institution: institution,
      workspaceName: workspaceName,
      registryUrl: "https://raw.githubusercontent.com/z1lms/edutech-portal-registry/main/registry.json",
      createdAt: new Date().toISOString(),
      version: "1.0.0"
    };
    
    await writeFile('.edutechrc', JSON.stringify(edutechConfig, null, 2));
    
    // 6. Create turbo.json
    const turboConfig = {
      "$schema": "https://turbo.build/schema.json",
      "pipeline": {
        "build": {
          "outputs": [".next/**", "!.next/cache/**"]
        },
        "dev": {
          "cache": false,
          "persistent": true
        },
        "lint": {
          "outputs": []
        }
      }
    };
    
    await writeFile('turbo.json', JSON.stringify(turboConfig, null, 2));
    
    // 7. Create basic README
    const readmeContent = `# ${institution.toUpperCase()} Edutech Platform

## Overview
This workspace contains the edutech portals for ${institution}.

## Portals Management

### Add a new portal
\`\`\`bash
npm run portal:add <portal-name> [--theme <theme-name>]
\`\`\`

### Update a portal
\`\`\`bash
npm run portal:update <portal-name>
\`\`\`

### List available portals
\`\`\`bash
npm run portal:list
\`\`\`

## Development
\`\`\`bash
# Install dependencies
npm install

# Start all portals in development mode
npm run dev

# Build all portals for production
npm run build

# Build specific portal
npm run build:portal ./portals/<portal-name>
\`\`\`

## Portals Structure
- \`/portals/\` - Individual portal applications
- \`/shared/\` - Shared components and utilities

## Configuration
- \`.edutechrc\` - Workspace configuration
- \`portal-registry.json\` - Local portal registry cache
`;

    await writeFile('README.md', readmeContent);
    
    // 8. Copy CLI scripts from package templates
    console.log('🔧 Installing CLI tools...');
    
    const scriptFiles = [
      'portal-add.js',
      'portal-update.js',
      'portal-remove.js',
      'portal-list.js'
    ];
    
    for (const scriptFile of scriptFiles) {
      const templatePath = path.join(__dirname, '../templates/scripts', scriptFile);
      const destPath = `scripts/${scriptFile}`;
      
      // In published package, templates are included
      if (fs.existsSync(templatePath)) {
        await copyFile(templatePath, destPath);
        await chmod(destPath, '755');
      } else {
        // Create minimal placeholder if template not found
        await writeFile(destPath, `#!/usr/bin/env node\nconsole.log('CLI script: ${scriptFile}');`);
        await chmod(destPath, '755');
      }
    }
    
    // 9. Create initial portal registry cache
    const initialRegistry = {
      lastFetched: new Date().toISOString(),
      portals: {}
    };
    
    await writeFile('portal-registry-cache.json', JSON.stringify(initialRegistry, null, 2));
    
    // 10. Install turbo
    console.log('📦 Installing Turbo...');
    execSync('npm install turbo --save-dev', { stdio: 'inherit' });
    
    // 11. Create .gitignore
    const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
.next/
out/
dist/

# Environment variables
.env.local
.env*.local

# Logs
*.log

# IDE
.vscode/
.idea/

# OS
.DS_Store

# Turbo
.turbo/

# Portal backups
backup-*/
temp-*/`;
    
    await writeFile('.gitignore', gitignoreContent);
    
    // 12. Create initial commit
    console.log('💾 Creating initial commit...');
    execSync('git add .', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit: Edutech workspace"', { stdio: 'pipe' });
    
    // 13. Add first portal if specified
    if (firstPortal) {
      console.log(`\n📦 Adding initial portal: ${firstPortal}`);
      console.log('This may take a moment...\n');
      
      try {
        execSync(`node scripts/portal-add.js ${firstPortal} --theme=default`, { stdio: 'inherit' });
      } catch (error) {
        console.log('\n⚠️  Initial portal setup skipped due to error');
        console.log('You can add it manually later with:');
        console.log(`npm run portal:add ${firstPortal}`);
      }
    }
    
    // Success message
    console.log('\n' + '='.repeat(50));
    console.log('✅ WORKSPACE CREATED SUCCESSFULLY!');
    console.log('='.repeat(50) + '\n');
    
    console.log('📁 Workspace location:');
    console.log(`  ${path.resolve(workspaceName)}`);
    
    console.log('\n🚀 Next steps:');
    console.log(`  cd ${workspaceName}`);
    
    if (!firstPortal) {
      console.log('  npm run portal:list          # View available portals');
      console.log('  npm run portal:add <portal>  # Add your first portal');
    }
    
    console.log('  npm run dev                # Start development servers');
    console.log('  npm run build              # Build for production');
    
    console.log('\n🔧 Manage portals:');
    console.log('  npm run portal:add <name> [--theme <theme>]');
    console.log('  npm run portal:update <name>');
    console.log('  npm run portal:remove <name>');
    
    console.log('\n📚 Documentation:');
    console.log('  Check README.md for detailed instructions');
    console.log('\n' + '✨ Happy coding!');

  } catch (error) {
    console.error('\n❌ Error creating workspace:', error.message);
    
    // Cleanup on error
    try {
      process.chdir('..');
      if (fs.existsSync(workspaceName)) {
        fs.rmSync(workspaceName, { recursive: true, force: true });
      }
    } catch (cleanupError) {
        console.error('⚠️  Error during cleanup:', cleanupError.message);
      // Ignore cleanup errors
    }
    
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const institution = args[0];
const firstPortal = args[1];

// Run the CLI
createWorkspace(institution, firstPortal).catch(console.error);