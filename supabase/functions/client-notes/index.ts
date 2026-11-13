import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { notesEndpoint } from '../_shared/clients.ts';
Deno.serve(withSystemRequestLogging('client-notes', notesEndpoint));
