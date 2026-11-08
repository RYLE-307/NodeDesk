import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { SshTerminal } from "./SshTerminal";
import type { Connection } from "./catalog";
import { childPath, parentPath, portableName, progressPercent, transferAllowed, transferBatchPlan, startBatch, updateBatchItem, finishBatch, remainingBatchIndexes, retryBatchPlan, redactedTransferReport, visibleEntries, OperationGate } from "./filesModel";
import type { BatchItem, BatchItemState, FileEntry, Listing, Progress } from "./filesModel";
import {adjacentMatch, countLiteral, replaceAllLiteral, replaceLiteralSelection,
  MAX_REPLACEMENTS, MAX_SEARCH_TERM} from "./textEditorSearch";
import {forgetRecovery, listRecoveries, recoverySlotsAvailable, saveRecovery} from "./queueRecovery";
import type {RecoveryEndpoint, RecoveryPartial, RecoveryRecord} from "./queueRecovery";

type PendingTransferPlan = {
  id:string;
  names:string[]; upload:boolean; localDirectory:string; remoteDirectory:string;
  connectionKey:string; sourceEntries:FileEntry[]; localVersion:number; remoteVersion:number;
};
type QueueSnapshot = {id:string;plan:PendingTransferPlan;items:BatchItem[];
  partialUpload:{index:number;previousId:string}|null;
  partialDownload:{index:number;previousId:string}|null;finished:boolean};

export function FileBrowser({ connection, language }: { connection: Connection; language: "ru" | "en" }) {
  const ru = language === "ru";
  const recoveryEndpoint:RecoveryEndpoint={
    host:connection.host,port:connection.port,username:connection.username
  };
  const [local, setLocal] = useState<Listing | null>(null), [remote, setRemote] = useState<Listing | null>(null);
  const [localPath, setLocalPath] = useState(""), [remotePath, setRemotePath] = useState(".");
  const [localSelection, selectLocal] = useState(""), [remoteSelection, selectRemote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null), [cancelling, setCancelling] = useState(false);
  const gate = useRef(new OperationGate()), mounted = useRef(true);
  const [authSession, setAuthSession] = useState<string | null>(null), [authReady, setAuthReady] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [identity, setIdentity] = useState("");
  const [capabilities, setCapabilities] = useState<{interactiveLogin:boolean;keyAgent:boolean;nativeLogin?:boolean}|null>(null);
  useEffect(() => {
    let alive=true;
    if (!isTauri()) return;
    void invoke<{interactiveLogin:boolean;keyAgent:boolean;nativeLogin?:boolean}>("files_capabilities")
      .then(value => {
        if (!alive) return;
        setCapabilities(value);
        setInteractive(value.interactiveLogin);
      })
      .catch(() => {
        if (!alive) return;
        setCapabilities({interactiveLogin:false,keyAgent:false});
        setInteractive(false);
      });
    return () => {alive=false;};
  }, []);
  const [dropTarget, setDropTarget] = useState<"local" | "remote" | null>(null);
  const [batchLocal,setBatchLocal] = useState<string[]>([]), [batchRemote,setBatchRemote] = useState<string[]>([]);
  const [queueProgress,setQueueProgress] = useState<{index:number;total:number;name:string}|null>(null);
  const [batchReport,setBatchReport] = useState<BatchItem[]>([]);
  const [batchFinished,setBatchFinished] = useState(false);
  const stopQueue = useRef(false);
  const pauseQueue = useRef(false);
  const [retryPlan,setRetryPlan] = useState<PendingTransferPlan|null>(null);
  const [queueArchive,setQueueArchive] = useState<QueueSnapshot[]>([]);
  const [partialUpload,setPartialUpload] = useState<{index:number;previousId:string}|null>(null);
  const [partialDownload,setPartialDownload] = useState<{index:number;previousId:string}|null>(null);
  // Recovery is explicitly opt-in and contains only file names, metadata,
  // folders and endpoint identity. Never credentials, content or authSession.
  const [keepRecovery,setKeepRecovery] = useState(false);
  const recoveryEnabled=useRef(false);
  const [savedRecoveries,setSavedRecoveries] = useState<RecoveryRecord[]>(()=>
    typeof window==="undefined"?[]:listRecoveries(window.localStorage,recoveryEndpoint));
  const listingVersion=useRef({local:0,remote:0});
  const [localFilter,setLocalFilter] = useState(""), [remoteFilter,setRemoteFilter] = useState("");
  const filteredLocal = useMemo(() => visibleEntries(local?.entries ?? [],localFilter),[local,localFilter]);
  const filteredRemote = useMemo(() => visibleEntries(remote?.entries ?? [],remoteFilter),[remote,remoteFilter]);
  const [context, setContext] = useState<{isRemote:boolean;name:string|null;x:number;y:number}|null>(null);
  const [preview, setPreview] = useState<{name:string;content:string;bytes:number}|null>(null);
  const [editing,setEditing] = useState(false);
  const [editDraft,setEditDraft] = useState("");
  const [saveName,setSaveName] = useState("");
  const [savedCopy,setSavedCopy] = useState<{name:string;sourceUnchanged:boolean}|null>(null);
  const [findText,setFindText] = useState("");
  const [replaceText,setReplaceText] = useState("");
  const [searchNotice,setSearchNotice] = useState("");
  const editorArea=useRef<HTMLTextAreaElement>(null);
  const matchCount=useMemo(()=>countLiteral(editDraft,findText),[editDraft,findText]);
  function clearEditor(){
    setPreview(null);setEditing(false);setEditDraft("");
    setSavedCopy(null);setFindText("");setReplaceText("");setSearchNotice("");
  }
  const editBytes = new TextEncoder().encode(editDraft).length;
  function canDiscardEdits():boolean {
    return !(preview && editDraft!==preview.content) ||
      window.confirm(ru?"Несохранённые изменения исчезнут. Продолжить?":"Unsaved edits will be lost. Continue?");
  }
  const profile = JSON.stringify([connection.host,connection.port,connection.username]);
  const currentProfile=useRef(profile);
  currentProfile.current=profile;
  useEffect(()=>{
    setSavedRecoveries(listRecoveries(window.localStorage,recoveryEndpoint));
    setIdentity("");
    recoveryEnabled.current=false;setKeepRecovery(false);
  },[profile]);
  function discardCheckpoint(queueId?:string){
    forgetRecovery(window.localStorage,recoveryEndpoint,queueId);
    setSavedRecoveries(listRecoveries(window.localStorage,recoveryEndpoint));
  }
  function checkpoint(plan:PendingTransferPlan,items:readonly BatchItem[],
    partial:RecoveryPartial|null):void {
    if(!recoveryEnabled.current)return;
    const state:RecoveryRecord={
      version:1,endpoint:{...recoveryEndpoint},queueId:plan.id,upload:plan.upload,
      localDirectory:plan.localDirectory,remoteDirectory:plan.remoteDirectory,
      names:[...plan.names],sourceEntries:plan.sourceEntries.map(item=>({...item})),
      items:items.map(item=>({...item})),partial,savedAt:Date.now()
    };
    if(items.every(item=>item.state==="done")){
      discardCheckpoint(plan.id);return;
    }
    if(saveRecovery(window.localStorage,state)) {
      setSavedRecoveries(listRecoveries(window.localStorage,recoveryEndpoint));
    }else{
      // Disable storage if disabled/quota exceeded; transfers still work.
      recoveryEnabled.current=false;setKeepRecovery(false);
      setError(ru?"Не удалось сохранить контрольную точку очереди. Продолжение после перезапуска недоступно.":
        "Cannot save queue checkpoint. Recovery after restart is unavailable.");
    }
  }
  function downloadRedactedReport(){
    if(!batchReport.length || !retryPlan || busy)return;
    const report=redactedTransferReport(batchReport,retryPlan.upload,new Date().toISOString());
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
    const link=document.createElement("a");
    link.href=url;link.download="nodedesk-transfer-report-redacted.json";
    document.body.append(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function archiveCurrent():boolean {
    if(!retryPlan || !batchReport.length)return true;
    if(queueArchive.length>=7){setError(ru?"Лимит: 8 очередей. Удали одну перед созданием новой.":
      "Limit: 8 queues. Clear one before creating another.");return false;}
    setQueueArchive(current=>[...current,{id:retryPlan.id,plan:retryPlan,
      items:batchReport,partialUpload,partialDownload,finished:batchFinished}]);
    return true;
  }
  function selectArchivedQueue(id:string){
    if(busy || gate.current.id)return;
    const selected=queueArchive.find(q=>q.id===id);
    if(!selected)return;
    setQueueArchive(current=>[
      ...current.filter(q=>q.id!==id),
      ...(retryPlan && batchReport.length?[{id:retryPlan.id,plan:retryPlan,
        items:batchReport,partialUpload,partialDownload,finished:batchFinished}]:[])
    ]);
    setRetryPlan(selected.plan);setBatchReport(selected.items);
    setPartialUpload(selected.partialUpload);setPartialDownload(selected.partialDownload);
    setBatchFinished(selected.finished);setQueueProgress(null);
  }
  function restoreCheckpoint(savedRecovery:RecoveryRecord){
    if(busy || gate.current.id)return;
    if(interactive && !authReady){
      setError(ru?"Сначала выполни вход для файлов, затем загрузи сохранённую очередь.":
        "Complete Files login first, then load the saved queue.");
      return;
    }
    const restored=listRecoveries(window.localStorage,recoveryEndpoint)
      .find(item=>item.queueId===savedRecovery.queueId && item.savedAt===savedRecovery.savedAt);
    if(!restored){
      setSavedRecoveries(listRecoveries(window.localStorage,recoveryEndpoint));setError(ru?"Контрольная точка устарела или недействительна.":
        "Recovery checkpoint expired or is invalid.");return;
    }
    if(retryPlan?.id===restored.queueId)return;
    if(queueArchive.some(q=>q.id===restored.queueId)){
      selectArchivedQueue(restored.queueId!);return;
    }
    if(!archiveCurrent())return;
    const plan:PendingTransferPlan={
      id:restored.queueId??crypto.randomUUID(),
      names:[...restored.names],upload:restored.upload,
      localDirectory:restored.localDirectory,remoteDirectory:restored.remoteDirectory,
      sourceEntries:restored.sourceEntries.map(entry=>({...entry})),
      connectionKey:profile,
      localVersion:listingVersion.current.local,remoteVersion:listingVersion.current.remote
    };
    setRetryPlan(plan);setBatchReport(restored.items);setBatchFinished(true);
    setPartialUpload(restored.upload?restored.partial:null);
    setPartialDownload(restored.upload?null:restored.partial);
    setQueueProgress(null);
    recoveryEnabled.current=true;setKeepRecovery(true);
    setStatus(ru?"Очередь загружена без передачи. Обнови обе панели и вручную подтверди повтор.":
      "Queue loaded without transfer. Refresh BOTH panes and confirm retry manually.");
  }
  const destination = {host:connection.host,port:connection.port,username:connection.username,
    authSession:interactive ? authSession : null,identity:!interactive && identity.trim() ? identity.trim() : null};
  useEffect(() => {
    setAuthReady(false);
    if (!authSession || !interactive) return;
    let alive = true;
    const check = () => void invoke<boolean>("files_auth_ready",{id:authSession,host:connection.host,port:connection.port,username:connection.username})
      .then(ready => {if (alive) setAuthReady(ready);}).catch(() => {if (alive) setAuthReady(false);});
    check(); const timer = setInterval(check,1000);
    return () => {alive=false; clearInterval(timer);};
  }, [authSession,interactive,profile]);
  useEffect(() => {
    if (interactive && !authReady) {
      stopQueue.current = true;
      setRemote(null); clearEditor(); selectRemote(""); setBatchRemote([]);
      const id=gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {});
    }
  }, [interactive,authReady]);
  useEffect(() => {
    if (!context) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".files-context-menu")) setContext(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setContext(null); };
    document.addEventListener("pointerdown",dismiss);
    document.addEventListener("keydown",escape);
    return () => {
      document.removeEventListener("pointerdown",dismiss);
      document.removeEventListener("keydown",escape);
    };
  }, [context]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopQueue.current = true; const id = gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {}); };
  }, []);
  // Profile edits invalidate the previous host's listing. No automatic reconnect.
  const previous = useRef(JSON.stringify(destination));
  useEffect(() => {
    const next = JSON.stringify(destination);
    if (next === previous.current) return;
    previous.current = next; stopQueue.current = true;
    setRemote(null); clearEditor(); selectRemote(""); setBatchRemote([]); setRemotePath(".");
    if(JSON.stringify([connection.host,connection.port,connection.username])!==retryPlan?.connectionKey){
      setBatchReport([]);setBatchFinished(false);setRetryPlan(null);setQueueArchive([]);
      setPartialUpload(null);setPartialDownload(null);
    }
    const id = gate.current.id; if (id) void invoke("files_cancel",{id}).catch(() => {});
  }, [connection.host, connection.port, connection.username, authSession, interactive, identity]);
  async function run<T>(task: (id: string) => Promise<T>, success: (value:T) => void): Promise<boolean> {
    if (!isTauri()) { setError(ru ? "Файлы доступны в приложении Tauri." : "Files require the Tauri desktop app."); return false; }
    const id = crypto.randomUUID(); if (!gate.current.begin(id)) return false;
    const host = JSON.stringify(destination);
    let completed = false;
    setBusy(true); setError(""); setStatus(""); setProgress(null); setCancelling(false);
    try {
      const result = await task(id);
      if (mounted.current && gate.current.owns(id) && previous.current === host) {
        success(result);
        completed = true;
      }
    } catch (e) { if (mounted.current && gate.current.owns(id)) setError(String(e)); }
    finally {
      // Close a late registration too if the component was destroyed during invoke.
      if (!mounted.current) void invoke("files_cancel",{id}).catch(() => {});
      if (gate.current.finish(id) && mounted.current) { setBusy(false); setCancelling(false); }
    }
    return completed;
  }
  function list(isRemote: boolean, path: string) {
    if(isRemote && !canDiscardEdits())return;
    if (isRemote && interactive && !authReady) { setError(ru ? "Сначала завершите вход для файлов." : "Complete Files login first."); return; }
    void run(id => invoke<Listing>("files_list",{id,destination:isRemote ? destination : null,path}), listing => {
      listingVersion.current[isRemote?"remote":"local"]++;
      if (isRemote) { setRemote(listing); clearEditor(); setRemotePath(listing.path); selectRemote(""); setBatchRemote([]); }
      else { setLocal(listing); setLocalPath(listing.path); selectLocal(""); setBatchLocal([]); }
      setStatus(ru ? "Каталог прочитан" : "Directory loaded");
    });
  }
  function transfer(upload: boolean, draggedName?: string) {
    const entry = (upload ? local : remote)?.entries.find(e => e.name === (draggedName ?? (upload ? localSelection : remoteSelection)));
    if (!transferAllowed(entry,local,remote,busy) || (interactive && !authReady)) return;
    const name = entry!.name;
    const target = upload ? remote! : local!;
    if (target.entries.some(e => e.name === name)) { setError(ru ? "Имя уже существует. Перезапись отключена." : "Destination name exists. Overwrite is disabled."); return; }
    if (!window.confirm(`${upload ? (ru ? "Загрузить на сервер" : "Upload to remote") : (ru ? "Скачать локально" : "Download locally")}\n${name}\n→ ${target.path}\n${ru ? "Без перезаписи" : "No overwrite"}?`)) return;
    const targetPath = target.path;
    setRetryPlan(null);setPartialUpload(null);setPartialDownload(null);setBatchReport([]);setBatchFinished(false);
    void run(id => {
      const events = new Channel<Progress>();
      events.onmessage = p => { if (mounted.current && gate.current.owns(id)) setProgress(p); };
      return invoke("files_transfer",{id,request:{destination,localDirectory:local!.path,remoteDirectory:remote!.path,name,upload},events});
    }, () => {
      // Clear stale destination before reloading it from the backend.
      if (upload) { setRemote(null); selectRemote(""); setBatchRemote([]); } else { setLocal(null); selectLocal(""); setBatchLocal([]); }
      setStatus(ru ? "Передача завершена" : "Transfer completed");
    }).then(ok => {
      // The first operation has released its gate before scheduling a refresh.
      // Never refresh after a cancellation, closed tab or changed connection.
      if (ok && mounted.current) list(upload,targetPath);
    });
  }
  function toggleBatch(isRemote: boolean, name: string, checked: boolean) {
    if (busy) return;
    const set = isRemote ? setBatchRemote : setBatchLocal;
    set(current => {
      if (!checked) return current.filter(item => item !== name);
      if (current.includes(name)) return current;
      if (current.length >= 50) {
        setError(ru ? "Можно выбрать максимум 50 файлов." : "Select no more than 50 files.");
        return current;
      }
      return [...current,name];
    });
  }
  /** A normal retry starts at byte zero. Byte-level resume is an explicit
   * action that verifies the entire retained partial against its source.
   * No background/autoresume, cross-session recovery or overwrites.
   */
  function executeBatch(plan:PendingTransferPlan,indexes:readonly number[],report:BatchItem[],
    resumeCandidate?:{index:number;previousId:string}){
    if(busy || gate.current.id || !indexes.length)return;
    stopQueue.current=false;
    pauseQueue.current=false;
    setBatchReport(report);setBatchFinished(false);setQueueProgress(null);
    let completed=report.filter(item=>item.state==="done").length;
    let currentItems=report.map(item=>({...item}));
    let activePartial:RecoveryPartial|null=null;
    checkpoint(plan,currentItems,activePartial);
    const mark=(index:number,state:BatchItemState)=>{
      currentItems=updateBatchItem(currentItems,index,state);
      checkpoint(plan,currentItems,activePartial);
      if(mounted.current)setBatchReport(items=>updateBatchItem(items,index,state));
    };
    const targetPath=plan.upload?plan.remoteDirectory:plan.localDirectory;
    const request={destination,localDirectory:plan.localDirectory,
      remoteDirectory:plan.remoteDirectory,upload:plan.upload};
    void run(async id=>{
      for(let offset=0;offset<indexes.length;offset++){
        if(stopQueue.current || !mounted.current || currentProfile.current!==plan.connectionKey)
          throw new Error(ru?"Очередь отменена.":"Transfer queue cancelled.");
        const index=indexes[offset],name=plan.names[index];
        activePartial=resumeCandidate?.index===index?resumeCandidate:
          {index,previousId:id};
        mark(index,"active");
        setQueueProgress({index:offset+1,total:indexes.length,name});
        setProgress(null);
        const events=new Channel<Progress>();
        events.onmessage=value=>{
          if(mounted.current && gate.current.owns(id) && !stopQueue.current)setProgress(value);
        };
        try{
          await invoke("files_transfer",{id,request:{
            ...request,name,
            retainPartial:!plan.upload,
            ...(resumeCandidate?.index===index?{resumeId:resumeCandidate.previousId}:{})
          },events});
        }catch(cause){
          const interrupted=resumeCandidate?.index===index?resumeCandidate:
            {index,previousId:id};
          if(plan.upload)setPartialUpload(interrupted);
          else setPartialDownload(interrupted);
          activePartial=interrupted;
          mark(index,pauseQueue.current?"paused":stopQueue.current?"cancelled":"failed");
          throw new Error(`${name}: ${String(cause)}`);
        }
        activePartial=null;
        mark(index,"done");completed++;
        if(resumeCandidate?.index===index){
          if(plan.upload)setPartialUpload(null);
          else setPartialDownload(null);
        }
      }
    },()=>{
      if(plan.upload){setRemote(null);selectRemote("");setBatchRemote([]);}
      else{setLocal(null);selectLocal("");setBatchLocal([]);}
      setStatus(ru?`Передано файлов: ${completed}/${plan.names.length}`:
        `Files transferred: ${completed}/${plan.names.length}`);
    }).then(ok=>{
      if(!mounted.current || currentProfile.current!==plan.connectionKey)return;
      setQueueProgress(null);
      currentItems=finishBatch(currentItems);
      checkpoint(plan,currentItems,activePartial);
      setBatchReport(items=>finishBatch(items));
      setBatchFinished(true);
      if(!completed)return;
      if(ok)list(plan.upload,targetPath);
      else if(plan.upload){setRemote(null);selectRemote("");setBatchRemote([]);}
      else{setLocal(null);selectLocal("");setBatchLocal([]);}
    });
  }
  function transferSelected(upload:boolean,draggedNames?:string[]){
    if(busy || gate.current.id || (interactive && !authReady))return;
    const source=upload?local:remote,target=upload?remote:local;
    let names:string[];
    try{names=transferBatchPlan(draggedNames ?? (upload?batchLocal:batchRemote),source,target);}
    catch(cause){setError(String(cause));return;}
    if(!source || !target)return;
    if(keepRecovery && !recoverySlotsAvailable(window.localStorage)){
      setError(ru?"Хранилище восстановления заполнено (8 очередей). Удали ненужную запись.":
        "Recovery storage is full (8 queues). Forget an old record first.");return;
    }
    const label=upload?(ru?"Загрузить на сервер":"Upload to server"):(ru?"Скачать локально":"Download locally");
    const sample=names.slice(0,12).join("\n");
    if(!window.confirm(`${label}: ${names.length} ${ru?"файлов":"files"}\n→ ${target.path}\n${sample}${names.length>12?"\n…":""}\n${ru?"Без перезаписи. Продолжить?":"No overwrite. Continue?"}`))return;
    if(!archiveCurrent())return;
    const plan:PendingTransferPlan={
      id:crypto.randomUUID(),
      names,upload,localDirectory:local!.path,remoteDirectory:remote!.path,
      connectionKey:profile,
      sourceEntries:names.map(name=>source.entries.find(entry=>entry.name===name)!),
      localVersion:listingVersion.current.local,remoteVersion:listingVersion.current.remote,
    };
    setRetryPlan(plan);setPartialUpload(null);setPartialDownload(null);
    executeBatch(plan,names.map((_,index)=>index),startBatch(names));
  }
  function retryUnfinished(resumeVerified:boolean){
    if(!retryPlan || busy || gate.current.id || !batchFinished)return;
    if(retryPlan.connectionKey!==profile){
      setError(ru?"Очередь относится к другому подключению.":"Queue belongs to a different connection.");
      return;
    }
    if(listingVersion.current.local<=retryPlan.localVersion ||
      listingVersion.current.remote<=retryPlan.remoteVersion){
      setError(ru?"Перед повтором обнови ОБЕ файловые панели.":"Refresh BOTH filesystem panes before retry.");
      return;
    }
    if(local?.path!==retryPlan.localDirectory || remote?.path!==retryPlan.remoteDirectory){
      setError(ru?"Открой обе исходные папки в том же подключении.":"Open both original folders in the same connection.");
      return;
    }
    let indexes:number[],names:string[];
    try{
      const source=retryPlan.upload?local:remote,target=retryPlan.upload?remote:local;
      ({indexes,names}=retryBatchPlan(retryPlan.names,batchReport,source,target,retryPlan.sourceEntries));
    }catch(cause){setError(String(cause));return;}
    const partial=retryPlan.upload?partialUpload:partialDownload;
    const candidate=resumeVerified && partial && indexes.includes(partial.index) ? partial:null;
    if(resumeVerified && !candidate){
      setError(ru?"Нет подтверждённой предыдущей частичной передачи.":"No previous partial transfer is available.");
      return;
    }
    const label=resumeVerified
      ? retryPlan.upload
        ? (ru?"Проверить удалённый .part перед дозаписью? При несовпадении прервать без записи.":"Verify remote .part before uploading remaining bytes? A mismatch stops without writing.")
        : (ru?"Проверить локальный .part с удалённым источником и скачать остаток? При несовпадении прервать без записи.":"Verify local .part against remote source and download only remaining bytes? A mismatch stops before writing.")
      : (ru?"Каждый незавершённый файл начнётся с нулевого байта.":"Every unfinished file restarts from byte zero.");
    if(!window.confirm(`${label}\n${names.join("\n")}\n${ru?"Готовые файлы не затрагиваются, перезапись запрещена.":"Completed files untouched; overwrite disabled."}`))return;
    const nextPlan={...retryPlan,localVersion:listingVersion.current.local,
      remoteVersion:listingVersion.current.remote};
    setRetryPlan(nextPlan);
    const toRetry=new Set(indexes);
    const report=batchReport.map((item,index)=>toRetry.has(index)?
      {...item,state:"queued" as BatchItemState}:item);
    executeBatch(nextPlan,indexes,report,candidate || undefined);
  }
  async function pauseActiveQueue(){
    if(!queueProgress || !gate.current.id)return;
    pauseQueue.current=true;
    stopQueue.current=true;
    const id=gate.current.id;
    try{await invoke("files_cancel",{id});}
    catch(e){setError(String(e));}
  }
  function showContext(isRemote: boolean, name: string|null, x: number, y: number) {
    if (name !== null) (isRemote ? selectRemote : selectLocal)(name);
    setContext({
      isRemote,name,
      x:Math.max(8,Math.min(x,window.innerWidth-198)),
      y:Math.max(8,Math.min(y,window.innerHeight-190)),
    });
  }
  function previewRemote(nameOverride?:string|null) {
    setContext(null);
    if(!canDiscardEdits())return;
    if (!remote || busy || (interactive && !authReady)) return;
    const name=nameOverride ?? remoteSelection;
    const entry=remote.entries.find(item=>item.name===name);
    if(!entry || entry.kind!=="file" || !portableName(name))return;
    clearEditor();
    void run(id=>invoke<{name:string;content:string;bytes:number}>("files_preview",{
      id,request:{destination,directory:remote.path,name}
    }),view=>{
      setPreview(view); setEditing(false); setEditDraft(view.content);
      setSaveName(view.name+".edited"); setSavedCopy(null);
      setFindText("");setReplaceText("");setSearchNotice("");
      setStatus(ru?"Текст прочитан только для просмотра":"Read-only text preview loaded");
    });
  }
  function jumpToMatch(direction:"next"|"previous"){
    const area=editorArea.current;
    if(!area || matchCount===0)return;
    const cursor=direction==="next"?area.selectionEnd:area.selectionStart;
    const match=adjacentMatch(editDraft,findText,cursor,direction);
    if(!match)return;
    area.focus();
    area.setSelectionRange(match.start,match.end);
    setSearchNotice(ru?"Совпадение выделено":"Match selected");
  }
  function replaceSelected(){
    const area=editorArea.current;
    if(!area || busy || matchCount===0)return;
    const updated=replaceLiteralSelection(editDraft,findText,replaceText,area.selectionStart,area.selectionEnd);
    if(updated===null){
      setSearchNotice(ru?"Сначала выдели точное совпадение кнопкой поиска; размер не должен превышать 128 КиБ.":"Select an exact match with Find first; result must fit in 128 KiB.");
      return;
    }
    const caret=area.selectionStart+replaceText.length;
    setEditDraft(updated);setSavedCopy(null);
    setSearchNotice(ru?"Заменено 1 совпадение (только в памяти)":"Replaced 1 match (in memory only)");
    // Restores the edit cursor on the next commit without affecting remote data.
    queueMicrotask(()=>{if(editorArea.current===area){area.focus();area.setSelectionRange(caret,caret);}});
  }
  function replaceAllMatches(){
    if(busy || matchCount===0 || matchCount>MAX_REPLACEMENTS)return;
    const updated=replaceAllLiteral(editDraft,findText,replaceText);
    if(!updated){
      setSearchNotice(ru?"Замена превышает лимит 128 КиБ или содержит недопустимые символы.":"Replacement exceeds 128 KiB or contains disallowed characters.");
      return;
    }
    if(!window.confirm(ru
      ? `Заменить ${updated.count} совпадений только в редакторе? На сервере ничего не сохранится.`
      : `Replace ${updated.count} matches in the editor only? Nothing is saved to the server.`))return;
    setEditDraft(updated.text);setSavedCopy(null);
    setSearchNotice(ru?`Заменено: ${updated.count}. Для записи нужна отдельная команда сохранения копии.`:
      `Replaced: ${updated.count}. Save as new copy is still required.`);
  }
  function saveEditedCopy(){
    if(!preview || !editing || !remote || busy || (interactive && !authReady))return;
    if(!portableName(saveName) || saveName===preview.name || editBytes>131072){
      setError(ru?"Недопустимое имя копии или текст больше 128 КиБ":"Invalid new filename or text exceeds 128 KiB");return;
    }
    if(!window.confirm(ru
      ? `Создать НОВЫЙ файл ${saveName} в ${remote.path}? Исходный ${preview.name} НЕ будет изменён. При ошибке передачи неполная копия может остаться.`
      : `Create NEW file ${saveName} in ${remote.path}? Original ${preview.name} will NOT be changed. A failed transfer may leave an incomplete copy.`))return;
    setSavedCopy(null);
    void run(id=>invoke<{name:string;bytes:number;sourceUnchanged:boolean}>("files_save_text_copy",{
      id,request:{
        destination,directory:remote.path,originalName:preview.name,
        originalContent:preview.content,newName:saveName,content:editDraft
      }
    }),saved=>{
      setSavedCopy({name:saved.name,sourceUnchanged:saved.sourceUnchanged});
      setStatus(saved.sourceUnchanged
        ? (ru?"Новая копия создана; исходный файл не изменён":"New copy created; original remains unchanged")
        : (ru?"Копия создана, но исходный файл изменился — проверь обе версии":"Copy created, but original changed — inspect both versions"));
    });
  }
  function changeRemotePermissions(entry:FileEntry){
    setContext(null);
    if(busy || (interactive && !authReady) || !remote || !portableName(entry.name) ||
      !["file","directory"].includes(entry.kind) || entry.permissions==null)return;
    if(!canDiscardEdits())return;
    const initial=(entry.permissions & 0o777).toString(8).padStart(3,"0");
    const supplied=window.prompt(ru
      ? `Права POSIX для ${entry.name} (только 000–777, без специальных битов):`
      : `POSIX permissions for ${entry.name} (000–777 only, no special bits):`,initial);
    if(supplied===null)return;
    if(!/^(?:0)?[0-7]{3}$/.test(supplied)){
      setError(ru?"Требуется трёхзначный восьмеричный режим, например 640.":
        "Enter three octal digits, e.g. 640; no setuid, setgid or sticky flags.");
      return;
    }
    const mode=Number.parseInt(supplied,8);
    if(mode===(entry.permissions & 0o777))return;
    const worldWritable=!!(mode & 0o002);
    const warning=worldWritable
      ? (ru?"\nВНИМАНИЕ: запись разрешена всем пользователям.":"\nWARNING: world-writable permissions.")
      : "";
    if(!window.confirm(ru
      ? `Изменить права удалённого ${entry.kind==="directory"?"каталога":"файла"} ${entry.name} в ${remote.path} с ${initial} на ${supplied}?${warning}\nБез автоматической отмены.`
      : `Change permissions of remote ${entry.kind} ${entry.name} in ${remote.path} from ${initial} to ${supplied}?${warning}\nThis cannot be automatically undone.`))return;
    const directory=remote.path;
    void run(id=>invoke("files_chmod",{id,request:{
      destination,directory,name:entry.name,expectedKind:entry.kind,
      expectedPermissions:entry.permissions,expectedSize:entry.size,
      expectedModified:entry.modified,mode
    }}),()=>{
      setRemote(null);selectRemote("");setBatchRemote([]);
      setStatus(ru?"Права изменены; список обновлён":"Permissions changed; listing refreshed");
    }).then(ok=>{if(ok && mounted.current)list(true,directory);});
  }
  function mutate(isRemote: boolean, action: "mkdir" | "rename" | "delete", nameOverride?: string|null) {
    setContext(null);
    if(isRemote && !canDiscardEdits())return;
    const listing = isRemote ? remote : local;
    if (!listing || busy || (isRemote && interactive && !authReady)) return;
    const nameSelected = nameOverride === undefined ? (isRemote ? remoteSelection : localSelection) : (nameOverride ?? "");
    const entry = listing.entries.find(e => e.name === nameSelected);
    if (action !== "mkdir" && (!entry || !portableName(entry.name) || !["file","directory"].includes(entry.kind))) return;
    let name = entry?.name ?? "";
    let newName: string | null = null;
    if (action === "mkdir") {
      name = window.prompt(ru ? "Название новой папки:" : "New folder name:", "") ?? "";
      if (!name) return;
    } else if (action === "rename") {
      newName = window.prompt(ru ? "Новое имя:" : "New name:", name);
      if (newName === null || newName === name) return;
    } else if (action === "delete") {
      const confirmText = ru
        ? `Безвозвратно удалить ${entry!.kind === "directory" ? "ПУСТУЮ папку" : "файл"}?\n${name}\n${listing.path}\nОперацию нельзя отменить.`
        : `Permanently delete ${entry!.kind === "directory" ? "EMPTY directory" : "file"}?\n${name}\n${listing.path}\nThis cannot be undone.`;
      if (!window.confirm(confirmText)) return;
    }
    if (!portableName(name) || (newName !== null && !portableName(newName))) {
      setError(ru ? "Недопустимое имя файла или папки." : "Invalid file or directory name."); return;
    }
    const existing = newName ?? name;
    if (action !== "delete" && listing.entries.some(e => e.name === existing)) {
      setError(ru ? "Имя уже существует. Перезапись запрещена." : "Destination already exists; no overwrite."); return;
    }
    const currentFolder = listing.path;
    void run(id => invoke("files_mutate",{id,request:{
      destination:isRemote ? destination : null,
      directory:currentFolder, name, action, newName,
      expectedKind:entry?.kind ?? null,
    }}), () => {
      if (isRemote) {setRemote(null); selectRemote(""); setBatchRemote([]);} else {setLocal(null); selectLocal(""); setBatchLocal([]);}
      setStatus(ru ? "Изменение выполнено" : "Change completed");
    }).then(ok => {
      if (ok && mounted.current) list(isRemote,currentFolder);
    });
  }
  function dragFile(event: React.DragEvent, isRemote: boolean, entry: FileEntry, folder: string) {
    if (busy || !portableName(entry.name) || entry.kind !== "file") {event.preventDefault();return;}
    event.dataTransfer.effectAllowed = "copy";
    const selection = isRemote ? batchRemote : batchLocal;
    const names = selection.includes(entry.name) ? selection : [entry.name];
    event.dataTransfer.setData("application/x-nodedesk-file",JSON.stringify({
      source:isRemote ? "remote" : "local",name:entry.name,names,folder
    }));
  }
  function dropFile(event: React.DragEvent, isRemote: boolean) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const raw = event.dataTransfer.getData("application/x-nodedesk-file");
    if (!raw || !local || !remote || busy || (interactive && !authReady)) return;
    try {
      const payload = JSON.parse(raw) as {source?:unknown;name?:unknown;names?:unknown;folder?:unknown};
      if (payload.source !== "remote" && payload.source !== "local") return;
      const sourceRemote = payload.source === "remote";
      if (sourceRemote === isRemote) return;
      const source = sourceRemote ? remote : local;
      const names = Array.isArray(payload.names) ? payload.names : [payload.name];
      if (payload.folder !== source.path || names.length<1 || names.length>50 ||
        new Set(names).size !== names.length ||
        names.some(name => typeof name !== "string" || !portableName(name) ||
          !source.entries.some(entry => entry.name===name && entry.kind==="file"))) return;
      if (names.length===1) transfer(!sourceRemote,names[0]);
      else transferSelected(!sourceRemote,names);
    } catch { /* ignore external and invalid drops */ }
  }
  async function cancel() {
    pauseQueue.current = false;
    stopQueue.current = true;
    const id = gate.current.id; if (!id) return; setCancelling(true);
    try { await invoke("files_cancel",{id}); } catch(e) { if (!queueProgress) setError(String(e)); }
  }
  function panel(isRemote: boolean) {
    const listing = isRemote ? remote : local, draft = isRemote ? remotePath : localPath;
    const selection = isRemote ? remoteSelection : localSelection, select = isRemote ? selectRemote : selectLocal;
    const filter = isRemote ? remoteFilter : localFilter, visible = isRemote ? filteredRemote : filteredLocal;
    const chosen = isRemote ? batchRemote : batchLocal;
    const title = isRemote ? (ru ? "Удалённая FS" : "Remote filesystem") : (ru ? "Локальная FS" : "Local filesystem");
    const kinds = ru ? {file:"Файл",directory:"Папка",symlink:"Ссылка",other:"Другой"} : {file:"File",directory:"Folder",symlink:"Link",other:"Other"};
    return <section className={`files-panel ${dropTarget === (isRemote ? "remote" : "local") ? "files-drop-target" : ""}`}
      aria-label={title}
      onDragOver={e => {
        if (busy || !local || !remote || (interactive && !authReady) || !e.dataTransfer.types.includes("application/x-nodedesk-file")) return;
        e.preventDefault(); e.dataTransfer.dropEffect="copy";
        setDropTarget(isRemote ? "remote" : "local");
      }}
      onDragLeave={e => {if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);}}
      onDrop={e => dropFile(e,isRemote)}>
      <h3>{title}</h3>
      <form className="files-path" onSubmit={e => {e.preventDefault(); list(isRemote,draft);}}>
        <input aria-label={title + (ru ? ": путь" : ": path")} value={draft} disabled={busy} placeholder={isRemote ? "." : (ru ? "Пусто = домашняя папка" : "Empty = home directory")} onChange={e => isRemote ? setRemotePath(e.target.value) : setLocalPath(e.target.value)}/>
        <button disabled={busy} type="submit">{ru ? "Открыть / обновить" : "Open / refresh"}</button>
        <button disabled={busy || !listing} type="button" onClick={() => listing && list(isRemote,parentPath(listing.path,isRemote))}>{ru ? "Вверх" : "Up"}</button>
      </form>
      <p className="files-current">{listing?.path ?? (ru ? "Панель не загружена" : "Pane not loaded")}</p>
      <input className="files-filter" type="search"
        aria-label={title + (ru ? ": поиск файлов" : ": search files")}
        placeholder={ru ? "Фильтр по имени…" : "Filter by filename…"}
        value={filter} disabled={!listing || busy}
        onChange={event => {
          if (isRemote) { setRemoteFilter(event.target.value); selectRemote(""); setBatchRemote([]); }
          else { setLocalFilter(event.target.value); selectLocal(""); setBatchLocal([]); }
        }}/>
      <div className="files-multiselect">
        <span>{ru ? "Выбрано для передачи" : "Selected for transfer"}: {chosen.length}/50</span>
        <button type="button"
          disabled={!listing || busy || !visible.some(entry => entry.kind==="file" && portableName(entry.name))}
          onClick={() => (isRemote ? setBatchRemote : setBatchLocal)(
            visible.filter(entry => entry.kind==="file" && portableName(entry.name))
              .slice(0,50).map(entry => entry.name)
          )}>{ru ? "Выбрать видимые (до 50)" : "Select visible (up to 50)"}</button>
        <button type="button" disabled={!listing || busy || chosen.length===0}
          onClick={() => (isRemote ? setBatchRemote : setBatchLocal)([])}>{ru ? "Снять выделение" : "Clear selection"}</button>
      </div>
      <div className="files-ops">
        {isRemote && <button type="button"
          disabled={busy || (interactive && !authReady) || !listing || !listing.entries.some(e=>e.name===selection&&e.kind==="file"&&portableName(e.name))}
          onClick={()=>previewRemote()}>
          {ru?"Текст: просмотр":"Preview text"}
        </button>}
        <button type="button" disabled={busy || !listing || (isRemote && interactive && !authReady)} onClick={() => mutate(isRemote,"mkdir")}>{ru ? "Новая папка" : "New folder"}</button>
        <button type="button" disabled={busy || !listing || !listing.entries.some(e => e.name === selection && ["file","directory"].includes(e.kind))} onClick={() => mutate(isRemote,"rename")}>{ru ? "Переименовать" : "Rename"}</button>
        <button type="button" disabled={busy || !listing || !listing.entries.some(e => e.name===selection && ["file","directory"].includes(e.kind))} onClick={() => mutate(isRemote,"delete")}>{ru ? "Удалить" : "Delete"}</button>
      </div>
      <div className="files-table-scroll" onContextMenu={event => {
        if (event.target instanceof Element && event.target.closest("tr")) return;
        event.preventDefault(); showContext(isRemote,null,event.clientX,event.clientY);
      }}><table><thead><tr><th>{ru ? "Выбор" : "Select"}</th><th>{ru ? "Имя" : "Name"}</th><th>{ru ? "Тип" : "Type"}</th><th>{ru ? "Байт" : "Bytes"}</th><th>{ru ? "Изменён" : "Modified"}</th><th>{ru ? "Права" : "Mode"}</th></tr></thead>
        <tbody>{listing && visible.map((e: FileEntry) => <tr key={e.name} className={selection === e.name ? "selected" : ""}
          draggable={!busy && e.kind === "file" && portableName(e.name)}
          onDragStart={event => dragFile(event,isRemote,e,listing.path)}
          onDragEnd={() => setDropTarget(null)}
          tabIndex={0}
          onContextMenu={event => {
            event.preventDefault();event.stopPropagation();
            showContext(isRemote,e.name,event.clientX,event.clientY);
          }}
          onKeyDown={event => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              const rect=event.currentTarget.getBoundingClientRect();
              showContext(isRemote,e.name,rect.left+24,rect.bottom);
            }
          }}
        >
          <td><input type="checkbox"
            aria-label={`${ru ? "Выбрать для передачи" : "Select for transfer"}: ${e.name}`}
            checked={chosen.includes(e.name)}
            disabled={busy || e.kind !== "file" || !portableName(e.name)}
            onChange={event => toggleBatch(isRemote,e.name,event.target.checked)}/></td>
          <td><button disabled={busy || !portableName(e.name)} aria-pressed={selection === e.name} onClick={() => select(e.name)} onDoubleClick={() => {if (e.kind === "directory") list(isRemote,childPath(listing.path,e.name,isRemote));}} title={e.name}>{e.name}</button>
            {e.kind === "directory" && <button disabled={busy || !portableName(e.name)} aria-label={`${ru ? "Открыть папку" : "Open folder"}: ${e.name}`} onClick={() => list(isRemote,childPath(listing.path,e.name,isRemote))}>↳</button>}</td>
          <td>{kinds[e.kind]}</td><td>{e.size ?? "—"}</td><td>{e.modified == null ? "—" : new Date(e.modified * 1000).toLocaleString(ru ? "ru-RU" : "en-US")}</td><td>{e.permissions == null ? "—" : (e.permissions & 0o7777).toString(8)}</td>
        </tr>)}</tbody></table>
        {listing && !listing.entries.length && <p>{ru ? "Пустая папка" : "Empty directory"}</p>}
        {listing && !!listing.entries.length && !visible.length && <p>{ru ? "Совпадений нет" : "No matches"}</p>}
      </div>
    </section>;
  }
  return <section className="file-browser" aria-label={ru ? "Файловый менеджер SFTP" : "SFTP file manager"}>
    <label><input type="checkbox" checked={interactive} disabled={busy || !capabilities?.interactiveLogin}
      onChange={e => setInteractive(e.target.checked)}/>{ru ? "Интерактивный вход для файлов (пароль/PAM)" : "Interactive Files login (password/PAM)"}</label>
    {!interactive && <label>{ru ? "Путь к SSH-ключу для файлов (необязательно)" : "SSH identity file path for Files (optional)"}
      <input aria-label="Files SSH identity file path" value={identity} disabled={busy} maxLength={4096}
        autoComplete="off" spellCheck={false} onChange={e=>setIdentity(e.target.value)}/>
    </label>}
    {!interactive && <p className="ssh-help">{ru
      ? "Укажите абсолютный путь к локальному ключу. Путь действует только в этой вкладке и не сохраняется. Для зашифрованного ключа заранее загрузите его в SSH-агент: файловые операции не показывают запрос парольной фразы. Ключ сервера должен быть заранее подтверждён."
      : "Enter an absolute path to a local key. The path applies only to this tab and is not saved. Load encrypted keys into your SSH agent first: Files operations cannot prompt for a passphrase. The host key must already be trusted."}</p>}
    {capabilities && !capabilities.interactiveLogin && <p className="ssh-help" role="status">
      {ru
        ? "Графический пароль/PAM на этой платформе пока недоступен. Используйте SSH-ключ/агент для файлов или SSH/SFTP-терминал для входа по паролю. Проверка ключа сервера обязательна."
        : "GUI password/PAM is not available on this platform yet. Use SSH key/agent for files, or the SSH/SFTP console for password login. Host-key verification remains required."}
    </p>}
    {interactive && <div className="files-login"><SshTerminal key={profile} connection={connection} language={language} kind="filesauth" passwordOnly={!!capabilities?.nativeLogin} onSession={setAuthSession}/><p role="status">{authReady ? (ru ? "Вход выполнен — панели готовы" : "Authenticated — panes ready") : (ru ? "Ожидается вход" : "Waiting for login")}</p></div>}
    {interactive && capabilities?.nativeLogin && <p className="ssh-help">{ru ? "Windows: только пароль/PAM и заранее доверенный host key. Новый ключ сначала сверьте и примите в SSH-консоли. Отмена передачи закрывает файловую сессию; затем подключитесь повторно. Для ключа/агента снимите галочку." : "Windows: password/PAM and a previously trusted host key only. Verify and accept new keys in the SSH console first. Cancelling a transfer closes the Files session; reconnect afterwards. For key/agent, uncheck interactive login."}</p>}
    <p className="ssh-help">{ru ? "При снятой галочке: ключ/агент и ранее доверенный host key (Linux/Windows). Перезапись запрещена. Отмена upload может оставить .nodedesk-*.part. Лимит операции 120 секунд." : "Unchecked: key/agent and previously trusted host key (Linux/Windows). No overwrite. Cancelled uploads may leave .nodedesk-*.part. Operation timeout: 120 seconds."}</p>
    <div className="files-actions">
      <button disabled={!transferAllowed(local?.entries.find(e => e.name === localSelection),local,remote,busy)} onClick={() => transfer(true)}>{ru ? "Загрузить → сервер" : "Upload → remote"}</button>
      <button disabled={!transferAllowed(remote?.entries.find(e => e.name === remoteSelection),local,remote,busy)} onClick={() => transfer(false)}>{ru ? "← Скачать локально" : "← Download locally"}</button>
      <button disabled={!batchLocal.length || busy || (interactive && !authReady) || !local || !remote}
        onClick={() => transferSelected(true)}>{ru ? `Загрузить выбранные (${batchLocal.length})` : `Upload selected (${batchLocal.length})`}</button>
      <button disabled={!batchRemote.length || busy || (interactive && !authReady) || !local || !remote}
        onClick={() => transferSelected(false)}>{ru ? `Скачать выбранные (${batchRemote.length})` : `Download selected (${batchRemote.length})`}</button>
      <button disabled={!busy || cancelling} onClick={() => void cancel()}>{cancelling ? (ru ? "Отменяется…" : "Cancelling…") : (ru ? "Отменить операцию" : "Cancel operation")}</button>
    </div>
    <div className="files-recovery">
      <label>
        <input type="checkbox" aria-label={ru?"Хранить восстановление очереди":"Keep queue recovery"}
          checked={keepRecovery} onChange={event=>{
            const enabled=event.target.checked;
            if(!enabled && savedRecoveries.length>0 && !window.confirm(ru
              ? "Отключение восстановления удалит ВСЕ сохранённые очереди для этого подключения. Частичные .part файлы останутся. Продолжить?"
              : "Disabling recovery forgets ALL saved queues for this connection. Partial .part files remain. Continue?"))return;
            recoveryEnabled.current=enabled;setKeepRecovery(enabled);
            if(!enabled)discardCheckpoint();
          }}/>
        {ru?"Сохранять незавершённую очередь после перезапуска":
          "Keep unfinished queue for recovery after restart"}
      </label>
      <p className="ssh-help">{ru?
        "По выбору сохраняются адрес сервера, имена и пути файлов, статусы и ID операции в локальном хранилище приложения без шифрования. Пароли, ключи и содержимое файлов не сохраняются. Без автоподключения и автопередачи. До 8 очередей, 7 дней.":
        "Opt-in local metadata: server address, filenames, paths, statuses and operation ID are stored without encryption. No passwords, keys or file contents. No automatic connections or transfers. To restore: log in first, then load and refresh both panes. Up to 8 queues, 7 days."}</p>
      {savedRecoveries.map(savedRecovery=><div className="files-ops" key={savedRecovery.queueId??"legacy"}>
        <span>{ru?"Незавершённая очередь":"Saved unfinished queue"}: {savedRecovery.items.filter(item=>item.state!=="done").length} {ru?"файлов":"files"} ({savedRecovery.upload?"upload":"download"}) · {savedRecovery.names[0]}</span>
        <button type="button" disabled={busy || !!gate.current.id || (interactive && !authReady)}
          onClick={()=>restoreCheckpoint(savedRecovery)}>{ru?"Загрузить очередь":"Load saved queue"}</button>
        <button type="button" disabled={busy} onClick={()=>{
          if(window.confirm(ru?"Забыть сохранённую очередь? Файлы .part останутся на диске.":
            "Forget saved queue metadata? .part files remain on disk.")){
            discardCheckpoint(savedRecovery.queueId);
          }
        }}>{ru?"Забыть очередь":"Forget saved queue"}</button>
      </div>)}
    </div>
    {queueArchive.length>0 && <section className="files-batch-report" aria-label={ru?"Очереди передач":"Transfer queues"}>
      <strong>{ru?"Другие очереди":"Other queues"}</strong>
      <div className="files-ops">{queueArchive.map(queue=><button type="button" key={queue.id}
        disabled={busy} onClick={()=>selectArchivedQueue(queue.id)}>
        {queue.plan.upload?(ru?"Загрузка":"Upload"):(ru?"Скачивание":"Download")}: {queue.items.filter(item=>item.state==="done").length}/{queue.items.length}
        {` · ${queue.plan.names[0]}`}
      </button>)}</div>
    </section>}
    {queueProgress && <p role="status">{ru ? "Очередь" : "Queue"}: {queueProgress.index}/{queueProgress.total} — {queueProgress.name}</p>}
    {batchReport.length>0 && <section className="files-batch-report" aria-label={ru ? "Отчёт о передаче" : "Transfer report"}>
      <div className="files-batch-heading">
        <strong>{ru ? "Передача файлов" : "File transfers"}: {batchReport.filter(item => item.state==="done").length}/{batchReport.length}</strong>
        {!batchFinished && queueProgress && <button type="button" disabled={cancelling || pauseQueue.current}
          onClick={()=>void pauseActiveQueue()}>{ru?"Приостановить очередь":"Pause queue"}</button>}
        {batchFinished && retryPlan && remainingBatchIndexes(batchReport).length>0 && <button type="button"
          disabled={busy} onClick={()=>retryUnfinished(false)}>
          {ru?"Повторить незавершённые":"Retry unfinished"}
        </button>}
        {batchFinished && !busy && retryPlan && (retryPlan.upload?partialUpload:partialDownload) &&
          remainingBatchIndexes(batchReport).includes((retryPlan.upload?partialUpload:partialDownload)!.index) &&
          <button type="button" onClick={()=>retryUnfinished(true)}>
            {retryPlan.upload
              ? (ru?"Возобновить загрузку с проверкой":"Resume verified upload")
              : (ru?"Возобновить скачивание с проверкой":"Resume verified download")}
          </button>}
        {batchFinished && retryPlan && !busy && <button type="button"
          onClick={downloadRedactedReport}>
          {ru?"Скачать отчёт без имён и адресов":"Download redacted report"}
        </button>}
        {batchFinished && !busy && <button type="button" onClick={() => {
          setBatchReport([]);setBatchFinished(false);setRetryPlan(null);
          setPartialUpload(null);setPartialDownload(null);
          if(retryPlan){discardCheckpoint(retryPlan.id);setQueueArchive(current=>current.filter(q=>q.id!==retryPlan.id));}
        }}>
          {ru ? "Очистить отчёт" : "Clear report"}</button>}
      </div>
      {batchFinished && retryPlan && (retryPlan.upload?partialUpload:partialDownload) &&
        remainingBatchIndexes(batchReport).length>0 && <details className="ssh-help">
          <summary>{ru?"Диагностика частичного файла (.part)":"Partial-file diagnostic (.part)"}</summary>
          <p>{ru
            ?"После сбоя может остаться неполный файл. Ниже только ожидаемый путь; существование файла не подтверждено. Перед удалением проверь источник и результаты передачи."
            :"A failed transfer may leave a partial file. This is only an expected path, not proof of existence. Check the source and outcome before cleanup."}</p>
          <code style={{overflowWrap:"anywhere"}}>{childPath(
            retryPlan.upload?retryPlan.remoteDirectory:retryPlan.localDirectory,
            `.nodedesk-${(retryPlan.upload?partialUpload:partialDownload)!.previousId}.part`,
            retryPlan.upload)}</code>
        </details>}
      {batchFinished && retryPlan && remainingBatchIndexes(batchReport).length>0 && <p className="ssh-help">
        {ru?"Обнови ОБЕ панели. Обычный повтор начинает файл с нуля; проверенное возобновление сравнивает частичный файл с источником перед дозагрузкой. Готовые файлы не повторяются.":
          "Refresh BOTH panes. Normal retry starts at byte zero; verified resume compares the partial to its source before transferring the remainder. Completed files are untouched."}
      </p>}
      <ol>{batchReport.map((item,index) => <li key={index} className={`files-batch-${item.state}`}>
        <span>{item.name}</span>
        <span>{ru
          ? ({queued:"Ожидает",active:"Передаётся",done:"Готово",failed:"Ошибка",cancelled:"Отменён",skipped:"Не запускался",paused:"Приостановлен"} as const)[item.state]
          : ({queued:"Queued",active:"Transferring",done:"Done",failed:"Failed",cancelled:"Cancelled",skipped:"Not started",paused:"Paused"} as const)[item.state]}</span>
      </li>)}</ol>
    </section>}
    {progress && <div className="files-progress"><progress aria-label={ru ? "Передано" : "Transferred"} max={100} value={progressPercent(progress)}/><span>{progress.bytes} / {progress.total ?? "?"} {ru ? "байт" : "bytes"}</span></div>}
    {error && <p className="error" role="alert">{ru ? "Ошибка операции" : "Operation failed"}: {error}</p>}
    <p role="status">{busy ? (ru ? "Операция выполняется…" : "Operation in progress…") : status}</p>
    <div className="files-panels">{panel(false)}{panel(true)}</div>
    {preview && <section className="files-preview" aria-label={ru?"Редактор удалённого текста":"Remote text editor"}>
      <div className="files-preview-heading">
        <strong>{ru?"Файл":"File"}: {preview.name} ({preview.bytes} {ru?"байт":"bytes"})</strong>
        <div className="files-ops">
          <button type="button" disabled={busy} onClick={()=>setEditing(!editing)}>
            {editing?(ru?"Только просмотр":"Read-only view"):(ru?"Редактировать":"Edit text")}
          </button>
          <button type="button" disabled={busy} onClick={()=>{if(canDiscardEdits())clearEditor();}}>
            {ru?"Закрыть":"Close editor"}
          </button>
        </div>
      </div>
      {editing ? <>
        <label className="files-editor-label">{ru?"Текст файла":"File text"}
          <textarea ref={editorArea} className="files-editor-textarea" aria-label={ru?"Текст файла":"File text"}
            spellCheck={false} value={editDraft} onChange={event=>{setEditDraft(event.target.value);setSavedCopy(null);}}/>
        </label>
        <div className="files-editor-search" role="group" aria-label={ru?"Поиск и замена":"Find and replace"}>
          <label>{ru?"Найти (точное совпадение)":"Find (literal, case-sensitive)"}
            <input type="search" aria-label={ru?"Найти в тексте":"Find in text"} maxLength={MAX_SEARCH_TERM}
              value={findText} onChange={e=>{setFindText(e.target.value);setSearchNotice("");}} />
          </label>
          <button type="button" disabled={!matchCount || busy}
            onClick={()=>jumpToMatch("previous")}>{ru?"Назад":"Previous match"}</button>
          <button type="button" disabled={!matchCount || busy}
            onClick={()=>jumpToMatch("next")}>{ru?"Вперёд":"Next match"}</button>
          <label>{ru?"Заменить на":"Replace with"}
            <input type="text" aria-label={ru?"Текст замены":"Replacement text"}
              maxLength={4096} value={replaceText} onChange={e=>setReplaceText(e.target.value)} />
          </label>
          <button type="button" disabled={!matchCount || busy} onClick={replaceSelected}>
            {ru?"Заменить выделенное":"Replace selected"}
          </button>
          <button type="button" disabled={!matchCount || matchCount>MAX_REPLACEMENTS || busy}
            onClick={replaceAllMatches}>{ru?"Заменить все…":"Replace all…"}</button>
          <span role="status" aria-label={ru?"Совпадения":"Matches"}>
            {ru?"Совпадений":"Matches"}: {matchCount>MAX_REPLACEMENTS?`>${MAX_REPLACEMENTS}`:matchCount}
          </span>
          {searchNotice && <p className="ssh-help" role="status">{searchNotice}</p>}
        </div>
        <div className="files-editor-footer">
          <label>{ru?"Имя новой копии":"New copy filename"}<input aria-label={ru?"Имя новой копии":"New copy filename"}
            value={saveName} maxLength={255} onChange={event=>{setSaveName(event.target.value);setSavedCopy(null);}}/></label>
          <button type="button" disabled={busy || (interactive && !authReady) ||
              !portableName(saveName) || saveName===preview.name || editBytes>131072}
            onClick={saveEditedCopy}>{ru?"Сохранить новой копией":"Save as new copy"}</button>
          <span>{editBytes} / 131072 {ru?"байт":"bytes"}</span>
        </div>
        <p className="ssh-help">{ru
          ?"Исходный файл никогда не перезаписывается. Перед сохранением проверяем, не изменился ли он на сервере. Новая копия создаётся только с новым именем."
          :"Original is never overwritten. Before saving, we check for source changes on the server. The new copy requires a distinct filename."}</p>
      </> : <pre>{preview.content}</pre>}
      {savedCopy && <p role="status">{savedCopy.sourceUnchanged
        ? (ru?`Создана копия: ${savedCopy.name}`:`Saved new copy: ${savedCopy.name}`)
        : (ru?`Копия ${savedCopy.name} создана, но источник изменился!`:`Copy ${savedCopy.name} created, but source changed!`)}</p>}
      <p className="ssh-help">{ru?"Содержимое не сохраняется локально. Не открывайте файлы с секретами.":"Contents are not stored locally. Avoid opening files containing secrets."}</p>
    </section>}
    {context && (() => {
      const listing=context.isRemote ? remote : local;
      const entry=listing?.entries.find(e => e.name===context.name);
      const valid=!!entry && portableName(entry.name) && ["file","directory"].includes(entry.kind);
      const allowed=!busy && !!listing && (!context.isRemote || !interactive || authReady);
      return <div className="files-context-menu" role="menu" aria-label={ru ? "Действия с файлом" : "File actions"}
        style={{left:context.x,top:context.y}}>
        <button role="menuitem" type="button" disabled={!allowed} onClick={() => mutate(context.isRemote,"mkdir",null)}>{ru ? "Новая папка" : "New folder"}</button>
        <button role="menuitem" type="button" disabled={!allowed || !valid || entry?.kind!=="directory"}
          onClick={() => {
            setContext(null);
            if (entry && listing) list(context.isRemote,childPath(listing.path,entry.name,context.isRemote));
          }}>{ru ? "Открыть папку" : "Open folder"}</button>
        <button role="menuitem" type="button" disabled={!allowed || !valid}
          onClick={() => mutate(context.isRemote,"rename",context.name)}>{ru ? "Переименовать" : "Rename"}</button>
        <button role="menuitem" type="button" disabled={!allowed || !valid}
          onClick={() => mutate(context.isRemote,"delete",context.name)}>{ru ? "Удалить…" : "Delete…"}</button>
        {context.isRemote && <button role="menuitem" type="button"
          disabled={!allowed || !valid || entry?.permissions==null}
          onClick={()=>{if(entry)changeRemotePermissions(entry);}}>
          {ru?"Изменить права…":"Change permissions…"}
        </button>}
        {context.isRemote && <button role="menuitem" type="button"
          disabled={!allowed || !valid || entry?.kind!=="file"}
          onClick={()=>previewRemote(context.name)}>
          {ru?"Просмотреть текст":"Preview text"}
        </button>}
        <button role="menuitem" type="button" disabled={!allowed || !valid || entry?.kind!=="file" || !local || !remote}
          onClick={() => {
            setContext(null);
            if (entry) transfer(!context.isRemote,entry.name);
          }}>{context.isRemote ? (ru ? "Скачать…" : "Download…") : (ru ? "Загрузить…" : "Upload…")}</button>
      </div>;
    })()}
  </section>;
}
