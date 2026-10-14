/**
 * فراخوانی مسیرهای API از سمت مرورگر (همه با کوکی نشست).
 * هر خطا یک Error فارسی با فیلد status برمی‌گرداند.
 */

export async function request(path, { method = 'GET', body, multipart = false } = {}) {
  const options = { method, cache: 'no-store', credentials: 'same-origin' };
  if (body !== undefined) {
    if (multipart) {
      options.body = body;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `خطای سرور (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export const login = (identifier, password) =>
  request('/api/auth/login', { method: 'POST', body: { identifier, password } });

export const logout = () => request('/api/auth/logout', { method: 'POST', body: {} });

export const fetchSession = () => request('/api/auth/me');

export const updateCredentials = (payload) =>
  request('/api/auth/credentials', { method: 'POST', body: payload });

export const fetchSettings = () => request('/api/settings');

export const saveSettings = (patch) => request('/api/settings', { method: 'POST', body: patch });

export const testDeepseekKey = (payload) =>
  request('/api/settings/test-key', { method: 'POST', body: payload });

export const fetchDeepseekStatus = () => request('/api/deepseek');

export const convertWithUrl = (payload) => request('/api/convert', { method: 'POST', body: payload });

export const convertWithFile = (formData) =>
  request('/api/convert', { method: 'POST', multipart: true, body: formData });

/** بدون throw: اگر کاربر وارد نشده باشد { authenticated: false } برمی‌گرداند */
export async function fetchSessionQuiet() {
  try {
    return await fetchSession();
  } catch (error) {
    return { ok: false, authenticated: false, status: error?.status || 0, error: error?.message || '' };
  }
}
