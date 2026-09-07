// Thin fetch wrapper. Uses cookies (credentials: include) for auth.
async function request(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && data.error) || `Erreur ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),

  // auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  changePassword: (current, next) => request('POST', '/auth/change-password', { current, next }),

  // employees
  employees: () => request('GET', '/employees'),
  createEmployee: (e) => request('POST', '/employees', e),
  updateEmployee: (id, e) => request('PUT', `/employees/${id}`, e),
  deleteEmployee: (id) => request('DELETE', `/employees/${id}`),
  availability: (id) => request('GET', `/employees/${id}/availability`),
  addAvailability: (id, a) => request('POST', `/employees/${id}/availability`, a),
  delAvailability: (id, availId) => request('DELETE', `/employees/${id}/availability/${availId}`),

  // absences
  absences: () => request('GET', '/absences'),
  createAbsence: (a) => request('POST', '/absences', a),
  updateAbsence: (id, a) => request('PUT', `/absences/${id}`, a),
  deleteAbsence: (id) => request('DELETE', `/absences/${id}`),

  // unavailabilities
  unavailabilities: () => request('GET', '/unavailabilities'),
  createUnavailability: (u) => request('POST', '/unavailabilities', u),
  updateUnavailability: (id, u) => request('PUT', `/unavailabilities/${id}`, u),
  deleteUnavailability: (id) => request('DELETE', `/unavailabilities/${id}`),

  // schedules
  previewDates: (start) => request('GET', `/schedules/preview-dates?start_date=${start}`),
  generate: (start_date, label) => request('POST', '/schedules/generate', { start_date, label }),
  schedules: () => request('GET', '/schedules'),
  schedule: (id) => request('GET', `/schedules/${id}`),
  dashboard: () => request('GET', '/schedules/dashboard'),
  updateShift: (shiftId, patch) => request('PUT', `/schedules/shifts/${shiftId}`, patch),
  validate: (id) => request('POST', `/schedules/${id}/validate`),
  duplicate: (id) => request('POST', `/schedules/${id}/duplicate`),
  archive: (id) => request('POST', `/schedules/${id}/archive`),
  setScheduleStatus: (id, status) => request('POST', `/schedules/${id}/status`, { status }),
  deleteSchedule: (id) => request('DELETE', `/schedules/${id}`),
  exportUrl: (id) => `/api/schedules/${id}/export.xlsx`,

  // settings & stats
  settings: () => request('GET', '/settings'),
  saveSettings: (partial) => request('PUT', '/settings', partial),
  resetSettings: () => request('POST', '/settings/reset'),
  stats: (period) => request('GET', `/stats?period=${period}`),
};
