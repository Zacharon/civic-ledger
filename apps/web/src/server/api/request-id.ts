export const REQUEST_ID_HEADER = 'x-request-id';

// Inbound ids are echoed into logs and responses, so accept only a safe, bounded alphabet.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFrom(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  return inbound && VALID_REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
}
