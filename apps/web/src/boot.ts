// Runs before any other module (imported first in main.tsx): the router reads the URL when App is
// evaluated, so invitation/reset links must be captured and rewritten before that happens.
import { captureAuthLink, resumeAuth } from './lib/auth';

captureAuthLink(); // invitation / password-reset links carry the session in the URL fragment
resumeAuth();      // keep an existing Supabase session's token fresh
