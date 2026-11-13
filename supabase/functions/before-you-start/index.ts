import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { beforeYouStartEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('before-you-start', beforeYouStartEndpoint));
