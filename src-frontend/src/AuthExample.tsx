import React, { useState } from 'react';
import { useCognitoAuth } from './useCognitoAuth';

/**
 * Example React component demonstrating Cognito authentication
 * 
 * This component shows how to use the useCognitoAuth hook for authentication.
 * It includes forms for sign in, sign up, and Google OAuth integration.
 */

export const AuthExample: React.FC = () => {
  const {
    isAuthenticated,
    user,
    isLoading,
    error,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    confirmSignUp,
    resendConfirmationCode,
    forgotPassword,
    confirmForgotPassword,
  } = useCognitoAuth('dev');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showSignUp, setShowSignUp] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signIn(email, password);
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signUp(email, password, givenName, familyName);
      setShowConfirmation(true);
    } catch (error) {
      console.error('Sign up error:', error);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign in error:', error);
    }
  };

  const handleConfirmSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await confirmSignUp(email, confirmationCode);
      setShowConfirmation(false);
    } catch (error) {
      console.error('Confirmation error:', error);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await forgotPassword(email);
      setShowResetPassword(true);
    } catch (error) {
      console.error('Forgot password error:', error);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await confirmForgotPassword(email, confirmationCode, newPassword);
      setShowResetPassword(false);
      setShowForgotPassword(false);
    } catch (error) {
      console.error('Reset password error:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Welcome!</h2>
        <div className="mb-4">
          <p><strong>Email:</strong> {user.email}</p>
          {user.givenName && <p><strong>Name:</strong> {user.givenName} {user.familyName}</p>}
          {user.picture && (
            <img 
              src={user.picture} 
              alt="Profile" 
              className="w-16 h-16 rounded-full mt-2"
            />
          )}
        </div>
        <button
          onClick={signOut}
          className="w-full bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">
        {showSignUp ? 'Sign Up' : 'Sign In'}
      </h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {showConfirmation ? (
        <form onSubmit={handleConfirmSignUp} className="space-y-4">
          <h3 className="text-lg font-semibold">Confirm Your Email</h3>
          <p className="text-sm text-gray-600">
            Please enter the confirmation code sent to {email}
          </p>
          <input
            type="text"
            placeholder="Confirmation Code"
            value={confirmationCode}
            onChange={(e) => setConfirmationCode(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded"
            required
          />
          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => resendConfirmationCode(email)}
            className="w-full bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
          >
            Resend Code
          </button>
        </form>
      ) : showResetPassword ? (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <h3 className="text-lg font-semibold">Reset Password</h3>
          <input
            type="text"
            placeholder="Confirmation Code"
            value={confirmationCode}
            onChange={(e) => setConfirmationCode(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded"
            required
          />
          <input
            type="password"
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded"
            required
          />
          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
          >
            Reset Password
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={showSignUp ? handleSignUp : handleSignIn} className="space-y-4">
            {showSignUp && (
              <>
                <input
                  type="text"
                  placeholder="First Name"
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </>
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded"
              required
            />
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
            >
              {showSignUp ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4">
            <button
              onClick={handleGoogleSignIn}
              className="w-full bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600"
            >
              Sign in with Google
            </button>
          </div>

          <div className="mt-4 text-center space-y-2">
            <button
              onClick={() => setShowSignUp(!showSignUp)}
              className="text-blue-500 hover:underline"
            >
              {showSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>
            
            {!showSignUp && (
              <button
                onClick={() => setShowForgotPassword(true)}
                className="block text-blue-500 hover:underline"
              >
                Forgot Password?
              </button>
            )}
          </div>

          {showForgotPassword && (
            <form onSubmit={handleForgotPassword} className="mt-4 space-y-4">
              <h3 className="text-lg font-semibold">Reset Password</h3>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
                required
              />
              <button
                type="submit"
                className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
              >
                Send Reset Code
              </button>
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-full bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
};

export default AuthExample;
