export function rncpIdFromSearch(search: string) {
  const id = new URLSearchParams(search).get("rncp") ?? "";
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? id : "";
}
