/**
 * Cognito Client Configuration
 * 
 * This file contains the configuration for AWS Cognito authentication.
 * Update these values with your actual Cognito User Pool and Identity Pool IDs
 * after deploying your CDK stack.
 */

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  domain?: string;
  googleClientId?: string;
}

// Development configuration
export const devCognitoConfig: CognitoConfig = {
  region: 'us-east-1',
  userPoolId: 'YOUR_USER_POOL_ID', // Replace with actual User Pool ID from CDK deployment
  userPoolClientId: 'YOUR_USER_POOL_CLIENT_ID', // Replace with actual User Pool Client ID from CDK deployment
  identityPoolId: 'YOUR_IDENTITY_POOL_ID', // Replace with actual Identity Pool ID from CDK deployment
  domain: 'dev.example.com', // Your CloudFront domain
  googleClientId: 'YOUR_GOOGLE_CLIENT_ID', // Your Google OAuth Client ID
};

// Production configuration (update as needed)
export const prodCognitoConfig: CognitoConfig = {
  region: 'us-east-1',
  userPoolId: 'YOUR_PROD_USER_POOL_ID',
  userPoolClientId: 'YOUR_PROD_USER_POOL_CLIENT_ID',
  identityPoolId: 'YOUR_PROD_IDENTITY_POOL_ID',
  domain: 'prod.example.com',
  googleClientId: 'YOUR_PROD_GOOGLE_CLIENT_ID',
};

// Get configuration based on environment
export function getCognitoConfig(environment: 'dev' | 'prod' = 'dev'): CognitoConfig {
  return environment === 'prod' ? prodCognitoConfig : devCognitoConfig;
}

// AWS Amplify configuration object
export function getAmplifyConfig(environment: 'dev' | 'prod' = 'dev') {
  const config = getCognitoConfig(environment);
  
  return {
    Auth: {
      region: config.region,
      userPoolId: config.userPoolId,
      userPoolWebClientId: config.userPoolClientId,
      identityPoolId: config.identityPoolId,
      oauth: {
        domain: config.domain,
        scope: ['email', 'openid', 'profile'],
        redirectSignIn: [
          'https://localhost:3000/callback',
          `https://${config.domain}/callback`,
        ],
        redirectSignOut: [
          'https://localhost:3000/logout',
          `https://${config.domain}/logout`,
        ],
        responseType: 'code',
      },
    },
  };
}

// Cognito Identity SDK configuration
export function getCognitoIdentityConfig(environment: 'dev' | 'prod' = 'dev') {
  const config = getCognitoConfig(environment);
  
  return {
    region: config.region,
    identityPoolId: config.identityPoolId,
  };
}
