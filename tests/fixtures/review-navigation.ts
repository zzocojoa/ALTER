export function useRouter():Readonly<{push:(href:string)=>void}> {return {push:(href:string):void=>{window.history.pushState(null,"",href);}};}
