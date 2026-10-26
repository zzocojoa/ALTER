/** 서버와 브라우저의 첫 렌더링을 일치시킨 뒤 상호작용을 허용합니다. */
export function subscribeToHydration(): () => void { return () => undefined; }
export function clientReady(): boolean { return true; }
export function serverReady(): boolean { return false; }
