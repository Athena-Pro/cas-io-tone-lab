// V2 separates library headers from take/audio payloads. Legacy v1 records move
// once in an atomic upgrade; subsequent library lists read only small headers.
export function createTakeStore(indexedDB=globalThis.indexedDB,name='cas-grid-recordings'){
  let opened;
  const open=()=>opened||=(new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('Take storage is unavailable. Export take JSON to keep a portable copy.'));return;}
    const request=indexedDB.open(name,2);let blocked=false;
    request.onupgradeneeded=()=>{
      const db=request.result,tx=request.transaction;
      for(const store of ['takeSummaries','takePayloads','takeUndo'])if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'id'});
      if(db.objectStoreNames.contains('takes')){
        const cursor=tx.objectStore('takes').openCursor();
        cursor.onsuccess=()=>{const row=cursor.result;if(!row){db.deleteObjectStore('takes');return;}
          const record=row.value;row.delete();tx.objectStore('takeSummaries').put({id:record.id,name:record.name,savedAt:record.savedAt});tx.objectStore('takePayloads').put({id:record.id,take:record.take});row.continue();};
      }
    };
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
    request.onerror=()=>{opened=null;reject(request.error);};
    request.onblocked=()=>{blocked=true;opened=null;reject(new Error('Close older CAS tabs to update take storage.'));};
  }));
  async function run(stores,mode,action){const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;
    try{result=action(tx);}catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(typeof result==='function'?result():result?.result);
    tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not update take storage. Export JSON to keep a copy.'));
  });}
  const summary=record=>({id:record.id,name:record.name,savedAt:record.savedAt});
  return {
    list:()=>run(['takeSummaries'],'readonly',tx=>tx.objectStore('takeSummaries').getAll()),
    hasDeleted:()=>run(['takeUndo'],'readonly',tx=>{const request=tx.objectStore('takeUndo').getKey('last');return ()=>request.result!==undefined;}),
    get:id=>run(['takeSummaries','takePayloads'],'readonly',tx=>{const header=tx.objectStore('takeSummaries').get(id),payload=tx.objectStore('takePayloads').get(id);return ()=>header.result&&payload.result?{...header.result,take:{...payload.result.take,name:header.result.name}}:undefined;}),
    put:record=>run(['takeSummaries','takePayloads'],'readwrite',tx=>{tx.objectStore('takeSummaries').put(summary(record));return tx.objectStore('takePayloads').put({id:record.id,take:record.take});}),
    rename:(id,name)=>run(['takeSummaries'],'readwrite',tx=>{
      name=String(name||'').trim().slice(0,120);if(!name)throw new Error('Enter a take name before renaming.');
      const store=tx.objectStore('takeSummaries'),request=store.get(id);let renamed=false;
      request.onsuccess=()=>{if(request.result){store.put({...request.result,name});renamed=true;}};return ()=>renamed;
    }),
    remove:id=>run(['takeSummaries','takePayloads','takeUndo'],'readwrite',tx=>{
      const headers=tx.objectStore('takeSummaries'),payloads=tx.objectStore('takePayloads'),header=headers.get(id),payload=payloads.get(id);let ready=0,removed=false;
      const finish=()=>{if(++ready!==2||!header.result||!payload.result)return;tx.objectStore('takeUndo').put({id:'last',record:{...header.result,take:payload.result.take}});headers.delete(id);payloads.delete(id);removed=true;};header.onsuccess=payload.onsuccess=finish;return ()=>removed;
    }),
    restoreDeleted:()=>run(['takeSummaries','takePayloads','takeUndo'],'readwrite',tx=>{
      const undo=tx.objectStore('takeUndo'),request=undo.get('last');let restored;
      request.onsuccess=()=>{const record=request.result?.record;if(!record)return;tx.objectStore('takeSummaries').put(summary(record));tx.objectStore('takePayloads').put({id:record.id,take:record.take});undo.delete('last');restored=record.id;};return ()=>restored;
    }),
    close:async()=>{if(opened)(await opened).close();opened=null;}
  };
}
