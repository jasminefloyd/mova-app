import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { consentsEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('client-consents', consentsEndpoint));
