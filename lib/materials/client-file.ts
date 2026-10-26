/** 브라우저에서 크기 검증을 통과한 파일의 해시를 구합니다. */
export async function hashClientFile(file:File):Promise<string> {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),(value:number):string=>value.toString(16).padStart(2,"0")).join("");}
