export function useRouter():Readonly<{refresh:()=>void}> {return {refresh:()=>{window.dispatchEvent(new Event("fixture-router-refresh"));}};}
