# CodePush Web Dashboard

A modern Next.js frontend for the CodePush server, providing a web interface to manage mobile app deployments.

## Features

- **Authentication**: GitHub OAuth integration and manual token entry
- **App Management**: Create, view, and delete applications
- **Deployment Control**: Manage deployments and view release history
- **Release Management**: View detailed release information, rollback capabilities
- **Responsive Design**: Modern UI built with Tailwind CSS

## Prerequisites

- Node.js 18+ and npm/yarn
- CodePush server running (see `/api` folder)
- GitHub OAuth app configured for authentication

## Setup

1. **Install dependencies**:
   ```bash
   cd web
   npm install
   ```

2. **Configure environment variables**:
   Create a `.env.local` file:
   ```bash
   # CodePush API Server URL
   NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3001`

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home page (redirects to dashboard)
│   ├── login/             # Authentication pages
│   ├── dashboard/         # Main dashboard
│   └── apps/[appName]/    # Individual app management
├── components/            # Reusable React components
│   └── auth-guard.tsx     # Authentication wrapper
├── lib/                   # Utility libraries
│   └── api.ts            # API client for CodePush server
└── styles/               # Global styles
```

## API Integration

The frontend integrates with the CodePush server through a comprehensive API client (`src/lib/api.ts`) that handles:

- Authentication and token management
- App CRUD operations
- Deployment management
- Release history and rollback
- Error handling and response parsing

## Authentication Flow

1. **GitHub OAuth**: Redirects to server's GitHub auth endpoints
2. **Manual Token**: Direct access token entry for existing users
3. **Persistent Sessions**: Tokens stored in localStorage
4. **Auto-redirect**: Automatic navigation based on auth state

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | CodePush server URL | `http://localhost:3000` |

## Usage

### First Time Setup

1. Start the CodePush server (`cd api && npm start`)
2. Start the web dashboard (`cd web && npm run dev`)
3. Navigate to `http://localhost:3001`
4. Register/login with GitHub OAuth
5. Create your first app and deployment

### Managing Apps

- **Create App**: Use the "Create App" button on the dashboard
- **View Details**: Click "Manage" on any app card
- **Delete App**: Use the "Delete" button (requires confirmation)

### Managing Deployments

- **Create Deployment**: In app view, use "Create Deployment"
- **View History**: Select a deployment to see release history
- **Rollback**: Use the "Rollback" button on the latest release
- **Delete Deployment**: Use the delete icon on deployment cards

## Development

### Tech Stack

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type safety and better DX
- **Tailwind CSS**: Utility-first styling
- **React Hooks**: Modern state management

### Key Components

- `AuthGuard`: Protects routes requiring authentication
- `Dashboard`: Main app listing and management
- `AppPage`: Individual app deployment management
- `LoginPage`: Authentication interface

### API Client

The API client provides typed interfaces and handles:
- Request/response serialization
- Error handling and parsing
- Authentication token management
- Base URL configuration

## Deployment

### Production Build

```bash
npm run build
npm run start
```

### Docker (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **API Connection Failed**
   - Verify `NEXT_PUBLIC_API_BASE_URL` is correct
   - Ensure CodePush server is running
   - Check CORS configuration in server

2. **Authentication Issues**
   - Verify GitHub OAuth app is configured
   - Check token expiration
   - Clear localStorage and re-authenticate

3. **Build Errors**
   - Run `npm install` to update dependencies
   - Check TypeScript errors with `npm run lint`
   - Verify Node.js version compatibility

### Logs

Check browser console for client-side errors and server logs for API issues.

## Contributing

1. Follow the existing code style and patterns
2. Add TypeScript types for new features
3. Test authentication flows
4. Ensure responsive design works on mobile

## Security

- Tokens are stored in localStorage (consider httpOnly cookies for production)
- All API requests include authentication headers
- CSRF protection through SameSite cookies (server-side)
- Input validation on forms and API boundaries
