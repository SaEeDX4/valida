import { resolveService, SERVICE } from '../../../services/serviceRegistry.js';
import * as jobsApi from './jobsApi.js';

/**
 * Resolves the Jobs service actually in use.
 *
 * In production this always returns the real API module: the registry holds no
 * override, because nothing in the production bundle installs one.
 */
export function getJobsService() {
  return resolveService(SERVICE.JOBS, jobsApi);
}
