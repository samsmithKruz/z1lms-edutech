# Edutech Platform Workspace

This is a monorepo workspace for managing multiple edutech portals.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm 8+
- Git

### Installation
```bash
# Install dependencies
pnpm install

# Add your first portal
pnpm run portal:add academic

# Start development
pnpm run dev
```

## 📁 Project Structure

```
workspace/
├── portals/          # Individual portal applications
│   ├── academic/     # Academic portal
│   ├── cbt/         # Computer-based test portal
│   └── ...          # Other portals
├── shared/           # Shared components and utilities
├── scripts/          # CLI tools for portal management
├── .edutechrc        # Workspace configuration
├── turbo.json        # Build pipeline configuration
└── package.json      # Workspace dependencies
```

## 🔧 Portal Management

### Add a Portal
```bash
# Add a portal with default theme
pnpm run portal:add <portal-name>

# Add with specific theme
pnpm run portal:add <portal-name> --theme <theme-name>
```

### Update a Portal
```bash
# Update to latest version
pnpm run portal:update <portal-name>

# Force update (overwrites local changes)
pnpm run portal:update <portal-name> --force
```

### Remove a Portal
```bash
# Remove with confirmation
pnpm run portal:remove <portal-name>

# Remove without backup
pnpm run portal:remove <portal-name> --no-backup
```

### List Portals
```bash
# List all portals
pnpm run portal:list

# List installed portals only
pnpm run portal:list --installed

# List available portals
pnpm run portal:list --available

# Show portal details
pnpm run portal:list --details <portal-name>
```

## 🛠️ Development

### Start Development Servers
```bash
# Start all portals
pnpm run dev

# Start specific portal
cd portals/<portal-name>
npm run dev
```

### Build for Production
```bash
# Build all portals
pnpm run build

# Build specific portal
pnpm run build:portal ./portals/<portal-name>
```

### Lint
```bash
pnpm run lint
```

## 📦 Portals

Portals are individual Next.js applications that:
- Use `output: 'export'` for static builds
- Share components from `/shared`
- Can have their own themes and configurations
- Are independently deployable

## 🔌 Shared Components

The `/shared` directory contains reusable components, hooks, and utilities:

```typescript
// Import shared components
import { Button, Card } from "@shared/components/ui";
import { useAuth } from "@shared/hooks/useAuth";
import { cn } from "@shared/lib/utils";
```

## ⚙️ Configuration

### `.edutechrc`
```json
{
  "institution": "your-institution",
  "registryUrl": "https://raw.githubusercontent.com/z1lms/edutech-portal-registry/main/registry.json",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

### Environment Variables
- Add `.env.local` files in individual portals for local development
- Shared variables can be added to root `.env` file

## 🚀 Deployment

### Manual Deployment
1. Build portals: `pnpm run build`
2. Deploy static files from `portals/*/out/` to your web server

### CI/CD Deployment
GitHub Actions workflow automatically:
- Builds changed portals
- Deploys to configured server
- Updates deployment information

## 🔄 Updating

### Update All Portals
```bash
# Update all installed portals
for portal in portals/*/; do
  portal_name=$(basename "$portal")
  pnpm run portal:update $portal_name
done
```

### Update Registry Cache
```bash
# Refresh available portals list
pnpm run portal:list --refresh
```

## 🆘 Troubleshooting

### Portal Not Found
```bash
# Refresh registry
pnpm run portal:list --refresh

# Check available portals
pnpm run portal:list --available
```

### Build Errors
```bash
# Clean and rebuild
rm -rf node_modules .turbo
pnpm install
pnpm run build
```

### Dependency Issues
```bash
# Update all dependencies
pnpm update --latest
```

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [TurboRepo Documentation](https://turbo.build/repo)
- [pnpm Documentation](https://pnpm.io)
