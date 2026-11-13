import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { importEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('client-import', importEndpoint));
