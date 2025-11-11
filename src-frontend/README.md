# Cognito Authentication Frontend

This directory contains frontend components and utilities for AWS Cognito authentication integration.

## Files

- `cognito-config.ts` - Configuration file for Cognito User Pool and Identity Pool settings
- `useCognitoAuth.ts` - React hook for authentication state management and methods
- `AuthExample.tsx` - Example React component demonstrating authentication flows
- `README.md` - This documentation file

## Setup

### 1. Install Dependencies

For a React application, you'll need to install AWS Amplify:

```bash
npm install aws-amplify
# or
yarn add aws-amplify
```

### 2. Configure Cognito

After deploying your CDK stack, update the configuration in `cognito-config.ts`:

```typescript
export const devCognitoConfig: CognitoConfig = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_XXXXXXXXX', // From CDK deployment
  userPoolClientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX', // From CDK deployment
  identityPoolId: 'us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', // From CDK deployment
  domain: 'dev.example.com', // Your CloudFront domain
  googleClientId: 'your-google-client-id.apps.googleusercontent.com', // Your Google OAuth Client ID
};
```

### 3. Initialize Amplify

In your main application file (e.g., `App.tsx` or `index.tsx`):

```typescript
import { Amplify } from 'aws-amplify';
import { getAmplifyConfig } from './cognito-config';

// Initialize Amplify with your configuration
Amplify.configure(getAmplifyConfig('dev')); // or 'prod'
```

### 4. Use the Authentication Hook

```typescript
import { useCognitoAuth } from './useCognitoAuth';

function MyComponent() {
  const { isAuthenticated, user, signIn, signOut, signInWithGoogle } = useCognitoAuth('dev');

  if (isAuthenticated) {
    return (
      <div>
        <p>Welcome, {user?.email}!</p>
        <button onClick={signOut}>Sign Out</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => signInWithGoogle()}>Sign in with Google</button>
    </div>
  );
}
```

## Authentication Flows

### 1. Email/Password Authentication

```typescript
const { signIn, signUp, confirmSignUp } = useCognitoAuth();

// Sign up
await signUp('user@example.com', 'password123', 'John', 'Doe');

// Confirm sign up
await confirmSignUp('user@example.com', '123456');

// Sign in
await signIn('user@example.com', 'password123');
```

### 2. Google OAuth Authentication

```typescript
const { signInWithGoogle } = useCognitoAuth();

// Sign in with Google
await signInWithGoogle();
```

### 3. Password Reset

```typescript
const { forgotPassword, confirmForgotPassword } = useCognitoAuth();

// Request password reset
await forgotPassword('user@example.com');

// Confirm password reset
await confirmForgotPassword('user@example.com', '123456', 'newpassword123');
```

## Environment Configuration

The configuration supports multiple environments:

- `dev` - Development environment
- `prod` - Production environment

Switch between environments by passing the environment parameter:

```typescript
const auth = useCognitoAuth('prod'); // Use production configuration
```

## Google OAuth Setup

To enable Google OAuth authentication:

1. **Create Google OAuth Credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URIs:
     - `https://localhost:3000/callback` (for development)
     - `https://your-domain.com/callback` (for production)

2. **Update Configuration**:
   - Add your Google Client ID to `cognito-config.ts`
   - Update the CDK configuration with your Google OAuth credentials

3. **Configure Cognito**:
   - The CDK stack will automatically configure the Google identity provider
   - Update callback URLs in the user pool client configuration

## Security Considerations

- Never expose sensitive credentials in client-side code
- Use environment variables for configuration in production
- Implement proper error handling for authentication failures
- Consider implementing rate limiting for authentication attempts
- Use HTTPS for all authentication flows

## Troubleshooting

### Common Issues

1. **"Invalid client" error**: Check that your User Pool Client ID is correct
2. **"User not found" error**: Ensure the user exists in the User Pool
3. **Google OAuth errors**: Verify your Google Client ID and redirect URIs
4. **CORS errors**: Ensure your domain is added to the allowed origins

### Debug Mode

Enable debug logging by setting the log level:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.Logger.LOG_LEVEL = 'DEBUG';
```

## Example Implementation

See `AuthExample.tsx` for a complete implementation example that includes:

- Sign in/Sign up forms
- Google OAuth integration
- Email confirmation
- Password reset
- Error handling
- Loading states

## Next Steps

1. Deploy your CDK stack to get the actual Cognito resource IDs
2. Update the configuration with real values
3. Implement the authentication in your frontend application
4. Test all authentication flows
5. Add proper error handling and user feedback
6. Implement role-based access control if needed
