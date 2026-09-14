import { resolveService, SERVICE } from '../../../services/serviceRegistry.js';
import * as applicationsApi from './applicationsApi.js';

/** Resolves the Applications service actually in use. See jobsService.js. */
export function getApplicationsService() {
  return resolveService(SERVICE.APPLICATIONS, applicationsApi);
}
