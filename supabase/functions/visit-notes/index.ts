import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { visitNotesEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('visit-notes', visitNotesEndpoint));
