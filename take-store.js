// IndexedDB keeps source PCM and takes off the small synchronous localStorage quota.
export function createTakeStore(indexedDB=globalThis.indexedDB){
  let opened;
  const open=()=>opened||=(new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('Take storage is unavailable. Export take JSON to keep a portable copy.'));return;}
    const request=indexedDB.open('cas-grid-recordings',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('takes',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opened=null;reject(request.error);};
    request.onblocked=()=>{opened=null;reject(new Error('Close older CAS tabs to update take storage.'));};
  }));
  async function transaction(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('takes',mode),request=action(tx.objectStore('takes'));tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error||request.error||new Error('Could not store this take. Export JSON instead.'));});}
  async function list(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readonly'),request=tx.objectStore('takes').openCursor(),records=[];request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const {id,name,savedAt}=cursor.value;records.push({id,name,savedAt});cursor.continue();};tx.oncomplete=()=>resolve(records);tx.onerror=tx.onabort=()=>reject(tx.error||request.error);});}
  return {list,get:id=>transaction('readonly',s=>s.get(id)),put:record=>transaction('readwrite',s=>s.put(record))};
}
