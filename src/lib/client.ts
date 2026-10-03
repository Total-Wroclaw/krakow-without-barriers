export async function postJson(url:string,body:unknown,timeout=35000){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await res.json();if(!res.ok)throw new Error(data.error??'Nie udało się wykonać żądania. Spróbuj ponownie.');return data;
 }catch(e){if(e instanceof DOMException&&e.name==='AbortError')throw new Error('Przekroczono czas oczekiwania. Spróbuj ponownie albo uzupełnij formularz ręcznie.');throw e;
 }finally{clearTimeout(timer);}
}
