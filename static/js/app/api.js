// Server calls. A 401 means the sign-in expired: go back to the sign-in page.
export class ApiError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new ApiError('Please sign in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : `Something went wrong (${res.status}).`);
  return data;
}

export function upload(file, onProgress, url = '/api/jobs') {
  let xhr;
  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'file'));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 401) { location.href = '/login'; return; }
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status !== 200) reject(new ApiError(body.detail || 'Upload failed.'));
      else resolve(body);
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.'));
    xhr.send(file);
  });
  promise.abort = () => xhr?.abort();
  return promise;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function deleteJob(id) {
  if (id) navigator.sendBeacon(`/api/jobs/${id}/delete`);
}
