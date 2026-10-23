export function validateAudioDuration(duration,maxSeconds=30){if(!Number.isFinite(duration)||duration<=0)throw new Error('Could not confirm this file’s duration safely. Convert it to WAV first.');if(duration>maxSeconds)throw new Error(`Choose a sound up to ${maxSeconds} seconds long (metadata reports ${duration.toFixed(1)} seconds).`);return duration;}
export function readAudioDuration(file,{createAudio=()=>new Audio(),createURL=f=>URL.createObjectURL(f),revokeURL=url=>URL.revokeObjectURL(url),timeoutMs=10000}={}){
  return new Promise((resolve,reject)=>{
    const element=createAudio(),url=createURL(file);let timer,done=false,seeking=false;
    const finish=(error,duration)=>{if(done)return;done=true;clearTimeout(timer);element.onloadedmetadata=element.ondurationchange=element.onseeked=element.ontimeupdate=element.onerror=null;element.removeAttribute('src');element.load();revokeURL(url);if(error)reject(error);else resolve(duration);};
    const inspect=()=>{if(done)return;if(Number.isFinite(element.duration)&&element.duration>0){finish(null,element.duration);return;}if(!seeking){seeking=true;try{element.currentTime=1e7;}catch{finish(new Error('Could not determine the recording duration. Convert it to WAV first.'));}}};
    element.preload='metadata';element.onloadedmetadata=inspect;element.ondurationchange=element.onseeked=element.ontimeupdate=()=>{if(Number.isFinite(element.duration)&&element.duration>0)finish(null,element.duration);};
    element.onerror=()=>finish(new Error('Audio metadata could not be read. Try WAV, MP3 or another supported format.'));timer=setTimeout(()=>finish(new Error('Audio metadata timed out. Convert the sound to WAV first.')),timeoutMs);element.src=url;
  });
}
export async function decodeAudioFile(file,context,{probe=readAudioDuration,onStage=()=>{}}={}){
  if(file.size>64*1048576)throw new Error('Choose an audio file under 64 MiB.');onStage('Reading audio metadata');const duration=validateAudioDuration(await probe(file));onStage(`Decoding ${duration.toFixed(2)} seconds`);const decoded=await context.decodeAudioData(await file.arrayBuffer());validateAudioDuration(decoded.duration);return decoded;
}
