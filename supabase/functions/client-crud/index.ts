import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { clientsEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('client-crud', clientsEndpoint));
