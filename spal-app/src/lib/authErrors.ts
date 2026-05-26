const ERROR_MAP: [string, string][] = [
  ['Invalid login credentials',                  'Incorrect email or password.'],
  ['Email not confirmed',                        'Please confirm your email address before signing in.'],
  ['User already registered',                    'An account with this email already exists.'],
  ['Password should be at least 6 characters',  'Password must be at least 6 characters.'],
  ['For security purposes, you can only request this after',
                                                 'Please wait a moment before requesting another reset email.'],
  ['Token has expired or is invalid',            'This link has expired. Please request a new one.'],
  ['New password should be different',           'Please choose a different password to your current one.'],
]

export function friendlyAuthError(message: string): string {
  for (const [key, friendly] of ERROR_MAP) {
    if (message.includes(key)) return friendly
  }
  return 'Something went wrong. Please try again.'
}
