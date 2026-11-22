export function readCustomerLink(path: string, key: string, signal?: AbortSignal) {
  return fetch("/api/portal/cliente" + path, {cache: "no-store", credentials: "omit", redirect: "error",
    referrerPolicy: "no-referrer", headers: {Authorization: "Bearer " + key}, signal});
}
