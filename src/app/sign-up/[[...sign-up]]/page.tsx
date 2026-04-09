import { SignUp } from '@clerk/nextjs';
export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return <SignUp fallbackRedirectUrl="/dashboard" />;
}
